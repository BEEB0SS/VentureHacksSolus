import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

interface Source {
  id: string;
  source_type: string;
  name: string;
  config: Record<string, string>;
  last_synced_at: string | null;
  status: string;
}

interface ChangeEvent {
  id: string;
  change_type: "added" | "modified" | "removed";
  entity_name: string;
  description: string;
  diff_data: Record<string, unknown>;
  created_at: string;
  acknowledged: boolean;
}

interface SyncResult {
  snapshot_id: string;
  entity_count: number;
  changes: ChangeEvent[];
}

export default function WorkspaceTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [sources, setSources] = useState<Source[]>([]);
  const [changes, setChanges] = useState<ChangeEvent[]>([]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const safeFetch = async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    return r.json();
  };

  useEffect(() => {
    safeFetch(`${API}/projects`)
      .then((data) => {
        setProjects(data);
        if (data.length > 0 && !selectedProjectId) {
          setSelectedProjectId(data[0].id);
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    safeFetch(`${API}/projects/${selectedProjectId}/sources`)
      .then(setSources)
      .catch((e) => setError(e.message));
    safeFetch(`${API}/projects/${selectedProjectId}/changes`)
      .then(setChanges)
      .catch((e) => setError(e.message));
  }, [selectedProjectId]);

  const handleSync = useCallback(
    async (sourceId: string) => {
      setSyncing(sourceId);
      setError(null);
      try {
        const resp = await fetch(
          `${API}/projects/${selectedProjectId}/sources/${sourceId}/sync`,
          { method: "POST" }
        );
        if (!resp.ok) throw new Error(await resp.text());
        const srcResp = await fetch(`${API}/projects/${selectedProjectId}/sources`);
        setSources(await srcResp.json());
        const chgResp = await fetch(`${API}/projects/${selectedProjectId}/changes`);
        setChanges(await chgResp.json());
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Sync failed");
      } finally {
        setSyncing(null);
      }
    },
    [selectedProjectId]
  );

  const changeTypeColor: Record<string, string> = {
    added: "text-green-400",
    modified: "text-yellow-400",
    removed: "text-red-400",
  };

  const changeTypeIcon: Record<string, string> = {
    added: "+",
    modified: "~",
    removed: "-",
  };

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-neutral-100 p-4 gap-4 font-['Inter']">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Workspace</h2>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-sm"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-4">
        <h3 className="text-sm font-medium text-neutral-400 mb-3">Connected Sources</h3>
        {sources.length === 0 ? (
          <p className="text-sm text-neutral-500">No sources connected yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sources.map((src) => (
              <div key={src.id} className="flex items-center justify-between bg-neutral-850 rounded px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${src.status === "connected" ? "bg-green-400" : "bg-neutral-500"}`} />
                  <div>
                    <span className="text-sm font-medium">{src.name}</span>
                    <span className="text-xs text-neutral-500 ml-2">{src.source_type}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {src.last_synced_at && (
                    <span className="text-xs text-neutral-500 font-['JetBrains_Mono']">
                      {new Date(src.last_synced_at).toLocaleTimeString()}
                    </span>
                  )}
                  <button
                    onClick={() => handleSync(src.id)}
                    disabled={syncing === src.id}
                    className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 rounded transition-colors"
                  >
                    {syncing === src.id ? "Syncing..." : "Sync"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-4 flex-1 overflow-auto">
        <h3 className="text-sm font-medium text-neutral-400 mb-3">Recent Changes</h3>
        {changes.length === 0 ? (
          <p className="text-sm text-neutral-500">No changes detected yet. Sync a source to see changes.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {changes.map((change) => (
              <div key={change.id} className="flex items-start gap-2 px-2 py-1.5 hover:bg-neutral-800 rounded text-sm font-['JetBrains_Mono']">
                <span className={`${changeTypeColor[change.change_type]} font-bold w-4`}>
                  {changeTypeIcon[change.change_type]}
                </span>
                <span className="text-neutral-200">{change.entity_name}</span>
                <span className="text-neutral-500 text-xs ml-auto">{change.change_type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
