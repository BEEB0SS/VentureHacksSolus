"""Tests for the SolusAgent — query routing and fallback behavior."""

import sys, os
import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

from packages.shared_types.src.models import AgentQuery, AgentResponse
from packages.shared_types.src.models import (
    Entity, EntityType, ChangeEvent, ChangeType, SourceType,
)


class TestAgentInit:
    def test_create_agent_no_deps(self):
        from apps.backend.src.agent.solus_agent import SolusAgent
        agent = SolusAgent()
        assert agent.context_engine is None
        assert agent.memory_store is None

    def test_create_agent_with_memory(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        agent = SolusAgent(memory_store=store)
        assert agent.memory_store is store


class TestAgentFallback:
    """Test that the agent returns useful fallback text when Gemini is unavailable."""

    @pytest.mark.asyncio
    async def test_general_query_fallback(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        agent = SolusAgent()
        query = AgentQuery(project_id=project_id, query="What is this project about?", query_type="general")
        response = await agent.query(query)
        assert isinstance(response, AgentResponse)
        assert response.query_id == query.id
        assert len(response.response_text) > 0

    @pytest.mark.asyncio
    async def test_debug_query_fallback(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(project_id, "Motor overheating", "DRV8825 hot", "Reduce current", ["Lower VREF"])
        agent = SolusAgent(memory_store=store)
        query = AgentQuery(project_id=project_id, query="My motor driver is getting hot", query_type="debug")
        response = await agent.query(query)
        assert isinstance(response, AgentResponse)
        assert len(response.response_text) > 0
        assert "memory_hits" in response.structured_data

    @pytest.mark.asyncio
    async def test_search_parts_query_fallback(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        agent = SolusAgent()
        query = AgentQuery(project_id=project_id, query="I need a motor driver for NEMA 17, 12V, must work with Teensy 4.1", query_type="search_parts")
        response = await agent.query(query)
        assert isinstance(response, AgentResponse)
        assert len(response.response_text) > 0

    @pytest.mark.asyncio
    async def test_extract_values_query_fallback(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_document_chunk(project_id, "PID values: Kp=2.5, Ki=0.1, Kd=0.05 for NEMA 17 stepper", "paper.pdf", 0)
        agent = SolusAgent(memory_store=store)
        query = AgentQuery(project_id=project_id, query="Extract PID values for stepper motor", query_type="extract_values")
        response = await agent.query(query)
        assert isinstance(response, AgentResponse)
        assert len(response.response_text) > 0
        assert "memory_hits" in response.structured_data

    @pytest.mark.asyncio
    async def test_unknown_query_type_defaults_to_general(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        agent = SolusAgent()
        query = AgentQuery(project_id=project_id, query="Hello", query_type="nonexistent_type")
        response = await agent.query(query)
        assert isinstance(response, AgentResponse)
        assert len(response.response_text) > 0

    @pytest.mark.asyncio
    async def test_response_includes_query_id(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        agent = SolusAgent()
        query = AgentQuery(project_id=project_id, query="test", query_type="general")
        response = await agent.query(query)
        assert response.query_id == query.id


class FakeContextEngine:
    """Minimal fake for testing agent context assembly without the real ContextEngine.
    Uses real Entity and ChangeEvent objects to match the production ContextEngine interface."""

    def __init__(self, project_id):
        self.project_id = project_id

    def get_full_graph(self):
        return {
            "entities": [
                {"id": "e1", "name": "DRV8825", "entity_type": "electrical_part", "description": "Motor driver"},
                {"id": "e2", "name": "motor_controller.py", "entity_type": "software_module", "description": "Stepper control"},
            ],
            "relations": [
                {"id": "r1", "source_entity_id": "e1", "target_entity_id": "e2", "relation_type": "drives"},
            ],
        }

    def get_subgraph(self, entity_id, depth=2):
        return self.get_full_graph()

    def impact_analysis(self, entity_id, depth=3):
        """Return real Entity objects matching the production interface."""
        return [
            Entity(
                id="e2",
                project_id=self.project_id,
                name="motor_controller.py",
                entity_type=EntityType.SOFTWARE_MODULE,
                description="Stepper control code",
            ),
        ]

    def list_changes(self):
        """Return real ChangeEvent objects matching the production interface."""
        return [
            ChangeEvent(
                project_id=self.project_id,
                change_type=ChangeType.MODIFIED,
                entity_name="DRV8825",
                description="Voltage range changed",
            ),
        ]

    def list_entities(self, entity_type=None):
        return []


class TestAgentContextAssembly:
    @pytest.mark.asyncio
    async def test_context_includes_graph(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        fake_engine = FakeContextEngine(project_id)
        agent = SolusAgent(context_engine=fake_engine)
        query = AgentQuery(project_id=project_id, query="What components are in my system?", query_type="general")
        context = agent._build_context(query)
        assert context["graph"] is not None
        assert len(context["graph"]["entities"]) == 2

    @pytest.mark.asyncio
    async def test_context_includes_memory(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(project_id, "Motor bug", "driver issue", "fixed it", ["step1"])
        # Second item ensures TF-IDF IDF is non-zero (single-doc corpus yields all-zero IDF)
        store.store_document_chunk(project_id, "Sensor calibration procedure for IMU", "calibration.pdf", 0)
        agent = SolusAgent(memory_store=store)
        query = AgentQuery(project_id=project_id, query="motor driver problem", query_type="debug")
        context = agent._build_context(query)
        assert len(context["memory_hits"]) > 0

    @pytest.mark.asyncio
    async def test_context_includes_changes(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        fake_engine = FakeContextEngine(project_id)
        agent = SolusAgent(context_engine=fake_engine)
        query = AgentQuery(project_id=project_id, query="What changed?", query_type="general")
        context = agent._build_context(query)
        assert len(context["recent_changes"]) > 0
        assert context["recent_changes"][0]["entity_name"] == "DRV8825"

    @pytest.mark.asyncio
    async def test_impact_analysis_with_engine(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        fake_engine = FakeContextEngine(project_id)
        agent = SolusAgent(context_engine=fake_engine)
        query = AgentQuery(
            project_id=project_id,
            query="DRV8825 was replaced with TMC2209",
            query_type="impact_analysis",
            context_entity_ids=["e1"],
        )
        response = await agent.query(query)
        assert "impacted_entities" in response.structured_data
        assert len(response.structured_data["impacted_entities"]) > 0
        assert response.structured_data["impacted_entities"][0]["name"] == "motor_controller.py"

    @pytest.mark.asyncio
    async def test_debug_with_both_engine_and_memory(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(project_id, "Motor overheating", "DRV8825 hot", "Reduce current", ["Lower VREF"])
        fake_engine = FakeContextEngine(project_id)
        agent = SolusAgent(context_engine=fake_engine, memory_store=store)
        query = AgentQuery(project_id=project_id, query="Motor driver getting hot", query_type="debug")
        response = await agent.query(query)
        assert "memory_hits" in response.structured_data
        assert len(response.response_text) > 0

    @pytest.mark.asyncio
    async def test_format_context_for_prompt(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        fake_engine = FakeContextEngine(project_id)
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(project_id, "Bug", "desc", "fix", ["step"])
        agent = SolusAgent(context_engine=fake_engine, memory_store=store)
        query = AgentQuery(project_id=project_id, query="motor issue", query_type="debug")
        context = agent._build_context(query)
        formatted = agent._format_context_for_prompt(context)
        assert "DRV8825" in formatted
        assert "Project Graph" in formatted
