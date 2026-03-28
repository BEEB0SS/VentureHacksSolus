# Teammate 2 Remaining: PDF Connector, Simulator, Agent Routes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PDF connector (document chunking), MuJoCo simulator stub (differential drive kinematics), and FastAPI routes that wire the agent, memory, and simulator into API endpoints — completing Teammate 2's entire backend.

**Architecture:** Three independent modules: (1) PDFConnector reads PDF files and returns text chunks for memory storage. (2) MuJoCoSimulator is a physics stub using differential drive kinematics — no real MuJoCo needed for hackathon. (3) routes_agent.py is a FastAPI APIRouter that wires SolusAgent, MemoryStore, and MuJoCoSimulator into REST endpoints. The ContextEngine is imported with try/except and resolves when Pratham merges.

**Tech Stack:** Python 3.11+, FastAPI, SQLite, PyPDF2, pytest, pytest-asyncio

**Dependencies (already built):**
- `apps/backend/src/memory/memory_store.py` — MemoryStore class (store, store_issue_fix, store_document_chunk, find_similar)
- `apps/backend/src/agent/solus_agent.py` — SolusAgent class (query method, _build_context, all 6 handlers)

**Dependencies (being built by Pratham — code against interface):**
- `apps/backend/src/context_engine.py` — ContextEngine class. Import with try/except.

**Import pattern:** All files in this project use a `sys.path` + module shim pattern for `packages.shared_types.src.models` because the directory `packages/shared-types` has a hyphen. Copy the shim from `memory_store.py` into each new production file. Test files rely on `conftest.py` which already sets up the shim.

---

## File Structure

### Files to Create

| File | Responsibility |
|------|---------------|
| `apps/backend/src/connectors/pdf_connector.py` | Read PDFs, extract text, chunk into ~500 word segments |
| `apps/backend/src/simulator/mujoco_wrapper.py` | Differential drive physics stub, parameter management, sim vs runtime comparison |
| `apps/backend/src/routes_agent.py` | FastAPI APIRouter — agent query, memory CRUD, simulator endpoints |
| `apps/backend/tests/test_pdf_connector.py` | Tests for PDF text extraction and chunking |
| `apps/backend/tests/test_mujoco_wrapper.py` | Tests for simulator parameter setting, trajectory, comparison |
| `apps/backend/tests/test_routes_agent.py` | Integration tests for API routes |

### Files to Modify

| File | Change |
|------|--------|
| `apps/backend/requirements.txt` | Add `PyPDF2==3.0.1` |

### Existing Files (Read-Only References)

| File | Used For |
|------|----------|
| `packages/shared-types/src/models.py` | SimulationRun, AgentQuery, AgentResponse, SemanticMemoryItem |
| `apps/backend/src/database.py` | get_connection(), init_db() |
| `apps/backend/src/memory/memory_store.py` | MemoryStore (already built) |
| `apps/backend/src/agent/solus_agent.py` | SolusAgent (already built) |
| `apps/backend/tests/conftest.py` | Shared fixtures: fresh_db, project_id, import shim |

---

## Task 1: PDF Connector

**Files:**
- Modify: `apps/backend/requirements.txt`
- Create: `apps/backend/tests/test_pdf_connector.py`
- Create: `apps/backend/src/connectors/pdf_connector.py`

**Context:** The PDF connector reads a PDF file, extracts text page by page, and chunks it into ~500-word segments. Each chunk is returned as a dict with content, doc_name, chunk_index, and page_numbers. It does NOT store to the database — the caller (routes_agent.py) feeds chunks into MemoryStore. For testing, we create a minimal PDF using Python's standard library.

- [ ] **Step 1: Add PyPDF2 to requirements and install**

Append `PyPDF2==3.0.1` to `apps/backend/requirements.txt`.

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/memory-store-agent/apps/backend && source .venv/bin/activate && pip install PyPDF2==3.0.1`

- [ ] **Step 2: Write failing tests**

Create `apps/backend/tests/test_pdf_connector.py`:

```python
"""Tests for the PDF connector — text extraction and chunking."""

import sys, os
import tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))


def _create_test_pdf(text_pages: list[str], path: str):
    """Create a minimal PDF with the given text per page using reportlab-free approach."""
    # Use PyPDF2 to create a simple PDF for testing
    from PyPDF2 import PdfWriter
    from PyPDF2.generic import (
        ArrayObject, DecodedStreamObject, DictionaryObject,
        NameObject, NumberObject, TextStringObject, createStringObject,
    )

    writer = PdfWriter()
    for page_text in text_pages:
        # Create a minimal PDF page with text
        page = writer.add_blank_page(width=612, height=792)

        # Create a content stream that draws text
        content = f"BT /F1 12 Tf 72 720 Td ({page_text}) Tj ET"

        # Add a font resource
        font_dict = DictionaryObject()
        font_dict.update({
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        })

        resources = DictionaryObject()
        font_resources = DictionaryObject()
        font_resources[NameObject("/F1")] = font_dict
        resources[NameObject("/Font")] = font_resources
        page[NameObject("/Resources")] = resources

        # Set content stream
        stream = DecodedStreamObject()
        stream.set_data(content.encode("latin-1"))
        page[NameObject("/Contents")] = stream

    with open(path, "wb") as f:
        writer.write(f)


class TestPDFConnector:
    def test_extract_text_single_page(self, tmp_path):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        pdf_path = str(tmp_path / "test.pdf")
        _create_test_pdf(["This is a simple test document with some text about motors."], pdf_path)
        connector = PDFConnector()
        text = connector.extract_text(pdf_path)
        assert isinstance(text, str)
        assert len(text) > 0

    def test_chunk_text_short(self):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        connector = PDFConnector()
        text = "This is a short text that should fit in one chunk."
        chunks = connector.chunk_text(text, "test.pdf", chunk_size=500)
        assert len(chunks) == 1
        assert chunks[0]["content"] == text
        assert chunks[0]["doc_name"] == "test.pdf"
        assert chunks[0]["chunk_index"] == 0

    def test_chunk_text_long(self):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        connector = PDFConnector()
        # Create text that's about 1500 words (should produce ~3 chunks at 500 words each)
        words = ["word"] * 1500
        text = " ".join(words)
        chunks = connector.chunk_text(text, "long.pdf", chunk_size=500)
        assert len(chunks) == 3
        for i, chunk in enumerate(chunks):
            assert chunk["chunk_index"] == i
            assert chunk["doc_name"] == "long.pdf"
            assert len(chunk["content"].split()) <= 550  # allow some overflow for word boundaries

    def test_chunk_text_preserves_word_boundaries(self):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        connector = PDFConnector()
        # 600 words — should split into 2 chunks, not cutting words
        words = [f"word{i}" for i in range(600)]
        text = " ".join(words)
        chunks = connector.chunk_text(text, "doc.pdf", chunk_size=500)
        assert len(chunks) == 2
        # First chunk should end on a word boundary
        assert not chunks[0]["content"].endswith(" ")

    def test_process_pdf_returns_chunks(self, tmp_path):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        pdf_path = str(tmp_path / "test.pdf")
        _create_test_pdf(["Some text about motor drivers and electronics."], pdf_path)
        connector = PDFConnector()
        chunks = connector.process_pdf(pdf_path, "test.pdf")
        assert isinstance(chunks, list)
        assert len(chunks) >= 1
        assert "content" in chunks[0]
        assert "doc_name" in chunks[0]
        assert "chunk_index" in chunks[0]

    def test_process_pdf_nonexistent_file(self):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        connector = PDFConnector()
        chunks = connector.process_pdf("/nonexistent/path.pdf", "missing.pdf")
        assert chunks == []

    def test_chunk_text_empty(self):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        connector = PDFConnector()
        chunks = connector.chunk_text("", "empty.pdf")
        assert chunks == []
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/memory-store-agent && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_pdf_connector.py -v 2>&1 | head -15`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 4: Implement PDFConnector**

Create `apps/backend/src/connectors/pdf_connector.py`:

```python
"""
Solus PDF Connector — Extract text from PDFs and chunk for memory storage.

Reads PDF files, extracts text page by page, and splits into ~500 word chunks.
Returns chunks as dicts ready to be fed into MemoryStore.store_document_chunk().
Hackathon: basic text extraction only, no OCR.
"""

from typing import Optional


class PDFConnector:
    """Extract text from PDFs and chunk for memory storage."""

    def extract_text(self, pdf_path: str) -> str:
        """Extract all text from a PDF file. Returns empty string on failure."""
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(pdf_path)
            pages_text = []
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    pages_text.append(text.strip())
            return "\n\n".join(pages_text)
        except Exception:
            return ""

    def chunk_text(
        self,
        text: str,
        doc_name: str,
        chunk_size: int = 500,
    ) -> list[dict]:
        """Split text into chunks of approximately `chunk_size` words, preserving word boundaries."""
        if not text or not text.strip():
            return []

        words = text.split()
        chunks = []
        chunk_index = 0
        i = 0

        while i < len(words):
            end = min(i + chunk_size, len(words))
            chunk_words = words[i:end]
            chunk_content = " ".join(chunk_words)
            chunks.append({
                "content": chunk_content,
                "doc_name": doc_name,
                "chunk_index": chunk_index,
            })
            chunk_index += 1
            i = end

        return chunks

    def process_pdf(
        self,
        pdf_path: str,
        doc_name: str,
        chunk_size: int = 500,
    ) -> list[dict]:
        """Extract text from a PDF and return chunks. Returns empty list on failure."""
        text = self.extract_text(pdf_path)
        if not text:
            return []
        return self.chunk_text(text, doc_name, chunk_size)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/memory-store-agent && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_pdf_connector.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/requirements.txt apps/backend/src/connectors/pdf_connector.py apps/backend/tests/test_pdf_connector.py
git commit -m "feat: PDF connector — text extraction and chunking for memory storage"
```

---

## Task 2: MuJoCo Simulator Stub

**Files:**
- Create: `apps/backend/tests/test_mujoco_wrapper.py`
- Create: `apps/backend/src/simulator/mujoco_wrapper.py`

**Context:** The simulator uses differential drive kinematics as a physics stub (no real MuJoCo required). Given left/right wheel speeds and wheel_radius, it computes x, y, theta over time. It supports setting parameters, running steps, and comparing simulation results against runtime data.

Differential drive equations:
- `v = (v_left + v_right) / 2` (linear velocity)
- `omega = (v_right - v_left) / wheel_base` (angular velocity)
- `x += v * cos(theta) * dt`
- `y += v * sin(theta) * dt`
- `theta += omega * dt`

- [ ] **Step 1: Write failing tests**

Create `apps/backend/tests/test_mujoco_wrapper.py`:

```python
"""Tests for the MuJoCo simulator stub — differential drive kinematics."""

import sys, os
import math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))


class TestSimulatorInit:
    def test_create_simulator(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        assert sim.parameters["wheel_radius"] == 0.05
        assert sim.parameters["wheel_base"] == 0.3
        assert sim.parameters["motor_torque"] == 0.5
        assert sim.parameters["friction"] == 0.1

    def test_set_parameter(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim.set_parameter("wheel_radius", 0.1)
        assert sim.parameters["wheel_radius"] == 0.1

    def test_set_parameter_unknown_key(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim.set_parameter("new_param", 42)
        assert sim.parameters["new_param"] == 42

    def test_get_state(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        state = sim.get_state()
        assert "parameters" in state
        assert "trajectory" in state
        assert "position" in state
        assert state["position"] == {"x": 0.0, "y": 0.0, "theta": 0.0}


class TestSimulatorRun:
    def test_run_steps_straight(self):
        """Equal wheel speeds should produce straight-line motion."""
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        trajectory = sim.run_steps(
            n_steps=100,
            left_speed=1.0,
            right_speed=1.0,
            dt=0.01,
        )
        assert len(trajectory) == 100
        # Should move forward (positive x) with no turning
        final = trajectory[-1]
        assert final["x"] > 0
        assert abs(final["y"]) < 0.001  # negligible lateral motion
        assert abs(final["theta"]) < 0.001  # no rotation

    def test_run_steps_turning(self):
        """Different wheel speeds should produce a turn."""
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        trajectory = sim.run_steps(
            n_steps=100,
            left_speed=0.5,
            right_speed=1.0,
            dt=0.01,
        )
        final = trajectory[-1]
        # Should have turned (theta != 0)
        assert abs(final["theta"]) > 0.01

    def test_run_steps_stationary(self):
        """Zero wheel speeds should produce no motion."""
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        trajectory = sim.run_steps(n_steps=10, left_speed=0.0, right_speed=0.0, dt=0.01)
        for point in trajectory:
            assert point["x"] == 0.0
            assert point["y"] == 0.0
            assert point["theta"] == 0.0

    def test_run_steps_stores_trajectory(self):
        """Trajectory should be stored in simulator state."""
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim.run_steps(n_steps=50, left_speed=1.0, right_speed=1.0, dt=0.01)
        state = sim.get_state()
        assert len(state["trajectory"]) == 50

    def test_trajectory_point_has_all_fields(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        trajectory = sim.run_steps(n_steps=1, left_speed=1.0, right_speed=1.0, dt=0.01)
        point = trajectory[0]
        assert "x" in point
        assert "y" in point
        assert "theta" in point
        assert "v_linear" in point
        assert "v_angular" in point
        assert "timestamp" in point


class TestSimulatorCompare:
    def test_compare_with_runtime_no_discrepancy(self):
        """Identical sim and runtime data should produce no discrepancies."""
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim_data = [
            {"signal": "turn_radius", "value": 15.0},
            {"signal": "speed", "value": 0.5},
        ]
        runtime_data = [
            {"signal": "turn_radius", "value": 15.0},
            {"signal": "speed", "value": 0.5},
        ]
        discrepancies = sim.compare_with_runtime(sim_data, runtime_data)
        assert len(discrepancies) == 0

    def test_compare_with_runtime_has_discrepancy(self):
        """Different values should produce discrepancies."""
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim_data = [
            {"signal": "turn_radius", "value": 15.0},
            {"signal": "speed", "value": 0.5},
        ]
        runtime_data = [
            {"signal": "turn_radius", "value": 22.0},
            {"signal": "speed", "value": 0.5},
        ]
        discrepancies = sim.compare_with_runtime(sim_data, runtime_data)
        assert len(discrepancies) == 1
        d = discrepancies[0]
        assert d["signal"] == "turn_radius"
        assert d["simulated"] == 15.0
        assert d["observed"] == 22.0
        assert d["delta"] == 7.0

    def test_compare_with_runtime_threshold(self):
        """Small differences within threshold should not be discrepancies."""
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim_data = [{"signal": "speed", "value": 0.500}]
        runtime_data = [{"signal": "speed", "value": 0.501}]
        discrepancies = sim.compare_with_runtime(sim_data, runtime_data, threshold=0.01)
        assert len(discrepancies) == 0

    def test_compare_with_runtime_mismatched_signals(self):
        """Signals present in sim but not runtime should be skipped."""
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim_data = [{"signal": "turn_radius", "value": 15.0}]
        runtime_data = [{"signal": "speed", "value": 0.5}]
        discrepancies = sim.compare_with_runtime(sim_data, runtime_data)
        assert len(discrepancies) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/memory-store-agent && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_mujoco_wrapper.py -v 2>&1 | head -15`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement MuJoCoSimulator**

Create `apps/backend/src/simulator/mujoco_wrapper.py`:

```python
"""
Solus MuJoCo Simulator — Differential drive physics stub.

Uses differential drive kinematics to simulate robot motion. No real MuJoCo required.
Given left/right wheel speeds + wheel_radius, computes x, y, theta over time.
Supports parameter management, step simulation, and comparison with runtime data.
"""

import math
from typing import Optional


class MuJoCoSimulator:
    """Physics simulator using differential drive kinematics."""

    def __init__(self):
        self.parameters: dict = {
            "wheel_radius": 0.05,  # meters
            "wheel_base": 0.3,     # meters (distance between wheels)
            "motor_torque": 0.5,   # Nm
            "friction": 0.1,       # coefficient
        }
        self._trajectory: list[dict] = []
        self._position = {"x": 0.0, "y": 0.0, "theta": 0.0}

    def set_parameter(self, name: str, value: float) -> None:
        """Set a simulation parameter."""
        self.parameters[name] = value

    def get_state(self) -> dict:
        """Get the current simulator state."""
        return {
            "parameters": dict(self.parameters),
            "trajectory": list(self._trajectory),
            "position": dict(self._position),
        }

    def run_steps(
        self,
        n_steps: int,
        left_speed: float,
        right_speed: float,
        dt: float = 0.01,
    ) -> list[dict]:
        """Run n_steps of differential drive simulation.

        Args:
            n_steps: Number of simulation steps
            left_speed: Left wheel speed (m/s)
            right_speed: Right wheel speed (m/s)
            dt: Time step in seconds

        Returns:
            List of trajectory points, each with x, y, theta, v_linear, v_angular, timestamp
        """
        wheel_base = self.parameters["wheel_base"]
        x = self._position["x"]
        y = self._position["y"]
        theta = self._position["theta"]

        trajectory = []
        time = 0.0

        for _ in range(n_steps):
            # Differential drive kinematics
            v_linear = (left_speed + right_speed) / 2.0
            v_angular = (right_speed - left_speed) / wheel_base

            # Update position
            x += v_linear * math.cos(theta) * dt
            y += v_linear * math.sin(theta) * dt
            theta += v_angular * dt
            time += dt

            trajectory.append({
                "x": x,
                "y": y,
                "theta": theta,
                "v_linear": v_linear,
                "v_angular": v_angular,
                "timestamp": round(time, 6),
            })

        # Update stored position
        self._position = {"x": x, "y": y, "theta": theta}
        self._trajectory = trajectory
        return trajectory

    def compare_with_runtime(
        self,
        sim_data: list[dict],
        runtime_data: list[dict],
        threshold: float = 0.01,
    ) -> list[dict]:
        """Compare simulation results with runtime observations.

        Both sim_data and runtime_data are lists of {"signal": str, "value": float}.
        Returns discrepancies where the absolute difference exceeds threshold.

        Args:
            sim_data: Simulated signal values
            runtime_data: Observed runtime signal values
            threshold: Minimum difference to report as a discrepancy

        Returns:
            List of discrepancy dicts with signal, simulated, observed, delta
        """
        # Index runtime data by signal name
        runtime_map = {item["signal"]: item["value"] for item in runtime_data}

        discrepancies = []
        for sim_item in sim_data:
            signal = sim_item["signal"]
            if signal not in runtime_map:
                continue
            sim_val = sim_item["value"]
            runtime_val = runtime_map[signal]
            delta = abs(sim_val - runtime_val)
            if delta > threshold:
                discrepancies.append({
                    "signal": signal,
                    "simulated": sim_val,
                    "observed": runtime_val,
                    "delta": round(delta, 6),
                })

        return discrepancies
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/memory-store-agent && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_mujoco_wrapper.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/simulator/mujoco_wrapper.py apps/backend/tests/test_mujoco_wrapper.py
git commit -m "feat: MuJoCo simulator stub — differential drive kinematics + runtime comparison"
```

---

## Task 3: Agent Routes — Request Models + Agent Query Endpoint

**Files:**
- Create: `apps/backend/tests/test_routes_agent.py`
- Create: `apps/backend/src/routes_agent.py`

**Context:** routes_agent.py uses FastAPI's APIRouter(prefix="/api") and wires together the SolusAgent, MemoryStore, and MuJoCoSimulator. The ContextEngine is imported with try/except — if it's not available yet, the agent runs without graph context. We use FastAPI's TestClient for integration tests.

This task creates the route file with the agent query endpoint (the most important one). Tasks 4 and 5 add memory and simulator endpoints.

The SolusAgent.query() is async, so the route handler is async too. The route creates the SolusAgent on each request with the available dependencies.

- [ ] **Step 1: Write failing tests for agent query route**

Create `apps/backend/tests/test_routes_agent.py`:

```python
"""Tests for agent API routes."""

import sys, os
import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

from fastapi.testclient import TestClient


def _get_app():
    """Create a FastAPI app with the agent router for testing."""
    from fastapi import FastAPI
    from apps.backend.src.routes_agent import router
    app = FastAPI()
    app.include_router(router)
    return app


class TestAgentQueryRoute:
    def test_agent_query_general(self, project_id):
        app = _get_app()
        client = TestClient(app)
        response = client.post(f"/api/projects/{project_id}/agent/query", json={
            "query": "What is this project about?",
            "query_type": "general",
        })
        assert response.status_code == 200
        data = response.json()
        assert "response_text" in data
        assert len(data["response_text"]) > 0
        assert "query_id" in data

    def test_agent_query_debug(self, project_id):
        app = _get_app()
        client = TestClient(app)
        response = client.post(f"/api/projects/{project_id}/agent/query", json={
            "query": "My motor is overheating",
            "query_type": "debug",
        })
        assert response.status_code == 200
        data = response.json()
        assert "response_text" in data

    def test_agent_query_search_parts(self, project_id):
        app = _get_app()
        client = TestClient(app)
        response = client.post(f"/api/projects/{project_id}/agent/query", json={
            "query": "I need a motor driver for NEMA 17",
            "query_type": "search_parts",
        })
        assert response.status_code == 200

    def test_agent_query_with_context_entities(self, project_id):
        app = _get_app()
        client = TestClient(app)
        response = client.post(f"/api/projects/{project_id}/agent/query", json={
            "query": "What is impacted?",
            "query_type": "impact_analysis",
            "context_entity_ids": ["entity-123"],
        })
        assert response.status_code == 200

    def test_agent_query_missing_query(self, project_id):
        app = _get_app()
        client = TestClient(app)
        response = client.post(f"/api/projects/{project_id}/agent/query", json={})
        assert response.status_code == 422  # validation error
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/memory-store-agent && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_routes_agent.py -v 2>&1 | head -15`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement routes_agent.py — agent query endpoint**

Create `apps/backend/src/routes_agent.py`:

```python
"""
Solus Agent Routes — FastAPI APIRouter for agent queries, memory, and simulator.

Uses APIRouter(prefix="/api") so it can be included in main.py without conflicts
with other teammates' route files.
"""

import sys
import os
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# Set up sys.path for cross-package imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

# Import shim for packages.shared_types (hyphenated directory)
_shared_types_src = os.path.join(os.path.dirname(__file__), "../../../packages/shared-types/src")
if _shared_types_src not in sys.path:
    sys.path.insert(0, _shared_types_src)

import types as _types
import importlib as _importlib

if "packages" not in sys.modules:
    _pkg = _types.ModuleType("packages")
    _pkg.__path__ = [os.path.join(os.path.dirname(__file__), "../../../packages")]
    sys.modules["packages"] = _pkg

if "packages.shared_types" not in sys.modules:
    _st = _types.ModuleType("packages.shared_types")
    _st.__path__ = [os.path.join(os.path.dirname(__file__), "../../../packages/shared-types")]
    sys.modules["packages.shared_types"] = _st

if "packages.shared_types.src" not in sys.modules:
    _st_src = _types.ModuleType("packages.shared_types.src")
    _st_src.__path__ = [_shared_types_src]
    sys.modules["packages.shared_types.src"] = _st_src

if "packages.shared_types.src.models" not in sys.modules:
    _models_mod = _importlib.import_module("models")
    sys.modules["packages.shared_types.src.models"] = _models_mod

from packages.shared_types.src.models import (
    AgentQuery, AgentResponse, SemanticMemoryItem, SimulationRun,
    _uid, _now,
)

from .memory.memory_store import MemoryStore
from .agent.solus_agent import SolusAgent
from .simulator.mujoco_wrapper import MuJoCoSimulator

# ContextEngine — optional, resolves when Pratham merges
try:
    from .context_engine import ContextEngine
    CONTEXT_ENGINE_AVAILABLE = True
except ImportError:
    CONTEXT_ENGINE_AVAILABLE = False


router = APIRouter(prefix="/api")

# Shared instances
_memory_store = MemoryStore()
_simulator_instances: dict[str, MuJoCoSimulator] = {}


def _get_simulator(project_id: str) -> MuJoCoSimulator:
    """Get or create a simulator instance for a project."""
    if project_id not in _simulator_instances:
        _simulator_instances[project_id] = MuJoCoSimulator()
    return _simulator_instances[project_id]


def _get_agent(project_id: str) -> SolusAgent:
    """Create a SolusAgent with available dependencies."""
    context_engine = None
    if CONTEXT_ENGINE_AVAILABLE:
        context_engine = ContextEngine(project_id)
    return SolusAgent(context_engine=context_engine, memory_store=_memory_store)


# ── Request Models ──

class AgentQueryReq(BaseModel):
    query: str
    query_type: str = "general"
    context_entity_ids: list[str] = Field(default_factory=list)

class MemoryStoreReq(BaseModel):
    content: str
    content_type: str
    metadata: dict[str, Any] = Field(default_factory=dict)

class SimulatorRunReq(BaseModel):
    n_steps: int = 100
    left_speed: float = 1.0
    right_speed: float = 1.0
    dt: float = 0.01
    parameters: dict[str, float] = Field(default_factory=dict)

class SimulatorCompareReq(BaseModel):
    sim_data: list[dict[str, Any]]
    runtime_data: list[dict[str, Any]]
    threshold: float = 0.01

class MemorySearchParams(BaseModel):
    query: str
    content_type: Optional[str] = None
    limit: int = 5


# ── Agent Routes ──

@router.post("/projects/{project_id}/agent/query")
async def agent_query(project_id: str, req: AgentQueryReq):
    """Main AI query endpoint — routes to appropriate handler based on query_type."""
    agent = _get_agent(project_id)
    query = AgentQuery(
        project_id=project_id,
        query=req.query,
        query_type=req.query_type,
        context_entity_ids=req.context_entity_ids,
    )
    response = await agent.query(query)
    return {
        "query_id": response.query_id,
        "response_text": response.response_text,
        "structured_data": response.structured_data,
        "sources": response.sources,
        "confidence": response.confidence,
    }


# ── Memory Routes ──

@router.post("/projects/{project_id}/memory")
async def store_memory(project_id: str, req: MemoryStoreReq):
    """Store a memory item."""
    item = SemanticMemoryItem(
        project_id=project_id,
        content=req.content,
        content_type=req.content_type,
        metadata=req.metadata,
    )
    stored = _memory_store.store(item)
    return {
        "id": stored.id,
        "project_id": stored.project_id,
        "content_type": stored.content_type,
        "created_at": stored.created_at,
    }


@router.get("/projects/{project_id}/memory/search")
async def search_memory(project_id: str, query: str, content_type: Optional[str] = None, limit: int = 5):
    """Search memory for similar items."""
    results = _memory_store.find_similar(
        query=query,
        project_id=project_id,
        content_type=content_type,
        limit=limit,
    )
    return results


# ── Simulator Routes ──

@router.post("/projects/{project_id}/simulator/run")
async def run_simulation(project_id: str, req: SimulatorRunReq):
    """Run a simulation with given parameters."""
    sim = _get_simulator(project_id)
    # Apply any parameter overrides
    for name, value in req.parameters.items():
        sim.set_parameter(name, value)
    trajectory = sim.run_steps(
        n_steps=req.n_steps,
        left_speed=req.left_speed,
        right_speed=req.right_speed,
        dt=req.dt,
    )
    return {
        "n_steps": req.n_steps,
        "trajectory": trajectory,
        "final_position": sim.get_state()["position"],
    }


@router.get("/projects/{project_id}/simulator/state")
async def get_simulator_state(project_id: str):
    """Get current simulator state."""
    sim = _get_simulator(project_id)
    return sim.get_state()


@router.post("/projects/{project_id}/simulator/compare")
async def compare_simulation(project_id: str, req: SimulatorCompareReq):
    """Compare simulation results with runtime data."""
    sim = _get_simulator(project_id)
    discrepancies = sim.compare_with_runtime(
        sim_data=req.sim_data,
        runtime_data=req.runtime_data,
        threshold=req.threshold,
    )
    return {
        "discrepancies": discrepancies,
        "match": len(discrepancies) == 0,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/memory-store-agent && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_routes_agent.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes_agent.py apps/backend/tests/test_routes_agent.py
git commit -m "feat: agent routes — query endpoint + request models + dependency wiring"
```

---

## Task 4: Agent Routes — Memory + Simulator Route Tests

**Files:**
- Modify: `apps/backend/tests/test_routes_agent.py`

**Context:** Now add integration tests for the memory and simulator endpoints. These verify the full HTTP round-trip including request validation, endpoint logic, and response format.

- [ ] **Step 1: Append memory and simulator route tests**

Append to `apps/backend/tests/test_routes_agent.py`:

```python
class TestMemoryRoutes:
    def test_store_memory_item(self, project_id):
        app = _get_app()
        client = TestClient(app)
        response = client.post(f"/api/projects/{project_id}/memory", json={
            "content": "DRV8825 motor driver supports up to 2.5A",
            "content_type": "datasheet",
            "metadata": {"doc_name": "drv8825.pdf"},
        })
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["content_type"] == "datasheet"

    def test_search_memory(self, project_id):
        app = _get_app()
        client = TestClient(app)
        # Store an item first
        client.post(f"/api/projects/{project_id}/memory", json={
            "content": "TMC2209 stepper motor driver with UART interface",
            "content_type": "datasheet",
        })
        # Search for it
        response = client.get(f"/api/projects/{project_id}/memory/search", params={
            "query": "stepper motor driver",
        })
        assert response.status_code == 200
        results = response.json()
        assert isinstance(results, list)

    def test_search_memory_with_filters(self, project_id):
        app = _get_app()
        client = TestClient(app)
        client.post(f"/api/projects/{project_id}/memory", json={
            "content": "Motor issue: overheating under load",
            "content_type": "issue_fix",
        })
        client.post(f"/api/projects/{project_id}/memory", json={
            "content": "Motor specs: 2A max current",
            "content_type": "datasheet",
        })
        response = client.get(f"/api/projects/{project_id}/memory/search", params={
            "query": "motor",
            "content_type": "datasheet",
            "limit": 1,
        })
        assert response.status_code == 200
        results = response.json()
        assert all(r["content_type"] == "datasheet" for r in results)


class TestSimulatorRoutes:
    def test_run_simulation(self, project_id):
        app = _get_app()
        client = TestClient(app)
        response = client.post(f"/api/projects/{project_id}/simulator/run", json={
            "n_steps": 50,
            "left_speed": 1.0,
            "right_speed": 1.0,
            "dt": 0.01,
        })
        assert response.status_code == 200
        data = response.json()
        assert len(data["trajectory"]) == 50
        assert "final_position" in data

    def test_run_simulation_with_params(self, project_id):
        app = _get_app()
        client = TestClient(app)
        response = client.post(f"/api/projects/{project_id}/simulator/run", json={
            "n_steps": 10,
            "left_speed": 0.5,
            "right_speed": 1.0,
            "dt": 0.01,
            "parameters": {"wheel_radius": 0.1, "wheel_base": 0.4},
        })
        assert response.status_code == 200
        data = response.json()
        assert len(data["trajectory"]) == 10

    def test_get_simulator_state(self, project_id):
        app = _get_app()
        client = TestClient(app)
        # Run a sim first to populate state
        client.post(f"/api/projects/{project_id}/simulator/run", json={
            "n_steps": 10, "left_speed": 1.0, "right_speed": 1.0,
        })
        response = client.get(f"/api/projects/{project_id}/simulator/state")
        assert response.status_code == 200
        data = response.json()
        assert "parameters" in data
        assert "trajectory" in data
        assert "position" in data

    def test_compare_simulation(self, project_id):
        app = _get_app()
        client = TestClient(app)
        response = client.post(f"/api/projects/{project_id}/simulator/compare", json={
            "sim_data": [
                {"signal": "turn_radius", "value": 15.0},
                {"signal": "speed", "value": 0.5},
            ],
            "runtime_data": [
                {"signal": "turn_radius", "value": 22.0},
                {"signal": "speed", "value": 0.5},
            ],
            "threshold": 0.01,
        })
        assert response.status_code == 200
        data = response.json()
        assert len(data["discrepancies"]) == 1
        assert data["discrepancies"][0]["signal"] == "turn_radius"
        assert data["match"] is False

    def test_compare_simulation_matching(self, project_id):
        app = _get_app()
        client = TestClient(app)
        response = client.post(f"/api/projects/{project_id}/simulator/compare", json={
            "sim_data": [{"signal": "speed", "value": 0.5}],
            "runtime_data": [{"signal": "speed", "value": 0.5}],
        })
        assert response.status_code == 200
        assert response.json()["match"] is True
```

- [ ] **Step 2: Run all route tests**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/memory-store-agent && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_routes_agent.py -v`
Expected: All tests PASS (5 existing + 8 new = 13 total)

- [ ] **Step 3: Commit**

```bash
git add apps/backend/tests/test_routes_agent.py
git commit -m "test: agent routes — memory + simulator integration tests"
```

---

## Task 5: Full Test Suite Verification

**Files:** None new — verification only.

- [ ] **Step 1: Run all tests together**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/memory-store-agent && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/ -v`
Expected: All tests PASS (27 existing + 7 pdf + 12 simulator + 13 routes = ~59 tests)

- [ ] **Step 2: Verify all imports work in test context**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/memory-store-agent && source apps/backend/.venv/bin/activate && python -m pytest --co apps/backend/tests/ 2>&1 | tail -5`
Expected: Shows all collected tests, no import errors

- [ ] **Step 3: Commit any remaining changes**

```bash
git status
# If clean, nothing to do. If there are changes:
git add -A apps/backend/
git commit -m "chore: final verification — all tests passing"
```
