import { useState, useEffect } from 'react'
import { Boxes, Network, Search, Activity, Cpu } from 'lucide-react'
import { useProjectStore } from './stores/projectStore'
import { LoadingSpinner } from './components/shared/LoadingSpinner'
import WorkspaceTab from './components/workspace/WorkspaceTab'
import ContextModelTab from './components/context-model/ContextModelTab'
import AgentTab from './components/agent/AgentTab'

const LiveBenchTab = () => (
  <div className="p-8 text-solus-text-dim">Live Bench — not built yet</div>
)
import SimulatorTab from './components/simulator/SimulatorTab'

const TABS = [
  { id: 'workspace', label: 'Workspace', icon: Boxes },
  { id: 'context', label: 'Context', icon: Network },
  { id: 'agent', label: 'Agent', icon: Search },
  { id: 'live-bench', label: 'Live Bench', icon: Activity },
  { id: 'simulator', label: 'Simulator', icon: Cpu },
] as const

const TAB_COMPONENTS: Record<string, React.ComponentType<any>> = {
  workspace: WorkspaceTab,
  context: ContextModelTab,
  agent: AgentTab,
  'live-bench': LiveBenchTab,
  simulator: SimulatorTab,
}

export default function App() {
  const [activeTab, setActiveTab] = useState('workspace')
  const { projects, currentProjectId, fetchProjects, setCurrentProject, loading, error, clearError } = useProjectStore()

  useEffect(() => { fetchProjects() }, [fetchProjects])

  useEffect(() => {
    if (projects.length > 0 && !currentProjectId) setCurrentProject(projects[0].id)
  }, [projects, currentProjectId, setCurrentProject])

  const currentProject = projects.find((p) => p.id === currentProjectId)
  const ActiveComponent = TAB_COMPONENTS[activeTab] || WorkspaceTab
  const needsProjectId = activeTab === 'context' || activeTab === 'agent'

  return (
    <div className="h-screen flex flex-col bg-solus-bg font-sans">
      {/* Title bar */}
      <div className="h-9 bg-solus-bg flex items-center px-4 border-b border-solus-border/50 [-webkit-app-region:drag]">
        <span className="text-[11px] font-mono text-solus-accent font-semibold tracking-[0.15em]">
          SOLUS
        </span>
        <div className="ml-auto flex items-center gap-3 [-webkit-app-region:no-drag]">
          {loading.fetchProjects && <LoadingSpinner size="sm" />}
          {currentProject && (
            <span className="text-[11px] text-solus-text-muted font-mono">
              {currentProject.name}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-solus-error/5 border-b border-solus-error/20 px-4 py-1.5 flex items-center justify-between">
          <span className="text-[11px] text-solus-error/80">{error}</span>
          <button onClick={clearError} className="text-[11px] text-solus-error/60 hover:text-solus-error cursor-pointer">
            dismiss
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — icon-only, minimal */}
        <nav className="w-12 bg-solus-bg border-r border-solus-border/50 flex flex-col items-center pt-2 gap-0.5">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors cursor-pointer
                  ${isActive
                    ? 'bg-solus-accent/15 text-solus-accent-bright'
                    : 'text-solus-text-muted hover:text-solus-text-dim'
                  }`}
                title={tab.label}
              >
                <Icon size={18} strokeWidth={isActive ? 2 : 1.5} />
              </button>
            )
          })}
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          {needsProjectId && currentProjectId ? (
            <ActiveComponent projectId={currentProjectId} />
          ) : (
            <ActiveComponent />
          )}
        </main>
      </div>
    </div>
  )
}
