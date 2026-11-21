export type Mode = 'auto' | 'manual'

interface Props {
  mode: Mode
  onMode: (m: Mode) => void
  canUndo: boolean
  canRedo: boolean
  hasBoxes: boolean
  onUndo: () => void
  onRedo: () => void
  onReset: () => void
  onFromAuto: () => void
}

export function Toolbar(p: Props) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Mode">
      <div className="seg" role="radiogroup" aria-label="Mode">
        {(['auto', 'manual'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={p.mode === m}
            className={p.mode === m ? 'on' : undefined}
            onClick={() => p.onMode(m)}
          >
            {m === 'auto' ? 'Auto' : 'Manual'}
          </button>
        ))}
      </div>
      {p.mode === 'manual' && (
        <div className="tools">
          <button type="button" onClick={p.onUndo} disabled={!p.canUndo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button type="button" onClick={p.onRedo} disabled={!p.canRedo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
          <button type="button" onClick={p.onReset} disabled={!p.hasBoxes} title="Remove all boxes (can be undone)">
            Reset
          </button>
          <button type="button" onClick={p.onFromAuto} title="Start from the automatic layout">
            From auto
          </button>
        </div>
      )}
    </div>
  )
}
