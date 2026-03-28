# Live Bench Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full Live Bench feature — a real-time telemetry monitoring system with simulated data generation, anomaly detection, issue/fix tracking with semantic search, WebSocket streaming, and an interactive frontend dashboard with sparkline charts.

**Architecture:** The backend has three layers: (1) `live_bench.py` — the telemetry engine that generates simulated signals, detects anomalies against configurable thresholds, and manages per-project state; (2) `routes_livebench.py` — FastAPI routes + a WebSocket endpoint that streams telemetry packets to the frontend; (3) `LiveBenchTab.tsx` — a React dashboard showing a signal grid with sparklines, anomaly feed, and issue/fix panels. Issues and fixes integrate with Teammate 2's existing `memory_store.py` for semantic similarity search (Demo C: Team Memory Reuse).

**Tech Stack:** Python FastAPI, WebSocket (via `fastapi.WebSocket`), asyncio, pytest; React 18, TypeScript, Tailwind CSS, Recharts (sparklines), Zustand (existing store)

---

## Integration Points (Read-Only — Do NOT Modify)

These files already exist and the LiveBench feature must integrate with them:

| File | What It Provides |
|------|-----------------|
| `packages/shared_types/src/models.py` | `RuntimeSignal`, `RuntimePacket`, `Anomaly`, `Issue`, `Fix`, `IssueStatus`, `SignalStatus`, `_uid`, `_now` |
| `apps/backend/src/database.py` | `get_connection()`, `init_db()` — tables `runtime_packets`, `anomalies`, `issues`, `fixes` already exist |
| `apps/backend/src/memory/memory_store.py` | `MemoryStore` class (no constructor args) with `store(item: SemanticMemoryItem)` and `find_similar(query, project_id=None, content_type=None, limit=5)` — used for issue similarity search |
| `apps/backend/src/main.py` | Already has `from .routes_livebench import router as livebench_router` with try/except — it will auto-wire when the file exists. **Also needs `ws_router` included** for the WebSocket endpoint (lives at `/ws/...`, not under `/api/...`) |
| `apps/desktop/src/renderer/stores/projectStore.ts` | Zustand store — we will add livebench actions here |
| `apps/desktop/src/renderer/hooks/useWebSocket.ts` | `useWebSocket(path, { onMessage })` hook with auto-reconnect |
| `apps/desktop/src/renderer/constants/api.ts` | `API_BASE` = `http://localhost:8000`, `WS_BASE` = `ws://localhost:8000` |
| `apps/desktop/src/renderer/App.tsx` | Has placeholder `LiveBenchTab` component — we replace it with a real import |
| `apps/backend/tests/conftest.py` | `fresh_db` fixture (auto-use) and `project_id` fixture |

## API Endpoints (from API Surface spec)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/projects/{id}/live-bench/start-simulated` | Start simulated telemetry generation |
| POST | `/api/projects/{id}/live-bench/stop` | Stop telemetry generation |
| POST | `/api/projects/{id}/live-bench/thresholds` | Set anomaly detection thresholds |
| POST | `/api/projects/{id}/live-bench/packet` | Ingest a single telemetry packet |
| GET | `/api/projects/{id}/live-bench/state` | Get current live bench state |
| POST | `/api/projects/{id}/issues` | Log a new issue |
| GET | `/api/projects/{id}/issues` | List all issues |
| POST | `/api/projects/{id}/fixes` | Log a fix for an issue |
| GET | `/api/projects/{id}/similar-issues` | Semantic search for similar past issues |
| WS | `/ws/projects/{id}/live-bench` | Real-time telemetry stream |

---

## File Structure

### Files to Create

| File | Responsibility |
|------|---------------|
| `apps/backend/src/live_bench.py` | Telemetry engine: simulated data generation, anomaly detection, per-project state management |
| `apps/backend/src/routes_livebench.py` | FastAPI APIRouter with all 10 REST endpoints + 1 WebSocket endpoint |
| `apps/backend/tests/test_live_bench.py` | Tests for the telemetry engine |
| `apps/backend/tests/test_routes_livebench.py` | Integration tests for livebench API routes |
| `apps/desktop/src/renderer/components/live-bench/LiveBenchTab.tsx` | Dashboard: signal grid, sparklines, anomaly feed, issue/fix panels |

### Files to Modify

| File | Change |
|------|--------|
| `apps/desktop/src/renderer/App.tsx` | Replace placeholder `LiveBenchTab` with real import |

---

## Task 1: Live Bench Engine — Simulated Telemetry + State Management

**Files:**
- Create: `apps/backend/src/live_bench.py`
- Create: `apps/backend/tests/test_live_bench.py`

**Context:** The live bench engine manages per-project telemetry state. It generates simulated signals (motor speeds, battery voltage, IMU data, temperature) with realistic noise and occasional anomaly injection. It tracks the last N packets in a ring buffer for sparkline history. Anomaly detection compares each signal against configurable thresholds.

- [ ] **Step 1: Write failing tests for telemetry engine**

Create `apps/backend/tests/test_live_bench.py`:

```python
"""Tests for the live bench telemetry engine."""

import os
import time

from packages.shared_types.src.models import SignalStatus


class TestLiveBenchEngine:
    def test_create_engine(self, project_id):
        from apps.backend.src.live_bench import LiveBenchEngine
        engine = LiveBenchEngine(project_id)
        assert engine.project_id == project_id
        assert engine.running is False

    def test_generate_simulated_packet(self, project_id):
        from apps.backend.src.live_bench import LiveBenchEngine
        engine = LiveBenchEngine(project_id)
        packet = engine.generate_simulated_packet()
        assert packet.project_id == project_id
        assert len(packet.signals) > 0
        # Should have standard robotics signals
        signal_names = {s.name for s in packet.signals}
        assert "left_motor_speed" in signal_names
        assert "battery_voltage" in signal_names

    def test_default_thresholds(self, project_id):
        from apps.backend.src.live_bench import LiveBenchEngine
        engine = LiveBenchEngine(project_id)
        thresholds = engine.get_thresholds()
        assert "left_motor_speed" in thresholds
        assert "min" in thresholds["left_motor_speed"]
        assert "max" in thresholds["left_motor_speed"]

    def test_set_thresholds(self, project_id):
        from apps.backend.src.live_bench import LiveBenchEngine
        engine = LiveBenchEngine(project_id)
        engine.set_thresholds({"left_motor_speed": {"min": 0, "max": 50}})
        t = engine.get_thresholds()
        assert t["left_motor_speed"]["max"] == 50

    def test_detect_anomaly(self, project_id):
        from apps.backend.src.live_bench import LiveBenchEngine
        from packages.shared_types.src.models import RuntimePacket, RuntimeSignal
        engine = LiveBenchEngine(project_id)
        engine.set_thresholds({"left_motor_speed": {"min": 0, "max": 100}})
        packet = RuntimePacket(
            project_id=project_id,
            source="simulated",
            signals=[RuntimeSignal(name="left_motor_speed", value=150.0, unit="rpm")],
        )
        anomalies = engine.check_anomalies(packet)
        assert len(anomalies) == 1
        assert anomalies[0].signal_name == "left_motor_speed"
        assert anomalies[0].actual_value == 150.0

    def test_no_anomaly_within_range(self, project_id):
        from apps.backend.src.live_bench import LiveBenchEngine
        from packages.shared_types.src.models import RuntimePacket, RuntimeSignal
        engine = LiveBenchEngine(project_id)
        engine.set_thresholds({"left_motor_speed": {"min": 0, "max": 200}})
        packet = RuntimePacket(
            project_id=project_id,
            source="simulated",
            signals=[RuntimeSignal(name="left_motor_speed", value=100.0, unit="rpm")],
        )
        anomalies = engine.check_anomalies(packet)
        assert len(anomalies) == 0

    def test_ingest_packet_stores_history(self, project_id):
        from apps.backend.src.live_bench import LiveBenchEngine
        engine = LiveBenchEngine(project_id)
        packet = engine.generate_simulated_packet()
        engine.ingest_packet(packet)
        state = engine.get_state()
        assert state["packet_count"] == 1
        assert len(state["history"]) == 1

    def test_history_ring_buffer(self, project_id):
        from apps.backend.src.live_bench import LiveBenchEngine
        engine = LiveBenchEngine(project_id, max_history=3)
        for _ in range(5):
            engine.ingest_packet(engine.generate_simulated_packet())
        state = engine.get_state()
        assert len(state["history"]) == 3  # capped at max_history

    def test_get_state_includes_latest_signals(self, project_id):
        from apps.backend.src.live_bench import LiveBenchEngine
        engine = LiveBenchEngine(project_id)
        engine.ingest_packet(engine.generate_simulated_packet())
        state = engine.get_state()
        assert "latest_signals" in state
        assert len(state["latest_signals"]) > 0

    def test_ingest_detects_and_stores_anomalies(self, project_id):
        from apps.backend.src.live_bench import LiveBenchEngine
        from packages.shared_types.src.models import RuntimePacket, RuntimeSignal
        engine = LiveBenchEngine(project_id)
        engine.set_thresholds({"left_motor_speed": {"min": 0, "max": 100}})
        bad_packet = RuntimePacket(
            project_id=project_id,
            source="test",
            signals=[RuntimeSignal(name="left_motor_speed", value=999.0, unit="rpm")],
        )
        engine.ingest_packet(bad_packet)
        state = engine.get_state()
        assert state["anomaly_count"] > 0

    def test_start_stop(self, project_id):
        from apps.backend.src.live_bench import LiveBenchEngine
        engine = LiveBenchEngine(project_id)
        engine.start()
        assert engine.running is True
        engine.stop()
        assert engine.running is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_live_bench.py -v 2>&1 | head -20`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.backend.src.live_bench'`

- [ ] **Step 3: Implement LiveBenchEngine**

Create `apps/backend/src/live_bench.py`:

```python
"""
Live Bench Engine — Real-time telemetry monitoring for robotics systems.

Generates simulated sensor data, detects anomalies against configurable
thresholds, and maintains per-project state with a ring buffer of recent
packets for sparkline history.
"""

import json
import math
import random
import time
from collections import deque
from typing import Optional

from .database import get_connection

from packages.shared_types.src.models import (
    RuntimeSignal, RuntimePacket, Anomaly, SignalStatus,
    Issue, Fix, IssueStatus,
    _uid, _now,
)

# Default signal definitions for a differential-drive robot
_DEFAULT_SIGNALS = [
    {"name": "left_motor_speed", "unit": "rpm", "base": 120.0, "noise": 8.0},
    {"name": "right_motor_speed", "unit": "rpm", "base": 118.0, "noise": 8.0},
    {"name": "battery_voltage", "unit": "V", "base": 11.8, "noise": 0.3},
    {"name": "imu_accel_x", "unit": "m/s²", "base": 0.0, "noise": 0.5},
    {"name": "imu_accel_y", "unit": "m/s²", "base": 0.0, "noise": 0.5},
    {"name": "imu_gyro_z", "unit": "rad/s", "base": 0.0, "noise": 0.1},
    {"name": "cpu_temperature", "unit": "°C", "base": 55.0, "noise": 3.0},
    {"name": "lidar_range_min", "unit": "m", "base": 0.8, "noise": 0.2},
]

_DEFAULT_THRESHOLDS = {
    "left_motor_speed": {"min": 0, "max": 200},
    "right_motor_speed": {"min": 0, "max": 200},
    "battery_voltage": {"min": 10.0, "max": 14.0},
    "imu_accel_x": {"min": -5.0, "max": 5.0},
    "imu_accel_y": {"min": -5.0, "max": 5.0},
    "imu_gyro_z": {"min": -3.0, "max": 3.0},
    "cpu_temperature": {"min": 20, "max": 80},
    "lidar_range_min": {"min": 0.1, "max": 10.0},
}


class LiveBenchEngine:
    """Per-project telemetry engine with simulated data and anomaly detection."""

    def __init__(self, project_id: str, max_history: int = 60):
        self.project_id = project_id
        self.running = False
        self.max_history = max_history
        self._history: deque[dict] = deque(maxlen=max_history)
        self._thresholds: dict = dict(_DEFAULT_THRESHOLDS)
        self._packet_count = 0
        self._anomaly_count = 0
        self._anomalies: list[dict] = []
        self._latest_signals: list[dict] = []
        self._tick = 0  # for time-varying simulation

    def start(self):
        self.running = True

    def stop(self):
        self.running = False

    def get_thresholds(self) -> dict:
        return dict(self._thresholds)

    def set_thresholds(self, thresholds: dict):
        self._thresholds.update(thresholds)

    def generate_simulated_packet(self) -> RuntimePacket:
        """Generate a realistic telemetry packet with time-varying signals and occasional anomalies."""
        self._tick += 1
        signals = []
        for sig_def in _DEFAULT_SIGNALS:
            # Base value with sinusoidal drift + gaussian noise
            drift = math.sin(self._tick * 0.05) * sig_def["noise"] * 0.5
            noise = random.gauss(0, sig_def["noise"])
            value = sig_def["base"] + drift + noise

            # 3% chance of an anomaly spike for demo purposes
            if random.random() < 0.03:
                threshold = self._thresholds.get(sig_def["name"], {})
                max_val = threshold.get("max", sig_def["base"] * 2)
                value = max_val * random.uniform(1.1, 1.5)

            signals.append(RuntimeSignal(
                name=sig_def["name"],
                value=round(value, 3),
                unit=sig_def["unit"],
            ))

        return RuntimePacket(
            project_id=self.project_id,
            source="simulated",
            signals=signals,
            status=SignalStatus.HEALTHY,
        )

    def check_anomalies(self, packet: RuntimePacket) -> list[Anomaly]:
        """Check all signals in a packet against thresholds. Returns list of anomalies."""
        anomalies = []
        for signal in packet.signals:
            threshold = self._thresholds.get(signal.name)
            if not threshold:
                continue
            min_val = threshold.get("min", float("-inf"))
            max_val = threshold.get("max", float("inf"))
            if signal.value < min_val or signal.value > max_val:
                severity = "critical" if abs(signal.value - (min_val + max_val) / 2) > (max_val - min_val) else "warning"
                anomalies.append(Anomaly(
                    project_id=self.project_id,
                    runtime_packet_id=packet.id,
                    signal_name=signal.name,
                    expected_range=(min_val, max_val),
                    actual_value=signal.value,
                    severity=severity,
                    description=f"{signal.name} = {signal.value:.2f} {signal.unit} (expected {min_val}-{max_val})",
                ))
        return anomalies

    def ingest_packet(self, packet: RuntimePacket) -> list[Anomaly]:
        """Process a telemetry packet: store in history, check anomalies, persist to DB."""
        self._packet_count += 1

        # Store signals for sparkline history
        signal_dict = {s.name: {"value": s.value, "unit": s.unit} for s in packet.signals}
        self._history.append({
            "id": packet.id,
            "timestamp": packet.timestamp,
            "signals": signal_dict,
        })
        self._latest_signals = [
            {"name": s.name, "value": s.value, "unit": s.unit}
            for s in packet.signals
        ]

        # Check anomalies
        anomalies = self.check_anomalies(packet)
        if anomalies:
            packet.status = SignalStatus.WARNING
            self._anomaly_count += len(anomalies)
            for a in anomalies:
                self._anomalies.append({
                    "id": a.id,
                    "signal_name": a.signal_name,
                    "actual_value": a.actual_value,
                    "expected_range": list(a.expected_range),
                    "severity": a.severity,
                    "description": a.description,
                    "created_at": a.created_at,
                })

        # Persist packet to DB
        self._save_packet(packet)
        for a in anomalies:
            self._save_anomaly(a)

        return anomalies

    def get_state(self) -> dict:
        """Get the current live bench state for the API response."""
        return {
            "running": self.running,
            "packet_count": self._packet_count,
            "anomaly_count": self._anomaly_count,
            "latest_signals": self._latest_signals,
            "history": list(self._history),
            "recent_anomalies": self._anomalies[-20:],
            "thresholds": self._thresholds,
        }

    def _save_packet(self, packet: RuntimePacket):
        conn = get_connection()
        signals_json = json.dumps([
            {"name": s.name, "value": s.value, "unit": s.unit, "timestamp": s.timestamp}
            for s in packet.signals
        ])
        conn.execute(
            "INSERT INTO runtime_packets (id, project_id, source, timestamp, signals, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (packet.id, packet.project_id, packet.source, packet.timestamp,
             signals_json, packet.status.value if hasattr(packet.status, 'value') else packet.status,
             json.dumps(packet.metadata)),
        )
        conn.commit()
        conn.close()

    def _save_anomaly(self, anomaly: Anomaly):
        conn = get_connection()
        conn.execute(
            "INSERT INTO anomalies (id, project_id, runtime_packet_id, signal_name, expected_min, expected_max, actual_value, severity, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (anomaly.id, anomaly.project_id, anomaly.runtime_packet_id,
             anomaly.signal_name, anomaly.expected_range[0], anomaly.expected_range[1],
             anomaly.actual_value, anomaly.severity, anomaly.description, anomaly.created_at),
        )
        conn.commit()
        conn.close()


# ── Issue / Fix CRUD (uses existing DB tables) ──

def create_issue(project_id: str, title: str, description: str = "",
                 related_entity_ids: list[str] | None = None, reported_by: str = "") -> Issue:
    issue = Issue(
        project_id=project_id, title=title, description=description,
        related_entity_ids=related_entity_ids or [], reported_by=reported_by,
    )
    conn = get_connection()
    conn.execute(
        "INSERT INTO issues (id, project_id, title, description, status, related_entity_ids, reported_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (issue.id, issue.project_id, issue.title, issue.description,
         issue.status.value, json.dumps(issue.related_entity_ids),
         issue.reported_by, issue.created_at, issue.updated_at),
    )
    conn.commit()
    conn.close()
    return issue


def list_issues(project_id: str) -> list[Issue]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM issues WHERE project_id = ? ORDER BY created_at DESC", (project_id,),
    ).fetchall()
    conn.close()
    return [Issue(
        id=r["id"], project_id=r["project_id"], title=r["title"],
        description=r["description"], status=IssueStatus(r["status"]),
        related_entity_ids=json.loads(r["related_entity_ids"]) if r["related_entity_ids"] else [],
        reported_by=r["reported_by"], created_at=r["created_at"], updated_at=r["updated_at"],
    ) for r in rows]


def create_fix(project_id: str, issue_id: str, description: str,
               steps: list[str] | None = None, applied_by: str = "") -> Fix:
    fix = Fix(
        project_id=project_id, issue_id=issue_id, description=description,
        steps=steps or [], applied_by=applied_by,
    )
    conn = get_connection()
    conn.execute(
        "INSERT INTO fixes (id, issue_id, project_id, description, steps, applied_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (fix.id, fix.issue_id, fix.project_id, fix.description,
         json.dumps(fix.steps), fix.applied_by, fix.created_at),
    )
    # Update issue status to resolved
    conn.execute(
        "UPDATE issues SET status = ?, updated_at = ? WHERE id = ?",
        (IssueStatus.RESOLVED.value, _now(), issue_id),
    )
    conn.commit()
    conn.close()
    return fix
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_live_bench.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/live_bench.py apps/backend/tests/test_live_bench.py
git commit -m "feat: live bench engine — simulated telemetry, anomaly detection, issue/fix CRUD"
```

---

## Task 2: Live Bench Routes — REST API + WebSocket

**Files:**
- Create: `apps/backend/src/routes_livebench.py`
- Create: `apps/backend/tests/test_routes_livebench.py`

**Context:** FastAPI APIRouter with all 10 REST endpoints + 1 WebSocket. The routes manage a dict of `LiveBenchEngine` instances keyed by project_id. The WebSocket endpoint streams telemetry at ~2Hz when the engine is running. Issues integrate with the existing `MemoryStore` for semantic search.

- [ ] **Step 1: Write failing tests for livebench routes**

Create `apps/backend/tests/test_routes_livebench.py`:

```python
"""Integration tests for live bench API routes."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(fresh_db):
    from apps.backend.src.main import app
    return TestClient(app)


@pytest.fixture
def project_id(client):
    resp = client.post("/api/projects", json={"name": "TestBot", "description": "Test"})
    assert resp.status_code == 200
    return resp.json()["id"]


class TestLiveBenchState:
    def test_get_state_initial(self, client, project_id):
        resp = client.get(f"/api/projects/{project_id}/live-bench/state")
        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is False
        assert data["packet_count"] == 0

    def test_start_simulated(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/live-bench/start-simulated")
        assert resp.status_code == 200
        assert resp.json()["running"] is True

    def test_stop(self, client, project_id):
        client.post(f"/api/projects/{project_id}/live-bench/start-simulated")
        resp = client.post(f"/api/projects/{project_id}/live-bench/stop")
        assert resp.status_code == 200
        assert resp.json()["running"] is False

    def test_set_thresholds(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/live-bench/thresholds",
                           json={"left_motor_speed": {"min": 0, "max": 50}})
        assert resp.status_code == 200
        state = client.get(f"/api/projects/{project_id}/live-bench/state").json()
        assert state["thresholds"]["left_motor_speed"]["max"] == 50

    def test_ingest_packet(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/live-bench/packet", json={
            "source": "test",
            "signals": [
                {"name": "left_motor_speed", "value": 120.0, "unit": "rpm"},
                {"name": "battery_voltage", "value": 11.5, "unit": "V"},
            ],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "anomalies" in data
        state = client.get(f"/api/projects/{project_id}/live-bench/state").json()
        assert state["packet_count"] == 1

    def test_ingest_triggers_anomaly(self, client, project_id):
        # Set tight thresholds
        client.post(f"/api/projects/{project_id}/live-bench/thresholds",
                     json={"left_motor_speed": {"min": 0, "max": 100}})
        resp = client.post(f"/api/projects/{project_id}/live-bench/packet", json={
            "source": "test",
            "signals": [{"name": "left_motor_speed", "value": 999.0, "unit": "rpm"}],
        })
        assert resp.status_code == 200
        assert len(resp.json()["anomalies"]) > 0


class TestIssueRoutes:
    def test_create_issue(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/issues", json={
            "title": "SLAM map won't save",
            "description": "Map saver node crashes on large maps",
            "reported_by": "Pratham",
        })
        assert resp.status_code == 200
        assert resp.json()["title"] == "SLAM map won't save"
        assert resp.json()["status"] == "open"

    def test_list_issues(self, client, project_id):
        client.post(f"/api/projects/{project_id}/issues",
                     json={"title": "Issue 1", "description": "desc"})
        client.post(f"/api/projects/{project_id}/issues",
                     json={"title": "Issue 2", "description": "desc"})
        resp = client.get(f"/api/projects/{project_id}/issues")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_create_fix_resolves_issue(self, client, project_id):
        issue = client.post(f"/api/projects/{project_id}/issues",
                             json={"title": "Bug", "description": "desc"}).json()
        resp = client.post(f"/api/projects/{project_id}/fixes", json={
            "issue_id": issue["id"],
            "description": "Fixed by resubscribing to correct topic",
            "steps": ["Open motor_controller.py", "Change topic name", "Rebuild"],
            "applied_by": "Pratham",
        })
        assert resp.status_code == 200
        # Issue should now be resolved
        issues = client.get(f"/api/projects/{project_id}/issues").json()
        resolved = [i for i in issues if i["id"] == issue["id"]]
        assert resolved[0]["status"] == "resolved"

    def test_similar_issues(self, client, project_id):
        # Create issues
        client.post(f"/api/projects/{project_id}/issues",
                     json={"title": "Motor driver overheating", "description": "DRV8825 thermal shutdown"})
        client.post(f"/api/projects/{project_id}/issues",
                     json={"title": "SLAM accuracy dropping", "description": "Lidar noise"})
        # Search
        resp = client.get(f"/api/projects/{project_id}/similar-issues",
                           params={"q": "motor overheating thermal"})
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) > 0
        assert "motor" in results[0]["title"].lower() or "motor" in results[0]["description"].lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_routes_livebench.py -v 2>&1 | head -20`
Expected: FAIL — routes return 404 or ImportError

- [ ] **Step 3: Implement routes_livebench.py**

Create `apps/backend/src/routes_livebench.py`:

```python
"""
Live Bench Routes — FastAPI APIRouter for telemetry monitoring.

REST endpoints for start/stop/state/thresholds/packet/issues/fixes.
WebSocket endpoint for real-time telemetry streaming.
"""

import asyncio
import json
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from .live_bench import LiveBenchEngine, create_issue, list_issues, create_fix

router = APIRouter(prefix="/api")
ws_router = APIRouter()  # No prefix — WebSocket lives at /ws/..., not /api/ws/...

# Per-project engine instances (created on demand)
_engines: dict[str, LiveBenchEngine] = {}


def _get_engine(project_id: str) -> LiveBenchEngine:
    if project_id not in _engines:
        _engines[project_id] = LiveBenchEngine(project_id)
    return _engines[project_id]


# ── Pydantic Request Models ──

class IngestPacketReq(BaseModel):
    source: str = "manual"
    signals: list[dict[str, Any]]

class CreateIssueReq(BaseModel):
    title: str
    description: str = ""
    related_entity_ids: list[str] = Field(default_factory=list)
    reported_by: str = ""

class CreateFixReq(BaseModel):
    issue_id: str
    description: str
    steps: list[str] = Field(default_factory=list)
    applied_by: str = ""


# ── Live Bench Control ──

@router.post("/projects/{project_id}/live-bench/start-simulated")
async def start_simulated(project_id: str):
    engine = _get_engine(project_id)
    engine.start()
    return {"running": True, "message": "Simulated telemetry started"}


@router.post("/projects/{project_id}/live-bench/stop")
async def stop_telemetry(project_id: str):
    engine = _get_engine(project_id)
    engine.stop()
    return {"running": False, "message": "Telemetry stopped"}


@router.post("/projects/{project_id}/live-bench/thresholds")
async def set_thresholds(project_id: str, thresholds: dict[str, dict[str, float]]):
    engine = _get_engine(project_id)
    engine.set_thresholds(thresholds)
    return {"thresholds": engine.get_thresholds()}


@router.get("/projects/{project_id}/live-bench/state")
async def get_state(project_id: str):
    engine = _get_engine(project_id)
    return engine.get_state()


@router.post("/projects/{project_id}/live-bench/packet")
async def ingest_packet(project_id: str, req: IngestPacketReq):
    from packages.shared_types.src.models import RuntimePacket, RuntimeSignal
    engine = _get_engine(project_id)
    packet = RuntimePacket(
        project_id=project_id,
        source=req.source,
        signals=[RuntimeSignal(name=s["name"], value=s["value"], unit=s.get("unit", ""))
                 for s in req.signals],
    )
    anomalies = engine.ingest_packet(packet)
    return {
        "packet_id": packet.id,
        "anomalies": [
            {"signal_name": a.signal_name, "actual_value": a.actual_value,
             "expected_range": list(a.expected_range), "severity": a.severity,
             "description": a.description}
            for a in anomalies
        ],
    }


# ── Issues / Fixes ──

@router.post("/projects/{project_id}/issues")
async def create_issue_route(project_id: str, req: CreateIssueReq):
    issue = create_issue(
        project_id=project_id, title=req.title, description=req.description,
        related_entity_ids=req.related_entity_ids, reported_by=req.reported_by,
    )
    # Also store in memory for semantic search
    try:
        from .memory.memory_store import MemoryStore
        from packages.shared_types.src.models import SemanticMemoryItem
        store = MemoryStore()
        store.store(SemanticMemoryItem(
            project_id=project_id,
            content=f"{issue.title}. {issue.description}",
            content_type="issue",
            metadata={"issue_id": issue.id, "title": issue.title},
        ))
    except Exception:
        pass  # memory store not available or failed
    return {
        "id": issue.id, "project_id": issue.project_id, "title": issue.title,
        "description": issue.description, "status": issue.status.value,
        "related_entity_ids": issue.related_entity_ids, "reported_by": issue.reported_by,
        "created_at": issue.created_at, "updated_at": issue.updated_at,
    }


@router.get("/projects/{project_id}/issues")
async def list_issues_route(project_id: str):
    issues = list_issues(project_id)
    return [{
        "id": i.id, "project_id": i.project_id, "title": i.title,
        "description": i.description, "status": i.status.value,
        "related_entity_ids": i.related_entity_ids, "reported_by": i.reported_by,
        "created_at": i.created_at, "updated_at": i.updated_at,
    } for i in issues]


@router.post("/projects/{project_id}/fixes")
async def create_fix_route(project_id: str, req: CreateFixReq):
    fix = create_fix(
        project_id=project_id, issue_id=req.issue_id, description=req.description,
        steps=req.steps, applied_by=req.applied_by,
    )
    # Store fix in memory for semantic search
    try:
        from .memory.memory_store import MemoryStore
        from packages.shared_types.src.models import SemanticMemoryItem
        store = MemoryStore()
        store.store(SemanticMemoryItem(
            project_id=project_id,
            content=f"Fix: {fix.description}. Steps: {'; '.join(fix.steps)}",
            content_type="fix",
            metadata={"fix_id": fix.id, "issue_id": fix.issue_id},
        ))
    except Exception:
        pass
    return {
        "id": fix.id, "issue_id": fix.issue_id, "project_id": fix.project_id,
        "description": fix.description, "steps": fix.steps,
        "applied_by": fix.applied_by, "created_at": fix.created_at,
    }


@router.get("/projects/{project_id}/similar-issues")
async def similar_issues(project_id: str, q: str, top_k: int = 5):
    try:
        from .memory.memory_store import MemoryStore
        store = MemoryStore()
        results = store.find_similar(query=q, project_id=project_id, content_type="issue", limit=top_k)
        # Enrich with full issue data
        enriched = []
        for result in results:
            issue_id = result.get("metadata", {}).get("issue_id")
            if issue_id:
                from .database import get_connection
                conn = get_connection()
                row = conn.execute("SELECT * FROM issues WHERE id = ?", (issue_id,)).fetchone()
                conn.close()
                if row:
                    enriched.append({
                        "id": row["id"], "title": row["title"],
                        "description": row["description"], "status": row["status"],
                        "reported_by": row["reported_by"], "created_at": row["created_at"],
                        "similarity": result.get("score", 0),
                    })
        return enriched
    except Exception:
        # Fallback: simple substring search in DB
        from .database import get_connection
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM issues WHERE project_id = ? AND (title LIKE ? OR description LIKE ?) ORDER BY created_at DESC LIMIT ?",
            (project_id, f"%{q}%", f"%{q}%", top_k),
        ).fetchall()
        conn.close()
        return [{
            "id": r["id"], "title": r["title"], "description": r["description"],
            "status": r["status"], "reported_by": r["reported_by"],
            "created_at": r["created_at"], "similarity": 0.5,
        } for r in rows]


# ── WebSocket — Real-Time Telemetry Stream ──

@ws_router.websocket("/ws/projects/{project_id}/live-bench")
async def live_bench_ws(websocket: WebSocket, project_id: str):
    await websocket.accept()
    engine = _get_engine(project_id)
    try:
        while True:
            if engine.running:
                packet = engine.generate_simulated_packet()
                anomalies = engine.ingest_packet(packet)
                await websocket.send_json({
                    "type": "telemetry",
                    "packet_id": packet.id,
                    "timestamp": packet.timestamp,
                    "signals": {s.name: {"value": s.value, "unit": s.unit} for s in packet.signals},
                    "status": packet.status.value if hasattr(packet.status, 'value') else packet.status,
                    "anomalies": [
                        {"signal_name": a.signal_name, "actual_value": a.actual_value,
                         "severity": a.severity, "description": a.description}
                        for a in anomalies
                    ],
                })
            await asyncio.sleep(0.5)  # ~2 Hz
    except WebSocketDisconnect:
        pass
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_routes_livebench.py -v`
Expected: All tests PASS

- [ ] **Step 5: Wire ws_router into main.py**

In `apps/backend/src/main.py`, update the livebench import block to also include `ws_router`:

Change the existing livebench try/except block from:
```python
try:
    from .routes_livebench import router as livebench_router
    app.include_router(livebench_router)
    print("[ok] routes_livebench loaded")
except ImportError as e:
    if "routes_livebench" not in str(e):
        raise
    print("[warn] routes_livebench not available — skipping")
```

To:
```python
try:
    from .routes_livebench import router as livebench_router, ws_router as livebench_ws_router
    app.include_router(livebench_router)
    app.include_router(livebench_ws_router)
    print("[ok] routes_livebench loaded (REST + WebSocket)")
except ImportError as e:
    if "routes_livebench" not in str(e):
        raise
    print("[warn] routes_livebench not available — skipping")
```

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/ -v --tb=short 2>&1 | tail -10`
Expected: All previously passing tests still pass

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/routes_livebench.py apps/backend/src/main.py apps/backend/tests/test_routes_livebench.py
git commit -m "feat: live bench routes — REST API + WebSocket for telemetry streaming"
```

---

## Task 3: LiveBenchTab.tsx — Frontend Dashboard

**Files:**
- Create: `apps/desktop/src/renderer/components/live-bench/LiveBenchTab.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

**Context:** The LiveBenchTab is a real-time dashboard that shows: (1) a control bar with Start/Stop buttons and connection status, (2) a signal grid showing current values with mini sparkline charts from the history buffer, (3) an anomaly feed showing recent anomalies with severity coloring, (4) an issue/fix panel for logging and searching past issues. It connects via WebSocket when running and falls back to polling for state.

Uses the existing `useWebSocket` hook from `apps/desktop/src/renderer/hooks/useWebSocket.ts`, the `WS_BASE` and `API_BASE` constants, and Tailwind with `solus-*` tokens. Sparklines use inline SVG polylines (no Recharts dependency needed for simple sparklines).

- [ ] **Step 1: Create the live-bench component directory**

Run: `mkdir -p /Users/bentontameling/VentureHacksSolus/apps/desktop/src/renderer/components/live-bench`

- [ ] **Step 2: Implement LiveBenchTab.tsx**

Create `apps/desktop/src/renderer/components/live-bench/LiveBenchTab.tsx`:

```tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { useWebSocket } from "../../hooks/useWebSocket";
import { API_BASE, WS_BASE } from "../../constants/api";
import { useProjectStore } from "../../stores/projectStore";

interface Signal {
  value: number;
  unit: string;
}

interface AnomalyEvent {
  signal_name: string;
  actual_value: number;
  severity: string;
  description: string;
}

interface TelemetryMessage {
  type: string;
  packet_id: string;
  timestamp: string;
  signals: Record<string, Signal>;
  status: string;
  anomalies: AnomalyEvent[];
}

interface IssueItem {
  id: string;
  title: string;
  description: string;
  status: string;
  reported_by: string;
  created_at: string;
}

// Simple sparkline using SVG polyline
function Sparkline({ data, width = 120, height = 30, color = "#60a5fa" }: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

const SIGNAL_COLORS: Record<string, string> = {
  left_motor_speed: "#60a5fa",
  right_motor_speed: "#818cf8",
  battery_voltage: "#fbbf24",
  imu_accel_x: "#4ade80",
  imu_accel_y: "#34d399",
  imu_gyro_z: "#2dd4bf",
  cpu_temperature: "#fb923c",
  lidar_range_min: "#c084fc",
};

const SEVERITY_COLORS: Record<string, string> = {
  warning: "text-yellow-400 bg-yellow-900/20 border-yellow-700/30",
  critical: "text-red-400 bg-red-900/20 border-red-700/30",
};

export default function LiveBenchTab() {
  const { currentProjectId } = useProjectStore();
  const [running, setRunning] = useState(false);
  const [signals, setSignals] = useState<Record<string, Signal>>({});
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const [anomalies, setAnomalies] = useState<AnomalyEvent[]>([]);
  const [issues, setIssues] = useState<IssueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [packetCount, setPacketCount] = useState(0);
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [newIssueDesc, setNewIssueDesc] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<IssueItem[]>([]);
  const maxHistory = 60;

  const pid = currentProjectId;

  // WebSocket for real-time telemetry
  const wsPath = running && pid ? `/ws/projects/${pid}/live-bench` : null;

  const onMessage = useCallback((data: unknown) => {
    const msg = data as TelemetryMessage;
    if (msg.type !== "telemetry") return;

    setSignals(msg.signals);
    setPacketCount((c) => c + 1);

    // Update sparkline history
    setHistory((prev) => {
      const next = { ...prev };
      for (const [name, sig] of Object.entries(msg.signals)) {
        const arr = next[name] ? [...next[name]] : [];
        arr.push(sig.value);
        if (arr.length > maxHistory) arr.shift();
        next[name] = arr;
      }
      return next;
    });

    // Append anomalies
    if (msg.anomalies.length > 0) {
      setAnomalies((prev) => [...msg.anomalies, ...prev].slice(0, 50));
    }
  }, []);

  useWebSocket(wsPath, { onMessage });

  // Load initial state + issues
  useEffect(() => {
    if (!pid) return;
    fetch(`${API_BASE}/api/projects/${pid}/live-bench/state`)
      .then((r) => r.json())
      .then((state) => {
        setRunning(state.running);
        setPacketCount(state.packet_count);
        if (state.latest_signals) {
          const sigs: Record<string, Signal> = {};
          for (const s of state.latest_signals) {
            sigs[s.name] = { value: s.value, unit: s.unit };
          }
          setSignals(sigs);
        }
      })
      .catch(() => {});

    fetch(`${API_BASE}/api/projects/${pid}/issues`)
      .then((r) => r.json())
      .then(setIssues)
      .catch(() => {});
  }, [pid]);

  const handleStart = async () => {
    if (!pid) return;
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/projects/${pid}/live-bench/start-simulated`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      setRunning(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start");
    }
  };

  const handleStop = async () => {
    if (!pid) return;
    try {
      await fetch(`${API_BASE}/api/projects/${pid}/live-bench/stop`, { method: "POST" });
      setRunning(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to stop");
    }
  };

  const handleCreateIssue = async () => {
    if (!pid || !newIssueTitle.trim()) return;
    try {
      const r = await fetch(`${API_BASE}/api/projects/${pid}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newIssueTitle, description: newIssueDesc }),
      });
      if (!r.ok) throw new Error(await r.text());
      const issue = await r.json();
      setIssues((prev) => [issue, ...prev]);
      setNewIssueTitle("");
      setNewIssueDesc("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create issue");
    }
  };

  const handleSearch = async () => {
    if (!pid || !searchQuery.trim()) return;
    try {
      const r = await fetch(
        `${API_BASE}/api/projects/${pid}/similar-issues?q=${encodeURIComponent(searchQuery)}`
      );
      if (!r.ok) throw new Error(await r.text());
      setSearchResults(await r.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Search failed");
    }
  };

  return (
    <div className="flex flex-col h-full bg-solus-bg text-solus-text p-4 gap-4 font-sans">
      {/* Control Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Live Bench</h2>
          <span className={`w-2.5 h-2.5 rounded-full ${running ? "bg-green-400 animate-pulse" : "bg-neutral-500"}`} />
          <span className="text-xs text-solus-text-dim font-mono">
            {running ? "STREAMING" : "STOPPED"} — {packetCount} packets
          </span>
        </div>
        <div className="flex gap-2">
          {!running ? (
            <button onClick={handleStart} className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-500 rounded transition-colors">
              Start Simulation
            </button>
          ) : (
            <button onClick={handleStop} className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-500 rounded transition-colors">
              Stop
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded px-3 py-2 text-sm text-red-300">{error}</div>
      )}

      <div className="flex gap-4 flex-1 overflow-hidden">
        {/* Left: Signal Grid + Anomalies */}
        <div className="flex-1 flex flex-col gap-4 overflow-auto">
          {/* Signal Grid */}
          <div className="bg-solus-surface rounded-lg border border-solus-border p-4">
            <h3 className="text-sm font-medium text-solus-text-dim mb-3">Signals</h3>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(signals).map(([name, sig]) => (
                <div key={name} className="bg-solus-elevated rounded px-3 py-2 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-solus-text-muted">{name.replace(/_/g, " ")}</div>
                    <div className="text-lg font-mono font-semibold" style={{ color: SIGNAL_COLORS[name] || "#94a3b8" }}>
                      {sig.value.toFixed(2)}
                      <span className="text-xs text-solus-text-muted ml-1">{sig.unit}</span>
                    </div>
                  </div>
                  <Sparkline data={history[name] || []} color={SIGNAL_COLORS[name] || "#94a3b8"} />
                </div>
              ))}
            </div>
            {Object.keys(signals).length === 0 && (
              <p className="text-sm text-solus-text-muted">No signals yet. Start the simulation to see live data.</p>
            )}
          </div>

          {/* Anomaly Feed */}
          <div className="bg-solus-surface rounded-lg border border-solus-border p-4 flex-1 overflow-auto">
            <h3 className="text-sm font-medium text-solus-text-dim mb-3">
              Anomalies <span className="text-xs text-solus-text-muted">({anomalies.length})</span>
            </h3>
            {anomalies.length === 0 ? (
              <p className="text-sm text-solus-text-muted">No anomalies detected.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {anomalies.slice(0, 20).map((a, i) => (
                  <div key={i} className={`rounded px-3 py-1.5 text-sm border ${SEVERITY_COLORS[a.severity] || "text-neutral-400 bg-neutral-900/20 border-neutral-700/30"}`}>
                    <span className="font-mono font-semibold">{a.signal_name}</span>
                    <span className="ml-2 text-xs">{a.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Issues Panel */}
        <div className="w-80 flex flex-col gap-4 overflow-auto">
          {/* Log Issue */}
          <div className="bg-solus-surface rounded-lg border border-solus-border p-4">
            <h3 className="text-sm font-medium text-solus-text-dim mb-2">Log Issue</h3>
            <input
              value={newIssueTitle}
              onChange={(e) => setNewIssueTitle(e.target.value)}
              placeholder="Issue title..."
              className="w-full bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-sm mb-2"
            />
            <textarea
              value={newIssueDesc}
              onChange={(e) => setNewIssueDesc(e.target.value)}
              placeholder="Description..."
              rows={2}
              className="w-full bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-sm mb-2 resize-none"
            />
            <button onClick={handleCreateIssue} className="w-full px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors">
              Log Issue
            </button>
          </div>

          {/* Search Similar Issues */}
          <div className="bg-solus-surface rounded-lg border border-solus-border p-4">
            <h3 className="text-sm font-medium text-solus-text-dim mb-2">Find Similar Issues</h3>
            <div className="flex gap-2 mb-2">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="flex-1 bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <button onClick={handleSearch} className="px-3 py-1.5 text-sm bg-solus-elevated hover:bg-solus-border rounded transition-colors">
                Search
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {searchResults.map((r) => (
                  <div key={r.id} className="bg-solus-elevated rounded px-2 py-1.5 text-xs">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-solus-text-muted truncate">{r.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Issue List */}
          <div className="bg-solus-surface rounded-lg border border-solus-border p-4 flex-1 overflow-auto">
            <h3 className="text-sm font-medium text-solus-text-dim mb-2">Issues ({issues.length})</h3>
            {issues.length === 0 ? (
              <p className="text-xs text-solus-text-muted">No issues logged yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {issues.map((issue) => (
                  <div key={issue.id} className="bg-solus-elevated rounded px-2 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{issue.title}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        issue.status === "resolved" ? "bg-green-900/30 text-green-400" :
                        issue.status === "investigating" ? "bg-yellow-900/30 text-yellow-400" :
                        "bg-red-900/30 text-red-400"
                      }`}>{issue.status}</span>
                    </div>
                    {issue.description && (
                      <div className="text-xs text-solus-text-muted mt-0.5 truncate">{issue.description}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update App.tsx to import real LiveBenchTab**

In `apps/desktop/src/renderer/App.tsx`, replace the placeholder:

Remove:
```tsx
const LiveBenchTab = () => (
  <div className="p-8 text-solus-text-dim">Live Bench — not built yet</div>
)
```

Add import at top (near the other imports):
```tsx
import LiveBenchTab from './components/live-bench/LiveBenchTab'
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/live-bench/LiveBenchTab.tsx apps/desktop/src/renderer/App.tsx
git commit -m "feat: LiveBenchTab — real-time dashboard with sparklines, anomaly feed, issue tracking"
```

---

## Parallelism Map

```
Task 1 (Engine)  ──sequential──▶  Task 2 (Routes — depends on engine)
                                          │
Task 3 (Frontend)  ◀──depends on──────────┘
```

**Optimal dispatch order:**
1. Task 1 (engine + tests)
2. Task 2 (routes + tests — needs engine)
3. Task 3 (frontend — needs routes running)
