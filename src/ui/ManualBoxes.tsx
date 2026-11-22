import type { TypeRow } from '../core/boxTypes'
import { rowLabel } from '../core/boxTypes'
import type { TypeSummary } from '../core/layout'

interface Props {
  rows: TypeRow[]
  summaries: ReadonlyMap<string, TypeSummary>
  canAdd: (typeId: string) => boolean
  onAddBox: (typeId: string) => void
}

/** Manual mode: the products to place. "+" adds one box of that product to the container. */
export function ManualBoxes({ rows, summaries, canAdd, onAddBox }: Props) {
  return (
    <section className="manualboxes" aria-label="Products to place">
      <p className="hint">Press + to add a box, then drag it in the 3D view or use the arrows. Undo, redo and reset are above the view.</p>
      {rows.map((r, i) => {
        const s = summaries.get(r.id)
        const short = s !== undefined && s.requested !== null && s.placed < s.requested
        const text = s ? (s.requested === null ? String(s.placed) : `${s.placed}/${s.requested}`) : '–'
        return (
          <div className="mbrow" key={r.id}>
            <span className="swatch" style={{ background: r.color }} />
            <span className="mbname">{rowLabel(r, i)}</span>
            <span className={short ? 'placed short' : 'placed'} aria-label={`Type ${i + 1} placed`}>
              {text}
            </span>
            <button type="button" className="add1" aria-label={`Add type ${i + 1} box`} title="Add one to the container" disabled={!canAdd(r.id)} onClick={() => onAddBox(r.id)}>
              +
            </button>
          </div>
        )
      })}
    </section>
  )
}
