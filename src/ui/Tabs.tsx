import type { KeyboardEvent } from 'react'

export type TabId = 'products' | 'boxes' | 'result' | 'report'

const TABS: { id: TabId; label: string }[] = [
  { id: 'products', label: 'Products' },
  { id: 'boxes', label: 'Boxes' },
  { id: 'result', label: 'Result' },
  { id: 'report', label: 'Report' },
]

interface Props {
  value: TabId
  onChange: (id: TabId) => void
  /** Tabs that contain a field that needs fixing. */
  flagged: ReadonlySet<TabId>
}

/** Products → Boxes → Result → Report. Arrow keys, Home and End move between tabs. */
export function Tabs({ value, onChange, flagged }: Props) {
  const move = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1
    if (next < 0) return
    e.preventDefault()
    onChange(TABS[next].id)
    document.getElementById(`tab-${TABS[next].id}`)?.focus()
  }
  return (
    <div className="tabs" role="tablist" aria-label="Sections">
      {TABS.map((t, i) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          className={value === t.id ? 'tab on' : 'tab'}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => move(e, i)}
        >
          <span className="tabno">{i + 1}</span>
          {t.label}
          {flagged.has(t.id) && (
            <b className="tabflag" title="Needs attention" aria-label="needs attention">
              !
            </b>
          )}
        </button>
      ))}
    </div>
  )
}
