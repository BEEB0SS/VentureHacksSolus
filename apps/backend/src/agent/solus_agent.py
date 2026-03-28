"""
Solus Agent — Gemini-powered AI reasoning for robotics development.

Routes queries by type, builds context from the graph + memory + recent changes,
and sends to Google Gemini for reasoning. Falls back gracefully when Gemini is unavailable.
"""

import asyncio
import os
import json
from typing import Optional

from packages.shared_types.src.models import (
    AgentQuery, AgentResponse, PartCandidate, _uid, _now,
)
from apps.backend.src.connectors.component_search import search_components, ComponentSearchError

# Gemini import — optional, fails gracefully
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False


class SolusAgent:
    """AI agent that uses the Robotics Context Model + memory to answer queries."""

    def __init__(self, context_engine=None, memory_store=None):
        self.context_engine = context_engine
        self.memory_store = memory_store
        self._gemini_model = None
        self._init_gemini()

    def _init_gemini(self):
        """Initialize Gemini if API key is available."""
        api_key = os.environ.get("GEMINI_API_KEY")
        if not GEMINI_AVAILABLE or not api_key:
            return
        # Try models in order of preference
        for model_name in ("gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"):
            try:
                genai.configure(api_key=api_key)
                self._gemini_model = genai.GenerativeModel(model_name)
                print(f"[Solus] Gemini ready: {model_name}")
                return
            except Exception as e:
                print(f"[Solus] Gemini model {model_name} failed: {e}")
        print("[Solus] WARNING: Gemini init failed for all models — falling back to rule-based responses")

    async def query(self, agent_query: AgentQuery) -> AgentResponse:
        """Route a query to the appropriate handler based on query_type."""
        handlers = {
            "general": self._handle_general,
            "debug": self._handle_debug,
            "search_parts": self._handle_search_parts,
            "extract_values": self._handle_extract_values,
            "impact_analysis": self._handle_impact_analysis,
            "diagnose_and_replace": self._handle_diagnose_and_replace,
            "plan": self._handle_plan,
        }
        handler = handlers.get(agent_query.query_type, self._handle_general)
        return await handler(agent_query)

    def _build_context(self, agent_query: AgentQuery) -> dict:
        """Assemble context from graph, memory, and recent changes."""
        context = {
            "query": agent_query.query,
            "query_type": agent_query.query_type,
            "project_id": agent_query.project_id,
            "graph": None,
            "memory_hits": [],
            "recent_changes": [],
        }
        if self.context_engine:
            try:
                if agent_query.context_entity_ids:
                    context["graph"] = self.context_engine.get_subgraph(agent_query.context_entity_ids[0], depth=2)
                else:
                    context["graph"] = self.context_engine.get_full_graph()
            except Exception:
                pass
            try:
                context["recent_changes"] = [
                    {
                        "change_type": c.change_type.value if hasattr(c.change_type, 'value') else c.change_type,
                        "entity_name": c.entity_name,
                        "description": c.description,
                    }
                    for c in self.context_engine.list_changes()[:10]
                ]
            except Exception:
                pass
        if self.memory_store:
            try:
                context["memory_hits"] = self.memory_store.find_similar(
                    agent_query.query, project_id=agent_query.project_id, limit=5,
                )
            except Exception:
                pass
        return context

    def _format_context_for_prompt(self, context: dict) -> str:
        """Format assembled context into a string for the Gemini prompt."""
        parts = []
        if context.get("graph") and context["graph"].get("entities"):
            entities = context["graph"]["entities"]
            parts.append(f"## Project Graph ({len(entities)} entities)")
            for e in entities[:20]:
                parts.append(f"- {e.get('name', 'unnamed')} ({e.get('entity_type', 'unknown')}): {e.get('description', '')}")
            relations = context["graph"].get("relations", [])
            if relations:
                parts.append(f"\n## Relations ({len(relations)} edges)")
                for r in relations[:20]:
                    parts.append(f"- {r.get('source_entity_id', '?')[:8]} --[{r.get('relation_type', '?')}]--> {r.get('target_entity_id', '?')[:8]}")
        if context.get("memory_hits"):
            parts.append(f"\n## Relevant Past Knowledge ({len(context['memory_hits'])} items)")
            for hit in context["memory_hits"]:
                parts.append(f"- [{hit.get('content_type', 'unknown')}] (similarity: {hit.get('similarity', 0):.2f})")
                parts.append(f"  {hit.get('content', '')[:300]}")
        if context.get("recent_changes"):
            parts.append(f"\n## Recent Changes ({len(context['recent_changes'])} events)")
            for ch in context["recent_changes"]:
                parts.append(f"- {ch.get('change_type', '?')}: {ch.get('entity_name', '?')} — {ch.get('description', '')}")
        return "\n".join(parts) if parts else "No project context available."

    async def _call_gemini(self, system_prompt: str, user_prompt: str) -> Optional[str]:
        """Call Gemini API. Returns None if unavailable."""
        if not self._gemini_model:
            print("[Solus] _call_gemini: no model initialized")
            return None
        try:
            full_prompt = f"{system_prompt}\n\n{user_prompt}"
            response = await asyncio.to_thread(self._gemini_model.generate_content, full_prompt)
            return response.text
        except Exception as e:
            print(f"[Solus] Gemini call failed: {e}")
            return None

    async def _handle_general(self, query: AgentQuery) -> AgentResponse:
        context = self._build_context(query)
        context_str = self._format_context_for_prompt(context)
        system_prompt = """You are Solus, an AI assistant for robotics development teams.
You have access to the project's context model — a graph of hardware, software, and runtime components.
Answer the user's question using the project context provided. Be specific and actionable."""
        user_prompt = f"Project Context:\n{context_str}\n\nUser Question: {query.query}"
        gemini_response = await self._call_gemini(system_prompt, user_prompt)
        if gemini_response:
            return AgentResponse(query_id=query.id, response_text=gemini_response,
                structured_data={"memory_hits": context.get("memory_hits", [])},
                sources=["gemini", "context_model"], confidence=0.8)
        fallback = self._build_fallback_general(query, context)
        return AgentResponse(query_id=query.id, response_text=fallback,
            structured_data={"memory_hits": context.get("memory_hits", [])},
            sources=["context_model", "fallback"], confidence=0.3)

    async def _handle_debug(self, query: AgentQuery) -> AgentResponse:
        context = self._build_context(query)
        context_str = self._format_context_for_prompt(context)
        system_prompt = """You are Solus, an AI debugging assistant for robotics.
Diagnose the issue using the project's context model, past issues, and recent changes.
If a similar issue was found in team memory, reference it and suggest the same fix.
Be systematic: identify the component, trace the signal path, suggest root causes."""
        user_prompt = f"Project Context:\n{context_str}\n\nIssue to Debug: {query.query}"
        gemini_response = await self._call_gemini(system_prompt, user_prompt)
        if gemini_response:
            return AgentResponse(query_id=query.id, response_text=gemini_response,
                structured_data={"memory_hits": context.get("memory_hits", [])},
                sources=["gemini", "context_model", "memory"], confidence=0.8)
        fallback = self._build_fallback_debug(query, context)
        return AgentResponse(query_id=query.id, response_text=fallback,
            structured_data={"memory_hits": context.get("memory_hits", [])},
            sources=["context_model", "memory", "fallback"], confidence=0.3)

    async def _extract_search_params(self, context_str: str, user_query: str) -> str:
        """Phase 1: Use Gemini to extract optimal DigiKey search keywords from project context."""
        system_prompt = (
            "You are a component search assistant. Given the project context and the user's request, "
            "extract the best search keywords for an electronic component search.\n\n"
            "Analyze the project's existing components (voltage levels, communication protocols, "
            "mechanical constraints, current requirements) and the user's request to determine "
            "what to search for.\n\n"
            'Output ONLY valid JSON:\n'
            '{"keywords": "the search query string for the component search", '
            '"reasoning": "one sentence explaining why these keywords"}'
        )
        user_prompt = f"Project Context:\n{context_str}\n\nUser Request: {user_query}"
        response = await self._call_gemini(system_prompt, user_prompt)
        if response:
            try:
                # Strip markdown code fences if present
                text = response.strip()
                if text.startswith("```"):
                    text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                    text = text.rsplit("```", 1)[0]
                data = json.loads(text)
                return data.get("keywords", user_query)
            except (json.JSONDecodeError, KeyError):
                pass
        return user_query

    async def _rank_candidates(self, context_str: str, user_query: str, products: list[dict]) -> dict:
        """Phase 2: Use Gemini to rank DigiKey results against project constraints."""
        system_prompt = (
            "You are a component compatibility analyst for a robotics project.\n"
            "Given the project context and component search results, evaluate each product "
            "for compatibility with the existing system.\n\n"
            "For each product, provide:\n"
            "- relevance_score (0.0-1.0)\n"
            "- compatibility_notes (1-2 sentences on why it fits or doesn't)\n\n"
            'Output ONLY valid JSON:\n'
            '{"ranked_products": [{"index": 0, "relevance_score": 0.95, "compatibility_notes": "..."}], '
            '"summary": "Overall recommendation in 2-3 sentences"}'
        )
        products_summary = json.dumps(
            [
                {
                    "index": i,
                    "manufacturer_part_number": p.get("manufacturer_part_number", ""),
                    "manufacturer": p.get("manufacturer", ""),
                    "description": p.get("description", ""),
                    "detailed_description": p.get("detailed_description", ""),
                    "unit_price": p.get("unit_price", 0),
                    "quantity_available": p.get("quantity_available", 0),
                    "category": p.get("category", ""),
                    "parameters": dict(list(p.get("parameters", {}).items())[:10]),
                }
                for i, p in enumerate(products)
            ],
            indent=2,
        )
        user_prompt = (
            f"Project Context:\n{context_str}\n\n"
            f"User Request: {user_query}\n\n"
            f"Mouser Search Results:\n{products_summary}"
        )
        response = await self._call_gemini(system_prompt, user_prompt)
        if response:
            try:
                text = response.strip()
                if text.startswith("```"):
                    text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                    text = text.rsplit("```", 1)[0]
                return json.loads(text)
            except (json.JSONDecodeError, KeyError):
                pass
        # Fallback: return unsorted with neutral scores
        return {
            "ranked_products": [
                {"index": i, "relevance_score": 0.5, "compatibility_notes": "Automated ranking unavailable"}
                for i in range(len(products))
            ],
            "summary": "Search results returned without AI ranking (Gemini unavailable).",
        }

    async def _handle_search_parts(self, query: AgentQuery) -> AgentResponse:
        context = self._build_context(query)
        context_str = self._format_context_for_prompt(context)

        # Phase 1: Extract search keywords
        keywords = await self._extract_search_params(context_str, query.query)

        # Web search for components
        try:
            search_results = search_components(keywords)
        except ComponentSearchError as exc:
            return AgentResponse(
                query_id=query.id,
                response_text=str(exc),
                structured_data={"memory_hits": context.get("memory_hits", [])},
                sources=["web_search"],
                confidence=0.1,
            )

        if not search_results:
            # Fall back to LLM-only search
            return await self._handle_search_parts_llm_only(query, context, context_str)


        # Phase 2: Rank candidates
        ranking = await self._rank_candidates(context_str, query.query, search_results)
        ranked_products = ranking.get("ranked_products", [])
        summary = ranking.get("summary", "")

        # Build PartCandidate objects
        part_candidates = []
        for rp in sorted(ranked_products, key=lambda x: x.get("relevance_score", 0), reverse=True):
            idx = rp.get("index", 0)
            if idx >= len(search_results):
                continue
            mp = search_results[idx]
            pricing = mp.get("pricing", [])
            price_range = ""
            if pricing:
                prices = [p["unit_price"] for p in pricing if p.get("unit_price")]
                if prices:
                    price_range = f"${min(prices):.2f} - ${max(prices):.2f}" if len(prices) > 1 else f"${prices[0]:.2f}"

            pc = PartCandidate(
                name=mp.get("description", mp.get("manufacturer_part_number", "")),
                manufacturer=mp.get("manufacturer", ""),
                manufacturer_part_number=mp.get("manufacturer_part_number", ""),
                distributor_part_number=mp.get("mouser_part_number", ""),
                specs=mp.get("parameters", {}),
                datasheet_url=mp.get("datasheet_url", ""),
                product_url=mp.get("product_url", ""),
                photo_url=mp.get("photo_url", ""),
                price_range=price_range,
                unit_price=float(mp.get("unit_price", 0)),
                quantity_available=int(mp.get("quantity_available", 0)),
                category=mp.get("category", ""),
                source_url=mp.get("product_url", ""),
                relevance_score=rp.get("relevance_score", 0.5),
                compatibility_notes=rp.get("compatibility_notes", ""),
            )
            part_candidates.append(pc)

        # Build response text
        response_lines = []
        if summary:
            response_lines.append(summary)
            response_lines.append("")
        for i, pc in enumerate(part_candidates, 1):
            response_lines.append(
                f"{i}. **{pc.manufacturer_part_number}** by {pc.manufacturer} — "
                f"${pc.unit_price:.2f}, {pc.quantity_available} in stock "
                f"(compatibility: {pc.relevance_score:.0%})"
            )
            if pc.compatibility_notes:
                response_lines.append(f"   {pc.compatibility_notes}")

        return AgentResponse(
            query_id=query.id,
            response_text="\n".join(response_lines),
            structured_data={
                "part_candidates": [vars(pc) for pc in part_candidates],
                "memory_hits": context.get("memory_hits", []),
            },
            sources=["gemini", "web_search", "context_model"],
            confidence=0.85,
        )

    async def _handle_search_parts_llm_only(
        self, query: AgentQuery, context: dict, context_str: str
    ) -> AgentResponse:
        """Fallback: LLM-only component search when DigiKey is unavailable."""
        system_prompt = (
            "You are Solus, an AI assistant that recommends electronic components for robotics projects.\n"
            "Given the user's requirements and the project's existing system context, recommend specific components.\n"
            "Include: part name, manufacturer, key specs, compatibility reasoning with existing components, and price range.\n"
            "Cross-reference with the project's context model for compatibility. NEVER hallucinate specifications."
        )
        user_prompt = f"Project Context:\n{context_str}\n\nComponent Request: {query.query}"
        gemini_response = await self._call_gemini(system_prompt, user_prompt)
        if gemini_response:
            return AgentResponse(
                query_id=query.id,
                response_text=gemini_response,
                structured_data={"memory_hits": context.get("memory_hits", [])},
                sources=["gemini", "context_model"],
                confidence=0.7,
            )
        fallback = f"Component search for: {query.query}\n\nGemini API is not available. To get AI-powered component recommendations, set the GEMINI_API_KEY environment variable.\n\n"
        if context.get("memory_hits"):
            fallback += "Related items from memory:\n"
            for hit in context["memory_hits"]:
                fallback += f"- {hit['content'][:200]}\n"
        return AgentResponse(
            query_id=query.id,
            response_text=fallback,
            structured_data={"memory_hits": context.get("memory_hits", [])},
            sources=["fallback"],
            confidence=0.1,
        )

    async def _handle_extract_values(self, query: AgentQuery) -> AgentResponse:
        context = self._build_context(query)
        context_str = self._format_context_for_prompt(context)
        system_prompt = """You are Solus, an AI assistant that extracts parameter values from research papers and datasheets.
Search the provided memory items (document chunks) for the requested values.
For each value found, provide: parameter name, value, unit, confidence level (high/medium/low), and source reference.
NEVER hallucinate values. If a value is not found, say so explicitly."""
        user_prompt = f"Project Context:\n{context_str}\n\nExtraction Request: {query.query}"
        gemini_response = await self._call_gemini(system_prompt, user_prompt)
        if gemini_response:
            return AgentResponse(query_id=query.id, response_text=gemini_response,
                structured_data={"memory_hits": context.get("memory_hits", [])},
                sources=["gemini", "memory"], confidence=0.7)
        fallback = f"Value extraction request: {query.query}\n\n"
        if context.get("memory_hits"):
            fallback += "Relevant document chunks found:\n"
            for hit in context["memory_hits"]:
                fallback += f"\n[{hit.get('content_type', 'unknown')}] (similarity: {hit.get('similarity', 0):.2f})\n"
                fallback += f"{hit['content'][:500]}\n"
            fallback += "\nSet GEMINI_API_KEY to enable AI-powered value extraction."
        else:
            fallback += "No relevant document chunks found in memory. Upload a PDF or datasheet first."
        return AgentResponse(query_id=query.id, response_text=fallback,
            structured_data={"memory_hits": context.get("memory_hits", [])},
            sources=["memory", "fallback"], confidence=0.2)

    async def _handle_impact_analysis(self, query: AgentQuery) -> AgentResponse:
        context = self._build_context(query)
        impacted_entities = []
        if self.context_engine and query.context_entity_ids:
            try:
                impacted = self.context_engine.impact_analysis(query.context_entity_ids[0], depth=3)
                impacted_entities = [
                    {"id": e.id, "name": e.name, "entity_type": e.entity_type.value if hasattr(e.entity_type, 'value') else e.entity_type}
                    for e in impacted
                ]
            except Exception:
                pass
        context_str = self._format_context_for_prompt(context)
        impact_list = "\n".join(f"- {ie['name']} ({ie['entity_type']})" for ie in impacted_entities) if impacted_entities else "None found"
        system_prompt = """You are Solus, an AI assistant explaining the impact of changes in a robotics system.

Return your response as valid JSON with exactly this structure:
{
  "summary": "One paragraph overview of the overall impact and risk level.",
  "entity_explanations": [
    {
      "name": "component name",
      "how_affected": "Specific explanation of how this component is affected — signal paths, interface changes, data format, timing, etc.",
      "action": "Concrete action the engineer must take — e.g. update config value, rewrite function, re-test integration."
    }
  ]
}

Be specific. Reference actual signal names, function names, config keys, and interface types from the project context where available.
Do not include markdown fences or extra text — return only the JSON object."""
        user_prompt = f"Project Context:\n{context_str}\n\nImpacted Components (graph traversal):\n{impact_list}\n\nChange Description: {query.query}"
        gemini_response = await self._call_gemini(system_prompt, user_prompt)
        if gemini_response:
            summary = gemini_response
            impact_explanations = []
            try:
                # Strip markdown fences if present
                clean = gemini_response.strip()
                if clean.startswith("```"):
                    clean = "\n".join(clean.split("\n")[1:])
                if clean.endswith("```"):
                    clean = "\n".join(clean.split("\n")[:-1])
                parsed = json.loads(clean.strip())
                summary = parsed.get("summary", gemini_response)
                impact_explanations = parsed.get("entity_explanations", [])
                # Merge entity metadata into explanations
                entity_map = {e["name"]: e for e in impacted_entities}
                for exp in impact_explanations:
                    matched = entity_map.get(exp.get("name", ""))
                    if matched:
                        exp["id"] = matched["id"]
                        exp["entity_type"] = matched["entity_type"]
            except Exception:
                pass
            return AgentResponse(query_id=query.id, response_text=summary,
                structured_data={
                    "impacted_entities": impacted_entities,
                    "impact_explanations": impact_explanations,
                    "memory_hits": context.get("memory_hits", []),
                },
                sources=["gemini", "context_model", "impact_analysis"], confidence=0.85)
        fallback = f"Impact analysis for: {query.query}\n\n"
        if impacted_entities:
            fallback += f"Found {len(impacted_entities)} impacted components:\n"
            for ie in impacted_entities:
                fallback += f"- {ie['name']} ({ie['entity_type']})\n"
            fallback += "\nRestart backend with GEMINI_API_KEY set for per-component AI explanations."
        else:
            fallback += "No impacted components found. Select an entity from the dropdown to run impact analysis."
        return AgentResponse(query_id=query.id, response_text=fallback,
            structured_data={"impacted_entities": impacted_entities, "impact_explanations": [], "memory_hits": context.get("memory_hits", [])},
            sources=["context_model", "fallback"], confidence=0.3)

    async def _handle_diagnose_and_replace(self, query: AgentQuery) -> AgentResponse:
        """Combined flow: run impact analysis, then automatically search for replacement parts."""
        # Step 1: Run impact analysis
        impact_response = await self._handle_impact_analysis(query)
        impact_text = impact_response.response_text
        impacted_entities = impact_response.structured_data.get("impacted_entities", [])

        # Step 2: Use Gemini to extract what component needs replacing from the impact analysis
        context = self._build_context(query)
        context_str = self._format_context_for_prompt(context)

        extract_prompt = (
            "You are a component replacement assistant. Given the impact analysis below "
            "and the user's original problem, determine what replacement component to search for.\n\n"
            "Output ONLY valid JSON:\n"
            '{"search_query": "specific component search terms", '
            '"reason": "why this component needs replacing", '
            '"constraints": "voltage, current, interface, or form factor constraints from the project"}'
        )
        user_prompt = (
            f"User's Problem: {query.query}\n\n"
            f"Impact Analysis:\n{impact_text}\n\n"
            f"Project Context:\n{context_str}"
        )

        search_query = query.query  # fallback
        replacement_reason = ""
        gemini_response = await self._call_gemini(extract_prompt, user_prompt)
        if gemini_response:
            try:
                text = gemini_response.strip()
                if text.startswith("```"):
                    text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                    text = text.rsplit("```", 1)[0]
                data = json.loads(text)
                search_query = data.get("search_query", query.query)
                replacement_reason = data.get("reason", "")
            except (json.JSONDecodeError, KeyError):
                pass

        # Step 3: Search for replacement parts
        try:
            search_results = search_components(search_query)
        except ComponentSearchError:
            search_results = []

        # Step 4: Rank candidates if we have results
        part_candidates = []
        parts_summary = ""
        if search_results:
            ranking = await self._rank_candidates(context_str, search_query, search_results)
            ranked_products = ranking.get("ranked_products", [])
            parts_summary = ranking.get("summary", "")

            for rp in sorted(ranked_products, key=lambda x: x.get("relevance_score", 0), reverse=True):
                idx = rp.get("index", 0)
                if idx >= len(search_results):
                    continue
                mp = search_results[idx]
                pricing = mp.get("pricing", [])
                price_range = ""
                if pricing:
                    prices = [p["unit_price"] for p in pricing if p.get("unit_price")]
                    if prices:
                        price_range = f"${min(prices):.2f} - ${max(prices):.2f}" if len(prices) > 1 else f"${prices[0]:.2f}"

                pc = PartCandidate(
                    name=mp.get("description", mp.get("manufacturer_part_number", "")),
                    manufacturer=mp.get("manufacturer", ""),
                    manufacturer_part_number=mp.get("manufacturer_part_number", ""),
                    distributor_part_number=mp.get("distributor_part_number", ""),
                    specs=mp.get("parameters", {}),
                    datasheet_url=mp.get("datasheet_url", ""),
                    product_url=mp.get("product_url", ""),
                    photo_url=mp.get("photo_url", ""),
                    price_range=price_range,
                    unit_price=float(mp.get("unit_price", 0)),
                    quantity_available=int(mp.get("quantity_available", 0)),
                    category=mp.get("category", ""),
                    source_url=mp.get("product_url", ""),
                    relevance_score=rp.get("relevance_score", 0.5),
                    compatibility_notes=rp.get("compatibility_notes", ""),
                )
                part_candidates.append(pc)

        # Step 5: Build combined response
        response_lines = [
            "## Impact Analysis",
            "",
            impact_text,
            "",
        ]

        if replacement_reason:
            response_lines.append(f"## Replacement Needed")
            response_lines.append("")
            response_lines.append(replacement_reason)
            response_lines.append("")

        if part_candidates:
            response_lines.append(f"## Replacement Candidates (searched: \"{search_query}\")")
            response_lines.append("")
            if parts_summary:
                response_lines.append(parts_summary)
                response_lines.append("")
            for i, pc in enumerate(part_candidates, 1):
                response_lines.append(
                    f"{i}. **{pc.manufacturer_part_number}** by {pc.manufacturer} — "
                    f"${pc.unit_price:.2f}, {pc.quantity_available:,} in stock "
                    f"(compatibility: {pc.relevance_score:.0%})"
                )
                if pc.compatibility_notes:
                    response_lines.append(f"   {pc.compatibility_notes}")
        elif search_results:
            response_lines.append("## Replacement search returned results but ranking failed.")
        else:
            response_lines.append(f"## No replacement parts found for \"{search_query}\"")

        return AgentResponse(
            query_id=query.id,
            response_text="\n".join(response_lines),
            structured_data={
                "impacted_entities": impacted_entities,
                "part_candidates": [vars(pc) for pc in part_candidates],
                "memory_hits": context.get("memory_hits", []),
            },
            sources=["gemini", "web_search", "context_model", "impact_analysis"],
            confidence=0.85 if part_candidates else 0.5,
        )

    async def _handle_plan(self, query: AgentQuery) -> AgentResponse:
        context = self._build_context(query)
        context_str = self._format_context_for_prompt(context)
        system_prompt = """You are Solus, an AI assistant that helps plan integration work for robotics projects.
Given the project's context model, suggest a plan for the requested integration task.
Consider hardware-software boundaries, testing order, and potential failure points."""
        user_prompt = f"Project Context:\n{context_str}\n\nPlanning Request: {query.query}"
        gemini_response = await self._call_gemini(system_prompt, user_prompt)
        if gemini_response:
            return AgentResponse(query_id=query.id, response_text=gemini_response,
                structured_data={"memory_hits": context.get("memory_hits", [])},
                sources=["gemini", "context_model"], confidence=0.7)
        fallback = f"Planning request: {query.query}\n\nSet GEMINI_API_KEY to enable AI-powered planning assistance."
        return AgentResponse(query_id=query.id, response_text=fallback,
            structured_data={"memory_hits": context.get("memory_hits", [])},
            sources=["fallback"], confidence=0.1)

    def _build_fallback_general(self, query: AgentQuery, context: dict) -> str:
        parts = [f"Query: {query.query}\n"]
        graph = context.get("graph")
        if graph and graph.get("entities"):
            parts.append(f"Project has {len(graph['entities'])} entities and {len(graph.get('relations', []))} relations in the context model.")
        if context.get("memory_hits"):
            parts.append("\nRelated items from memory:")
            for hit in context["memory_hits"][:3]:
                parts.append(f"- {hit['content'][:200]}")
        if context.get("recent_changes"):
            parts.append(f"\n{len(context['recent_changes'])} recent changes detected.")
        parts.append("\nSet GEMINI_API_KEY for AI-powered responses.")
        return "\n".join(parts)

    def _build_fallback_debug(self, query: AgentQuery, context: dict) -> str:
        parts = [f"Debugging: {query.query}\n"]
        if context.get("memory_hits"):
            parts.append("Similar past issues found:")
            for hit in context["memory_hits"][:3]:
                meta = hit.get("metadata", {})
                if meta.get("issue_title"):
                    parts.append(f"\n**{meta['issue_title']}** (similarity: {hit.get('similarity', 0):.2f})")
                    if meta.get("fix_desc"):
                        parts.append(f"  Fix: {meta['fix_desc']}")
                    if meta.get("fix_steps"):
                        parts.append(f"  Steps: {'; '.join(meta['fix_steps'])}")
                else:
                    parts.append(f"- {hit['content'][:200]}")
        else:
            parts.append("No similar past issues found in team memory.")
        if context.get("recent_changes"):
            parts.append(f"\nNote: {len(context['recent_changes'])} recent changes — one of these may be related.")
        parts.append("\nSet GEMINI_API_KEY for AI-powered diagnosis.")
        return "\n".join(parts)
