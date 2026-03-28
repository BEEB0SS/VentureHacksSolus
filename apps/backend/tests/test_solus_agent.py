"""Tests for the SolusAgent — query routing and fallback behavior."""

import sys, os
import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

from packages.shared_types.src.models import AgentQuery, AgentResponse


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
