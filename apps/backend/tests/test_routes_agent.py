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


@pytest.fixture(autouse=True)
def _clear_simulator_instances():
    """Clear shared simulator instances between tests to prevent state leakage."""
    yield
    try:
        from apps.backend.src import routes_agent
        routes_agent._simulator_instances.clear()
    except (ImportError, AttributeError):
        pass


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
        assert response.status_code == 422


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
        # Store 2 items so TF-IDF has corpus variance (single-doc IDF is zero)
        client.post(f"/api/projects/{project_id}/memory", json={
            "content": "TMC2209 stepper motor driver with UART interface",
            "content_type": "datasheet",
        })
        client.post(f"/api/projects/{project_id}/memory", json={
            "content": "MPU6050 IMU sensor calibration and drift correction",
            "content_type": "datasheet",
        })
        response = client.get(f"/api/projects/{project_id}/memory/search", params={
            "query": "stepper motor driver",
        })
        assert response.status_code == 200
        results = response.json()
        assert isinstance(results, list)
        assert len(results) >= 1
        assert "TMC2209" in results[0]["content"]

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
