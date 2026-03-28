"""Integration tests for the discovery API route."""

import os
import pytest
from fastapi.testclient import TestClient

from packages.shared_types.src.models import (
    Entity, EntityType, SourceType, SourceConnection,
)


@pytest.fixture
def client(fresh_db):
    from apps.backend.src.main import app
    return TestClient(app)


@pytest.fixture
def seeded_project(client, project_id, tmp_path):
    """Create a project with entities and source connections pointing to fixture files."""
    from apps.backend.src.context_engine import ContextEngine
    engine = ContextEngine(project_id)

    fixtures = os.path.join(os.path.dirname(__file__), "fixtures", "discovery")

    # Source connection pointing to fixtures dir as "repo"
    engine.create_source(SourceConnection(
        source_type=SourceType.GITHUB,
        name="Test Repo",
        config={"repo_path": fixtures},
    ))

    # Software entities with source_ref relative to fixtures dir
    engine.create_entity(Entity(
        entity_type=EntityType.SOFTWARE_MODULE,
        name="motor_controller.py",
        source_ref="motor_controller.py",
    ))

    # Interface entities
    engine.create_entity(Entity(entity_type=EntityType.INTERFACE, name="/cmd_vel"))
    engine.create_entity(Entity(entity_type=EntityType.INTERFACE, name="/odom"))

    # Electrical entities
    engine.create_entity(Entity(
        entity_type=EntityType.ELECTRICAL_PART,
        name="DRV8825", metadata={"ref": "U2"},
    ))

    return project_id


class TestDiscoverEndpoint:
    def test_discover_returns_report(self, client, seeded_project):
        resp = client.post(f"/api/projects/{seeded_project}/discover",
                           json={"analyzers": ["python_ast"]})
        assert resp.status_code == 200
        data = resp.json()
        assert "total_candidates" in data
        assert "relations" in data
        assert "warnings" in data

    def test_discover_finds_ros_topics(self, client, seeded_project):
        resp = client.post(f"/api/projects/{seeded_project}/discover",
                           json={"analyzers": ["python_ast"]})
        data = resp.json()
        rel_types = {r["relation_type"] for r in data["relations"]}
        assert "subscribes_to" in rel_types or "publishes" in rel_types

    def test_discover_with_auto_add(self, client, seeded_project):
        resp = client.post(f"/api/projects/{seeded_project}/discover",
                           json={"analyzers": ["python_ast"], "auto_add": True})
        data = resp.json()
        if data["new_relations"] > 0:
            assert any(r["added"] for r in data["relations"])
            # Verify relations were actually created in the graph
            graph_resp = client.get(f"/api/projects/{seeded_project}/graph")
            graph = graph_resp.json()
            assert len(graph["relations"]) > 0

    def test_discover_nonexistent_project(self, client):
        resp = client.post("/api/projects/fake-id/discover", json={})
        assert resp.status_code == 404

    def test_discover_default_params(self, client, seeded_project):
        resp = client.post(f"/api/projects/{seeded_project}/discover", json={})
        assert resp.status_code == 200
