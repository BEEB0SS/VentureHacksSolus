# Integration Checklist

> Part of [[Operations]]

Verify these at each merge point.

## After Pratham Merges
- [ ] Backend starts without errors: `uvicorn src.main:app --reload --port 8000`
- [ ] `GET /api/health` returns `{"status": "ok"}`
- [ ] `POST /api/projects` creates a project
- [ ] `GET /api/projects/{id}/graph` returns entities after sync
- [ ] Context Model tab shows D3 graph with nodes

## After Teammate 3 Merges
- [ ] Frontend starts: `pnpm run dev:web`
- [ ] All 5 sidebar tabs render without errors
- [ ] Zustand store connects to API correctly
- [ ] Shared components (Card, Modal, LoadingSpinner) render

## After Teammate 1 Merges
- [ ] "Start Simulated" generates live telemetry
- [ ] WebSocket streams data to LiveBenchTab
- [ ] Anomaly detection triggers on spikes
- [ ] Issues can be created and retrieved
- [ ] Similar issue search returns results

## After Teammate 2 Merges
- [ ] Agent query endpoint responds
- [ ] Memory store finds similar items
- [ ] Simulator runs and returns trajectory
- [ ] Sim vs runtime comparison works

## Final Integration (Teammate 3 Pass)
- [ ] All 5 demo flows work end-to-end
- [ ] No console errors in browser
- [ ] Seed data loads and looks good
- [ ] Transitions between tabs are smooth

#checklist #integration #qa
