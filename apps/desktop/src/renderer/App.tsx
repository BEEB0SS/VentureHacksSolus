import { useState, useEffect } from 'react'
import { Boxes, Network, Search, Activity, Cpu } from 'lucide-react'
import { useProjectStore } from './stores/projectStore'
import { LoadingSpinner } from './components/shared/LoadingSpinner'
import WorkspaceTab from './components/workspace/WorkspaceTab'
import ContextModelTab from './components/context-model/ContextModelTab'
import AgentTab from './components/agent/AgentTab'

// Placeholders — teammates replace these when they merge
const LiveBenchTab = () => (
  <div className="p-8 text-solus-text-dim">Live Bench — not built yet</div>
)
import SimulatorTab from './components/simulator/SimulatorTab'

const TABS = [
  { id: 'workspace', label: 'Workspace', icon: Boxes, component: WorkspaceTab },
  { id: 'context', label: 'Context', icon: Network, component: ContextModelTab },
  { id: 'agent', label: 'Agent', icon: Search, component: AgentTab },
  { id: 'live-bench', label: 'Live Bench', icon: Activity, component: LiveBenchTab },
  { id: 'simulator', label: 'Simulator', icon: Cpu, component: SimulatorTab },
] as const

export default function App() {
  const [activeTab, setActiveTab] = useState('workspace')
  const ActiveComponent =
    TABS.find((t) => t.id === activeTab)?.component || WorkspaceTab

  const { projects, currentProjectId, fetchProjects, setCurrentProject, loading, error, clearError } = useProjectStore()

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (projects.length > 0 && !currentProjectId) {
      setCurrentProject(projects[0].id)
    }
  }, [projects, currentProjectId, setCurrentProject])

  const currentProject = projects.find((p) => p.id === currentProjectId)

  return (
    <div className="h-screen flex flex-col bg-solus-bg font-sans">
      {/* Title bar — draggable on macOS */}
      <div className="h-8 bg-solus-surface flex items-center px-4 border-b border-solus-border [-webkit-app-region:drag]">
        <span className="text-xs font-mono text-solus-accent font-semibold tracking-wider">
          SOLUS
        </span>
        <div className="ml-auto flex items-center gap-2 [-webkit-app-region:no-drag]">
          {loading.fetchProjects && <LoadingSpinner size="sm" />}
          {currentProject && (
            <span className="text-xs text-solus-text-dim font-mono">
              {currentProject.name}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-solus-error/10 border-b border-solus-error/30 px-4 py-1.5 flex items-center justify-between">
          <span className="text-xs text-solus-error">{error}</span>
          <button onClick={clearError} className="text-xs text-solus-error hover:underline cursor-pointer">
            dismiss
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-14 bg-solus-surface border-r border-solus-border flex flex-col items-center py-3 gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all cursor-pointer
                  ${
                    isActive
                      ? 'bg-solus-accent/20 text-solus-accent-bright'
                      : 'text-solus-text-muted hover:text-solus-text-dim hover:bg-solus-elevated'
                  }`}
                title={tab.label}
              >
                <Icon size={20} />
              </button>
            )
          })}
        </nav>

        {/* Main content area */}
        <main className="flex-1 overflow-auto">
          {activeTab === 'context' && currentProjectId ? (
            <ContextModelTab projectId={currentProjectId} />
          ) : activeTab === 'agent' && currentProjectId ? (
            <AgentTab projectId={currentProjectId} />
          ) : (
            <ActiveComponent />
          )}
        </main>
      </div>
    </div>
  )
}