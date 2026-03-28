"""Tests for the Onshape import stub endpoint."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

from fastapi.testclient import TestClient


def _get_app():
    from fastapi import FastAPI
    from apps.backend.src.routes_agent import router
    app = FastAPI()
    app.include_router(router)
    return app


class TestOnshapeImport:
    def test_import_valid_url(self, project_id):
        client = TestClient(_get_app())
        response = client.post(f"/api/projects/{project_id}/simulator/import-onshape", json={
            "url": "https://cad.onshape.com/documents/abc123/w/def456/e/ghi789",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["model_name"] == "elegoo-rover"
        assert "model_url" in data

    def test_import_invalid_url(self, project_id):
        client = TestClient(_get_app())
        response = client.post(f"/api/projects/{project_id}/simulator/import-onshape", json={
            "url": "https://example.com/not-onshape",
        })
        assert response.status_code == 400

    def test_import_missing_url(self, project_id):
        client = TestClient(_get_app())
        response = client.post(f"/api/projects/{project_id}/simulator/import-onshape", json={})
        assert response.status_code == 422
