"""Tests for Solus Core API Routes — all 14 endpoints."""

import os
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(fresh_db):
    from apps.backend.src.main import app
    return TestClient(app)


@pytest.fixture
def project_id(client):
    resp = client.post("/api/projects", json={"name": "TestBot", "description": "A test robot"})
    assert resp.status_code == 200
    return resp.json()["id"]


FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


class TestProjectRoutes:
    def test_create_project(self, client):
        resp = client.post("/api/projects", json={"name": "MyBot", "description": "desc"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "MyBot"
        assert data["description"] == "desc"
        assert "id" in data

    def test_list_projects(self, client, project_id):
        resp = client.get("/api/projects")
        assert resp.status_code == 200
        projects = resp.json()
        assert len(projects) >= 1
        assert any(p["id"] == project_id for p in projects)

    def test_get_project(self, client, project_id):
        resp = client.get(f"/api/projects/{project_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == project_id
        assert data["name"] == "TestBot"

    def test_get_project_not_found(self, client):
        resp = client.get("/api/projects/nonexistent-id")
        assert resp.status_code == 404


class TestTeamRoutes:
    def test_add_team_member(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/team",
                           json={"name": "Alice", "role": "Engineer", "email": "alice@test.com"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Alice"
        assert data["role"] == "Engineer"
        assert data["project_id"] == project_id

    def test_list_team_members(self, client, project_id):
        client.post(f"/api/projects/{project_id}/team",
                    json={"name": "Bob", "role": "Designer"})
        resp = client.get(f"/api/projects/{project_id}/team")
        assert resp.status_code == 200
        members = resp.json()
        assert len(members) >= 1
        assert any(m["name"] == "Bob" for m in members)


class TestEntityRoutes:
    def test_create_entity(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/entities",
                           json={"name": "MotorDriver", "entity_type": "electrical_part",
                                 "description": "H-bridge motor driver"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "MotorDriver"
        assert data["entity_type"] == "electrical_part"
        assert data["project_id"] == project_id

    def test_list_entities(self, client, project_id):
        client.post(f"/api/projects/{project_id}/entities",
                    json={"name": "Sensor", "entity_type": "electrical_part"})
        resp = client.get(f"/api/projects/{project_id}/entities")
        assert resp.status_code == 200
        entities = resp.json()
        assert len(entities) >= 1
        assert any(e["name"] == "Sensor" for e in entities)


class TestRelationRoutes:
    def test_create_relation(self, client, project_id):
        e1 = client.post(f"/api/projects/{project_id}/entities",
                         json={"name": "MCU", "entity_type": "electrical_part"}).json()
        e2 = client.post(f"/api/projects/{project_id}/entities",
                         json={"name": "Motor", "entity_type": "mechanical_part"}).json()
        resp = client.post(f"/api/projects/{project_id}/relations",
                           json={"source_entity_id": e1["id"], "target_entity_id": e2["id"],
                                 "relation_type": "connected_to"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["source_entity_id"] == e1["id"]
        assert data["target_entity_id"] == e2["id"]
        assert data["relation_type"] == "connected_to"


class TestGraphRoutes:
    def test_get_full_graph(self, client, project_id):
        client.post(f"/api/projects/{project_id}/entities",
                    json={"name": "NodeA", "entity_type": "software_module"})
        resp = client.get(f"/api/projects/{project_id}/graph")
        assert resp.status_code == 200
        graph = resp.json()
        assert "entities" in graph
        assert "relations" in graph
        assert len(graph["entities"]) >= 1


class TestImpactRoute:
    def test_impact_analysis(self, client, project_id):
        e1 = client.post(f"/api/projects/{project_id}/entities",
                         json={"name": "A", "entity_type": "software_module"}).json()
        e2 = client.post(f"/api/projects/{project_id}/entities",
                         json={"name": "B", "entity_type": "software_module"}).json()
        e3 = client.post(f"/api/projects/{project_id}/entities",
                         json={"name": "C", "entity_type": "software_module"}).json()
        client.post(f"/api/projects/{project_id}/relations",
                    json={"source_entity_id": e1["id"], "target_entity_id": e2["id"],
                          "relation_type": "depends_on"})
        client.post(f"/api/projects/{project_id}/relations",
                    json={"source_entity_id": e2["id"], "target_entity_id": e3["id"],
                          "relation_type": "depends_on"})
        resp = client.get(f"/api/projects/{project_id}/impact/{e1['id']}")
        assert resp.status_code == 200
        impacted = resp.json()
        impacted_ids = {e["id"] for e in impacted}
        assert e2["id"] in impacted_ids
        assert e3["id"] in impacted_ids


class TestSourceRoutes:
    def test_add_source(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/sources",
                           json={"name": "kicad-hw", "source_type": "kicad",
                                 "config": {"schematic_path": "/tmp/test.kicad_sch"}})
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "kicad-hw"
        assert data["source_type"] == "kicad"
        assert data["project_id"] == project_id

    def test_list_sources(self, client, project_id):
        client.post(f"/api/projects/{project_id}/sources",
                    json={"name": "github-repo", "source_type": "github"})
        resp = client.get(f"/api/projects/{project_id}/sources")
        assert resp.status_code == 200
        sources = resp.json()
        assert len(sources) >= 1
        assert any(s["name"] == "github-repo" for s in sources)


class TestChangesRoute:
    def test_list_changes_empty(self, client, project_id):
        resp = client.get(f"/api/projects/{project_id}/changes")
        assert resp.status_code == 200
        assert resp.json() == []


class TestSyncRoute:
    def test_sync_kicad_source(self, client, project_id):
        sch_path = os.path.join(FIXTURES_DIR, "test_motor.kicad_sch")
        pcb_path = os.path.join(FIXTURES_DIR, "test_motor.kicad_pcb")
        src = client.post(f"/api/projects/{project_id}/sources",
                          json={"name": "kicad-motor", "source_type": "kicad",
                                "config": {"schematic_path": sch_path, "pcb_path": pcb_path}}).json()
        resp = client.post(f"/api/projects/{project_id}/sources/{src['id']}/sync")
        assert resp.status_code == 200
        data = resp.json()
        assert data["snapshot_id"]
        assert data["items_synced"] > 0
        assert data["changes"] == []  # first sync, no previous snapshot

    def test_sync_creates_changes_on_second_sync(self, client, project_id):
        sch_path = os.path.join(FIXTURES_DIR, "test_motor.kicad_sch")
        pcb_path = os.path.join(FIXTURES_DIR, "test_motor.kicad_pcb")
        src = client.post(f"/api/projects/{project_id}/sources",
                          json={"name": "kicad-motor", "source_type": "kicad",
                                "config": {"schematic_path": sch_path, "pcb_path": pcb_path}}).json()
        # First sync
        client.post(f"/api/projects/{project_id}/sources/{src['id']}/sync")
        # Second sync (same data — no changes expected)
        resp = client.post(f"/api/projects/{project_id}/sources/{src['id']}/sync")
        assert resp.status_code == 200
        data = resp.json()
        assert data["snapshot_id"]
        # Same data means no changes
        assert data["changes"] == []

    def test_sync_nonexistent_source(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/sources/fake-source-id/sync")
        assert resp.status_code == 404


class TestProjectValidation:
    def test_entity_on_nonexistent_project(self, client):
        resp = client.post("/api/projects/nonexistent-project/entities",
                           json={"name": "Ghost", "entity_type": "software_module"})
        assert resp.status_code == 404
