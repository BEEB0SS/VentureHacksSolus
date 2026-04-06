"""
LiveBench + Team Memory routes.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from .database import get_connection
from .live_bench import LiveBench, _anomaly_to_dict, _packet_to_dict
from .arduino_flasher import ArduinoFlasher

try:
    from .memory.store import MemoryStore
    _MEMORY_OK = True
except ImportError:
    _MEMORY_OK = False

_flasher = ArduinoFlasher()

router = APIRouter()

# ── in-process state ─────────────────────────────────────────────────────────
live_benches: dict[str, LiveBench] = {}
_ws_clients: dict[str, list[WebSocket]] = {}  # project_id -> active sockets
_broadcasters_attached: set[str] = set()       # project_ids that already have a broadcaster


def _get_or_create(project_id: str) -> LiveBench:
    if project_id not in live_benches:
        live_benches[project_id] = LiveBench(project_id)
    return live_benches[project_id]


def _now() -> str:
    return datetime.utcnow().isoformat()


# ── request/response models ───────────────────────────────────────────────────

class StartConnectionRequest(BaseModel):
    mode: str = "simulated"   # simulated | serial | elegoo_wifi | yahboom
    port: str = ""            # empty → auto-detect first Arduino port
    baud: int = 9600
    ip: str = "192.168.4.1"
    interval: float = 0.1


class ThresholdUpdate(BaseModel):
    thresholds: dict[str, list[float]]  # name -> [min, max, max_roc]


class InjectPacketRequest(BaseModel):
    signals: list[dict[str, Any]]   # [{name, value, unit?}]
    source: str = "manual"


class IssueCreate(BaseModel):
    title: str
    description: str = ""
    reported_by: str = ""
    related_entity_ids: list[str] = []


class FixCreate(BaseModel):
    issue_id: str
    description: str
    steps: list[str] = []
    applied_by: str = ""


class FlashRequest(BaseModel):
    name: str
    code: str
    port: str
    fqbn: str = "arduino:avr:uno"


class SaveSketchRequest(BaseModel):
    name: str
    code: str


class SendCommandRequest(BaseModel):
    command: str


# ── WebSocket broadcast helper ────────────────────────────────────────────────

async def _broadcast(project_id: str, payload: dict):
    clients = list(_ws_clients.get(project_id, []))
    dead: list[WebSocket] = []
    for ws in clients:
        try:
            await ws.send_json(payload)
        except Exception as e:
            print(f"[Broadcast:{project_id}] send_json FAILED: {e}")
            dead.append(ws)
    for ws in dead:
        _ws_clients.get(project_id, []).remove(ws)


def _attach_broadcaster(bench: LiveBench, project_id: str):
    """Register one broadcast listener per project (idempotent)."""
    if project_id in _broadcasters_attached:
        print(f"[Broadcaster:{project_id}] already attached (skipping), bench listeners={len(bench.listeners)}")
        return

    async def _on_data(payload: dict):
        print(f"[Broadcaster:{project_id}] _on_data called, ws_clients={len(_ws_clients.get(project_id, []))}")
        await _broadcast(project_id, payload)

    bench.add_listener(_on_data)
    _broadcasters_attached.add(project_id)
    print(f"[Broadcaster:{project_id}] attached, bench now has {len(bench.listeners)} listener(s)")


def _default_thresholds(bench: LiveBench):
    bench.set_thresholds({
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
    })


# ── Live Bench endpoints ──────────────────────────────────────────────────────

@router.post("/api/projects/{pid}/live-bench/start")
async def start_connection(pid: str, req: StartConnectionRequest):
    bench = _get_or_create(pid)
    if bench.running:
        bench.stop()

    _default_thresholds(bench)
    _attach_broadcaster(bench, pid)

    mode = req.mode.lower()
    if mode == "simulated":
        bench.start_simulated(interval=req.interval)
    elif mode in ("serial", "yahboom"):
        port = req.port
        if not port:
            ports = LiveBench.list_serial_ports()
            arduino_ports = [p for p in ports if p.get("is_arduino")]
            if arduino_ports:
                port = arduino_ports[0]["device"]
            elif ports:
                port = ports[0]["device"]
            else:
                raise HTTPException(400, "No serial ports detected — plug in device or specify port")
        if mode == "serial":
            bench.start_serial(port, req.baud)
        else:
            bench.start_yahboom_serial(port)
    elif mode == "elegoo_wifi":
        bench.start_elegoo_wifi(ip=req.ip)
    else:
        raise HTTPException(400, f"Unknown mode: {req.mode}")

    return {"status": "started", "mode": mode, "project_id": pid}


@router.post("/api/projects/{pid}/live-bench/start-simulated")
async def start_simulated_compat(pid: str, interval: float = 0.1):
    """Backwards-compatible endpoint."""
    bench = _get_or_create(pid)
    if bench.running:
        bench.stop()
    _default_thresholds(bench)
    _attach_broadcaster(bench, pid)
    bench.start_simulated(interval=interval)
    return {"status": "started", "mode": "simulated", "project_id": pid}


@router.post("/api/projects/{pid}/live-bench/stop")
async def stop_bench(pid: str):
    bench = live_benches.get(pid)
    if bench:
        bench.stop()
    return {"status": "stopped", "project_id": pid}


@router.put("/api/projects/{pid}/live-bench/thresholds")
async def update_thresholds(pid: str, req: ThresholdUpdate):
    bench = _get_or_create(pid)
    converted = {k: tuple(v) for k, v in req.thresholds.items()}
    bench.set_thresholds(converted)
    return {"status": "ok", "thresholds_updated": list(req.thresholds.keys())}


@router.post("/api/projects/{pid}/live-bench/packet")
async def inject_packet(pid: str, req: InjectPacketRequest):
    from .live_bench import RuntimePacket, RuntimeSignal, SignalStatus
    bench = _get_or_create(pid)
    signals = [
        RuntimeSignal(name=s["name"], value=float(s.get("value", 0)), unit=s.get("unit", ""))
        for s in req.signals
    ]
    packet = RuntimePacket(
        project_id=pid,
        source=req.source,
        timestamp=_now(),
        signals=signals,
        status=SignalStatus.HEALTHY,
    )
    anomalies = await bench.ingest_packet(packet)
    return {
        "packet": _packet_to_dict(packet),
        "anomalies": [_anomaly_to_dict(a) for a in anomalies],
    }


@router.get("/api/projects/{pid}/live-bench/state")
async def get_state(pid: str):
    bench = live_benches.get(pid)
    if not bench:
        return {"running": False, "signals": {}, "anomalies": []}
    return {
        "running": bench.running,
        "signals": bench.get_current_state(),
        "anomalies": bench.get_recent_anomalies(),
    }


@router.get("/api/projects/{pid}/live-bench/logs")
async def get_logs_for_agent(pid: str, anomaly_limit: int = 20):
    """Package current telemetry state + anomalies for the AI agent."""
    if pid not in live_benches:
        return {"signals": {}, "anomalies": [], "summary": "No active bench",
                "signal_count": 0, "anomaly_count": 0}

    bench = live_benches[pid]
    state = bench.get_current_state()
    anomalies = bench.get_recent_anomalies(n=anomaly_limit)

    summary_lines = ["Robot Telemetry Log:"]
    for name, info in state.items():
        summary_lines.append(
            f"  {name}: current={info['current']:.3f}, "
            f"min={info['min']:.3f}, max={info['max']:.3f}, avg={info['avg']:.3f}"
        )
    if anomalies:
        summary_lines.append(f"\n{len(anomalies)} anomaly/anomalies detected:")
        for a in anomalies[:10]:
            summary_lines.append(
                f"  [{a.get('severity','?')}] {a.get('signal_name','?')}: {a.get('description','')}"
            )

    return {
        "signals": state,
        "anomalies": anomalies,
        "summary": "\n".join(summary_lines),
        "signal_count": len(state),
        "anomaly_count": len(anomalies),
    }


@router.get("/api/serial-ports")
async def list_serial_ports_global():
    """List serial ports without needing a project ID (used before project creation)."""
    return {"ports": LiveBench.list_serial_ports()}


@router.get("/api/projects/{pid}/live-bench/serial-ports")
async def list_serial_ports(pid: str):
    return {"ports": LiveBench.list_serial_ports()}


@router.post("/api/projects/{pid}/live-bench/command")
async def send_command(pid: str, req: SendCommandRequest):
    bench = live_benches.get(pid)
    if not bench:
        raise HTTPException(404, "No active bench for this project")
    success = bench.send_serial_command(req.command)
    return {"success": success, "command": req.command}


# ── WebSocket ────────────────────────────────────────────────────────────────

@router.websocket("/ws/projects/{pid}/live-bench")
async def ws_live_bench(ws: WebSocket, pid: str):
    await ws.accept()
    _ws_clients.setdefault(pid, []).append(ws)
    print(f"[WS:{pid}] client connected, total={len(_ws_clients[pid])}")

    bench = _get_or_create(pid)
    print(f"[WS:{pid}] bench running={bench.running} listeners={len(bench.listeners)}")
    _attach_broadcaster(bench, pid)

    # Auto-start simulation if nothing is running
    if not bench.running:
        print(f"[WS:{pid}] bench not running — auto-starting simulation")
        _default_thresholds(bench)
        bench.start_simulated()
        print(f"[WS:{pid}] simulation started, task={bench._task}")

    # Send current state immediately so the client has data right away
    try:
        await ws.send_json({"type": "state", "data": {
            "running": bench.running,
            "signals": bench.get_current_state(),
            "anomalies": bench.get_recent_anomalies(),
        }})
        print(f"[WS:{pid}] sent initial state")
    except Exception as e:
        print(f"[WS:{pid}] failed to send initial state: {e}")

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                if msg.get("type") == "send_serial":
                    bench.send_serial_command(msg.get("command", ""))
            except Exception:
                pass
    except WebSocketDisconnect:
        print(f"[WS:{pid}] client disconnected")
    except Exception as e:
        print(f"[WS:{pid}] unexpected error in receive loop: {e}")
    finally:
        clients = _ws_clients.get(pid, [])
        if ws in clients:
            clients.remove(ws)
        print(f"[WS:{pid}] cleaned up, remaining clients={len(_ws_clients.get(pid, []))}")


# ── Issues (Team Memory) ──────────────────────────────────────────────────────

@router.post("/api/projects/{pid}/issues")
async def create_issue(pid: str, req: IssueCreate):
    issue_id = str(uuid.uuid4())
    now = _now()
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO issues (id,project_id,title,description,status,related_entity_ids,reported_by,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (issue_id, pid, req.title, req.description, "open",
             json.dumps(req.related_entity_ids), req.reported_by, now, now),
        )
        conn.commit()

    # semantic memory
    if _MEMORY_OK:
        try:
            store = MemoryStore(pid)
            store.add(
                content=f"Issue: {req.title}\n{req.description}",
                content_type="issue",
                metadata={"issue_id": issue_id},
            )
        except Exception:
            pass

    return {"id": issue_id, "status": "open", "created_at": now}


@router.get("/api/projects/{pid}/issues")
async def list_issues(pid: str):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM issues WHERE project_id=? ORDER BY created_at DESC", (pid,)
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/api/projects/{pid}/fixes")
async def create_fix(pid: str, req: FixCreate):
    fix_id = str(uuid.uuid4())
    now = _now()
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO fixes (id,issue_id,project_id,description,steps,applied_by,created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (fix_id, req.issue_id, pid, req.description,
             json.dumps(req.steps), req.applied_by, now),
        )
        conn.execute(
            "UPDATE issues SET status=?,updated_at=? WHERE id=? AND project_id=?",
            ("resolved", now, req.issue_id, pid),
        )
        conn.commit()

    # semantic memory
    if _MEMORY_OK:
        try:
            store = MemoryStore(pid)
            store.add(
                content=f"Fix for issue {req.issue_id}: {req.description}\nSteps: {'; '.join(req.steps)}",
                content_type="fix",
                metadata={"fix_id": fix_id, "issue_id": req.issue_id},
            )
        except Exception:
            pass

    return {"id": fix_id, "issue_id": req.issue_id, "created_at": now}


@router.get("/api/projects/{pid}/similar-issues")
async def similar_issues(pid: str, query: str = ""):
    if not _MEMORY_OK or not query:
        # fallback: return all issues
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM issues WHERE project_id=? ORDER BY created_at DESC LIMIT 10", (pid,)
            ).fetchall()
        return [dict(r) for r in rows]

    try:
        store = MemoryStore(pid)
        results = store.search(query, content_type="issue", limit=5)
        return results
    except Exception:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM issues WHERE project_id=? ORDER BY created_at DESC LIMIT 10", (pid,)
            ).fetchall()
        return [dict(r) for r in rows]


# ── Arduino CLI routes ────────────────────────────────────────────────────────

@router.post("/api/arduino/boards")
async def arduino_list_boards():
    if not _flasher.is_available():
        raise HTTPException(503, "arduino-cli not found on PATH")
    loop = asyncio.get_running_loop()
    boards = await loop.run_in_executor(None, _flasher.list_boards)
    return {"boards": boards}


@router.post("/api/arduino/flash")
async def arduino_flash(req: FlashRequest):
    if not _flasher.is_available():
        raise HTTPException(503, "arduino-cli not found on PATH")

    # Stop any live bench holding this port open and wait for OS to release it
    for pid, bench in live_benches.items():
        if bench.running and bench.serial_connection:
            try:
                if bench.serial_connection.port == req.port:
                    bench.stop()
                    await asyncio.sleep(1)
                    break
            except Exception:
                pass

    result = await _flasher.compile_and_upload(req.name, req.code, req.port, req.fqbn)

    # Notify all WS listeners so the UI can prompt the user to reconnect
    if result.get("success"):
        for pid, bench in live_benches.items():
            for listener in list(bench.listeners):
                try:
                    await listener({
                        "event": "code_flashed",
                        "message": "New Arduino code uploaded successfully. Reconnect to see changes.",
                        "sketch_name": req.name,
                    })
                except Exception:
                    pass

    return result


@router.get("/api/arduino/sketches")
async def arduino_list_sketches():
    loop = asyncio.get_running_loop()
    sketches = await loop.run_in_executor(None, _flasher.get_saved_sketches)
    return {"sketches": sketches}


@router.post("/api/arduino/sketches")
async def arduino_save_sketch(req: SaveSketchRequest):
    loop = asyncio.get_running_loop()
    path = await loop.run_in_executor(None, _flasher.save_sketch, req.name, req.code)
    return {"name": req.name, "path": str(path)}


@router.get("/api/arduino/available")
async def arduino_available():
    return {"available": _flasher.is_available(), "path": _flasher.arduino_cli}


# ── Camera proxy ──────────────────────────────────────────────────────────────

@router.get("/api/projects/{pid}/live-bench/camera")
async def camera_stream(pid: str, ip: str = "192.168.4.1", port: int = 80):
    try:
        import httpx
    except ImportError:
        raise HTTPException(503, "httpx not installed — run: pip install httpx")

    async def _stream():
        try:
            async with httpx.AsyncClient() as client:
                url = f"http://{ip}:{port}/stream"
                async with client.stream("GET", url,
                                         timeout=httpx.Timeout(5.0, read=None)) as r:
                    async for chunk in r.aiter_bytes(4096):
                        yield chunk
        except Exception as e:
            print(f"[Camera] Stream error: {e}")
            yield b""

    return StreamingResponse(_stream(), media_type="multipart/x-mixed-replace; boundary=frame")


@router.get("/api/projects/{pid}/live-bench/camera/snapshot")
async def camera_snapshot(pid: str, ip: str = "192.168.4.1"):
    try:
        import httpx
    except ImportError:
        raise HTTPException(503, "httpx not installed — run: pip install httpx")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"http://{ip}/capture")
            return Response(content=r.content, media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(503, f"Camera unavailable: {e}")


@router.get("/api/projects/{pid}/live-bench/camera/status")
async def camera_status(pid: str, ip: str = "192.168.4.1"):
    try:
        import httpx
    except ImportError:
        return {"available": False, "ip": ip, "error": "httpx not installed"}
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"http://{ip}/capture")
            return {"available": r.status_code == 200, "ip": ip}
    except Exception as e:
        return {"available": False, "ip": ip, "error": str(e)}
