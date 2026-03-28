# Teammate 2 Assignment: Demo D (External Knowledge) + Demo E (Simulator)

**Branch:** `feature/ai-knowledge-simulator`

You own the AI brain, the knowledge retrieval system, and the simulator,
end-to-end — backend engines, API routes, and frontend tab.

---

## Demo D Recap — External Knowledge + Grounded Planning

1. Engineer asks: "I need a motor driver for a NEMA 17 stepper, 12V, must work with Teensy 4.1"
2. Agent checks system constraints from context model
3. Returns recommendations with specs, compatibility reasoning, price range
4. OR: "Extract the PID values from this research paper for our motor setup"
5. Agent reads paper chunks, extracts values with confidence levels

## Demo E Recap — Simulator Loop

1. Design parameter changes (wheel radius, motor torque)
2. Context model updates (Lead's code handles this)
3. Your simulator runs with updated parameters
4. Compares simulated vs live runtime data
5. Shows discrepancies: "Simulated turn_radius=15cm, observed=22cm"

---

## Files You Own

### Backend
- `apps/backend/src/agent/solus_agent.py` — Gemini-powered AI reasoning
- `apps/backend/src/memory/memory_store.py` — semantic search over past knowledge
- `apps/backend/src/connectors/pdf_connector.py` — chunk PDFs/datasheets
- `apps/backend/src/simulator/mujoco_wrapper.py` — physics simulation
- `apps/backend/src/routes_agent.py` — your API routes

### Frontend
- `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx`

(Note: Teammate 1 builds the Agent tab chat UI. Your agent code just handles
the backend logic. Teammate 1's frontend POSTs to your route.)

---

## Backend: What to Build

### memory/memory_store.py — MemoryStore class

```python
class MemoryStore:
    def store(self, item: SemanticMemoryItem) -> SemanticMemoryItem
    def store_issue_fix(self, project_id, issue_title, issue_desc, fix_desc, fix_steps, entity_ids=None)
    def store_document_chunk(self, project_id, content, doc_name, chunk_index, doc_type="datasheet")
    def find_similar(self, query, project_id=None, content_type=None, limit=5) -> list[dict]
```

`find_similar` uses TF-IDF cosine similarity — standard library only (no numpy).
Tokenize, TF, IDF, cosine sim. Filter stop words. Good enough for demos.

### agent/solus_agent.py — SolusAgent class

```python
class SolusAgent:
    def __init__(self, context_engine=None, memory_store=None)
    async def query(self, agent_query: AgentQuery) -> AgentResponse
```

Routes by `query_type`:

- **"general"** — answer using project subgraph context
- **"debug"** (Demo B) — diagnose issues using graph + memory + recent changes. If similar past issue found, surface it.
- **"search_parts"** (Demo D) — recommend components with compatibility reasoning
- **"extract_values"** (Demo D) — extract params from papers/datasheets with confidence levels. NEVER hallucinate.
- **"impact_analysis"** (Demo A) — call context_engine.analyze_impact() + Gemini explanation
- **"plan"** — integration planning

Every handler calls `_build_context(query)` → assembles subgraph + memory hits + recent changes → feeds into Gemini prompt.

Use `google-generativeai` SDK. Model: `gemini-2.0-flash`. Env var: `GEMINI_API_KEY`.
If unavailable, return useful fallback text.

### connectors/pdf_connector.py

Read PDF, extract text, chunk into ~500 word segments, return for memory storage.
Hackathon: just basic text extraction. No OCR.

### simulator/mujoco_wrapper.py — MuJoCoSimulator class

If mujoco not installed, use a **physics stub** (differential drive kinematics):
- Given left/right wheel speeds + wheel_radius → compute x, y, theta over time
- `set_parameter(name, value)` — update sim params
- `run_steps(n_steps)` → return trajectory
- `compare_with_runtime(sim_data, runtime_data)` → discrepancies list

### routes_agent.py — Your API Routes

Use `APIRouter(prefix="/api")`:

```python
POST /api/projects/{id}/agent/query       ← the main one
POST /api/projects/{id}/memory            ← store a memory item
GET  /api/projects/{id}/memory/search     ← search memory (?query=&content_type=)
POST /api/projects/{id}/simulator/run     ← run simulation
GET  /api/projects/{id}/simulator/state   ← get sim state
POST /api/projects/{id}/simulator/compare ← compare sim vs runtime
```

---

## Frontend: What to Build

### SimulatorTab.tsx

- **Left panel: Parameters**
  - Editable fields: wheel_radius, motor_torque, friction
  - "Load from Context Model" button
  - "Run Simulation" button
- **Right panel: Results**
  - Line chart: sim trajectory vs runtime trajectory (Recharts)
  - Discrepancy table: signal | simulated | observed | delta
  - "Explain" button per discrepancy → sends to Agent tab as query

---

## Claude Code Prompt

```
Read PRODUCT_CONTEXT.md first, then packages/shared_types/src/models.py and
apps/backend/src/database.py.

I'm building Demo D (External Knowledge) + Demo E (Simulator). Read my full spec at
team-briefs/TEAMMATE_2_AI_SIMULATOR.md.

Build in this order:
1. apps/backend/src/memory/memory_store.py (no dependencies)
2. apps/backend/src/agent/solus_agent.py (imports context_engine — code against the interface, it'll resolve later)
3. apps/backend/src/simulator/mujoco_wrapper.py
4. apps/backend/src/connectors/pdf_connector.py
5. apps/backend/src/routes_agent.py (use FastAPI APIRouter(prefix="/api"))
6. apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx

For routes, use APIRouter so it can be included in main.py without conflicts.
```