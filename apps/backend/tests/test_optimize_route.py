"""Integration test for the PID optimize endpoint."""

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


class TestOptimizeEndpoint:
    def test_optimize_returns_result(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/simulator/optimize", json={
            "n_trials": 20,
            "n_steps": 100,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "best_gains" in data
        assert "best_score" in data
        assert "bad_score" in data
        assert "best_trajectory" in data
        assert "bad_trajectory" in data
        assert data["best_score"] <= data["bad_score"]

    def test_optimize_with_custom_bounds(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/simulator/optimize", json={
            "n_trials": 10,
            "n_steps": 50,
            "bounds": {"kp": [1.0, 3.0], "ki": [0.0, 0.5], "kd": [0.0, 0.2]},
        })
        assert resp.status_code == 200
        gains = resp.json()["best_gains"]
        assert 1.0 <= gains["kp"] <= 3.0

    def test_optimize_default_params(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/simulator/optimize", json={})
        assert resp.status_code == 200
        assert resp.json()["trials_run"] == 100
