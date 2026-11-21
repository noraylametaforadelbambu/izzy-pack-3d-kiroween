import type { ReactNode } from 'react'
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
}

const KEYS: { key: keyof Dims; name: string; head: string }[] = [
  { key: 'l', name: 'length', head: 'L' },
  { key: 'w', name: 'width', head: 'W' },
  { key: 'h', name: 'height', head: 'H' },
]

/** The container the order is packed into, its weight limits, and the shipping-box catalog. */
export function BoxesTab({ box, invalid, empty, max, onEditBox, onEditWeight, catalog }: Props) {
  return (
    <div className="boxestab">
      <div className="whead">
        <span className="rowlabel">Container (interior)</span>
      </div>
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
            />
          )
        })}
      </div>
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
      {catalog}
    </div>
  )
}
