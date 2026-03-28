// apps/desktop/src/renderer/components/agent/MemoryPanel.tsx
import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

interface MemoryResult {
  id: string;
  content: string;
  content_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  similarity: number;
}

interface MemoryPanelProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

const TYPE_COLOR: Record<string, string> = {
  issue:     "#ef4444",
  fix:       "#4ade80",
  note:      "#6366f1",
  datasheet: "#22d3ee",
  paper:     "#c084fc",
};

export function MemoryPanel({ projectId, open, onClose }: MemoryPanelProps) {
  const [query,     setQuery]     = useState("");
  const [results,   setResults]   = useState<MemoryResult[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!query.trim() || !projectId) return;
    setSearching(true);
    try {
      const resp = await fetch(`${API}/projects/${projectId}/memory/search?query=${encodeURIComponent(query)}&limit=10`);
      if (!resp.ok) throw new Error("Search failed");
      setResults(await resp.json());
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  if (!open) return null;

  return (
    <div style={{ width: 300, borderLeft: "1px solid #1e1e2e", display: "flex", flexDirection: "column", background: "#08080f", fontFamily: "JetBrains Mono, monospace", flexShrink: 0 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #1a1a28" }}>
        <span style={{ fontSize: 8, color: "#374151", letterSpacing: "0.18em" }}>TEAM MEMORY</span>
        <button onClick={onClose} style={{ fontSize: 12, color: "#374151", background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", lineHeight: 1 }}>✕</button>
      </div>

      {/* Search */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #1a1a28" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="search past issues, fixes…"
            style={{ flex: 1, background: "#0d0d18", border: "1px solid #1e1e2e", borderRadius: 4, padding: "6px 10px", fontSize: 10, color: "#c9cfd6", fontFamily: "JetBrains Mono, monospace", outline: "none" }}
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            style={{ padding: "6px 12px", fontSize: 9, letterSpacing: "0.1em", background: searching ? "#0d0d18" : "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 4, color: searching ? "#374151" : "#a5b4fc", cursor: searching ? "not-allowed" : "pointer", fontFamily: "JetBrains Mono, monospace" }}
          >
            {searching ? "···" : "SEARCH"}
          </button>
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {results.length === 0 ? (
          <div style={{ padding: "24px 14px", fontSize: 9, color: "#1f2937", letterSpacing: "0.1em", lineHeight: 1.8 }}>
            {query ? "NO RESULTS FOUND." : "SEARCH PAST ISSUES,\nFIXES, AND NOTES."}
          </div>
        ) : (
          results.map((r, i) => {
            const color = TYPE_COLOR[r.content_type] ?? "#6b7280";
            return (
              <div key={r.id} style={{ padding: "12px 14px", borderBottom: i < results.length - 1 ? "1px solid #0f0f1a" : undefined }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 8, padding: "2px 6px", background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 3, color, letterSpacing: "0.08em" }}>
                    {r.content_type.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 8, color: "#374151", marginLeft: "auto" }}>
                    {(r.similarity * 100).toFixed(0)}%
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "#9ca3af", lineHeight: 1.6, marginBottom: 6 }}>
                  {r.content.length > 200 ? r.content.slice(0, 200) + "…" : r.content}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {r.metadata.topic && (
                    <span style={{ fontSize: 8, padding: "1px 6px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 3, color: "#a5b4fc" }}>
                      {String(r.metadata.topic)}
                    </span>
                  )}
                  {r.metadata.issue_id && (
                    <span style={{ fontSize: 8, padding: "1px 6px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 3, color: "#fca5a5" }}>
                      issue linked
                    </span>
                  )}
                  {r.metadata.fix_id && (
                    <span style={{ fontSize: 8, padding: "1px 6px", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 3, color: "#86efac" }}>
                      fix linked
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
