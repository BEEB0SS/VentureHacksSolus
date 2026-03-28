"""Shared test fixtures for Solus backend tests."""

import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

# packages/shared-types uses a hyphen which Python cannot import via dot notation.
# Add the src directory directly so 'from models import ...' works, and also
# expose it as 'packages.shared_types.src' for compatibility with the task spec imports.
_shared_types_src = os.path.join(os.path.dirname(__file__), "../../../packages/shared-types/src")
sys.path.insert(0, _shared_types_src)

# Create a packages.shared_types.src shim so imports like
# 'from packages.shared_types.src.models import ...' resolve correctly.
import types as _types

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

import importlib as _importlib
if "packages.shared_types.src.models" not in sys.modules:
    _models = _importlib.import_module("models")
    sys.modules["packages.shared_types.src.models"] = _models


@pytest.fixture(autouse=True)
def fresh_db(tmp_path):
    """Give every test a fresh SQLite database."""
    db_path = str(tmp_path / "test.db")
    os.environ["SOLUS_DB_PATH"] = db_path
    from apps.backend.src.database import init_db
    init_db()
    yield db_path


@pytest.fixture
def project_id(fresh_db):
    """Create a test project and return its ID."""
    try:
        from apps.backend.src.context_engine import ContextEngine
        from packages.shared_types.src.models import Project
        p = ContextEngine.create_project(Project(name="TestBot", description="A test robot"))
        return p.id
    except ImportError:
        from packages.shared_types.src.models import _uid, _now
        from apps.backend.src.database import get_connection
        pid = _uid()
        conn = get_connection()
        conn.execute(
            "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (pid, "TestBot", "A test robot", _now(), _now()),
        )
        conn.commit()
        conn.close()
        return pid
