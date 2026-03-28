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
        assert len(results) >= 2
        for r in results:
            assert "id" in r and "similarity" in r and r["similarity"] > 0


class TestMemoryStoreSimilarity:
    def _seed_issues(self, project_id):
        """Seed 4 issue/fix pairs covering different domains."""
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(
            project_id, "SLAM map won't save",
            "map_saver node crashes when writing to disk after mapping session",
            "map_saver wasn't subscribed to the correct topic /map_data",
            ["Change subscription topic from /map to /map_data", "Rebuild nav package"],
        )
        store.store_issue_fix(
            project_id, "Motor driver overheating",
            "DRV8825 gets extremely hot after 5 minutes of continuous operation at 1.5A",
            "Current limit was set too high for passive cooling, reduced to 1.0A",
            ["Adjust VREF potentiometer to 0.5V", "Add heatsink to DRV8825"],
        )
        store.store_issue_fix(
            project_id, "IMU calibration drift",
            "MPU6050 IMU readings drift significantly after 10 minutes",
            "Needed to run calibration routine on startup and apply offsets",
            ["Add calibration routine to setup()", "Store offsets in EEPROM"],
        )
        store.store_issue_fix(
            project_id, "ROS topic not publishing",
            "sensor_reader node starts but /distance topic shows no messages",
            "Publisher was created with wrong message type, should be Float32 not String",
            ["Change msg type to Float32", "Verify with rostopic echo /distance"],
        )
        return store

    def test_similar_issue_returns_relevant_match(self, project_id):
        store = self._seed_issues(project_id)
        results = store.find_similar("map saving crashes", project_id=project_id)
        assert len(results) > 0
        assert "SLAM" in results[0]["content"] or "map_saver" in results[0]["content"]

    def test_motor_query_returns_motor_result(self, project_id):
        store = self._seed_issues(project_id)
        results = store.find_similar("motor driver hot overheating", project_id=project_id)
        assert len(results) > 0
        assert "DRV8825" in results[0]["content"] or "overheating" in results[0]["content"]

    def test_imu_query_returns_imu_result(self, project_id):
        store = self._seed_issues(project_id)
        results = store.find_similar("IMU sensor drift calibration", project_id=project_id)
        assert len(results) > 0
        assert "IMU" in results[0]["content"] or "MPU6050" in results[0]["content"]

    def test_filter_by_content_type(self, project_id):
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(project_id, "Bug", "desc", "fix", ["step"])
        store.store_document_chunk(project_id, "TMC2209 datasheet content about motors", "tmc.pdf", 0)
        results = store.find_similar("motor", project_id=project_id, content_type="datasheet")
        assert all(r["content_type"] == "datasheet" for r in results)

    def test_limit_results(self, project_id):
        store = self._seed_issues(project_id)
        results = store.find_similar("motor", project_id=project_id, limit=2)
        assert len(results) <= 2

    def test_no_results_for_unrelated_query(self, project_id):
        store = self._seed_issues(project_id)
        results = store.find_similar("blockchain cryptocurrency", project_id=project_id)
        if results:
            assert results[0]["similarity"] < 0.3

    def test_empty_store_returns_empty(self, project_id):
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        results = store.find_similar("anything", project_id=project_id)
        assert results == []

    def test_stop_words_only_query_returns_empty(self, project_id):
        """Query made entirely of stop words should return empty (all tokens filtered)."""
        store = self._seed_issues(project_id)
        results = store.find_similar("the and or is it", project_id=project_id)
        assert results == []

    def test_store_document_chunk_default_doc_type(self, project_id):
        """Verify the default doc_type='datasheet' works when not explicitly passed."""
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        item = store.store_document_chunk(
            project_id=project_id,
            content="TMC2209 supports UART interface",
            doc_name="tmc2209.pdf",
            chunk_index=0,
        )
        assert item.content_type == "datasheet"
