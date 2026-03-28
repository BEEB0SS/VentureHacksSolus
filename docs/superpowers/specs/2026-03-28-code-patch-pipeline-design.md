# Code Patch Pipeline — Design Spec

**Goal:** Enable Solus to apply AI-suggested code changes directly to project files. Any agent response that includes a code suggestion gets an "Apply" button that validates the patch, writes it to the filesystem, and re-syncs the context model.

**Timeline:** Phase 3.5 — after all teammate merges (step 3.3), before integration polish (Phase 4). ~1-1.5 hours of implementation.

**Dependencies:** Context Engine (Pratham), Solus Agent (Teammate 2), Source Connections with `repo_path` in their `config` dict.

---

## Architecture

Three new components form a pipeline between the Solus Agent and the filesystem:

```
Agent Response (any query type)
  → PatchExtractor (frontend) parses solus-patch blocks
  → CodePatchPreview (frontend) renders diff + calls validate
  → User clicks Apply
  → PatchApplier (backend) writes to temp → validates → writes to file
  → Auto re-sync of affected source → graph updates
```

The agent itself requires no Python code changes — only a system prompt addition.

---

## Component 1: PatchExtractor (Frontend)

New file: `apps/desktop/src/renderer/utils/patchExtractor.ts` (create the `utils/` directory — it does not exist yet).

Runs client-side inside `MessageBubble.tsx`. Currently, `MessageBubble` renders `message.content` as plain text (line 50: `<div className="text-sm ...">{message.content}</div>`). The integration point is this line — replace the raw text render with a call to `extractPatches(message.content)` that returns an array of `{ type: "text", content: string } | { type: "patch", patch: CodePatch }` segments. `MessageBubble` maps over these segments: text segments render as before, patch segments render as `<CodePatchPreview />` components inline.

### Patch Format

The agent outputs code suggestions in this tagged format:

````
```solus-patch
file: src/motor_control/scripts/motor_controller.py
description: Update microstepping protocol for TMC2209
---
  MOTOR_TYPE = "stepper"
- MICROSTEPPING = 16  # DRV8825
+ MICROSTEPPING = 256  # TMC2209 interpolation
- DRIVER_PROTOCOL = "step_dir"
+ DRIVER_PROTOCOL = "uart"
  MAX_SPEED = 1000
```
````

### Parsed Structure

```typescript
interface CodePatch {
  filePath: string;       // relative to repo root
  description: string;    // human-readable summary
  diffLines: string[];    // unified diff format lines
  language: string;       // detected from file extension
}
```

### Behavior

- Scans response text using regex for `` ```solus-patch `` fenced blocks
- Parses `file:` and `description:` headers, everything after `---` is diff content
- Replaces the raw code block in the rendered response with a CodePatchPreview component
- If a code block is malformed (missing headers, no diff lines), silently skip — render as a normal code block with no Apply button. No error shown, graceful degradation.

---

## Component 2: PatchApplier (Backend)

New file: `apps/backend/src/patch_applier.py`

### Data Model

```python
@dataclass
class CodePatch:
    file_path: str          # relative to repo root
    description: str
    diff_lines: list[str]   # unified diff format
    language: str            # detected from extension
    status: str = "pending" # pending | valid | invalid | unchecked | applied | rolled_back

@dataclass
class PatchResult:
    status: str             # valid | invalid | unchecked | conflict | applied | rolled_back
    errors: list[str]       # empty if valid
    backup_path: str = ""   # populated after apply
    sync_result: dict = field(default_factory=dict)  # populated after apply
```

### Core Logic

**`validate(project_id, patch)`**
1. Resolve absolute path: find the source connection whose `config.get("repo_path")` contains the file. (`SourceConnection` stores `repo_path` inside its `config: dict`, not as a top-level field — access via `source.config.get("repo_path")`.) Reject if file is outside all registered source connections (security boundary).
2. Check file exists. If not → `{status: "invalid", errors: ["File not found"]}`.
3. Check context lines in the diff match the current file content. If not → `{status: "conflict", errors: ["File has been modified since this patch was generated"]}`.
4. Apply the diff to a temp copy of the file.
5. Run language-appropriate syntax validation on the temp copy:
   - `.py` → `ast.parse()`
   - `.cpp/.c/.h` → `g++ -fsyntax-only` (if compiler available, else skip)
   - `.yaml/.yml` → `yaml.safe_load()` (stdlib)
   - `.json` → `json.loads()` (stdlib)
   - Everything else → skip, return `"unchecked"`
6. Return `{status: "valid" | "invalid" | "unchecked", errors: [...]}`.
7. Never touches the real file.

**`apply(project_id, patch)`**
1. Run validate first. If not valid, reject.
2. Write backup to `.solus/backups/{timestamp}_{filename}` inside the project directory.
3. Write the patched content to the real file.
4. Trigger a re-sync of the affected source connection (reuse existing sync logic from `ContextEngine`).
5. Return `{status: "applied", backup_path: "...", sync_result: {...}}`.

**`rollback(project_id, patch_id)`**
1. Look up the backup file for this patch using the in-memory `_applied_patches` dict (see Patch History below).
2. Restore the original file content from backup.
3. Re-sync the affected source connection.
4. Return `{status: "rolled_back"}`.

### Patch History

Patch history is tracked in-memory within `PatchApplier` using a dict keyed by `patch_id` (a UUID generated at apply time). Each entry stores the `backup_path`, `file_path`, and `source_connection_id`. No database table is needed — patches are transient within a session. The backup files on disk (`.solus/backups/{timestamp}_{filename}`) provide a filesystem safety net if the server restarts, but rollback after restart is not a supported flow for the hackathon demo.

### Diff Application Logic

The diff applicator reads the current file, matches context lines (unprefixed lines in the diff) to find the exact location, removes `-` lines, inserts `+` lines. If context lines don't match, returns a conflict error instead of guessing.

---

## Component 3: API Routes

New file: `apps/backend/src/routes_patches.py`

Three endpoints on an APIRouter with prefix `/api`:

### `POST /api/projects/{project_id}/patches/validate`

Request:
```json
{
  "file_path": "src/motor_control/scripts/motor_controller.py",
  "diff_lines": ["  MOTOR_TYPE = \"stepper\"", "- MICROSTEPPING = 16", "+ MICROSTEPPING = 256"],
  "description": "Update microstepping protocol"
}
```

Response:
```json
{
  "status": "valid",
  "errors": []
}
```

### `POST /api/projects/{project_id}/patches/apply`

Same request body as validate.

Response:
```json
{
  "status": "applied",
  "patch_id": "abc123",
  "backup_path": ".solus/backups/1711612800_motor_controller.py",
  "sync_result": {
    "snapshot_id": "def456",
    "entity_count": 12,
    "changes": []
  }
}
```

### `POST /api/projects/{project_id}/patches/rollback`

Request:
```json
{
  "patch_id": "abc123"
}
```

Response:
```json
{
  "status": "rolled_back"
}
```

---

## Component 4: CodePatchPreview (Frontend)

New file: `apps/desktop/src/renderer/components/shared/CodePatchPreview.tsx`

Reusable component that renders wherever agent responses appear.

### Visual Layout

```
┌─────────────────────────────────────────────────┐
│  motor_controller.py                            │
│  Update microstepping protocol for TMC2209      │
├─────────────────────────────────────────────────┤
│  7 │   MOTOR_TYPE = "stepper"                   │
│  8 │ - MICROSTEPPING = 16  # DRV8825            │
│  8 │ + MICROSTEPPING = 256  # TMC2209           │
│  9 │ - DRIVER_PROTOCOL = "step_dir"             │
│  9 │ + DRIVER_PROTOCOL = "uart"                 │
│ 10 │   MAX_SPEED = 1000                         │
├─────────────────────────────────────────────────┤
│  ✓ Syntax valid               [ Apply ] [ Skip ]│
└─────────────────────────────────────────────────┘
```

### States

| State | Status Area | Buttons |
|-------|-------------|---------|
| Pending | Spinner + "Validating..." | Both disabled |
| Valid | Green ✓ "Syntax valid" | Apply (blue) + Skip (gray) |
| Invalid | Red ✗ + error message | Apply disabled, Skip enabled |
| Unchecked | Yellow — "Unverified (no validator for .launch.py)" | Apply (yellow) + Skip |
| Applied | Green "Applied ✓" | Undo (gray) |
| Rolled back | Gray "Rolled back" | Re-apply + Skip |

### Behavior

- Calls `POST /patches/validate` on mount (auto-validation, no user action needed)
- Apply calls `POST /patches/apply`, flips to Applied state on success
- Undo calls `POST /patches/rollback`
- Diff rendering: `-` lines red background, `+` lines green background, context lines neutral. JetBrains Mono font.

### Multiple Patches

When an agent response contains multiple `solus-patch` blocks, each gets its own CodePatchPreview card. An "Apply All (N)" button appears above the group when all patches are valid. Applies them sequentially, re-syncs once at the end.

---

## Component 5: Agent Prompt Update

No Python code changes. Add this to the Solus Agent's system prompt (in `solus_agent.py`'s `_build_context` or system message):

```
When you recommend a code change, output it as a solus-patch block so the user
can apply it directly. Format:

```solus-patch
file: <path relative to repo root>
description: <one-line summary of the change>
---
<context lines (unprefixed) for location matching>
<- lines to remove>
<+ lines to add>
<context lines (unprefixed)>
```

Rules:
- Only suggest patches for files that exist in the project's context model.
- Use the file paths from the entity graph (source_ref or path field).
- Include 1-2 unchanged context lines before and after the change for unambiguous placement.
- If you are unsure about the exact current file content, describe the change in plain text instead. Do not guess file contents.
- One solus-patch block per file. If multiple files need changes, use multiple blocks.
```

### Which Query Types Produce Patches

| Query Type | Produces Patches? | Example |
|-----------|-------------------|---------|
| `impact_analysis` | Yes | "Motor driver changed, update the config" → patch |
| `debug` | Yes | "Bug is on line 14, here's the fix" → patch |
| `general` | Only if user asks | "Change the max speed to 2000" → patch |
| `search_parts` | No | Informational — component recommendations |
| `extract_values` | No | Informational — parameter extraction |
| `plan` | No | Informational — planning assistance |

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| File doesn't exist | Validate returns `invalid` with "File not found" |
| File changed since agent read it | Context lines don't match → `conflict` error, user told to re-sync and ask again |
| Agent hallucinates a file path | Path outside all registered source connections → rejected |
| Malformed solus-patch block | PatchExtractor skips it, renders as normal code block, no Apply button |
| Multiple patches, mixed validity | Each card independent. "Apply All" only when all valid. |
| Write permission denied | Apply catches `PermissionError`, returns clear message |
| Syntax validation fails | Shows error details in red, Apply disabled, user can still read the suggestion |

---

## Security Boundary

The PatchApplier **only writes to files inside a registered source connection's `config["repo_path"]`**. The validate endpoint resolves the absolute path by iterating all source connections for the project, reading `source.config.get("repo_path")`, and checking the patch's `file_path` falls within one of them. This prevents the agent from writing to arbitrary filesystem locations.

---

## Files to Create

| File | Responsibility |
|------|---------------|
| `apps/backend/src/patch_applier.py` | Validate, apply, rollback logic + diff application |
| `apps/backend/src/routes_patches.py` | FastAPI APIRouter — 3 endpoints |
| `apps/backend/tests/test_patch_applier.py` | Unit tests for validation, apply, rollback, edge cases |
| `apps/backend/tests/test_routes_patches.py` | Integration tests for API endpoints |
| `apps/desktop/src/renderer/components/shared/CodePatchPreview.tsx` | Diff preview card component |
| `apps/desktop/src/renderer/utils/patchExtractor.ts` | Parse solus-patch blocks from agent response text (create `utils/` directory) |

## Files to Modify

| File | Change |
|------|--------|
| `apps/backend/src/main.py` | Add `include_router(patches_router)` via try/except block (follows existing pattern for `routes_core`, `routes_livebench`, `routes_agent`) |
| `apps/backend/src/agent/solus_agent.py` | Add solus-patch format instructions to `_handle_general`, `_handle_debug`, and `_handle_impact_analysis` system prompts |
| `apps/desktop/src/renderer/components/agent/MessageBubble.tsx` | Replace plain-text content render (line 50) with segment-based render that interleaves text and `CodePatchPreview` components |

---

## End-to-End Flow (Demo A Example)

1. User syncs KiCad source → snapshot diff detects DRV8825 → TMC2209
2. Impact analysis highlights `motor_controller.py` on the graph
3. User asks agent: "What do I need to change?"
4. Agent responds with explanation + `solus-patch` block for `motor_controller.py`
5. PatchExtractor parses the block, CodePatchPreview renders inline
6. Auto-validation fires → green check → Apply button enabled
7. User clicks Apply
8. Backend: backup → write file → re-sync source
9. Graph updates — impacted entity no longer flagged
10. Card shows "Applied ✓" with Undo option
