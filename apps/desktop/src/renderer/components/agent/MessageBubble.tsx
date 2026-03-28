// apps/desktop/src/renderer/components/agent/MessageBubble.tsx
import { useState } from "react";

interface MemoryHit {
  id: string;
  content: string;
  content_type: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

interface ImpactExplanation {
  name: string;
  entity_type?: string;
  how_affected: string;
  action: string;
}

interface AgentResponseData {
  query_id: string;
  response_text: string;
  structured_data: {
    memory_hits?: MemoryHit[];
    impacted_entities?: Array<{ id: string; name: string; entity_type: string }>;
    impact_explanations?: ImpactExplanation[];
  };
  sources: string[];
  confidence: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  query_type?: string;
  response?: AgentResponseData;
  timestamp: string;
}

const CONTENT_TYPE_COLOR: Record<string, string> = {
  issue:     "#ef4444",
  fix:       "#4ade80",
  note:      "#6366f1",
  datasheet: "#22d3ee",
  paper:     "#c084fc",
};

export function ResponseDocument({ message }: { message: ChatMessage }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const r = message.response;
  if (!r) return null;

  const confidence = r.confidence ?? 0;
  const confColor = confidence >= 0.7 ? "#4ade80" : confidence >= 0.4 ? "#f59e0b" : "#ef4444";
  const memHits            = r.structured_data?.memory_hits ?? [];
  const impacted           = r.structured_data?.impacted_entities ?? [];
  const impactExplanations = r.structured_data?.impact_explanations ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Response body */}
      <div style={{ padding: "16px 20px", background: "#0d0d18", border: "1px solid #1e1e2e", borderRadius: 8 }}>
        <div style={{ fontSize: 8, color: "#374151", letterSpacing: "0.16em", marginBottom: 12 }}>RESPONSE</div>
        <div style={{ fontSize: 13, color: "#c9cfd6", lineHeight: 1.75, whiteSpace: "pre-wrap", fontFamily: "JetBrains Mono, monospace" }}>
          {r.response_text}
        </div>
      </div>

      {/* Confidence + Sources row */}
      <div style={{ display: "flex", gap: 12 }}>

        {/* Confidence */}
        <div style={{ flex: "0 0 160px", padding: "12px 14px", background: "#0d0d18", border: "1px solid #1e1e2e", borderRadius: 8 }}>
          <div style={{ fontSize: 8, color: "#374151", letterSpacing: "0.16em", marginBottom: 10 }}>CONFIDENCE</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 3, background: "#1a1a28", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${confidence * 100}%`, background: confColor, borderRadius: 2, transition: "width 0.4s ease" }} />
            </div>
            <span style={{ fontSize: 11, color: confColor, fontWeight: 700, flexShrink: 0 }}>
              {Math.round(confidence * 100)}%
            </span>
          </div>
        </div>

        {/* Sources */}
        {r.sources.length > 0 && (
          <div style={{ flex: 1, padding: "12px 14px", background: "#0d0d18", border: "1px solid #1e1e2e", borderRadius: 8 }}>
            <div style={{ fontSize: 8, color: "#374151", letterSpacing: "0.16em", marginBottom: 10 }}>SOURCES</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {r.sources.map((src) => (
                <span
                  key={src}
                  style={{ fontSize: 9, padding: "2px 8px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 3, color: "#a5b4fc", letterSpacing: "0.06em" }}
                >
                  {src}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Impacted entities — with per-entity AI explanations if available */}
      {impacted.length > 0 && (
        <div style={{ border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.06)", borderBottom: impactExplanations.length > 0 ? "1px solid rgba(239,68,68,0.12)" : undefined }}>
            <div style={{ fontSize: 8, color: "#ef4444", letterSpacing: "0.16em", marginBottom: 8 }}>
              IMPACTED COMPONENTS  ·  {impacted.length}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {impacted.map((e) => (
                <span
                  key={e.id}
                  style={{ fontSize: 9, padding: "3px 9px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 3, color: "#fca5a5", letterSpacing: "0.04em" }}
                >
                  {e.name}
                </span>
              ))}
            </div>
          </div>

          {/* Per-entity AI explanations */}
          {impactExplanations.length > 0 && (
            <div style={{ background: "#08080f" }}>
              {impactExplanations.map((exp, i) => (
                <div
                  key={exp.name + i}
                  style={{ padding: "12px 14px", borderTop: i > 0 ? "1px solid #0f0f1a" : undefined }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 9, padding: "2px 7px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 3, color: "#fca5a5", fontWeight: 700, letterSpacing: "0.06em" }}>
                      {exp.name}
                    </span>
                    {exp.entity_type && (
                      <span style={{ fontSize: 8, color: "#374151", letterSpacing: "0.08em" }}>
                        {exp.entity_type.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.65, marginBottom: 8 }}>
                    {exp.how_affected}
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.18)", borderRadius: 5 }}>
                    <span style={{ fontSize: 9, color: "#f59e0b", flexShrink: 0, marginTop: 1 }}>→</span>
                    <span style={{ fontSize: 11, color: "#d97706", lineHeight: 1.55 }}>{exp.action}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Memory evidence */}
      {memHits.length > 0 && (
        <div style={{ border: "1px solid #1e1e2e", borderRadius: 8, overflow: "hidden" }}>
          <button
            onClick={() => setEvidenceOpen(!evidenceOpen)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#0d0d18", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace" }}
          >
            <span style={{ fontSize: 8, color: "#374151", letterSpacing: "0.16em" }}>EVIDENCE  ·  {memHits.length} MEMORY HITS</span>
            <span style={{ fontSize: 9, color: "#374151" }}>{evidenceOpen ? "▲" : "▼"}</span>
          </button>
          {evidenceOpen && (
            <div style={{ background: "#08080f" }}>
              {memHits.map((hit, i) => {
                const color = CONTENT_TYPE_COLOR[hit.content_type] ?? "#6b7280";
                return (
                  <div
                    key={hit.id}
                    style={{ padding: "12px 14px", borderTop: i > 0 ? "1px solid #1a1a28" : undefined }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 8, padding: "2px 6px", background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 3, color, letterSpacing: "0.08em" }}>
                        {hit.content_type.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 8, color: "#374151", marginLeft: "auto" }}>
                        {(hit.similarity * 100).toFixed(0)}% MATCH
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {hit.content.length > 280 ? hit.content.slice(0, 280) + "…" : hit.content}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
