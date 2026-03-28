import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

interface Project     { id: string; name: string; description: string; created_at: string; }
interface Source      { id: string; source_type: string; name: string; config: Record<string, string>; last_synced_at: string | null; status: string; }
interface ChangeEvent { id: string; change_type: "added" | "modified" | "removed"; entity_name: string; description: string; diff_data: Record<string, unknown>; created_at: string; acknowledged: boolean; }

const SOURCE_COLOR: Record<string, string> = {
  github:  "#6366f1",
  kicad:   "#4ade80",
  onshape: "#22d3ee",
  pdf:     "#c084fc",
  manual:  "#f59e0b",
  runtime: "#ef4444",
};

const CHANGE: Record<string, { sym: string; color: string; bg: string; border: string }> = {
  added:    { sym: "+", color: "#4ade80", bg: "rgba(74,222,128,0.07)",  border: "rgba(74,222,128,0.22)"  },
  modified: { sym: "~", color: "#f59e0b", bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.22)"  },
  removed:  { sym: "−", color: "#ef4444", bg: "rgba(239,68,68,0.07)",  border: "rgba(239,68,68,0.22)"   },
};

const fmtTime = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (ts: string) => {
  const d = new Date(ts), t = new Date();
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return "TODAY";
  if (d.toDateString() === y.toDateString()) return "YESTERDAY";
  return d.toLocaleDateString([], { month: "short", day: "numeric" }).toUpperCase();
};

export default function WorkspaceTab() {
  const [projects,          setProjects]          = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [sources,           setSources]           = useState<Source[]>([]);
  const [changes,           setChanges]           = useState<ChangeEvent[]>([]);
  const [syncing,           setSyncing]           = useState<string | null>(null);
  const [error,             setError]             = useState<string | null>(null);

  const safeFetch = async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    return r.json();
  };

  useEffect(() => {
    safeFetch(`${API}/projects`)
      .then((data) => { setProjects(data); if (data.length > 0) setSelectedProjectId(data[0].id); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    safeFetch(`${API}/projects/${selectedProjectId}/sources`).then(setSources).catch((e) => setError(e.message));
    safeFetch(`${API}/projects/${selectedProjectId}/changes`).then(setChanges).catch((e) => setError(e.message));
  }, [selectedProjectId]);

  const handleSync = useCallback(async (sourceId: string) => {
    setSyncing(sourceId); setError(null);
    try {
      const r = await fetch(`${API}/projects/${selectedProjectId}/sources/${sourceId}/sync`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      const [srcs, chgs] = await Promise.all([
        fetch(`${API}/projects/${selectedProjectId}/sources`).then(r => r.json()),
        fetch(`${API}/projects/${selectedProjectId}/changes`).then(r => r.json()),
      ]);
      setSources(srcs); setChanges(chgs);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Sync failed"); }
    finally { setSyncing(null); }
  }, [selectedProjectId]);

  const currentProject = projects.find(p => p.id === selectedProjectId);

  // Group changes by date label
  const grouped: { date: string; items: ChangeEvent[] }[] = [];
  for (const c of changes) {
    const d = fmtDate(c.created_at);
    const last = grouped[grouped.length - 1];
    if (last?.date === d) last.items.push(c);
    else grouped.push({ date: d, items: [c] });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#07070f", color: "#c9cfd6", fontFamily: "JetBrains Mono, monospace", overflow: "hidden" }}>
      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes glow-pulse { 0%,100%{box-shadow:0 0 5px currentColor,0 0 10px currentColor} 50%{box-shadow:0 0 2px currentColor} }
        .src-row:hover { background: rgba(255,255,255,0.02) !important; }
        .chg-row:hover { background: rgba(255,255,255,0.025) !important; }
        .sync-btn:not(:disabled):hover { filter: brightness(1.25); }
      `}</style>

      {/* ── Topbar ── */}
      <div style={{ height: 40, display: "flex", alignItems: "center", padding: "0 20px", borderBottom: "1px solid #111120", background: "#060610", flexShrink: 0, gap: 10 }}>
        <span style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.22em", fontWeight: 700 }}>WORKSPACE</span>
        <span style={{ width: 1, height: 14, background: "#1a1a2e" }} />
        {currentProject && (
          <span style={{ fontSize: 10, color: "#6b7280" }}>{currentProject.name}</span>
        )}
        <div style={{ flex: 1 }} />
        {changes.length > 0 && (
          <div style={{ display: "flex", gap: 10 }}>
            {(["added","modified","removed"] as const).map(t => {
              const n = changes.filter(c => c.change_type === t).length;
              if (!n) return null;
              return <span key={t} style={{ fontSize: 8, color: CHANGE[t].color, letterSpacing: "0.1em" }}>{CHANGE[t].sym}{n}</span>;
            })}
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ padding: "6px 20px", background: "rgba(239,68,68,0.06)", borderBottom: "1px solid rgba(239,68,68,0.18)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: "#f87171" }}>{error}</span>
          <button onClick={() => setError(null)} style={{ fontSize: 9, color: "#7f1d1d", background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace" }}>✕</button>
        </div>
      )}

      {/* ── Body ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Sources ── */}
        <div style={{ width: 280, borderRight: "1px solid #111120", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "10px 16px 8px", borderBottom: "1px solid #0e0e1c", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 8, color: "#2e2e48", letterSpacing: "0.2em", fontWeight: 700 }}>SOURCES</span>
            <span style={{ fontSize: 8, color: "#374151" }}>{sources.length}</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
            {sources.length === 0 ? (
              <div style={{ padding: "18px 6px", fontSize: 9, color: "#2a2a40", lineHeight: 1.9 }}>
                No sources connected.<br />Add GitHub, KiCad, or a PDF.
              </div>
            ) : sources.map((src) => {
              const col      = SOURCE_COLOR[src.source_type] ?? "#6b7280";
              const isSyncing = syncing === src.id;
              const connected = src.status === "connected";
              return (
                <div
                  key={src.id}
                  className="src-row"
                  style={{ padding: "11px 12px", borderRadius: 6, background: "#0a0a16", border: `1px solid ${isSyncing ? col + "45" : "#141428"}`, transition: "border-color 0.2s, background 0.15s" }}
                >
                  {/* Row 1: LED + type badge + sync btn */}
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                      background: connected ? col : "#252535",
                      boxShadow: connected && !isSyncing ? `0 0 6px ${col}90` : undefined,
                      animation: isSyncing ? "glow-pulse 0.9s ease-in-out infinite" : undefined,
                      color: col,
                    }} />
                    <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 2, background: `${col}15`, border: `1px solid ${col}30`, color: col, letterSpacing: "0.12em", fontWeight: 700 }}>
                      {src.source_type.toUpperCase()}
                    </span>
                    <div style={{ flex: 1 }} />
                    <button
                      className="sync-btn"
                      onClick={() => handleSync(src.id)}
                      disabled={isSyncing}
                      style={{
                        fontSize: 8, letterSpacing: "0.14em", padding: "3px 10px",
                        background: isSyncing ? "transparent" : `${col}12`,
                        border: `1px solid ${isSyncing ? "#252535" : col + "35"}`,
                        borderRadius: 3, color: isSyncing ? "#374151" : col,
                        cursor: isSyncing ? "not-allowed" : "pointer",
                        fontFamily: "JetBrains Mono, monospace", transition: "filter 0.1s",
                      }}
                    >
                      {isSyncing
                        ? <span style={{ display: "inline-block", animation: "spin 0.9s linear infinite" }}>↻</span>
                        : "SYNC"}
                    </button>
                  </div>

                  {/* Row 2: Name */}
                  <div style={{ fontSize: 11, color: "#c9cfd6", lineHeight: 1.3, marginBottom: 5 }}>{src.name}</div>

                  {/* Row 3: Last sync */}
                  <div style={{ fontSize: 9, color: "#2e2e48" }}>
                    {src.last_synced_at
                      ? <span>synced <span style={{ color: "#4b5563" }}>{fmtTime(src.last_synced_at)}</span></span>
                      : <span style={{ color: "#252535" }}>never synced</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Change log ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 18px 8px", borderBottom: "1px solid #0e0e1c", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <span style={{ fontSize: 8, color: "#2e2e48", letterSpacing: "0.2em", fontWeight: 700 }}>CHANGE LOG</span>
            {changes.length > 0 && <span style={{ fontSize: 8, color: "#374151" }}>{changes.length} events</span>}
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {changes.length === 0 ? (
              <div style={{ padding: "24px 18px", fontSize: 9, color: "#2a2a40", lineHeight: 2 }}>
                No changes yet.<br />Sync a source to populate the log.
              </div>
            ) : grouped.map(({ date, items }) => (
              <div key={date}>
                {/* Date header */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 18px", position: "sticky", top: 0, background: "#07070f", zIndex: 1 }}>
                  <span style={{ fontSize: 7, color: "#252535", letterSpacing: "0.22em", fontWeight: 700 }}>{date}</span>
                  <div style={{ flex: 1, height: 1, background: "#0e0e1c" }} />
                </div>

                {/* Rows */}
                {items.map((c, i) => {
                  const cfg = CHANGE[c.change_type];
                  return (
                    <div
                      key={c.id}
                      className="chg-row"
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 18px", borderBottom: i < items.length - 1 ? "1px solid #0a0a12" : undefined, transition: "background 0.1s" }}
                    >
                      {/* Symbol chip */}
                      <span style={{ width: 18, height: 18, borderRadius: 3, background: cfg.bg, border: `1px solid ${cfg.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: cfg.color, fontWeight: 700, flexShrink: 0, lineHeight: 1 }}>
                        {cfg.sym}
                      </span>

                      {/* Entity name */}
                      <span style={{ fontSize: 11, color: "#c9cfd6", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.entity_name}
                      </span>

                      {/* Description */}
                      {c.description && (
                        <span style={{ fontSize: 9, color: "#374151", flex: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.description}
                        </span>
                      )}

                      {/* Type badge */}
                      <span style={{ fontSize: 7, padding: "1px 5px", background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 2, color: cfg.color, letterSpacing: "0.1em", flexShrink: 0 }}>
                        {c.change_type.toUpperCase()}
                      </span>

                      {/* Time */}
                      <span style={{ fontSize: 8, color: "#252535", flexShrink: 0 }}>
                        {fmtTime(c.created_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
