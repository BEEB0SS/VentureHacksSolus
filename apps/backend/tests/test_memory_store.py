"""Tests for the MemoryStore — storage and retrieval."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

from packages.shared_types.src.models import SemanticMemoryItem


class TestMemoryStoreBasicStorage:
    def test_store_item(self, project_id):
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        item = store.store(SemanticMemoryItem(
            project_id=project_id,
            content="Motor driver DRV8825 overheating under load",
            content_type="issue_fix",
            metadata={"issue_title": "DRV8825 overheat"},
        ))
        assert item.id
        assert item.project_id == project_id
        assert item.content_type == "issue_fix"

    def test_store_issue_fix(self, project_id):
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        item = store.store_issue_fix(
            project_id=project_id,
            issue_title="SLAM map won't save",
            issue_desc="map_saver node crashes when writing to disk",
            fix_desc="map_saver wasn't subscribed to the correct topic",
            fix_steps=["Change topic from /map to /map_data", "Rebuild the package"],
            entity_ids=["entity-123"],
        )
        assert item.id
        assert item.content_type == "issue_fix"
        assert "SLAM map won't save" in item.content
        assert "map_saver wasn't subscribed" in item.content
        assert item.metadata["issue_title"] == "SLAM map won't save"
        assert item.metadata["fix_steps"] == ["Change topic from /map to /map_data", "Rebuild the package"]

    def test_store_document_chunk(self, project_id):
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        item = store.store_document_chunk(
            project_id=project_id,
            content="The TMC2209 supports up to 2A RMS with 256 microstep interpolation.",
            doc_name="TMC2209_datasheet.pdf",
            chunk_index=3,
            doc_type="datasheet",
        )
        assert item.id
        assert item.content_type == "datasheet"
        assert item.metadata["doc_name"] == "TMC2209_datasheet.pdf"
        assert item.metadata["chunk_index"] == 3

    def test_store_multiple_items(self, project_id):
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(project_id, "Bug A", "desc A", "fix A", ["step"])
        store.store_issue_fix(project_id, "Bug B", "desc B", "fix B", ["step"])
        store.store_document_chunk(project_id, "Some datasheet text", "doc.pdf", 0)
        results = store.find_similar("bug", project_id=project_id)
        assert len(results) >= 1
