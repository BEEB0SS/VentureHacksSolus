// apps/desktop/src/renderer/components/agent/MemoryPanel.tsx
import { useState } from "react";
import { Search, BookOpen, X } from "lucide-react";

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

export function MemoryPanel({ projectId, open, onClose }: MemoryPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemoryResult[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!query.trim() || !projectId) return;
    setSearching(true);
    try {
      const resp = await fetch(
        `${API}/projects/${projectId}/memory/search?query=${encodeURIComponent(query)}&limit=10`
      );
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
    <div className="w-80 bg-neutral-900 border-l border-neutral-800 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-neutral-400" />
          <span className="text-sm font-medium text-neutral-200">Team Memory</span>
        </div>
        <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 cursor-pointer">
          <X size={14} />
        </button>
      </div>

      <div className="p-3 border-b border-neutral-800">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search team memory..."
            className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-neutral-600"
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            className="px-2 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded transition-colors cursor-pointer"
          >
            <Search size={14} className={searching ? "text-neutral-600 animate-pulse" : "text-neutral-400"} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 flex flex-col gap-2">
        {results.length === 0 ? (
          <div className="text-xs text-neutral-500 text-center mt-8">
            {query ? "No results found." : "Search past issues, fixes, and notes."}
          </div>
        ) : (
          results.map((r) => (
            <div key={r.id} className="bg-neutral-800 rounded p-3 text-xs">
              <div className="flex justify-between text-neutral-400 mb-1">
                <span className="bg-neutral-700 rounded px-1.5 py-0.5">{r.content_type}</span>
                <span className="font-['JetBrains_Mono']">{(r.similarity * 100).toFixed(0)}%</span>
              </div>
              <div className="text-neutral-200 mt-1 whitespace-pre-wrap">{r.content}</div>
              {r.metadata && Object.keys(r.metadata).length > 0 && (
                <div className="mt-2 pt-1.5 border-t border-neutral-700 flex flex-wrap gap-1">
                  {r.metadata.topic && (
                    <span className="bg-blue-900/30 border border-blue-800 text-blue-300 text-[10px] px-1.5 py-0.5 rounded">
                      {String(r.metadata.topic)}
                    </span>
                  )}
                  {r.metadata.issue_id && (
                    <span className="bg-red-900/30 border border-red-800 text-red-300 text-[10px] px-1.5 py-0.5 rounded">
                      issue linked
                    </span>
                  )}
                  {r.metadata.fix_id && (
                    <span className="bg-green-900/30 border border-green-800 text-green-300 text-[10px] px-1.5 py-0.5 rounded">
                      fix linked
                    </span>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
