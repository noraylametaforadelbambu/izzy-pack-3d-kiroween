import { useEffect, useRef } from 'react'
import { MAX_CATALOG, type BoxTrial, type CatalogRow, type Recommendation } from '../core/catalog'
import type { Dims } from '../core/pack'
import { formatDim, formatVolume, volumeUnitLabel, type Unit } from '../core/units'
import { formatWeight, type WeightUnit } from '../core/weight'
import { trialReason } from './trialReason'

interface Props {
  rows: CatalogRow[]
  unit: Unit
  weightUnit: WeightUnit
  invalid: ReadonlySet<string>
  busy: boolean
  recommendation: Recommendation | null
  /** Box types as numbered in the type list, for messages ("Type 2"). */
  typeNumbers: ReadonlyMap<string, number>
  onEdit: (id: string, key: keyof Dims, text: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onRecommend: () => void
  onUse: () => void
}

const KEYS: { key: keyof Dims; name: string }[] = [
  { key: 'l', name: 'length' },
  { key: 'w', name: 'width' },
  { key: 'h', name: 'height' },
]

const size = (d: Dims, unit: Unit): string => `${formatDim(d.l, unit)} × ${formatDim(d.w, unit)} × ${formatDim(d.h, unit)} ${unit}`

function Trials({ trials, unit, orderVolumeMm3 }: { trials: BoxTrial[]; unit: Unit; orderVolumeMm3: number }) {
  return (
    <ul className="trials" data-testid="trials">
      {trials.map((t) => (
        <li key={t.boxId}>
          <span>{size(t.dims, unit)}</span>
          <i>{trialReason(t, orderVolumeMm3, unit)}</i>
        </li>
      ))}
    </ul>
  )
}

/** Shipping-box catalog (interior sizes) and the recommendation of the smallest box that holds the whole order. */
export function CatalogPanel(p: Props) {
  const r = p.recommendation
  const box = useRef<HTMLDivElement>(null)
  // The answer appears below the list: bring it into view inside the scrolling section.
  useEffect(() => {
    if (r) box.current?.scrollIntoView?.({ block: 'nearest' })
  }, [r])
  const vol = (mm3: number): string => `${formatVolume(mm3, p.unit)} ${volumeUnitLabel(p.unit)}`
  const typeList = (ids: string[]): string => ids.map((id) => `Type ${p.typeNumbers.get(id) ?? '?'}`).join(', ')
  return (
    <section className="catalog" aria-label="Shipping boxes">
      <div className="whead">
        <span className="rowlabel">Shipping boxes ({p.rows.length})</span>
      </div>
      <p className="hint">Interior sizes. The smallest box that holds the whole order is recommended.</p>
      <div className="cgrid">
        {p.rows.map((row, i) => (
          <div className="crow" key={row.id}>
            {KEYS.map(({ key, name }) => {
              const bad = p.invalid.has(`${row.id}.${key}`)
              return (
                <input
                  key={key}
                  className={bad ? 'bad' : undefined}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={`Shipping box ${i + 1} ${name}`}
                  aria-invalid={bad}
                  value={row.dims[key].text}
                  onChange={(e) => p.onEdit(row.id, key, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                />
              )
            })}
            <button type="button" className="del" aria-label={`Remove shipping box ${i + 1}`} title="Remove" onClick={() => p.onRemove(row.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="cactions">
        <button type="button" className="add" onClick={p.onAdd} disabled={p.rows.length >= MAX_CATALOG || p.busy} title="Add a box size">
          + Box
        </button>
        <button type="button" className="add" onClick={p.onRecommend} disabled={p.busy || p.rows.length === 0} title="Smallest catalog box that holds the whole order">
          Recommend box
        </button>
      </div>

      {r && (
        <div ref={box} className="recommendation" role="status" aria-live="polite" data-testid="recommendation" data-status={r.status}>
          {r.status === 'found' && r.box && r.result && (
            <>
              <b data-testid="rec-box">{size(r.box.dims, p.unit)}</b>
              <p>
                Holds all {r.orderUnits.toLocaleString('en-US')} units. Interior {vol(r.trials[r.trials.length - 1].volumeMm3)}, {r.result.layout.usedPct.toFixed(1)}% used
                {r.result.weight.maxG !== null && <>, gross {formatWeight(r.result.weight.grossG, p.weightUnit)} of {formatWeight(r.result.weight.maxG, p.weightUnit)}</>}.
              </p>
              {r.trials.length > 1 && (
                <>
                  <p className="muted">Why not the smaller {r.trials.length === 2 ? 'box' : 'boxes'}:</p>
                  <Trials trials={r.trials.slice(0, -1)} unit={p.unit} orderVolumeMm3={r.orderVolumeMm3} />
                </>
              )}
              {r.result.stats.effort.reduced && <p className="muted">The search was reduced for this large order; a smaller box may exist.</p>}
              <button type="button" className="add" onClick={p.onUse} disabled={p.busy}>
                Use this box
              </button>
            </>
          )}
          {r.status === 'not-found' && (
            <>
              <b>No complete arrangement found</b>
              <p>
                None of the {r.trials.length} catalog {r.trials.length === 1 ? 'box' : 'boxes'} held all {r.orderUnits.toLocaleString('en-US')} units in this search.
                The search is a heuristic, so this does not prove that no arrangement exists. A larger box, or a different catalog, may work.
              </p>
              <Trials trials={r.trials} unit={p.unit} orderVolumeMm3={r.orderVolumeMm3} />
            </>
          )}
          {r.status === 'needs-quantities' && (
            <>
              <b>Enter quantities first</b>
              <p>A blank quantity means “as many as fit”, which has no fixed size to recommend a box for. Set a number for {typeList(r.needsQuantities)}.</p>
            </>
          )}
          {r.status === 'over-weight' && (
            <>
              <b>The order is too heavy for one box</b>
              <p>The products weigh {formatWeight(r.orderWeightG, p.weightUnit)}, which together with the empty box is above the maximum gross weight. That is true for any box size.</p>
            </>
          )}
          {r.status === 'empty-catalog' && <b>Add at least one shipping box</b>}
          {r.status === 'invalid-order' && (
            <>
              <b>The order cannot be optimized</b>
              <p>{r.message}</p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
