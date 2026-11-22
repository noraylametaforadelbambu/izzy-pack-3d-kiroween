import { useState, type ReactNode } from 'react'
import type { DimsFields } from '../core/fields'
import type { Dims } from '../core/pack'
import type { WField } from '../core/weight'

interface Props {
  box: DimsFields
  invalid: ReadonlySet<string>
  empty: WField
  max: WField
  onEditBox: (key: keyof Dims, text: string) => void
  onEditWeight: (key: 'empty' | 'max', text: string) => void
  /** The shipping-box catalog (rendered by the caller). */
  catalog: ReactNode
  /** "Pack in my own box": packs the order into the container above instead of a catalog box. */
  onOwnBox: () => void
  busy: boolean
}

const KEYS: { key: keyof Dims; name: string; head: string }[] = [
  { key: 'l', name: 'length', head: 'L' },
  { key: 'w', name: 'width', head: 'W' },
  { key: 'h', name: 'height', head: 'H' },
]

/**
 * "Choose a box": the shipping-box catalog with the recommendation first, then the weight limits, and the option of
 * a box of your own (the container) in a section that opens on request.
 */
export function BoxesTab({ box, invalid, empty, max, onEditBox, onEditWeight, catalog, onOwnBox, busy }: Props) {
  const [ownOpen, setOwnOpen] = useState(false)
  const ownBad = KEYS.some((k) => invalid.has(`box.${k.key}`))
  return (
    <div className="boxestab">
      {catalog}
      <div className="whead wtop">
        <span className="rowlabel">Weight limits</span>
      </div>
      <div className="wgrid">
        <label>
          <span>Empty box</span>
          <input
            className={invalid.has('w.empty') ? 'bad' : undefined}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label="Empty box weight"
            aria-invalid={invalid.has('w.empty')}
            placeholder="0"
            value={empty.text}
            onChange={(e) => onEditWeight('empty', e.target.value)}
          />
        </label>
        <label>
          <span>Max gross</span>
          <input
            className={invalid.has('w.max') ? 'bad' : undefined}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label="Maximum gross weight"
            aria-invalid={invalid.has('w.max')}
            placeholder="no limit"
            value={max.text}
            onChange={(e) => onEditWeight('max', e.target.value)}
          />
        </label>
      </div>
      <details className="ownbox" open={ownOpen || ownBad} onToggle={(e) => setOwnOpen(e.currentTarget.open)}>
        <summary>Use my own box</summary>
        <p className="hint">Interior size of a box you already have. The order is packed into it as it is, without a recommendation.</p>
        <div className="pheads three" aria-hidden="true">
          {KEYS.map((k) => (
            <span key={k.key}>{k.head}</span>
          ))}
        </div>
        <div className="cdims">
          {KEYS.map(({ key, name }) => {
            const bad = invalid.has(`box.${key}`)
            return (
              <input
                key={key}
                className={bad ? 'bad' : undefined}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                aria-label={`Box ${name}`}
                aria-invalid={bad}
                value={box[key].text}
                onChange={(e) => onEditBox(key, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              />
            )
          })}
        </div>
        <button type="button" className="add ownaction" onClick={onOwnBox} disabled={busy}>
          Pack in my own box
        </button>
      </details>
    </div>
  )
}
