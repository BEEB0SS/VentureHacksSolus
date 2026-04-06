"""
LiveBench — real-time signal ingestion for robot hardware.
Supports: simulated, serial (generic), Elegoo V4 WiFi, Yahboom serial.
"""

from __future__ import annotations

import asyncio
import json
import math
import random
import sys
import os
from collections import deque
from datetime import datetime
from typing import Any, Callable

# ── shared-types path injection ──────────────────────────────────────────────
_SHARED = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'packages', 'shared-types', 'src')
if _SHARED not in sys.path:
    sys.path.insert(0, _SHARED)

from models import Anomaly, RuntimePacket, RuntimeSignal, SignalStatus  # noqa: E402

# ── optional hardware imports ────────────────────────────────────────────────
try:
    import serial
    import serial.tools.list_ports
    _SERIAL_OK = True
except ImportError:
    _SERIAL_OK = False

try:
    import socket as _socket_mod
    _SOCKET_OK = True
except ImportError:
    _SOCKET_OK = False


def _now() -> str:
    return datetime.utcnow().isoformat()


class LiveBench:
    """Real-time robot signal monitor."""

    # Default thresholds: (min, max, max_rate_of_change)
    _DEFAULT_THRESHOLDS: dict[str, tuple[float, float, float]] = {
        "left_motor":      (-1.0,  1.0,  0.5),
        "right_motor":     (-1.0,  1.0,  0.5),
        "distance":        ( 0.0, 400.0, 50.0),
        "battery":         ( 9.0,  13.0,  0.5),
        "imu_roll":        (-90.0, 90.0, 20.0),
        "imu_pitch":       (-90.0, 90.0, 20.0),
        "motor_temp":      ( 0.0,  80.0, 10.0),
        "motor1_speed":    (-255.0, 255.0, 100.0),
        "motor2_speed":    (-255.0, 255.0, 100.0),
        "motor3_speed":    (-255.0, 255.0, 100.0),
        "motor4_speed":    (-255.0, 255.0, 100.0),
        "imu_yaw":         (-180.0, 180.0, 30.0),
        "battery_voltage": ( 9.0,  13.0,  0.5),
    }

    def __init__(self, project_id: str):
        self.project_id = project_id
        self.signal_history: dict[str, deque] = {}
        self.signal_thresholds: dict[str, tuple[float, float, float]] = dict(self._DEFAULT_THRESHOLDS)
        self.anomalies: list[Anomaly] = []
        self.listeners: list[Callable] = []
        self.running: bool = False
        self._task: asyncio.Task | None = None
        self.serial_connection = None  # holds open serial.Serial when in serial mode
        self._ingest_count: int = 0    # per-instance counter (not class-level)

    # ── ingestion ────────────────────────────────────────────────────────────

    async def ingest_packet(self, packet: RuntimePacket) -> list[Anomaly]:
        self._ingest_count += 1
        if self._ingest_count % 10 == 1:  # log 1st, then every 10th
            print(f"[LiveBench:{self.project_id}] ingest #{self._ingest_count} source={packet.source} "
                  f"signals={[s.name for s in packet.signals]} listeners={len(self.listeners)}")
        new_anomalies: list[Anomaly] = []

        for sig in packet.signals:
            name = sig.name
            value = sig.value

            if name not in self.signal_history:
                self.signal_history[name] = deque(maxlen=50)

            history = self.signal_history[name]
            thresholds = self.signal_thresholds.get(name)

            if thresholds:
                lo, hi, max_roc = thresholds

                # min/max check
                if value < lo or value > hi:
                    severity = self._severity(value, lo, hi)
                    a = Anomaly(
                        project_id=self.project_id,
                        runtime_packet_id=packet.id,
                        signal_name=name,
                        expected_range=(lo, hi),
                        actual_value=value,
                        severity=severity,
                        description=f"{name}={value:.3f} outside [{lo}, {hi}]",
                    )
                    new_anomalies.append(a)

                # rate-of-change check
                elif len(history) >= 1:
                    prev = history[-1]
                    roc = abs(value - prev)
                    if roc > max_roc:
                        a = Anomaly(
                            project_id=self.project_id,
                            runtime_packet_id=packet.id,
                            signal_name=name,
                            expected_range=(lo, hi),
                            actual_value=value,
                            severity="warning",
                            description=f"{name} rate-of-change {roc:.3f} > {max_roc}",
                        )
                        new_anomalies.append(a)

            history.append(value)

        self.anomalies.extend(new_anomalies)
        # keep last 200 anomalies in memory
        if len(self.anomalies) > 200:
            self.anomalies = self.anomalies[-200:]

        if new_anomalies or True:  # always notify listeners with every packet
            await self._notify(packet, new_anomalies)

        return new_anomalies

    @staticmethod
    def _severity(value: float, lo: float, hi: float) -> str:
        span = (hi - lo) or 1.0
        over = max(value - hi, lo - value, 0)
        ratio = over / span
        if ratio > 0.3:
            return "critical"
        if ratio > 0.1:
            return "error"
        return "warning"

    async def _notify(self, packet: RuntimePacket, anomalies: list[Anomaly]):
        payload = {"packet": _packet_to_dict(packet), "anomalies": [_anomaly_to_dict(a) for a in anomalies]}
        if self._ingest_count % 10 == 1:
            print(f"[LiveBench:{self.project_id}] _notify firing {len(self.listeners)} listener(s)")
        for i, listener in enumerate(list(self.listeners)):
            try:
                if asyncio.iscoroutinefunction(listener):
                    await listener(payload)
                else:
                    listener(payload)
            except Exception as e:
                print(f"[LiveBench:{self.project_id}] listener[{i}] EXCEPTION: {e}")

    # ── public API ───────────────────────────────────────────────────────────

    def get_current_state(self) -> dict[str, Any]:
        state: dict[str, Any] = {}
        for name, history in self.signal_history.items():
            vals = list(history)
            state[name] = {
                "current": vals[-1] if vals else 0.0,
                "history": vals,
                "min": min(vals) if vals else 0.0,
                "max": max(vals) if vals else 0.0,
                "avg": sum(vals) / len(vals) if vals else 0.0,
            }
        return state

    def get_recent_anomalies(self, n: int = 50) -> list[dict]:
        return [_anomaly_to_dict(a) for a in self.anomalies[-n:]]

    def set_thresholds(self, thresholds: dict[str, tuple[float, float, float]]):
        self.signal_thresholds.update(thresholds)

    def add_listener(self, fn: Callable):
        if fn not in self.listeners:
            self.listeners.append(fn)

    def remove_listener(self, fn: Callable):
        self.listeners = [l for l in self.listeners if l is not fn]

    def stop(self):
        self.running = False
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = None
        if self.serial_connection:
            try:
                self.serial_connection.close()
            except Exception:
                pass
            self.serial_connection = None
        # Clear stale telemetry so reconnects start fresh
        self.signal_history = {}
        self.anomalies = []
        # Notify listeners that we disconnected (fire-and-forget tasks)
        try:
            loop = asyncio.get_running_loop()
            for listener in list(self.listeners):
                try:
                    loop.create_task(listener({"event": "disconnected"}))
                except Exception:
                    pass
        except RuntimeError:
            pass  # no running loop (e.g. called from sync startup code)
        print("[LiveBench] Stopped and cleared all state")

    @staticmethod
    def list_serial_ports() -> list[dict]:
        if not _SERIAL_OK:
            return []
        result = []
        for p in serial.tools.list_ports.comports():
            is_arduino = (
                (p.vid == 0x1A86 and p.pid == 0x7523)   # CH340 (Elegoo / cheap clones)
                or (p.vid == 0x2341)                      # Official Arduino
                or (p.vid == 0x10C4)                      # CP2102 (Silicon Labs)
                or "arduino" in (p.description or "").lower()
                or "ch340"   in (p.description or "").lower()
                or "usb serial" in (p.description or "").lower()
            )
            result.append({
                "device":       p.device,
                "description":  p.description or "",
                "hwid":         p.hwid or "",
                "manufacturer": p.manufacturer or "",
                "vid":          p.vid,
                "pid":          p.pid,
                "is_arduino":   is_arduino,
            })
        # likely Arduino devices first
        result.sort(key=lambda x: (not x["is_arduino"], x["device"]))
        return result

    # ── connection modes ─────────────────────────────────────────────────────

    def start_simulated(self, interval: float = 0.1):
        self.running = True
        self._task = asyncio.get_running_loop().create_task(self._run_simulated(interval))

    async def _run_simulated(self, interval: float):
        t = 0.0
        while self.running:
            left_motor  = 0.5 + 0.3 * math.sin(t * 0.5)  + random.gauss(0, 0.02)
            right_motor = 0.5 + 0.3 * math.cos(t * 0.5)  + random.gauss(0, 0.02)
            distance    = max(5.0, 50 + 30 * math.sin(t * 0.2) + random.gauss(0, 2))
            battery     = max(0.0, 12.6 - t * 0.001 + random.gauss(0, 0.05))
            imu_roll    = random.gauss(0, 2)
            imu_pitch   = random.gauss(0, 2)
            motor_temp  = 25 + t * 0.01 + random.gauss(0, 0.5)

            # 2 % chance of spike on left_motor
            if random.random() < 0.02:
                left_motor = random.choice([-0.5, 1.5, 0.0])

            packet = RuntimePacket(
                project_id=self.project_id,
                source="simulated",
                timestamp=_now(),
                signals=[
                    RuntimeSignal(name="left_motor",  value=left_motor,  unit="duty"),
                    RuntimeSignal(name="right_motor", value=right_motor, unit="duty"),
                    RuntimeSignal(name="distance",    value=distance,    unit="cm"),
                    RuntimeSignal(name="battery",     value=battery,     unit="V"),
                    RuntimeSignal(name="imu_roll",    value=imu_roll,    unit="deg"),
                    RuntimeSignal(name="imu_pitch",   value=imu_pitch,   unit="deg"),
                    RuntimeSignal(name="motor_temp",  value=motor_temp,  unit="°C"),
                ],
                status=SignalStatus.HEALTHY,
            )
            await self.ingest_packet(packet)
            await asyncio.sleep(interval)
            t += interval

    # ── serial (generic) ─────────────────────────────────────────────────────

    def start_serial(self, port: str, baud: int = 9600):
        # Reset state before opening so reconnects never show stale data
        self.signal_history = {}
        self.anomalies = []
        self.running = True
        self._task = asyncio.get_running_loop().create_task(self._run_serial(port, baud))

    async def _run_serial(self, port: str, baud: int):
        if not _SERIAL_OK:
            print(f"[LiveBench] pyserial not installed, cannot open {port}")
            self.running = False
            return
        import serial as pyserial
        try:
            ser = pyserial.Serial(port, baud, timeout=2)
            self.serial_connection = ser
            print(f"[LiveBench] Opened {port} at {baud} baud")
        except Exception as e:
            print(f"[LiveBench] Failed to open {port}: {e}")
            self.running = False
            return

        # Arduino resets on serial open — wait for boot then flush garbage
        await asyncio.sleep(3)
        ser.reset_input_buffer()
        print("[LiveBench] Buffer flushed, reading...")

        loop = asyncio.get_running_loop()
        _line_count = 0
        try:
            while self.running:
                raw = await loop.run_in_executor(None, ser.readline)
                if not raw:
                    continue
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                if _line_count < 5:
                    print(f"[LiveBench] << {line[:120]}")
                _line_count += 1
                packet = self._parse_line(line)
                if packet:
                    await self.ingest_packet(packet)
        except Exception as e:
            print(f"[LiveBench] Serial error: {e}")
            import traceback; traceback.print_exc()
        finally:
            try:
                ser.close()
            except Exception:
                pass
            # Only clear shared state if it still belongs to THIS task.
            # If stop() + start_serial() raced us, the new session owns these.
            if self.serial_connection is ser:
                self.serial_connection = None
            if self._task is asyncio.current_task():
                self.running = False
            print(f"[LiveBench] Serial port closed: {port}")

    def _parse_line(self, line: str) -> RuntimePacket | None:
        """Parse JSON / plain-text / CSV serial lines into a RuntimePacket."""
        import re
        if not line or len(line) < 2:
            return None

        # 1. JSON: {"signals":[{name,value,unit},...]} or flat {name:value}
        try:
            data = json.loads(line)
            if "signals" in data and isinstance(data["signals"], list):
                signals = [
                    RuntimeSignal(name=s["name"], value=float(s["value"]), unit=s.get("unit", ""))
                    for s in data["signals"]
                ]
            elif isinstance(data, dict):
                signals = []
                for k, v in data.items():
                    try:
                        signals.append(RuntimeSignal(name=k, value=float(v)))
                    except (TypeError, ValueError):
                        pass
            else:
                signals = []
            if signals:
                return RuntimePacket(project_id=self.project_id, source="serial",
                                     timestamp=_now(), signals=signals, status=SignalStatus.HEALTHY)
        except (json.JSONDecodeError, ValueError, TypeError, KeyError):
            pass

        # 2. Plain text: "Word(s): NUMBER [UNIT]"  e.g. "Distance: 9 cm"
        m = re.match(r'^(\w[\w\s]*?):\s*([-\d.]+)\s*(\w*)$', line)
        if m:
            try:
                name = m.group(1).strip().lower().replace(" ", "_")
                value = float(m.group(2))
                unit = m.group(3).strip()
                return RuntimePacket(project_id=self.project_id, source="serial",
                                     timestamp=_now(), status=SignalStatus.HEALTHY,
                                     signals=[RuntimeSignal(name=name, value=value, unit=unit)])
            except ValueError:
                pass

        # 3. CSV key=value pairs: "distance_cm=18,battery_v=12.5"
        if "=" in line:
            signals = []
            for pair in line.split(","):
                if "=" in pair:
                    k, _, v = pair.partition("=")
                    try:
                        signals.append(RuntimeSignal(name=k.strip(), value=float(v.strip())))
                    except ValueError:
                        pass
            if signals:
                return RuntimePacket(project_id=self.project_id, source="serial",
                                     timestamp=_now(), signals=signals, status=SignalStatus.HEALTHY)

        return None

    # keep old name as alias so Yahboom path still works
    def _parse_serial_line(self, raw: bytes) -> RuntimePacket | None:
        try:
            line = raw.decode("utf-8", errors="replace").strip()
        except Exception:
            return None
        return self._parse_line(line)

    def send_serial_command(self, command: str) -> bool:
        """Write a newline-terminated command to the open serial port."""
        if self.serial_connection and self.serial_connection.is_open:
            try:
                self.serial_connection.write((command.strip() + "\n").encode())
                print(f"[LiveBench] >> {command}")
                return True
            except Exception as e:
                print(f"[LiveBench] Send failed: {e}")
        return False

    # ── Elegoo V4 WiFi ───────────────────────────────────────────────────────

    def start_elegoo_wifi(self, ip: str = "192.168.4.1", port: int = 100):
        self.running = True
        self._task = asyncio.get_running_loop().create_task(self._run_elegoo_wifi(ip, port))

    async def _run_elegoo_wifi(self, ip: str, port: int):
        if not _SOCKET_OK:
            return
        loop = asyncio.get_running_loop()
        try:
            sock = _socket_mod.socket(_socket_mod.AF_INET, _socket_mod.SOCK_STREAM)
            sock.settimeout(5)
            await loop.run_in_executor(None, sock.connect, (ip, port))
            sock.setblocking(False)
        except Exception:
            return

        buf = b""
        try:
            while self.running:
                # request ultrasonic + motor data
                try:
                    await loop.run_in_executor(None, sock.sendall, json.dumps({"N": 21}).encode())
                except Exception:
                    break

                await asyncio.sleep(0.1)

                try:
                    chunk = await loop.run_in_executor(None, sock.recv, 4096)
                    if chunk:
                        buf += chunk
                except Exception:
                    pass

                # parse complete JSON objects from buffer
                while b"\n" in buf or len(buf) > 512:
                    nl = buf.find(b"\n")
                    if nl == -1:
                        break
                    line, buf = buf[:nl], buf[nl + 1:]
                    packet = self._parse_serial_line(line)
                    if packet:
                        packet.source = "elegoo_wifi"
                        await self.ingest_packet(packet)
        finally:
            try:
                sock.close()
            except Exception:
                pass

    # ── Yahboom serial ───────────────────────────────────────────────────────

    def start_yahboom_serial(self, port: str = "/dev/ttyUSB0"):
        self.running = True
        self._task = asyncio.get_running_loop().create_task(self._run_yahboom_serial(port))

    _YAHBOOM_SIGNALS = {
        "motor1_speed", "motor2_speed", "motor3_speed", "motor4_speed",
        "imu_roll", "imu_pitch", "imu_yaw", "battery_voltage",
    }

    async def _run_yahboom_serial(self, port: str):
        if not _SERIAL_OK:
            return
        loop = asyncio.get_running_loop()
        try:
            ser = serial.Serial(port, 115200, timeout=1)
        except Exception:
            return
        try:
            while self.running:
                line = await loop.run_in_executor(None, ser.readline)
                if not line:
                    continue
                # skip binary lines
                try:
                    line.decode("utf-8")
                except UnicodeDecodeError:
                    continue

                packet = self._parse_serial_line(line)
                if not packet:
                    continue

                # keep only known Yahboom signal names
                packet.signals = [s for s in packet.signals if s.name in self._YAHBOOM_SIGNALS]
                if not packet.signals:
                    continue
                packet.source = "yahboom_serial"
                await self.ingest_packet(packet)
        finally:
            ser.close()


# ── serialisation helpers ────────────────────────────────────────────────────

def _packet_to_dict(p: RuntimePacket) -> dict:
    return {
        "id": p.id,
        "project_id": p.project_id,
        "source": p.source,
        "timestamp": p.timestamp,
        "signals": [{"name": s.name, "value": s.value, "unit": s.unit, "timestamp": s.timestamp} for s in p.signals],
        "status": p.status.value if hasattr(p.status, "value") else p.status,
        "metadata": p.metadata,
    }


def _anomaly_to_dict(a: Anomaly) -> dict:
    return {
        "id": a.id,
        "project_id": a.project_id,
        "runtime_packet_id": a.runtime_packet_id,
        "signal_name": a.signal_name,
        "expected_range": list(a.expected_range),
        "actual_value": a.actual_value,
        "severity": a.severity,
        "description": a.description,
        "created_at": a.created_at,
    }
