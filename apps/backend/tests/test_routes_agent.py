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
