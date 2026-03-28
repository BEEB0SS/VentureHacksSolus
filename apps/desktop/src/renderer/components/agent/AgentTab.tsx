// apps/desktop/src/renderer/components/agent/AgentTab.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { type ChatMessage, ResponseDocument } from "./MessageBubble";
import { MemoryPanel } from "./MemoryPanel";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

interface GraphEntity { id: string; entity_type: string; name: string; }

const MODE_CONFIG: Record<string, {
  label: string; color: string; desc: string; example: string; shortcut: string;
}> = {
  general:         { label: "General",         color: "#6366f1", shortcut: "G", desc: "Ask anything about the project graph",                    example: "What components are connected to the ESP32?" },
  debug:           { label: "Debug",           color: "#f59e0b", shortcut: "D", desc: "Diagnose a hardware or software issue",                   example: "My motor keeps stalling at low RPM" },
  search_parts:    { label: "Find Parts",      color: "#22d3ee", shortcut: "P", desc: "Recommend compatible components with your constraints",   example: "Motor driver for NEMA17, 12V, microstepping, Teensy 4.1" },
  extract_values:  { label: "Extract Values",  color: "#4ade80", shortcut: "E", desc: "Pull specs and values from datasheets or research papers", example: "Extract PID gains from the attached control paper" },
  impact_analysis: { label: "Impact Analysis", color: "#ef4444", shortcut: "I", desc: "Trace what breaks when a component changes",             example: "What breaks if I replace the DRV8825 with a TMC2209?" },
  plan:            { label: "Plan",            color: "#c084fc", shortcut: "L", desc: "Generate an integration or build work plan",              example: "Plan adding a second motor axis to the system" },
};

interface AgentTabProps { projectId: string; }

export default function AgentTab({ projectId }: AgentTabProps) {
  const [messages,         setMessages]         = useState<ChatMessage[]>([]);
  const [input,            setInput]            = useState("");
  const [queryType,        setQueryType]        = useState("general");
  const [sending,          setSending]          = useState(false);
  const [memoryOpen,       setMemoryOpen]       = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [entities,         setEntities]         = useState<GraphEntity[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [selectedIdx,      setSelectedIdx]      = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!projectId) return;
    fetch(`${API}/projects/${projectId}/entities`)
      .then((r) => r.ok ? r.json() : []).then(setEntities).catch(() => {});
  }, [projectId]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const pairs = (() => {
    const out: Array<{ user: ChatMessage; agent: ChatMessage | null; idx: number }> = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === "user") {
        const nxt = messages[i + 1];
        out.push({ user: messages[i], agent: nxt?.role === "agent" ? nxt : null, idx: out.length + 1 });
      }
    }
    return out;
  })();

  // null = empty state (cleared). Explicit idx required to show a pair.
  const activePair   = selectedIdx !== null ? (pairs[selectedIdx - 1] ?? null) : null;
  const mode         = MODE_CONFIG[queryType]  ?? MODE_CONFIG.general;
  const activeMode   = activePair ? (MODE_CONFIG[activePair.user.query_type ?? "general"] ?? MODE_CONFIG.general) : mode;

  const selectMode = (key: string) => {
    setQueryType(key);
    setSelectedIdx(null); // clear workspace on mode switch
    setInput("");
    inputRef.current?.focus();
  };

  const sendQuery = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || !projectId || sending) return;
    const contextEntityIds = queryType === "impact_analysis" && selectedEntityId ? [selectedEntityId] : [];

    const nextIdx = pairs.length + 1; // idx the new pair will get
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: "user", content: trimmed,
      query_type: queryType, timestamp: new Date().toISOString(),
    };
    setMessages((p) => [...p, userMsg]);
    setInput(""); setSending(true); setError(null); setSelectedIdx(nextIdx);

    try {
      const resp = await fetch(`${API}/projects/${projectId}/agent/query`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, query_type: queryType, context_entity_ids: contextEntityIds }),
      });
      if (!resp.ok) throw new Error(`Agent query failed: ${resp.status}`);
      const data = await resp.json();
      setMessages((p) => [...p, {
        id: crypto.randomUUID(), role: "agent", content: data.response_text,
        response: data, timestamp: new Date().toISOString(),
      }]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Query failed");
    } finally {
      setSending(false); inputRef.current?.focus();
    }
  }, [input, projectId, queryType, selectedEntityId, sending]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuery(); }
  };

  const fmt = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ display: "flex", height: "100%", background: "#07070f", color: "#c9cfd6", fontFamily: "JetBrains Mono, monospace", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes scanbar { 0%{transform:translateX(-100%)} 100%{transform:translateX(400%)} }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fadein  { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
        .mode-btn:hover { background: rgba(255,255,255,0.03) !important; }
        .history-btn:hover { background: rgba(255,255,255,0.03) !important; }
      `}</style>

      {/* ── Top bar ── */}
      <div style={{ display: "flex", alignItems: "center", height: 38, padding: "0 16px", borderBottom: "1px solid #111120", background: "#070710", flexShrink: 0, gap: 10 }}>
        <span style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.2em", fontWeight: 700 }}>SOLUS AGENT</span>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 6px #4ade8080", display: "inline-block", marginLeft: 4 }} />
        <div style={{ flex: 1 }} />
        {pairs.length > 0 && (
          <span style={{ fontSize: 9, color: "#374151", letterSpacing: "0.1em" }}>{pairs.length} queries</span>
        )}
        <button
          onClick={() => setMemoryOpen(!memoryOpen)}
          style={{
            fontSize: 9, letterSpacing: "0.12em", padding: "4px 10px",
            background: memoryOpen ? "rgba(99,102,241,0.15)" : "transparent",
            border: `1px solid ${memoryOpen ? "rgba(99,102,241,0.5)" : "#1e1e30"}`,
            borderRadius: 4, color: memoryOpen ? "#818cf8" : "#4b5563",
            cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
            transition: "all 0.12s",
          }}
        >
          MEMORY
        </button>
      </div>

      {/* ── Main body ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Left panel ── */}
        <div style={{ width: 200, borderRight: "1px solid #111120", display: "flex", flexDirection: "column", flexShrink: 0, background: "#060610" }}>

          {/* Mode selector */}
          <div style={{ borderBottom: "1px solid #111120", paddingBottom: 4 }}>
            <div style={{ padding: "10px 14px 6px", fontSize: 8, color: "#2e2e48", letterSpacing: "0.18em", fontWeight: 700 }}>MODE</div>
            {Object.entries(MODE_CONFIG).map(([key, cfg]) => {
              const active = queryType === key;
              return (
                <button
                  key={key}
                  className="mode-btn"
                  onClick={() => selectMode(key)}
                  style={{
                    display: "flex", alignItems: "center", width: "100%", textAlign: "left",
                    padding: "8px 14px 8px 10px", cursor: "pointer", border: "none",
                    borderLeft: `2px solid ${active ? cfg.color : "transparent"}`,
                    background: active ? `${cfg.color}12` : "transparent",
                    transition: "background 0.1s",
                  }}
                >
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: active ? cfg.color : "#1e1e30", flexShrink: 0, marginRight: 10, transition: "background 0.1s" }} />
                  <div>
                    <div style={{ fontSize: 11, color: active ? cfg.color : "#6b7280", fontWeight: active ? 700 : 400, lineHeight: 1.2 }}>
                      {cfg.label}
                    </div>
                    {active && (
                      <div style={{ fontSize: 9, color: `${cfg.color}90`, marginTop: 2, lineHeight: 1.4, animation: "fadein 0.15s ease" }}>
                        {cfg.desc}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Query history */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {pairs.length > 0 && (
              <div style={{ padding: "10px 14px 4px", fontSize: 8, color: "#2e2e48", letterSpacing: "0.18em", fontWeight: 700 }}>HISTORY</div>
            )}
            {pairs.map((p) => {
              const m   = MODE_CONFIG[p.user.query_type ?? "general"] ?? MODE_CONFIG.general;
              const sel = activePair?.idx === p.idx;
              const conf = p.agent?.response?.confidence;
              return (
                <button
                  key={p.user.id}
                  className="history-btn"
                  onClick={() => setSelectedIdx(p.idx)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "8px 14px 8px 10px", cursor: "pointer", border: "none",
                    borderLeft: `2px solid ${sel ? m.color : "transparent"}`,
                    background: sel ? `${m.color}0e` : "transparent",
                    borderBottom: "1px solid #0d0d1a",
                    transition: "background 0.1s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: m.color, opacity: sel ? 1 : 0.4, flexShrink: 0 }} />
                    <span style={{ fontSize: 8, color: "#374151" }}>{m.label}</span>
                    {conf !== undefined && (
                      <span style={{ fontSize: 8, color: conf >= 0.7 ? "#4ade80" : conf >= 0.4 ? "#f59e0b" : "#ef4444", marginLeft: "auto" }}>
                        {Math.round(conf * 100)}%
                      </span>
                    )}
                    {!p.agent && sending && sel && (
                      <span style={{ fontSize: 8, color: "#4ade80", animation: "pulse 1.2s infinite", marginLeft: "auto" }}>●</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: sel ? "#9ca3af" : "#4b5563", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.user.content}
                  </div>
                  <div style={{ fontSize: 8, color: "#2a2a40", marginTop: 2 }}>{fmt(p.user.timestamp)}</div>
                </button>
              );
            })}

            {/* Empty history state */}
            {pairs.length === 0 && (
              <div style={{ padding: "16px 14px", flex: 1 }}>
                <div style={{ fontSize: 9, color: "#2a2a40", lineHeight: 1.8 }}>
                  No queries yet.<br />Select a mode and<br />submit a query below.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Workspace ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {activePair ? (
            <>
              {/* Query header */}
              <div style={{ padding: "14px 24px 12px", borderBottom: "1px solid #111120", flexShrink: 0, position: "relative", overflow: "hidden" }}>
                {/* Ghost watermark */}
                <div style={{ position: "absolute", right: 16, top: -2, fontSize: 48, fontWeight: 900, color: activeMode.color, opacity: 0.04, letterSpacing: "-0.03em", userSelect: "none", pointerEvents: "none", lineHeight: 1 }}>
                  {activeMode.label.toUpperCase()}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, position: "relative" }}>
                  <span style={{ fontSize: 8, padding: "2px 7px", borderRadius: 3, background: `${activeMode.color}18`, border: `1px solid ${activeMode.color}35`, color: activeMode.color, letterSpacing: "0.1em", fontWeight: 700 }}>
                    {activeMode.label.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 9, color: "#374151" }}>{fmt(activePair.user.timestamp)}</span>
                  {activePair.agent?.response?.confidence !== undefined && (
                    <>
                      <span style={{ color: "#1e1e30", fontSize: 10 }}>·</span>
                      <span style={{
                        fontSize: 9,
                        color: activePair.agent.response.confidence >= 0.7 ? "#4ade80"
                             : activePair.agent.response.confidence >= 0.4 ? "#f59e0b" : "#ef4444",
                      }}>
                        {Math.round(activePair.agent.response.confidence * 100)}% confidence
                      </span>
                    </>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, position: "relative" }}>
                  <span style={{ color: activeMode.color, opacity: 0.7, flexShrink: 0, marginTop: 2, fontSize: 12 }}>▸</span>
                  <span style={{ fontSize: 14, color: "#dde2ea", lineHeight: 1.55, fontWeight: 500 }}>{activePair.user.content}</span>
                </div>
              </div>

              {/* Response */}
              <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
                {activePair.agent ? (
                  <div style={{ animation: "fadein 0.2s ease" }}>
                    <ResponseDocument message={activePair.agent} />
                  </div>
                ) : sending ? (
                  <div style={{ paddingTop: 6 }}>
                    <div style={{ fontSize: 9, color: "#4ade80", letterSpacing: "0.16em", animation: "pulse 1.4s ease-in-out infinite", marginBottom: 12 }}>
                      QUERYING CONTEXT MODEL…
                    </div>
                    <div style={{ height: 2, background: "#0e0e1c", overflow: "hidden", width: 240, borderRadius: 2 }}>
                      <div style={{ height: "100%", width: "30%", background: "#4ade80", borderRadius: 2, animation: "scanbar 1.4s ease-in-out infinite" }} />
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            /* Empty state */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", padding: "0 40px 80px" }}>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, color: "#4b5563", letterSpacing: "0.06em", marginBottom: 6 }}>
                  <span style={{ color: mode.color, fontWeight: 700 }}>{mode.label}</span> mode active
                </div>
                <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.6, maxWidth: 360 }}>{mode.desc}</div>
              </div>
              <button
                onClick={() => { setInput(mode.example); inputRef.current?.focus(); }}
                style={{
                  textAlign: "left", padding: "12px 16px",
                  background: `${mode.color}0a`,
                  border: `1px solid ${mode.color}25`,
                  borderRadius: 6, cursor: "pointer", maxWidth: 400,
                  transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = `${mode.color}15`;
                  (e.currentTarget as HTMLButtonElement).style.borderColor = `${mode.color}50`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = `${mode.color}0a`;
                  (e.currentTarget as HTMLButtonElement).style.borderColor = `${mode.color}25`;
                }}
              >
                <div style={{ fontSize: 8, color: "#374151", letterSpacing: "0.14em", marginBottom: 6 }}>TRY THIS EXAMPLE</div>
                <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.5 }}>"{mode.example}"</div>
              </button>
            </div>
          )}

          {error && (
            <div style={{ margin: "0 24px 12px", padding: "8px 12px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: "#f87171" }}>{error}</span>
              <button onClick={() => setError(null)} style={{ fontSize: 9, color: "#7f1d1d", background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace" }}>✕</button>
            </div>
          )}
        </div>

        <MemoryPanel projectId={projectId} open={memoryOpen} onClose={() => setMemoryOpen(false)} />
      </div>

      {/* ── Input bar ── */}
      <div style={{ borderTop: "1px solid #111120", background: "#060610", flexShrink: 0, padding: "10px 20px 14px" }}>

        {/* Impact entity picker */}
        {queryType === "impact_analysis" && entities.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 8, color: "#374151", letterSpacing: "0.14em", marginBottom: 5 }}>SELECT ENTITY FOR IMPACT ANALYSIS</div>
            <select
              value={selectedEntityId}
              onChange={(e) => setSelectedEntityId(e.target.value)}
              style={{ width: "100%", background: "#0d0d1c", border: `1px solid ${selectedEntityId ? "#ef444450" : "#1e1e30"}`, borderRadius: 4, padding: "7px 10px", fontSize: 10, color: selectedEntityId ? "#fca5a5" : "#6b7280", fontFamily: "JetBrains Mono, monospace", outline: "none" }}
            >
              <option value="">Choose a component…</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.name} — {e.entity_type.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
          {/* Mode pill */}
          <div
            style={{ flexShrink: 0, paddingBottom: 8, cursor: "pointer" }}
            title="Click to cycle mode"
          >
            <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 3, background: `${mode.color}15`, border: `1px solid ${mode.color}30`, color: mode.color, letterSpacing: "0.08em", fontWeight: 700 }}>
              {mode.label.toUpperCase()}
            </span>
          </div>

          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode.example}
            rows={1}
            style={{
              flex: 1, background: "transparent", padding: "6px 0 10px",
              border: "none", borderBottom: `1px solid ${input.trim() ? mode.color + "60" : "#1e1e30"}`,
              fontSize: 12, color: "#e2e8f0", fontFamily: "JetBrains Mono, monospace",
              outline: "none", resize: "none", lineHeight: 1.5,
              transition: "border-color 0.15s",
            }}
          />

          {/* Hint + Execute */}
          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, paddingBottom: 2 }}>
            <span style={{ fontSize: 8, color: "#2a2a40" }}>↵ to run</span>
            <button
              onClick={sendQuery}
              disabled={sending || !input.trim()}
              style={{
                padding: "7px 18px", fontSize: 9, letterSpacing: "0.14em",
                fontFamily: "JetBrains Mono, monospace", fontWeight: 700,
                background: !sending && input.trim() ? `${mode.color}18` : "transparent",
                border: `1px solid ${!sending && input.trim() ? mode.color + "60" : "#1e1e30"}`,
                color: !sending && input.trim() ? mode.color : "#2a2a40",
                borderRadius: 4, cursor: sending || !input.trim() ? "not-allowed" : "pointer",
                transition: "all 0.12s",
              }}
            >
              {sending ? "···" : "RUN"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
