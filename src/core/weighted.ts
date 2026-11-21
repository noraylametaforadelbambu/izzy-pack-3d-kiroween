import { layoutFromPlacements, type Placement } from './layout'
import { optimize, type OptimizeOptions, type OptimizeResult, type PackItem } from './optimizer'
import { volume, type Dims } from './pack'
import { WEIGHT_EPS_G, weightOf, type WeightSpec, type WeightSummary } from './weight'
import type { Layout } from './layout'

/**
 * Weight-aware packing: space and the maximum gross weight are decided together.
 *
 * Payload = max gross weight - empty box weight. The spatial optimizer (optimizer.ts) is not changed. Weight
 * enters the search as the choice of WHICH units compete for space:
 *
 *   1. Run the spatial optimizer unconstrained. If its arrangement is within the payload, it is the answer.
 *   2. Otherwise weight is binding. Pick units under the payload by two orders:
 *        - lightest first (maximizes the number of units under a pure weight limit),
 *        - the order the types were entered (keeps the requested mix).
 *      Pack each selection spatially. If some units did not fit in space, the weight they would have used
 *      is handed to more units of the types that were fully placed, and the selection is packed again
 *      (at most MAX_ROUNDS times).
 *   3. The candidate with the most placed units wins (ties: most placed volume). Its weight is checked
 *      against the payload, and the topmost boxes are dropped if it were ever above it.
 *
 * Items without a weight count as 0 g (no weight limit from them). Everything is deterministic.
 * A heuristic: nothing here is proven optimal.
 *
 * Multi-box orders (future): `remainingItems()` returns what was not placed, so a caller can pack the
 * rest into the next box with the same function.
 */

const MAX_ROUNDS = 3

export interface WeightedResult extends OptimizeResult {
  weight: WeightSummary
  /** True when the weight limit forced fewer units than fit in space. */
  weightLimited: boolean
  /** Units that fit in space but were held back by the weight limit. */
  heldBackByWeight: number
}

const unitG = (i: PackItem): number => (i.weightKg ?? 0) * 1000

function unitMap(items: PackItem[]): Map<string, number> {
  return new Map(items.map((i) => [i.id, unitG(i)]))
}

function extentOf(ps: Placement[]): Dims {
  let l = 0, w = 0, h = 0
  for (const p of ps) {
    l = Math.max(l, p.x + p.size.l)
    w = Math.max(w, p.y + p.size.w)
    h = Math.max(h, p.z + p.size.h)
  }
  return { l, w, h }
}

/** Same result shape as the optimizer, rebuilt from a (possibly reduced) list of placements. */
function rebuild(base: OptimizeResult, box: Dims, items: PackItem[], placements: Placement[], strategy: OptimizeResult['strategy'], warnings: string[]): OptimizeResult {
  const layout: Layout = layoutFromPlacements(box, items, placements)
  const g = unitMap(items)
  const status = base.status === 'rejected' ? 'rejected' : layout.placedCount === 0 ? 'none' : layout.unplacedCount === 0 ? 'complete' : 'partial'
  return {
    ...base,
    status,
    layout,
    strategy: placements.length === 0 ? null : strategy,
    totalWeightKg: placements.reduce((s, p) => s + (g.get(p.typeId) ?? 0), 0) / 1000,
    extent: extentOf(placements),
    warnings,
  }
}

/**
 * Rank of an arrangement: pieces of the ORIGINAL explicit-quantity types first (inside a weight search the optimizer sees
 * every selected count as explicit, so the original order is what tells which types are "as many as fit"), then all pieces,
 * then placed volume.
 */
const rankOf = (r: OptimizeResult, explicitIds: ReadonlySet<string>): [number, number, number] => [
  r.layout.types.reduce((n, t) => (explicitIds.has(t.typeId) ? n + t.placed : n), 0),
  r.layout.placedCount,
  r.layout.usedVolumeMm3,
]
const better = (a: OptimizeResult, b: OptimizeResult | null, explicitIds: ReadonlySet<string>): boolean => {
  if (!b) return true
  const x = rankOf(a, explicitIds)
  const y = rankOf(b, explicitIds)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

/** Greedy selection of unit counts under `payloadG`, following `order`. `cap` limits each type. */
function select(order: PackItem[], cap: Map<string, number>, payloadG: number): Map<string, number> {
  const counts = new Map<string, number>()
  let left = payloadG
  for (const it of order) {
    const c = cap.get(it.id) ?? 0
    const w = unitG(it)
    const k = w <= 0 ? c : Math.min(c, Math.floor((left + WEIGHT_EPS_G) / w))
    counts.set(it.id, k)
    left -= k * w
  }
  return counts
}

export function optimizeWeighted(box: Dims, items: PackItem[], spec: WeightSpec, options: OptimizeOptions = {}): WeightedResult {
  const g = unitMap(items)
  const payload = spec.maxG === null ? Infinity : spec.maxG - spec.emptyG
  const wrap = (r: OptimizeResult, limited: boolean, held: number): WeightedResult => ({
    ...r,
    weight: weightOf(r.layout.placements, g, spec),
    weightLimited: limited,
    heldBackByWeight: held,
  })

  const progress = options.onProgress
  const base = optimize(box, items, options)
  if (base.status === 'rejected') return wrap(base, false, 0)
  const baseWeight = weightOf(base.layout.placements, g, { emptyG: 0, maxG: null }).productG
  if (baseWeight <= payload + WEIGHT_EPS_G) return wrap(base, false, 0)

  // Weight is binding.
  if (payload <= 0) {
    const none = rebuild(base, box, items, [], null, [...base.warnings, 'The maximum weight is not above the empty box weight'])
    return wrap(none, true, base.layout.placedCount)
  }

  // Upper bound per type: its requested quantity, or what fit in space for "as many as fit" types.
  const placedBase = new Map(base.layout.types.map((t) => [t.typeId, t.placed]))
  const cap = new Map(items.map((i) => [i.id, i.qty ?? placedBase.get(i.id) ?? 0]))

  const explicitIds = new Set(items.filter((i) => i.qty !== null).map((i) => i.id))
  const lightest = [...items].sort((a, b) => unitG(a) - unitG(b) || volume(a.dims) - volume(b.dims))
  const orders = [lightest, items]
  const seen = new Set<string>()
  let best: OptimizeResult | null = null
  const totalSteps = orders.length * MAX_ROUNDS
  let step = 0
  const runOptions: OptimizeOptions = {
    ...options,
    maxPasses: Math.min(options.maxPasses ?? 16, 6),
    onProgress: progress && ((p) => progress({ phase: `Weight limit: ${p.phase.toLowerCase()}`, step: Math.min(step, totalSteps), steps: totalSteps })),
  }

  const pack = (counts: Map<string, number>): OptimizeResult | null => {
    const chosen = items.filter((i) => (counts.get(i.id) ?? 0) > 0).map((i) => ({ ...i, qty: counts.get(i.id)! }))
    step++
    return chosen.length === 0 ? null : optimize(box, chosen, runOptions)
  }

  for (const order of orders) {
    let counts = select(order, cap, payload)
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const sig = items.map((i) => counts.get(i.id) ?? 0).join(',')
      if (seen.has(sig)) break
      seen.add(sig)
      const r = pack(counts)
      if (!r) break
      if (better(r, best, explicitIds)) best = r
      // Hand the weight of units that did not fit in space to more units of fully placed types.
      const placed = new Map(r.layout.types.map((t) => [t.typeId, t.placed]))
      const placedG = r.layout.placements.reduce((s, p) => s + (g.get(p.typeId) ?? 0), 0)
      const next = new Map<string, number>()
      const room = new Map<string, number>()
      for (const it of items) {
        const p = placed.get(it.id) ?? 0
        next.set(it.id, p)
        if (p === (counts.get(it.id) ?? 0)) room.set(it.id, Math.max(0, (cap.get(it.id) ?? 0) - p))
      }
      const extra = select(
        order.filter((it) => (room.get(it.id) ?? 0) > 0),
        room,
        payload - placedG,
      )
      let added = 0
      for (const [id, k] of extra) {
        next.set(id, (next.get(id) ?? 0) + k)
        added += k
      }
      if (added === 0) break
      counts = next
    }
  }

  let placements = best?.layout.placements ?? []
  // Safety net: never return more than the payload. Drop the topmost boxes first (keeps support valid).
  let weightG = placements.reduce((s, p) => s + (g.get(p.typeId) ?? 0), 0)
  if (weightG > payload + WEIGHT_EPS_G) {
    placements = [...placements].sort((a, b) => a.z + a.size.h - (b.z + b.size.h) || a.x - b.x)
    while (placements.length > 0 && weightG > payload + WEIGHT_EPS_G) {
      const top = placements.pop()!
      weightG -= g.get(top.typeId) ?? 0
    }
  }

  const held = Math.max(0, base.layout.placedCount - placements.length)
  const warnings = [...base.warnings]
  if (held > 0) warnings.push(`Weight limit reached: ${held} unit${held === 1 ? '' : 's'} that fit in the box were held back`)
  const result = rebuild(base, box, items, placements, best?.strategy ?? null, warnings)
  return wrap(result, true, held)
}

/** What is still to be packed after `layout`: fixed quantities reduced by what was placed. Basis for multi-box orders. */
export function remainingItems(items: PackItem[], layout: Layout): PackItem[] {
  const placed = new Map(layout.types.map((t) => [t.typeId, t.placed]))
  const out: PackItem[] = []
  for (const it of items) {
    if (it.qty === null) continue // "as many as fit" is satisfied by whatever was placed
    const left = it.qty - (placed.get(it.id) ?? 0)
    if (left > 0) out.push({ ...it, qty: left })
  }
  return out
}
