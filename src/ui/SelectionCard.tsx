import type { Field } from '../core/fields'
import type { Placement } from '../core/layout'
import { orientationLabel, type Axis } from '../core/manual'
import type { Dims } from '../core/pack'
import { formatDim, type Unit } from '../core/units'

interface Props {
  placement: Placement
  /** 1-based position of the box's type in the type list. */
  typeNumber: number
  typeDims: Dims
  unit: Unit
  step: Field
  onStep: (text: string) => void
  onMove: (axis: Axis, sign: 1 | -1) => void
  onRotate: (axis: Axis) => void
  onRemove: () => void
  onClose: () => void
}

const AXES: Axis[] = ['x', 'y', 'z']

export function SelectionCard(p: Props) {
  const { placement: b, unit } = p
  const f = (mm: number) => formatDim(mm, unit)
  const stepOk = p.step.mm !== null
  return (
    <div className="selcard" data-testid="selection">
      <div className="selhead">
        <span className="swatch" style={{ background: b.color }} />
        <b>Type {p.typeNumber}</b>
        <button type="button" className="del" aria-label="Deselect" title="Deselect" onClick={p.onClose}>
          ×
        </button>
      </div>
      <dl className="seldata">
        <dt>Size</dt>
        <dd data-testid="sel-size">
          {f(b.size.l)} × {f(b.size.w)} × {f(b.size.h)} {unit}
        </dd>
        <dt>Position</dt>
        <dd data-testid="sel-pos">
          {f(b.x)}, {f(b.y)}, {f(b.z)} {unit}
        </dd>
        <dt>Axes</dt>
        <dd data-testid="sel-axes" title="Which of the type's L, W, H lies along x, y, z">
          {orientationLabel(p.typeDims, b.size)}
        </dd>
      </dl>
      <div className="selrow">
        <span className="rowlabel">Move</span>
        <input
          className={stepOk ? undefined : 'bad'}
          type="text"
          inputMode="decimal"
          aria-label="Step"
          title={`Step (${unit})`}
          value={p.step.text}
          onChange={(e) => p.onStep(e.target.value)}
        />
        {AXES.map((a) => (
          <span key={a} className="pair">
            <button
              type="button"
              disabled={!stepOk}
              aria-label={`Move ${a.toUpperCase()} minus`}
              title={a === 'z' ? 'Swap with the box below' : `${a.toUpperCase()} −`}
              onClick={() => p.onMove(a, -1)}
            >
              {a.toUpperCase()}−
            </button>
            <button
              type="button"
              disabled={!stepOk}
              aria-label={`Move ${a.toUpperCase()} plus`}
              title={a === 'z' ? 'Swap with the box above' : `${a.toUpperCase()} +`}
              onClick={() => p.onMove(a, 1)}
            >
              {a.toUpperCase()}+
            </button>
          </span>
        ))}
      </div>
      <div className="selrow">
        <span className="rowlabel">Rotate</span>
        {AXES.map((a) => (
          <button
            key={a}
            type="button"
            aria-label={`Rotate ${a.toUpperCase()}`}
            title={`Rotate 90° around ${a.toUpperCase()}`}
            onClick={() => p.onRotate(a)}
          >
            {a.toUpperCase()} 90°
          </button>
        ))}
        <button type="button" className="danger" onClick={p.onRemove} title="Return to inventory (Delete)">
          Remove
        </button>
      </div>
    </div>
  )
}
