import { dimsToFields, editField, switchFields, validateFields, type DimsFields } from './fields'
import type { OptimizeOptions, OptimizeProgress, PackItem } from './optimizer'
import { volume, type Dims } from './pack'
import type { Unit } from './units'
import { WEIGHT_EPS_G, type WeightSpec } from './weight'
import { optimizeWeighted, type WeightedResult } from './weighted'

/**
 * Shipping-box catalog and box recommendation. Pure functions, no UI.
 *
 * A catalog entry is an INTERIOR size (mm). The recommendation tries the entries by ascending interior volume and
 * returns the first one in which the existing optimizer (`optimizeWeighted`) finds a complete arrangement of the
 * whole order within the configured weight limits. Nothing about the optimizer or its rules is changed here:
 *
 *  - "Complete" means every requested unit is placed (`unplacedCount === 0`). A partial arrangement never
 *    qualifies, and the optimizer's own treatment of partial orders is untouched.
 *  - The optimizer is a heuristic. "No box found" means this search found no complete arrangement. It is not a
 *    proof that none exists, and a larger box outside the catalog, or another arrangement, may still work.
 *  - The same weight settings apply to every box (the weight panel has one empty-box weight and one maximum).
 *
 * Ties in volume keep the catalog order. Entries with identical dimensions are tried once.
 */

export const MAX_CATALOG = 12

/** Typical interior sizes (mm), shown as removable examples until the user edits the list. */
export const EXAMPLE_BOXES: Dims[] = [
  { l: 300, w: 200, h: 150 },
  { l: 400, w: 300, h: 200 },
  { l: 600, w: 400, h: 300 },
  { l: 600, w: 400, h: 400 },
]

export interface CatalogBox {
  id: string
  /** Interior size in mm. */
  dims: Dims
}

// ---- Rows as the user edits them (same field model as the container) ------------------------------

export interface CatalogRow {
  id: string
  dims: DimsFields
}

let seq = 0

export function newCatalogRow(dims: Dims, unit: Unit): CatalogRow {
  return { id: `c${++seq}`, dims: dimsToFields(dims, unit) }
}

export function editCatalogRow(r: CatalogRow, key: keyof Dims, text: string, unit: Unit): CatalogRow {
  return { ...r, dims: { ...r.dims, [key]: editField(text, unit) } }
}

/** Re-renders the text in another unit; the stored mm do not change, so nothing drifts. */
export function switchCatalogRow(r: CatalogRow, unit: Unit): CatalogRow {
  return { ...r, dims: switchFields(r.dims, unit) }
}

/** Boxes ready for the recommendation, or the keys of invalid fields ("<id>.l"). */
export function validateCatalog(rows: CatalogRow[]): { boxes: CatalogBox[] } | { invalid: string[] } {
  const invalid: string[] = []
  const boxes: CatalogBox[] = []
  for (const r of rows) {
    const v = validateFields(r.dims)
    if ('invalid' in v) v.invalid.forEach((k) => invalid.push(`${r.id}.${k}`))
    else boxes.push({ id: r.id, dims: v.dims })
  }
  return invalid.length > 0 ? { invalid } : { boxes }
}

const dimsKey = (d: Dims): string => `${d.l}|${d.w}|${d.h}`

/** Ascending interior volume. Equal volumes keep their catalog order; identical sizes appear once. */
export function sortByVolume(boxes: CatalogBox[]): CatalogBox[] {
  const seen = new Set<string>()
  const unique = boxes.filter((b) => {
    const k = dimsKey(b.dims)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return unique
    .map((b, i) => ({ b, i, v: volume(b.dims) }))
    .sort((a, c) => a.v - c.v || a.i - c.i)
    .map((x) => x.b)
}

// ---- Recommendation --------------------------------------------------------------------------------

/** What happened when one catalog box was tried. */
export type TrialOutcome =
  /** The whole order was placed. */
  | 'fits'
  /** The search placed only part of the order. */
  | 'partial'
  /** The order's total volume is larger than the box interior, so it was not searched (exact arithmetic). */
  | 'too-small'

export interface BoxTrial {
  boxId: string
  dims: Dims
  volumeMm3: number
  outcome: TrialOutcome
  placed: number
  requested: number
  /** Units that fit in space but were held back by the weight limit (0 when the limit is not binding). */
  heldBackByWeight: number
  /** True when the optimizer reported that its search was reduced (large order or work limit). */
  reducedEffort: boolean
}

export type RecommendationStatus =
  | 'found'
  /** No catalog box held the whole order in this search (not a proof that none can). */
  | 'not-found'
  /** At least one type has a blank quantity ("as many as fit"): explicit quantities are required first. */
  | 'needs-quantities'
  | 'empty-catalog'
  /** The optimizer rejected the order (for example too many items). `message` says why. */
  | 'invalid-order'
  /** The order alone weighs more than the maximum gross weight allows, whatever the box. */
  | 'over-weight'

export interface Recommendation {
  status: RecommendationStatus
  /** The recommended catalog box (status 'found'). */
  box: CatalogBox | null
  /** The optimizer's result in that box, ready to show (status 'found'). */
  result: WeightedResult | null
  /** Boxes tried, in the order tried, up to and including the recommended one. */
  trials: BoxTrial[]
  /** Types without a quantity (status 'needs-quantities'). */
  needsQuantities: string[]
  orderUnits: number
  orderVolumeMm3: number
  orderWeightG: number
  /** Short explanation for invalid-order, otherwise empty. */
  message: string
}

const empty = (status: RecommendationStatus, over: Partial<Recommendation> = {}): Recommendation => ({
  status,
  box: null,
  result: null,
  trials: [],
  needsQuantities: [],
  orderUnits: 0,
  orderVolumeMm3: 0,
  orderWeightG: 0,
  message: '',
  ...over,
})

/**
 * Smallest catalog box (by interior volume) in which the optimizer places the whole order within the weight limits.
 * Synchronous, deterministic. Run it in the worker for real orders (see `src/worker/jobs.ts`).
 */
export function recommendBox(
  catalog: CatalogBox[],
  items: PackItem[],
  spec: WeightSpec,
  options: Omit<OptimizeOptions, 'onProgress'> = {},
  onProgress?: (p: OptimizeProgress) => void,
): Recommendation {
  if (catalog.length === 0) return empty('empty-catalog')
  const blank = items.filter((i) => i.qty === null).map((i) => i.id)
  if (blank.length > 0) return empty('needs-quantities', { needsQuantities: blank })
  if (items.length === 0) return empty('invalid-order', { message: 'No items to pack' })

  const orderUnits = items.reduce((s, i) => s + (i.qty ?? 0), 0)
  const orderVolumeMm3 = items.reduce((s, i) => s + (i.qty ?? 0) * volume(i.dims), 0)
  const orderWeightG = items.reduce((s, i) => s + (i.qty ?? 0) * (i.weightKg ?? 0) * 1000, 0)
  const base = { orderUnits, orderVolumeMm3, orderWeightG }

  // The weight limit does not depend on the box: if the order itself is too heavy, no box can take all of it.
  if (spec.maxG !== null && spec.emptyG + orderWeightG > spec.maxG + WEIGHT_EPS_G) return empty('over-weight', base)

  const sorted = sortByVolume(catalog)
  const trials: BoxTrial[] = []
  for (let k = 0; k < sorted.length; k++) {
    const box = sorted[k]
    const v = volume(box.dims)
    const step = (p: OptimizeProgress): void => onProgress?.({ phase: `Box ${k + 1} of ${sorted.length}: ${p.phase}`, step: k + 1, steps: sorted.length })
    step({ phase: 'checking', step: 1, steps: 1 })
    const trial = { boxId: box.id, dims: box.dims, volumeMm3: v, requested: orderUnits }
    if (orderVolumeMm3 > v + 1e-6) {
      trials.push({ ...trial, outcome: 'too-small', placed: 0, heldBackByWeight: 0, reducedEffort: false })
      continue
    }
    const r = optimizeWeighted(box.dims, items, spec, { ...options, onProgress: step })
    if (r.status === 'rejected') return empty('invalid-order', { ...base, trials, message: r.warnings[0] ?? 'The order cannot be optimized' })
    const fits = r.layout.unplacedCount === 0 && r.status === 'complete' && !r.weight.overLimit
    trials.push({
      ...trial,
      outcome: fits ? 'fits' : 'partial',
      placed: r.layout.placedCount,
      heldBackByWeight: r.heldBackByWeight,
      reducedEffort: r.stats.effort.reduced,
    })
    if (fits) return empty('found', { ...base, box, result: r, trials })
  }
  return empty('not-found', { ...base, trials })
}
