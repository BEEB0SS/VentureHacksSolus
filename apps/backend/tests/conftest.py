"""Shared test fixtures for Solus backend tests."""

import os
import pytest


@pytest.fixture(autouse=True)
def fresh_db(tmp_path):
    """Give every test a fresh SQLite database.

    Uses a temp file (not :memory:) because each get_connection() call
    opens a new connection, and :memory: creates a separate DB per connection.
    The env var is read dynamically by get_connection() on every call.
    """
    db_path = str(tmp_path / "test.db")
    os.environ["SOLUS_DB_PATH"] = db_path
    from apps.backend.src.database import init_db
    init_db()
    yield db_path


@pytest.fixture
def project_id(fresh_db):
    """Create a test project and return its ID."""
    from apps.backend.src.context_engine import ContextEngine
    from packages.shared_types.src.models import Project
    p = ContextEngine.create_project(Project(name="TestBot", description="A test robot"))
    return p.id
