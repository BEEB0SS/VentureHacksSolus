import { useState, useRef } from 'react'
import { Box, Upload, Globe, X } from 'lucide-react'
import { LoadingSpinner } from '../shared/LoadingSpinner'

interface ModelSourceBarProps {
  activeSource: 'default' | 'upload' | 'onshape'
  loading: boolean
  onLoadDefault: () => void
  onUploadFile: (xmlFile: File, meshFiles: File[]) => void
  onImportOnshape: (url: string) => void
}

export function ModelSourceBar({
  activeSource,
  loading,
  onLoadDefault,
  onUploadFile,
  onImportOnshape,
}: ModelSourceBarProps) {
  const [showOnshapeInput, setShowOnshapeInput] = useState(false)
  const [onshapeUrl, setOnshapeUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const xmlFile = files.find(f => f.name.endsWith('.xml'))
    if (!xmlFile) return
    const meshFiles = files.filter(f => f.name.endsWith('.stl') || f.name.endsWith('.obj'))
    onUploadFile(xmlFile, meshFiles)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleOnshapeSubmit = () => {
    if (!onshapeUrl.startsWith('https://cad.onshape.com/')) return
    onImportOnshape(onshapeUrl)
    setShowOnshapeInput(false)
    setOnshapeUrl('')
  }

  const btnBase = "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer"
  const btnActive = "bg-solus-accent/20 text-solus-accent-bright border border-solus-accent/40"
  const btnInactive = "text-solus-text-dim bg-solus-elevated border border-solus-border hover:bg-solus-surface"

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-solus-border bg-solus-surface/50">
      <span className="text-xs text-solus-text-muted mr-1">Model:</span>

      <button
        onClick={onLoadDefault}
        disabled={loading}
        className={`${btnBase} ${activeSource === 'default' ? btnActive : btnInactive}`}
      >
        <Box size={14} />
        Default Rover
      </button>

      <button
        onClick={handleUploadClick}
        disabled={loading}
        className={`${btnBase} ${activeSource === 'upload' ? btnActive : btnInactive}`}
      >
        <Upload size={14} />
        Upload MJCF
      </button>

      <button
        onClick={() => setShowOnshapeInput(true)}
        disabled={loading}
        className={`${btnBase} ${activeSource === 'onshape' ? btnActive : btnInactive}`}
      >
        <Globe size={14} />
        Import from Onshape
      </button>

      {loading && <LoadingSpinner size="sm" label="Loading model..." />}

      <input
        ref={fileInputRef}
        type="file"
        accept=".xml,.stl,.obj"
        multiple
        onChange={handleFilesSelected}
        className="hidden"
      />

      {showOnshapeInput && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-solus-surface border border-solus-border rounded-lg p-4 w-[480px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-solus-text">Import from Onshape</h3>
              <button onClick={() => setShowOnshapeInput(false)} className="text-solus-text-muted hover:text-solus-text cursor-pointer">
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-solus-text-muted mb-3">
              Paste the Onshape document URL to import your CAD model.
            </p>
            <input
              type="text"
              value={onshapeUrl}
              onChange={e => setOnshapeUrl(e.target.value)}
              placeholder="https://cad.onshape.com/documents/..."
              className="w-full bg-solus-elevated border border-solus-border rounded px-3 py-2 text-xs font-mono text-solus-text focus:outline-none focus:border-solus-accent mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowOnshapeInput(false)}
                className="px-3 py-1.5 text-xs text-solus-text-dim bg-solus-elevated border border-solus-border rounded-md hover:bg-solus-surface cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleOnshapeSubmit}
                disabled={!onshapeUrl.startsWith('https://cad.onshape.com/')}
                className="px-3 py-1.5 text-xs text-white bg-solus-accent rounded-md hover:bg-solus-accent-bright disabled:opacity-50 cursor-pointer"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
