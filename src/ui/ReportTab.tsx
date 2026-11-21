import type { Layout } from '../core/layout'
import type { PackItem } from '../core/optimizer'
import { volume } from '../core/pack'
import { formatDim, formatVolume, volumeUnitLabel, type Unit } from '../core/units'
import { formatWeight, type WeightSummary, type WeightUnit } from '../core/weight'

interface Props {
  layout: Layout
  /** The order the layout was made for (sizes, weights). */
  items: PackItem[]
  /** Current display name and color of each product, by id. */
  labels: ReadonlyMap<string, { name: string; color: string }>
  unit: Unit
  weightUnit: WeightUnit
  weight: WeightSummary
  manual: boolean
  /** Inputs changed after this layout was made. */
  stale: boolean
  heldBack: number
  effortNotes: string[]
}

const n = (v: number): string => v.toLocaleString('en-US')

/** A readable summary of the arrangement on screen: box, pieces per product, volume and weight. */
export function ReportTab({ layout: r, items, labels, unit, weightUnit, weight: w, manual, stale, heldBack, effortNotes }: Props) {
  const vol = volumeUnitLabel(unit)
  const wt = (g: number): string => formatWeight(g, weightUnit)
  const byId = new Map(items.map((i) => [i.id, i]))
  const rows = r.types.map((t) => {
    const it = byId.get(t.typeId)
    const label = labels.get(t.typeId)
    const unitVol = it ? volume(it.dims) : 0
    return {
      id: t.typeId,
      name: label?.name ?? 'Removed product',
      color: label?.color ?? '#8899aa',
      size: it ? `${formatDim(it.dims.l, unit)} × ${formatDim(it.dims.w, unit)} × ${formatDim(it.dims.h, unit)} ${unit}` : '–',
      weightEach: it?.weightKg !== undefined ? wt(it.weightKg * 1000) : '–',
      requested: t.requested,
      placed: t.placed,
      out: t.requested === null ? null : Math.max(0, t.requested - t.placed),
      volumeMm3: t.placed * unitVol,
    }
  })
  const requested = rows.reduce((s, x) => s + (x.requested ?? x.placed), 0)
  const verdict = r.placedCount === 0 ? 'Nothing placed' : r.unplacedCount > 0 ? 'Partial: some pieces did not fit' : 'Complete: every requested piece is placed'
  const tone = r.placedCount === 0 || r.unplacedCount > 0 ? 'warn' : 'good'
  return (
    <article className="report" data-testid="report" aria-label="Packing report">
      <div className={`verdict ${tone}`} data-testid="report-verdict">
        {verdict}
      </div>
      {stale && !manual && (
        <p className="stalenote" data-testid="report-stale">
          Inputs changed after this result. Press Optimize to update it.
        </p>
      )}
      <p className="muted">{manual ? 'Manual arrangement (as currently placed in the 3D view).' : 'Automatic arrangement from Optimize.'}</p>

      <h3>Box</h3>
      <dl className="rdl">
        <dt>Interior size</dt>
        <dd data-testid="report-box">
          {formatDim(r.box.l, unit)} × {formatDim(r.box.w, unit)} × {formatDim(r.box.h, unit)} {unit}
        </dd>
        <dt>Interior volume</dt>
        <dd data-testid="report-box-volume">
          {formatVolume(r.boxVolumeMm3, unit)} {vol}
        </dd>
      </dl>

      <h3>Pieces by product</h3>
      <div className="tablewrap">
        <table className="rtable">
          <thead>
            <tr>
              <th>Product</th>
              <th>Requested</th>
              <th>Placed</th>
              <th>Not placed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} data-testid={`report-row-${x.id}`}>
                <td>
                  <span className="swatch" style={{ background: x.color }} /> <b>{x.name}</b>
                  <div className="sub">
                    {x.size} · {x.weightEach} each · {formatVolume(x.volumeMm3, unit)} {vol} placed
                  </div>
                </td>
                <td>{x.requested === null ? 'as many as fit' : n(x.requested)}</td>
                <td data-testid="report-placed">{n(x.placed)}</td>
                <td className={x.out ? 'bad' : undefined}>{x.out === null ? '–' : n(x.out)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td data-testid="report-requested">{n(requested)}</td>
              <td data-testid="report-placed-total">{n(r.placedCount)}</td>
              <td data-testid="report-out-total" className={r.unplacedCount > 0 ? 'bad' : undefined}>
                {n(r.unplacedCount)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h3>Volume</h3>
      <dl className="rdl">
        <dt>Used</dt>
        <dd data-testid="report-used">
          {formatVolume(r.usedVolumeMm3, unit)} {vol} ({r.usedPct.toFixed(1)}%)
        </dd>
        <dt>Free</dt>
        <dd data-testid="report-free">
          {formatVolume(r.freeVolumeMm3, unit)} {vol}
        </dd>
      </dl>

      <h3>Weight</h3>
      <dl className="rdl">
        <dt>Products</dt>
        <dd data-testid="report-w-products">{wt(w.productG)}</dd>
        <dt>Empty box</dt>
        <dd>{wt(w.emptyG)}</dd>
        <dt>Gross</dt>
        <dd data-testid="report-w-gross">{wt(w.grossG)}</dd>
        <dt>Maximum</dt>
        <dd data-testid="report-w-max">{w.maxG === null ? 'no limit' : wt(w.maxG)}</dd>
        {w.remainingG !== null && (
          <>
            <dt>Capacity left</dt>
            <dd data-testid="report-w-left">{wt(w.remainingG)}</dd>
          </>
        )}
      </dl>
      {w.overLimit && (
        <p className="wwarn over" role="alert">
          Over the weight limit by {wt(w.overByG)}.
        </p>
      )}
      {!w.overLimit && heldBack > 0 && !manual && (
        <p className="wwarn" data-testid="report-held">
          {n(heldBack)} more {heldBack === 1 ? 'unit fits' : 'units fit'} in the box but would exceed the weight limit.
        </p>
      )}

      <h3>Notes</h3>
      <ul className="rnotes">
        {effortNotes.map((x) => (
          <li key={x}>{x}</li>
        ))}
        <li>The arrangement comes from a heuristic search. It is a good result, not a proof that no better one exists.</li>
        {r.unplacedCount > 0 && <li>When not everything fits, the search prefers more pieces placed, then more volume.</li>}
      </ul>
    </article>
  )
}
