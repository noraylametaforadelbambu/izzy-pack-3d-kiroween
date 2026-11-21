import type { Layout } from '../core/layout'
import { formatDim, formatVolume, volumeUnitLabel, type Unit } from '../core/units'
import { formatWeight, type WeightSummary, type WeightUnit } from '../core/weight'
import { MAX_RENDERED } from '../viewer/PackViewer'

interface Props {
  layout: Layout
  unit: Unit
  stale: boolean
  /** Orientation is only meaningful for the automatic layout of a single type. */
  showOrientation: boolean
  weight: WeightSummary
  weightUnit: WeightUnit
  /** Units that fit in space but were held back by the weight limit (automatic mode). */
  heldBack: number
  /** Why the search effort was reduced (large orders, work limits). Empty when the full search ran. */
  effortNotes: string[]
}

export function Results({ layout: r, unit, stale, showOrientation, weight: w, weightUnit: wu, heldBack, effortNotes }: Props) {
  // Shown only when every box of the single type has the same orientation (mixed layouts have none).
  const first = r.placements[0]?.size
  const uniform = first !== undefined && r.placements.every((p) => p.size.l === first.l && p.size.w === first.w && p.size.h === first.h)
  const single = showOrientation && r.types.length === 1 && uniform ? first : null
  const vol = volumeUnitLabel(unit)
  return (
    <div className={stale ? 'results stale' : 'results'} aria-live="polite" data-testid="results">
      <div className="metric big">
        <b data-testid="count">{r.placedCount.toLocaleString('en-US')}</b>
        <span>
          placed of <i data-testid="total">{r.totalCount.toLocaleString('en-US')}</i>
        </span>
      </div>
      <div className={r.unplacedCount > 0 ? 'metric warn' : 'metric'}>
        <b data-testid="unplaced">{r.unplacedCount.toLocaleString('en-US')}</b>
        <span>unplaced</span>
      </div>
      <div className="metric">
        <b data-testid="usedvol">
          {formatVolume(r.usedVolumeMm3, unit)} {vol}
        </b>
        <span>used</span>
      </div>
      <div className="metric">
        <b data-testid="used">{r.usedPct.toFixed(1)}%</b>
        <span>efficiency</span>
      </div>
      <div className="metric">
        <b data-testid="free">
          {formatVolume(r.freeVolumeMm3, unit)} {vol}
        </b>
        <span>free</span>
      </div>
      {single && (
        <div className="metric">
          <b data-testid="orientation">
            {formatDim(single.l, unit)} × {formatDim(single.w, unit)} × {formatDim(single.h, unit)} {unit}
          </b>
          <span>orientation</span>
        </div>
      )}
      {(w.productG > 0 || w.emptyG > 0 || w.maxG !== null) && (
        <div className="wblock" data-testid="weight">
          <div className="metric">
            <b data-testid="w-product">{formatWeight(w.productG, wu)}</b>
            <span>products</span>
          </div>
          <div className="metric">
            <b data-testid="w-gross">
              {formatWeight(w.grossG, wu)}
              {w.maxG !== null && <> / {formatWeight(w.maxG, wu)}</>}
            </b>
            <span>gross{w.emptyG > 0 ? ` (box ${formatWeight(w.emptyG, wu)})` : ''}</span>
          </div>
          {w.remainingG !== null && (
            <div className="metric">
              <b data-testid="w-left">{formatWeight(w.remainingG, wu)}</b>
              <span>capacity left</span>
            </div>
          )}
          {w.ratio !== null && (
            <div className="wbar" role="progressbar" aria-label="Weight used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.ratio * 100)}>
              <i className={w.overLimit ? 'over' : w.ratio >= 0.85 ? 'high' : undefined} style={{ width: `${Math.min(100, w.ratio * 100)}%` }} />
            </div>
          )}
          {w.overLimit && (
            <p className="wwarn over" role="alert" data-testid="w-warning">
              Over the weight limit by {formatWeight(w.overByG, wu)}
            </p>
          )}
          {!w.overLimit && heldBack > 0 && (
            <p className="wwarn" data-testid="w-warning">
              {heldBack.toLocaleString('en-US')} more {heldBack === 1 ? 'unit fits' : 'units fit'} in the box but would exceed the weight limit
            </p>
          )}
        </div>
      )}
      {effortNotes.length > 0 && (
        <div className="effort" data-testid="effort">
          <b>Reduced search effort</b>
          {effortNotes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}
      {r.placedCount > MAX_RENDERED && (
        <p className="note">Showing first {MAX_RENDERED.toLocaleString('en-US')}</p>
      )}
    </div>
  )
}
