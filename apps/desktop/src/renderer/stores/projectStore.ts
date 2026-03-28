import { create } from 'zustand';

const API_BASE = 'http://localhost:8000';

// ─── Type Definitions ────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface Entity {
  id: string;
  project_id: string;
  entity_type: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  source: string;
  source_ref: string;
  created_at: string;
  updated_at: string;
}

export interface Relation {
  id: string;
  project_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  metadata: Record<string, unknown>;
  confidence: number;
  created_at: string;
}

export interface SourceConnection {
  id: string;
  project_id: string;
  source_type: string;
  name: string;
  config: Record<string, unknown>;
  last_synced_at: string | null;
  status: string;
}

export interface TeamMember {
  id: string;
  project_id: string;
  name: string;
  role: string;
  email: string;
}

export interface ChangeEvent {
  id: string;
  project_id: string;
  change_type: string;
  entity_id: string;
  entity_name: string;
  description: string;
  diff_data: unknown;
  impacted_entity_ids: string[];
  created_at: string;
  acknowledged: boolean;
}

// ─── Store Interface ─────────────────────────────────────────────────────────

export interface ProjectStore {
  // State
  currentProjectId: string | null;
  projects: Project[];
  entities: Entity[];
  relations: Relation[];
  sources: SourceConnection[];
  teamMembers: TeamMember[];
  recentChanges: ChangeEvent[];
  loading: Record<string, boolean>;
  error: string | null;

  // Actions
  fetchProjects: () => Promise<void>;
  createProject: (name: string, description?: string) => Promise<string>;
  setCurrentProject: (id: string) => Promise<void>;
  fetchEntities: (projectId: string) => Promise<void>;
  fetchGraph: (projectId: string) => Promise<{ entities: Entity[]; relations: Relation[] }>;
  fetchChanges: (projectId: string) => Promise<void>;
  fetchSources: (projectId: string) => Promise<void>;
  addSource: (
    projectId: string,
    sourceType: string,
    name: string,
    config: Record<string, unknown>
  ) => Promise<void>;
  syncSource: (projectId: string, sourceId: string) => Promise<unknown>;
  fetchTeam: (projectId: string) => Promise<void>;
  addTeamMember: (projectId: string, name: string, role: string, email: string) => Promise<void>;
  queryAgent: (projectId: string, query: string, queryType: string) => Promise<unknown>;
  fetchImpact: (projectId: string, entityId: string) => Promise<unknown>;
  clearError: () => void;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useProjectStore = create<ProjectStore>((set, get) => ({
  // Initial state
  currentProjectId: null,
  projects: [],
  entities: [],
  relations: [],
  sources: [],
  teamMembers: [],
  recentChanges: [],
  loading: {},
  error: null,

  // ── Actions ──────────────────────────────────────────────────────────────

  fetchProjects: async () => {
    set((state) => ({ loading: { ...state.loading, fetchProjects: true } }));
    try {
      const res = await fetch(`${API_BASE}/api/projects`);
      if (!res.ok) throw new Error(`Failed to fetch projects: ${res.statusText}`);
      const projects: Project[] = await res.json();
      set({ projects });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set((state) => ({ loading: { ...state.loading, fetchProjects: false } }));
    }
  },

  createProject: async (name: string, description?: string) => {
    set((state) => ({ loading: { ...state.loading, createProject: true } }));
    try {
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) throw new Error(`Failed to create project: ${res.statusText}`);
      const project: Project = await res.json();
      set((state) => ({ projects: [...state.projects, project] }));
      return project.id;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      set((state) => ({ loading: { ...state.loading, createProject: false } }));
    }
  },

  setCurrentProject: async (id: string) => {
    set({
      currentProjectId: id,
      entities: [],
      relations: [],
      sources: [],
      teamMembers: [],
      recentChanges: [],
    });
    const { fetchEntities, fetchSources, fetchChanges, fetchTeam } = get();
    await Promise.all([
      fetchEntities(id),
      fetchSources(id),
      fetchChanges(id),
      fetchTeam(id),
    ]);
  },

  fetchEntities: async (projectId: string) => {
    set((state) => ({ loading: { ...state.loading, fetchEntities: true } }));
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/entities`);
      if (!res.ok) throw new Error(`Failed to fetch entities: ${res.statusText}`);
      const entities: Entity[] = await res.json();
      set({ entities });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set((state) => ({ loading: { ...state.loading, fetchEntities: false } }));
    }
  },

  fetchGraph: async (projectId: string) => {
    set((state) => ({ loading: { ...state.loading, fetchGraph: true } }));
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/graph`);
      if (!res.ok) throw new Error(`Failed to fetch graph: ${res.statusText}`);
      const data: { entities: Entity[]; relations: Relation[] } = await res.json();
      set({ entities: data.entities, relations: data.relations });
      return data;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      set((state) => ({ loading: { ...state.loading, fetchGraph: false } }));
    }
  },

  fetchChanges: async (projectId: string) => {
    set((state) => ({ loading: { ...state.loading, fetchChanges: true } }));
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/changes`);
      if (!res.ok) throw new Error(`Failed to fetch changes: ${res.statusText}`);
      const recentChanges: ChangeEvent[] = await res.json();
      set({ recentChanges });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set((state) => ({ loading: { ...state.loading, fetchChanges: false } }));
    }
  },

  fetchSources: async (projectId: string) => {
    set((state) => ({ loading: { ...state.loading, fetchSources: true } }));
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/sources`);
      if (!res.ok) throw new Error(`Failed to fetch sources: ${res.statusText}`);
      const sources: SourceConnection[] = await res.json();
      set({ sources });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set((state) => ({ loading: { ...state.loading, fetchSources: false } }));
    }
  },

  addSource: async (
    projectId: string,
    sourceType: string,
    name: string,
    config: Record<string, unknown>
  ) => {
    set((state) => ({ loading: { ...state.loading, addSource: true } }));
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_type: sourceType, name, config }),
      });
      if (!res.ok) throw new Error(`Failed to add source: ${res.statusText}`);
      await get().fetchSources(projectId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      set((state) => ({ loading: { ...state.loading, addSource: false } }));
    }
  },

  syncSource: async (projectId: string, sourceId: string) => {
    set((state) => ({ loading: { ...state.loading, syncSource: true } }));
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/${projectId}/sources/${sourceId}/sync`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error(`Failed to sync source: ${res.statusText}`);
      const result = await res.json();
      const { fetchEntities, fetchChanges, fetchSources } = get();
      await Promise.all([
        fetchEntities(projectId),
        fetchChanges(projectId),
        fetchSources(projectId),
      ]);
      return result;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      set((state) => ({ loading: { ...state.loading, syncSource: false } }));
    }
  },

  fetchTeam: async (projectId: string) => {
    set((state) => ({ loading: { ...state.loading, fetchTeam: true } }));
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/team`);
      if (!res.ok) throw new Error(`Failed to fetch team: ${res.statusText}`);
      const teamMembers: TeamMember[] = await res.json();
      set({ teamMembers });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set((state) => ({ loading: { ...state.loading, fetchTeam: false } }));
    }
  },

  addTeamMember: async (projectId: string, name: string, role: string, email: string) => {
    set((state) => ({ loading: { ...state.loading, addTeamMember: true } }));
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, email }),
      });
      if (!res.ok) throw new Error(`Failed to add team member: ${res.statusText}`);
      await get().fetchTeam(projectId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      set((state) => ({ loading: { ...state.loading, addTeamMember: false } }));
    }
  },

  queryAgent: async (projectId: string, query: string, queryType: string) => {
    set((state) => ({ loading: { ...state.loading, queryAgent: true } }));
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/agent/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, query_type: queryType }),
      });
      if (!res.ok) throw new Error(`Agent query failed: ${res.statusText}`);
      return await res.json();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      set((state) => ({ loading: { ...state.loading, queryAgent: false } }));
    }
  },

  fetchImpact: async (projectId: string, entityId: string) => {
    set((state) => ({ loading: { ...state.loading, fetchImpact: true } }));
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/impact/${entityId}`);
      if (!res.ok) throw new Error(`Failed to fetch impact: ${res.statusText}`);
      return await res.json();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      set((state) => ({ loading: { ...state.loading, fetchImpact: false } }));
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));
