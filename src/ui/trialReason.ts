import type { BoxTrial } from '../core/catalog'
import { formatVolume, volumeUnitLabel, type Unit } from '../core/units'

const n = (v: number): string => v.toLocaleString('en-US')

/**
 * One short sentence saying what happened to a catalog box in the recommendation search, taken only from the
 * trial the search already recorded (nothing is recomputed). Volumes are shown in the active unit.
 *
 *  - 'too-small': the order's total volume is larger than the box interior, so the box was not searched. This is
 *    exact arithmetic, not a heuristic result.
 *  - 'partial': the search placed only part of the order. Because the search is a heuristic, this says "in this
 *    search" and never claims that the order cannot fit.
 */
export function trialReason(t: BoxTrial, orderVolumeMm3: number, unit: Unit): string {
  const vol = (mm3: number): string => `${formatVolume(mm3, unit)} ${volumeUnitLabel(unit)}`
  if (t.outcome === 'too-small') return `not searched: its volume (${vol(t.volumeMm3)}) is below the order's (${vol(orderVolumeMm3)})`
  if (t.outcome === 'fits') return `fits all ${n(t.requested)}`
  const parts = [`placed ${n(t.placed)} of ${n(t.requested)} in this search`]
  if (t.heldBackByWeight > 0) parts.push(`${n(t.heldBackByWeight)} more fit in space but not under the weight limit`)
  if (t.reducedEffort) parts.push('search reduced')
  return parts.join('; ')
}
