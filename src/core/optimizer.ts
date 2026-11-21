import { layoutFromPlacements, newPlacementId, type BoxType, type Layout, type Placement } from './layout'
import { checkPlacement, EPS, MIN_SUPPORT } from './manual'
import { orientations, volume, type Dims } from './pack'

/**
 * Automatic packing optimizer (Phase 3, core only: no UI, no Three.js).
 *
 * Coordinates and rules are the ones of manual.ts / layout.ts:
 *   x = container length, y = width, z = height (up), millimetres, origin at the minimum corner.
 *   No overlaps, inside the container, and every box above the floor needs `minSupport` (70%) of its
 *   footprint resting on top faces at its bottom height.
 *
 * Strategies (each produces a candidate; every candidate is verified before it can win):
 *   1. layer-dp-slabs  Types are laid out as slabs along the container length. Inside a slab the best
 *                      "layered" pattern is found by exhaustive search over layer counts (see layerPlan).
 *                      Linear time, scales to tens of thousands of items. Tried for 3 type orders.
 *   2. grid-slabs      Same slabs, but one orientation and one regular grid per type. Valid by construction;
 *                      only used if (1) fails verification.
 *   3. extreme-points  Item-by-item constructive heuristic with seeded multi-start. Handles mixed sizes
 *                      that share layers. Full detail up to `epLimit` items; above it only the largest
 *                      `epLimit` items are searched one by one (reported in `stats.effort`).
 *   4. block-extreme-points  Identical items are first grouped into regular blocks (a x b x c grids), then the
 *                      same extreme-point search places the blocks and the leftover single items. Far fewer
 *                      pieces to place, so it scales to large orders; the blocks are expanded back to single
 *                      items and every candidate is verified like the others.
 *
 * CHOICE AMONG CANDIDATES: (1) most pieces of the types with an explicit quantity, (2) most placed volume (this also
 * covers the "as many as fit" types, which can never take priority over explicit quantities), (3) smallest bounding box.
 * When every requested quantity fits, (1) is equal for all candidates and the choice is by volume, as before.
 *
 * NOTHING HERE IS PROVEN OPTIMAL. The result is the best candidate found. `OptimizeResult.bounds` reports
 * the only certificates available: a volume bound (a lower bound on what cannot fit, an upper bound on
 * what could).
 */

// ---- Public types --------------------------------------------------------------------------------

/** A product type to pack. Extends BoxType, so `layoutFromPlacements`, the viewer and manual mode work unchanged. */
export interface PackItem extends BoxType {
  /** Weight of one unit in kilograms. Optional. Used for the total and as one item order in the search; there is no stacking-weight rule yet. */
  weightKg?: number
  /** "This side up": keeps the item's own height vertical (it may still turn around the vertical axis). */
  upright?: boolean
}

export interface OptimizeOptions {
  /** Seed for the randomized passes. Same inputs and seed give the same result. Default 1. */
  seed?: number
  /** Share of a footprint that must rest on boxes below. Default MIN_SUPPORT (0.7). */
  minSupport?: number
  /** Maximum extreme-point passes. Default 16. */
  maxPasses?: number
  /** Work budget for extreme points, in placement probes (deterministic, unlike wall-clock time). Default 800,000. */
  maxQueries?: number
  /** Item-by-item extreme points run in full detail (many passes) up to this many items. Larger orders are grouped
   *  into blocks instead (see PIECE_LIMIT). 0 turns every extreme-point search off. Default 250. */
  epLimit?: number
  /** Hard cap on placement probes inside ONE extreme-point pass (each pass gets the full amount). Default 1,200,000. */
  passQueryCap?: number
  /** Called between search steps with what is running. Never changes the result. */
  onProgress?: (p: OptimizeProgress) => void
  /** Cap for types with quantity null ("as many as fit"). Default 20,000 (what the viewer renders). */
  fillCap?: number
  /** Reject orders whose requested quantities add up to more than this. Default 100,000. */
  maxItems?: number
}

/** What the optimizer is doing now. `step` of `steps` is an upper bound for the current phase, not a promise. */
export interface OptimizeProgress {
  phase: string
  step: number
  steps: number
}

export type StrategyName = 'layer-dp-slabs' | 'grid-slabs' | 'extreme-points' | 'block-extreme-points'

export type OptimizeStatus =
  /** Every requested quantity was placed ("as many as fit" types count as satisfied). */
  | 'complete'
  /** Something was placed, something requested was not. */
  | 'partial'
  /** Nothing was placed. */
  | 'none'
  /** The input was invalid; see `warnings`. Layout is empty. */
  | 'rejected'

export interface CandidateInfo {
  strategy: StrategyName
  placedCount: number
  usedVolumeMm3: number
  /** Boxes dropped by the support repair (layered patterns can leave a border box under-supported). */
  removed: number
  valid: boolean
}

export interface OptimizeResult {
  status: OptimizeStatus
  /** Same Layout type as packTypes(): the viewer and manual mode can consume it directly. */
  layout: Layout
  /** Strategy of the chosen candidate, or null when nothing was placed / rejected. */
  strategy: StrategyName | null
  totalWeightKg: number
  /** Bounding box of everything placed (mm). Useful to choose a smaller container later. */
  extent: Dims
  bounds: {
    containerVolumeMm3: number
    /** Volume of all fixed-quantity items. */
    requestedVolumeMm3: number
    /** True when requested volume exceeds the container: proves that not everything can fit. */
    exceedsContainer: boolean
  }
  warnings: string[]
  stats: {
    candidates: CandidateInfo[]
    passes: number
    queries: number
    /** 'full' = also checked with manual.ts checkPlacement; 'indexed' = indexed verifier only (large orders). */
    verified: 'full' | 'indexed' | 'none'
    /** Block extreme-point passes run (identical items grouped into blocks). */
    blockPasses: number
    /** True when the search was cut short by size or work limits. `notes` say what was skipped. */
    effort: { reduced: boolean; notes: string[] }
  }
}

// ---- Constants -----------------------------------------------------------------------------------

const DEFAULTS = {
  seed: 1,
  minSupport: MIN_SUPPORT,
  maxPasses: 16,
  maxQueries: 800_000,
  epLimit: 250,
  passQueryCap: 1_200_000,
  fillCap: 20_000,
  maxItems: 100_000,
}
/** Above this many boxes the O(n²) checkPlacement pass is skipped and only the indexed verifier runs. */
const FULL_VERIFY_MAX = 1500
const COMBO_BUDGET = 300_000

// ---- Small helpers -------------------------------------------------------------------------------

/** Internal box: type index plus position and size (mm). */
interface Box {
  t: number
  x: number
  y: number
  z: number
  l: number
  w: number
  h: number
}

interface Spec {
  index: number
  item: PackItem
  qty: number | null
  /** Quantity to place: the request, or the capped fill target. */
  want: number
  weight: number
  orients: Dims[]
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6
const fl = (a: number, b: number): number => Math.floor(a / b + 1e-9)
const pos = (n: number): boolean => Number.isFinite(n) && n > 0
const span = (a0: number, a1: number, b0: number, b1: number): number => Math.min(a1, b1) - Math.max(a0, b0)

function itemOrientations(item: PackItem): Dims[] {
  const seen = new Set<string>()
  const out: Dims[] = []
  for (const s of orientations(item.dims)) {
    if (item.upright && Math.abs(s.h - item.dims.h) > EPS) continue
    const key = `${s.l}|${s.w}|${s.h}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

/** Mulberry32: tiny deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- Spatial index (footprint buckets) -----------------------------------------------------------

/**
 * Uniform 2D bucket grid over the container footprint. A footprint query only looks at the boxes in the
 * buckets it touches, so a probe costs about the stack height instead of the number of boxes placed.
 */
class Grid {
  boxes: Box[] = []
  private cells: number[][]
  private nx: number
  private ny: number
  private mark: Uint32Array
  private tick = 0
  private hits: number[] = []

  private cs: number

  constructor(L: number, W: number, cs: number, capacity: number) {
    this.cs = cs
    this.nx = Math.max(1, Math.ceil(L / cs))
    this.ny = Math.max(1, Math.ceil(W / cs))
    this.cells = Array.from({ length: this.nx * this.ny }, () => [])
    this.mark = new Uint32Array(capacity + 1)
  }

  private cx(v: number, n: number): number {
    return Math.min(n - 1, Math.max(0, Math.floor(v / this.cs)))
  }

  add(b: Box): void {
    const i = this.boxes.length
    this.boxes.push(b)
    const x0 = this.cx(b.x + EPS, this.nx)
    const x1 = this.cx(b.x + b.l - EPS, this.nx)
    const y0 = this.cx(b.y + EPS, this.ny)
    const y1 = this.cx(b.y + b.w - EPS, this.ny)
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) this.cells[ix * this.ny + iy].push(i)
  }

  /** Indices of boxes whose footprint overlaps the rectangle with positive area. Valid until the next call. */
  query(x: number, y: number, l: number, w: number): number[] {
    this.hits.length = 0
    this.tick++
    const x0 = this.cx(x + EPS, this.nx)
    const x1 = this.cx(x + l - EPS, this.nx)
    const y0 = this.cx(y + EPS, this.ny)
    const y1 = this.cx(y + w - EPS, this.ny)
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (const i of this.cells[ix * this.ny + iy]) {
          if (this.mark[i] === this.tick) continue
          this.mark[i] = this.tick
          const b = this.boxes[i]
          if (span(x, x + l, b.x, b.x + b.l) > EPS && span(y, y + w, b.y, b.y + b.w) > EPS) this.hits.push(i)
        }
      }
    }
    return this.hits
  }

  /**
   * Height at which a footprint would rest (the highest top face under it), or -1 when it does not fit
   * below `H` or is not supported enough. Overlap is impossible by construction at that height.
   */
  drop(x: number, y: number, l: number, w: number, h: number, H: number, minSupport: number): number {
    const hits = this.query(x, y, l, w)
    let z = 0
    for (const i of hits) {
      const b = this.boxes[i]
      const top = b.z + b.h
      if (top > z) z = top
    }
    if (z + h > H + EPS) return -1
    if (z > EPS) {
      let area = 0
      for (const i of hits) {
        const b = this.boxes[i]
        if (Math.abs(b.z + b.h - z) <= EPS) {
          area += span(x, x + l, b.x, b.x + b.l) * span(y, y + w, b.y, b.y + b.w)
        }
      }
      if (area / (l * w) < minSupport - 1e-9) return -1
    }
    return round6(z)
  }
}

function cellSize(L: number, W: number, minSide: number): number {
  return Math.max(minSide, Math.max(L, W) / 48)
}

// ---- Verification --------------------------------------------------------------------------------

/**
 * Indexed re-implementation of the manual.ts rules (inside container, no overlap, support) in about
 * O(n log n). It is cross-checked against `checkPlacement` in the tests, and used alone only for
 * orders too big for the O(n²) reference check.
 */
function verifyIndexed(box: Dims, boxes: Box[], minSupport: number): boolean {
  if (boxes.length === 0) return true
  let minSide = Infinity
  for (const b of boxes) minSide = Math.min(minSide, b.l, b.w)
  const g = new Grid(box.l, box.w, cellSize(box.l, box.w, minSide), boxes.length)
  for (const b of boxes) {
    if (b.x < -EPS || b.y < -EPS || b.z < -EPS) return false
    if (b.x + b.l > box.l + EPS || b.y + b.w > box.w + EPS || b.z + b.h > box.h + EPS) return false
    g.add(b)
  }
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    let area = 0
    for (const j of g.query(b.x, b.y, b.l, b.w)) {
      if (j === i) continue
      const o = boxes[j]
      if (span(b.z, b.z + b.h, o.z, o.z + o.h) > EPS) return false // volumes overlap
      if (Math.abs(o.z + o.h - b.z) <= EPS) area += span(b.x, b.x + b.l, o.x, o.x + o.l) * span(b.y, b.y + b.w, o.y, o.y + o.w)
    }
    if (b.z > EPS && area / (b.l * b.w) < minSupport - 1e-9) return false
  }
  return true
}

/**
 * Layered patterns can leave a box with less support than the rule asks (for example when rows of different
 * footprints meet in the layer below). Dropping such boxes, and any box that then loses its own support,
 * keeps the rest of the pattern instead of discarding all of it. Repeats until stable.
 */
function repairSupport(box: Dims, boxes: Box[], minSupport: number): Box[] {
  let cur = boxes
  for (let round = 0; round < 200 && cur.length > 0; round++) {
    let minSide = Infinity
    for (const b of cur) minSide = Math.min(minSide, b.l, b.w)
    const g = new Grid(box.l, box.w, cellSize(box.l, box.w, minSide), cur.length)
    for (const b of cur) g.add(b)
    const keep: Box[] = []
    cur.forEach((b, i) => {
      if (b.z <= EPS) {
        keep.push(b)
        return
      }
      let area = 0
      for (const j of g.query(b.x, b.y, b.l, b.w)) {
        const o = cur[j]
        if (j !== i && Math.abs(o.z + o.h - b.z) <= EPS) {
          area += span(b.x, b.x + b.l, o.x, o.x + o.l) * span(b.y, b.y + b.w, o.y, o.y + o.w)
        }
      }
      if (area / (b.l * b.w) >= minSupport - 1e-9) keep.push(b)
    })
    if (keep.length === cur.length) return cur
    cur = keep
  }
  return cur
}

function toPlacements(boxes: Box[], specs: Spec[], withIds: boolean): Placement[] {
  return boxes.map((b, i) => ({
    id: withIds ? newPlacementId() : `v${i}`,
    typeId: specs[b.t].item.id,
    color: specs[b.t].item.color,
    x: b.x,
    y: b.y,
    z: b.z,
    size: { l: b.l, w: b.w, h: b.h },
  }))
}

/**
 * Checks any arrangement with the exact reference rules of manual mode (`checkPlacement` for every box,
 * O(n²)). Exported for tests and for validating arrangements that come from elsewhere.
 */
export function verifyPlacements(box: Dims, placements: Placement[]): boolean {
  return placements.every((p) => checkPlacement(box, placements, p).ok)
}

/** The indexed verifier on public types. Same answer as `verifyPlacements`, much faster on big layouts. */
export function verifyPlacementsIndexed(box: Dims, placements: Placement[], minSupport: number = MIN_SUPPORT): boolean {
  const boxes: Box[] = placements.map((p) => ({ t: 0, x: p.x, y: p.y, z: p.z, l: p.size.l, w: p.size.w, h: p.size.h }))
  return verifyIndexed(box, boxes, minSupport)
}

// ---- Layered pattern search ----------------------------------------------------------------------
//
// A "layered" pattern stacks horizontal layers. All items of a layer share one height (one orientation
// class); inside a layer, rows of identical footprints run across the container. For a given container
// the search below enumerates ALL layer counts and ALL row counts of this family, so it is exact WITHIN
// the family (layers of rows). It says nothing about arrangements outside it.

interface Fp {
  l: number
  w: number
}
interface Rect {
  x: number
  y: number
  l: number
  w: number
}
/** `n[i]` rows of footprint `fps[i]`; each row holds floor(L / l) items; rows stack across. `flip` swaps x and y. */
interface Plan2D {
  count: number
  L: number
  fps: Fp[]
  n: number[]
  flip: boolean
}
interface HeightClass {
  h: number
  plan: Plan2D
}
interface Plan3D {
  total: number
  layers: { cls: HeightClass; n: number }[]
}

const swapFp = (f: Fp): Fp => ({ l: f.w, w: f.l })

function rowsBest(L: number, W: number, fps: Fp[]): Omit<Plan2D, 'flip'> {
  const usable = fps.filter((f) => fl(L, f.l) > 0 && fl(W, f.w) > 0)
  if (usable.length === 0) return { count: 0, L, fps: [], n: [] }
  const a = usable[0]
  const ca = fl(L, a.l)
  if (usable.length === 1) {
    const n1 = fl(W, a.w)
    return { count: n1 * ca, L, fps: usable, n: [n1] }
  }
  const b = usable[1]
  const cb = fl(L, b.l)
  let best: Omit<Plan2D, 'flip'> = { count: -1, L, fps: usable, n: [0, 0] }
  for (let n1 = 0, max = fl(W, a.w); n1 <= max; n1++) {
    const n2 = fl(W - n1 * a.w, b.w)
    const count = n1 * ca + n2 * cb
    if (count > best.count) best = { count, L, fps: usable, n: [n1, n2] }
  }
  return best
}

function plan2D(L: number, W: number, fps: Fp[], allowFlip: boolean): Plan2D {
  let best: Plan2D = { ...rowsBest(L, W, fps), flip: false }
  if (allowFlip) {
    const b = rowsBest(W, L, fps.map(swapFp))
    if (b.count > best.count) best = { ...b, flip: true }
  }
  return best
}

function buildRects(p: Plan2D): Rect[] {
  const out: Rect[] = []
  let v = 0
  p.fps.forEach((f, i) => {
    const per = fl(p.L, f.l)
    for (let r = 0; r < p.n[i]; r++) {
      for (let k = 0; k < per; k++) {
        out.push(p.flip ? { x: v, y: k * f.l, l: f.w, w: f.l } : { x: k * f.l, y: v, l: f.l, w: f.w })
      }
      v += f.w
    }
  })
  return out
}

const coveredArea = (p: Plan2D): number =>
  p.fps.reduce((s, f, i) => s + p.n[i] * fl(p.L, f.l) * f.l * f.w, 0)

/** Orientation classes (one per distinct height) with their best 2D plan. `grid` = one orientation, regular grid. */
function heightClasses(L: number, W: number, H: number, orients: Dims[], grid: boolean): HeightClass[] {
  let os = orients
  if (grid) {
    let bestO: Dims | null = null
    let bestC = 0
    for (const o of orients) {
      const c = fl(L, o.l) * fl(W, o.w) * fl(H, o.h)
      if (c > bestC) {
        bestC = c
        bestO = o
      }
    }
    os = bestO ? [bestO] : []
  }
  const byH = new Map<number, Fp[]>()
  for (const o of os) {
    const list = byH.get(round6(o.h)) ?? []
    if (!list.some((f) => f.l === o.l && f.w === o.w)) list.push({ l: o.l, w: o.w })
    byH.set(round6(o.h), list)
  }
  const out: HeightClass[] = []
  for (const [h, fps] of byH) {
    const plan = plan2D(L, W, fps, !grid)
    if (plan.count > 0 && h <= H + EPS) out.push({ h, plan })
  }
  return out
}

/** How many layers of each class maximize the item count: exhaustive, with a work cap and a safe fallback. */
function bestCombo(cs: HeightClass[], H: number): { n: number[]; total: number } {
  const k = cs.length
  let best = { n: new Array<number>(k).fill(0), total: 0 }
  if (k === 0) return best
  let budget = COMBO_BUDGET
  const cur = new Array<number>(k).fill(0)
  const rec = (i: number, rem: number, val: number): void => {
    if (budget-- <= 0) return
    if (i === k - 1) {
      const n = fl(rem, cs[i].h)
      const total = val + n * cs[i].plan.count
      if (total > best.total) best = { n: [...cur.slice(0, i), n], total }
      return
    }
    for (let n = 0, max = fl(rem, cs[i].h); n <= max && budget > 0; n++) {
      cur[i] = n
      rec(i + 1, rem - n * cs[i].h, val + n * cs[i].plan.count)
    }
    cur[i] = 0
  }
  rec(0, H, 0)
  if (budget <= 0) {
    // Too many combinations (tiny items): fall back to the best single class.
    cs.forEach((c, i) => {
      const n = fl(H, c.h)
      if (n * c.plan.count > best.total) {
        best = { n: cs.map((_, j) => (j === i ? n : 0)), total: n * c.plan.count }
      }
    })
  }
  return best
}

function layerPlan(L: number, W: number, H: number, orients: Dims[], grid: boolean): Plan3D {
  const cs = heightClasses(L, W, H, orients, grid)
  const { n, total } = bestCombo(cs, H)
  const layers = cs
    .map((cls, i) => ({ cls, n: n[i] }))
    .filter((x) => x.n > 0)
    // Widest layers first: they are the best base for the layers above (support rule).
    .sort((a, b) => coveredArea(b.cls.plan) - coveredArea(a.cls.plan))
  return { total, layers }
}

/** First `limit` boxes of a plan, bottom layer first, then row by row. */
function buildLayers(plan: Plan3D, t: number, x0: number, limit: number): Box[] {
  const out: Box[] = []
  let z = 0
  for (const { cls, n } of plan.layers) {
    const rects = buildRects(cls.plan)
    for (let r = 0; r < n; r++) {
      for (const q of rects) {
        if (out.length >= limit) return out
        out.push({ t, x: round6(x0 + q.x), y: round6(q.y), z, l: q.l, w: q.w, h: cls.h })
      }
      z = round6(z + cls.h)
    }
  }
  return out
}

interface Ctx {
  box: Dims
  specs: Spec[]
  minSupport: number
  /** Optional support requirement per spec (blocks need more than single items). */
  pieceSupport?: number[]
}

/** Types in sequence along the container length. Each slab is as short as its quantity allows. */
function slabCandidate(ctx: Ctx, order: number[], grid: boolean): Box[] {
  const { box, specs } = ctx
  const boxes: Box[] = []
  let x0 = 0
  for (const t of order) {
    const s = specs[t]
    const rem = box.l - x0
    if (rem <= EPS || s.want === 0) continue
    const count = (len: number): number => layerPlan(len, box.w, box.h, s.orients, grid).total
    if (count(rem) === 0) continue
    let len = rem
    if (count(rem) > s.want) {
      let lo = 0
      let hi = rem
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2
        if (count(mid) >= s.want) hi = mid
        else lo = mid
      }
      len = hi
    }
    const made = buildLayers(layerPlan(len, box.w, box.h, s.orients, grid), t, x0, s.want)
    let ext = x0
    for (const b of made) {
      boxes.push(b)
      ext = Math.max(ext, b.x + b.l)
    }
    x0 = ext
  }
  return boxes
}

/** Type orders to try. Fixed quantities always go before "as many as fit" types, so those cannot starve the rest. */
function typeOrders(specs: Spec[]): number[][] {
  const fixedFirst = (cmp: (a: Spec, b: Spec) => number): number[] => {
    const by = (list: Spec[]): number[] => [...list].sort((a, b) => cmp(a, b) || a.index - b.index).map((s) => s.index)
    return [...by(specs.filter((s) => s.qty !== null)), ...by(specs.filter((s) => s.qty === null))]
  }
  const vol = (s: Spec): number => volume(s.item.dims)
  const longest = (s: Spec): number => Math.max(s.item.dims.l, s.item.dims.w, s.item.dims.h)
  // Smallest first is the count-oriented order: when not everything fits, small types are not starved by big ones.
  const orders = [fixedFirst(() => 0), fixedFirst((a, b) => vol(b) - vol(a)), fixedFirst((a, b) => longest(b) - longest(a)), fixedFirst((a, b) => vol(a) - vol(b))]
  const seen = new Set<string>()
  return orders.filter((o) => {
    const k = o.join(',')
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ---- Extreme points (small mixed orders) ---------------------------------------------------------
//
// Items are placed one by one at the lowest, back-left candidate point (corners of already placed boxes,
// and the point above each box). An item "drops" to the highest surface under its footprint and must pass
// the support rule. Several item orders and orientation preferences are tried; the best pass wins.

type SortKey = 'weight' | 'volume' | 'footprint' | 'longest' | 'smallest'
type Policy = 'flat' | 'tall' | 'lowTop' | 'longX'
const POLICIES: Policy[] = ['flat', 'lowTop', 'tall', 'longX']

interface Work {
  queries: number
  /** Stop placing inside ONE pass once that pass has spent this many probes (`queries` is the running total of all passes). */
  cap?: number
  /** Set when a pass was stopped by the cap. */
  hit?: boolean
}

function orderOrients(os: Dims[], policy: Policy): Dims[] {
  const cmp: Record<Policy, (a: Dims, b: Dims) => number> = {
    flat: (a, b) => a.h - b.h || b.l - a.l,
    lowTop: (a, b) => a.h - b.h || b.l - a.l,
    tall: (a, b) => b.h - a.h || b.l - a.l,
    longX: (a, b) => b.l - a.l || a.h - b.h,
  }
  return [...os].sort(cmp[policy])
}

function typeKey(s: Spec, key: SortKey): number {
  const d = s.item.dims
  const v = volume(d)
  switch (key) {
    case 'volume':
      return v
    case 'footprint':
      return Math.max(d.l * d.w, d.l * d.h, d.w * d.h)
    case 'longest':
      return Math.max(d.l, d.w, d.h)
    case 'smallest':
      return -v // units are placed in descending key order, so this places the smallest items first
    case 'weight':
      return s.weight * 1e12 + v
  }
}

function epPass(ctx: Ctx, units: number[], policy: Policy, work: Work): Box[] {
  const { box, specs, minSupport } = ctx
  const nulls = specs.filter((s) => s.qty === null)
  const capacity = units.length + nulls.reduce((s, n) => s + n.want, 0)
  let minSide = Infinity
  for (const s of specs) minSide = Math.min(minSide, s.item.dims.l, s.item.dims.w, s.item.dims.h)
  const grid = new Grid(box.l, box.w, cellSize(box.l, box.w, minSide), capacity)
  const ordered = specs.map((s) => orderOrients(s.orients, policy))
  const cx: number[] = [0]
  const cy: number[] = [0]
  const seen = new Set<string>(['0|0'])
  const addCand = (x: number, y: number): void => {
    x = round6(x)
    y = round6(y)
    const k = `${x}|${y}`
    if (x >= box.l - EPS || y >= box.w - EPS || seen.has(k)) return
    seen.add(k)
    cx.push(x)
    cy.push(y)
  }

  const place = (t: number): boolean => {
    const sup = ctx.pieceSupport?.[t] ?? minSupport
    let bx = 0
    let by = 0
    let bz = 0
    let bk = Infinity
    let bo: Dims | null = null
    for (let c = 0; c < cx.length; c++) {
      const x = cx[c]
      const y = cy[c]
      for (const o of ordered[t]) {
        if (x + o.l > box.l + EPS || y + o.w > box.w + EPS) continue
        work.queries++
        const z = grid.drop(x, y, o.l, o.w, o.h, box.h, sup)
        if (z < 0) continue
        const k = policy === 'lowTop' ? z + o.h : z
        const better =
          bo === null ||
          k < bk - EPS ||
          (Math.abs(k - bk) <= EPS &&
            (z < bz - EPS ||
              (Math.abs(z - bz) <= EPS && (x < bx - EPS || (Math.abs(x - bx) <= EPS && y < by - EPS)))))
        if (better) {
          bo = o
          bx = x
          by = y
          bz = z
          bk = k
        }
      }
    }
    if (!bo) return false
    grid.add({ t, x: bx, y: by, z: bz, l: bo.l, w: bo.w, h: bo.h })
    addCand(bx + bo.l, by)
    addCand(bx, by + bo.w)
    addCand(bx + bo.l, 0)
    addCand(0, by + bo.w)
    addCand(bx, by)
    return true
  }

  const passStart = work.queries
  const spent = (): boolean => {
    if (work.cap !== undefined && work.queries - passStart > work.cap) {
      work.hit = true
      return true
    }
    return false
  }
  for (const t of units) {
    if (spent()) break
    place(t) // an item that fits nowhere is skipped; smaller ones may still fit
  }
  for (const s of nulls) {
    for (let i = 0; i < s.want; i++) if (spent() || !place(s.index)) break
  }
  return grid.boxes
}

// ---- Blocks: identical items grouped into regular grids -------------------------------------------
//
// An order with hundreds of items but few distinct types is, for the search, a handful of "blocks". A block is
// a x b x c identical items in one orientation (so its top face is flat and it behaves like one big item).
// The extreme-point search places the blocks (and the single items left over); blocks are then expanded back
// into single items and verified like every other candidate. Cost grows with the number of pieces, not items.

type ShapePolicy = 'cube' | 'flat'

interface BlockMeta {
  nx: number
  ny: number
  nz: number
  il: number
  iw: number
  ih: number
}

/** Most pieces (blocks or single items) one extreme-point pass searches; keeps a pass near one second. */
const PIECE_LIMIT = 400
const MAX_COUNT = 40
const MAX_BLOCKS_PER_TYPE = 40
/** Blocks need more support than single items: an overhanging row of a block would be dropped by the repair. */
const BLOCK_SUPPORT = 0.9
const PERMS: ReadonlyArray<readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]
const BLOCK_VARIANTS: ReadonlyArray<readonly [ShapePolicy, number]> = [
  ['cube', Infinity],
  ['flat', Infinity],
  ['cube', 16],
  ['flat', 16],
]

const dkey = (d: { l: number; w: number; h: number }): string => `${round6(d.l)}|${round6(d.w)}|${round6(d.h)}`
const sameDims = (a: Dims, b: Dims): boolean => Math.abs(a.l - b.l) <= EPS && Math.abs(a.w - b.w) <= EPS && Math.abs(a.h - b.h) <= EPS

interface Shape {
  n: [number, number, number]
  units: number
  score: number
}

/** Largest a x b x c grid of `o`-oriented items that fits the container and holds at most min(q, cap) items. */
function bestShape(q: number, o: Dims, box: Dims, policy: ShapePolicy, cap: number): Shape | null {
  const Q = Math.min(q, cap)
  const mx = Math.min(MAX_COUNT, fl(box.l, o.l))
  const my = Math.min(MAX_COUNT, fl(box.w, o.w))
  const mz = Math.min(MAX_COUNT, fl(box.h, o.h))
  if (mx < 1 || my < 1 || mz < 1) return null
  let best: Shape | null = null
  for (let a = 1; a <= mx; a++) {
    for (let b = 1; b <= my; b++) {
      const ab = a * b
      if (ab > Q) break
      const c = Math.min(mz, Math.floor(Q / ab))
      if (c < 1) continue
      const units = ab * c
      const dx = a * o.l
      const dy = b * o.w
      const dz = c * o.h
      const score = policy === 'cube' ? Math.max(dx, dy, dz) / Math.min(dx, dy, dz) : dz * 1e3 - ab
      if (!best || units > best.units || (units === best.units && score < best.score)) best = { n: [a, b, c], units, score }
    }
  }
  return best
}

interface BlockSet {
  /** Virtual specs: blocks, leftover single items, and "as many as fit" types. */
  vspecs: Spec[]
  /** Real spec index of each virtual spec. */
  base: number[]
  support: number[]
  meta: Map<string, BlockMeta>
  blocks: number
  signature: string
}

function buildBlockSet(specs: Spec[], box: Dims, policy: ShapePolicy, cap: number, minSupport: number): BlockSet {
  const vspecs: Spec[] = []
  const base: number[] = []
  const support: number[] = []
  const meta = new Map<string, BlockMeta>()
  let blocks = 0
  const add = (t: number, dims: Dims, orients: Dims[], qty: number | null, want: number, sup: number, weight: number): number => {
    const index = vspecs.length
    vspecs.push({ index, item: { id: `v${index}`, color: specs[t].item.color, dims, qty }, qty, want, weight, orients })
    base.push(t)
    support.push(sup)
    return index
  }
  for (const s of specs) {
    if (s.qty === null) {
      add(s.index, s.item.dims, s.orients, null, s.want, minSupport, s.weight)
      continue
    }
    let q = s.qty
    const groups = new Map<string, { o: Dims; n: [number, number, number]; k: number }>()
    for (let guard = 0; q >= 2 && guard < MAX_BLOCKS_PER_TYPE; guard++) {
      let pick: (Shape & { o: Dims }) | null = null
      for (const o of s.orients) {
        const sh = bestShape(q, o, box, policy, cap)
        if (!sh || sh.units < 2) continue
        if (!pick || sh.units > pick.units || (sh.units === pick.units && sh.score < pick.score)) pick = { ...sh, o }
      }
      if (!pick) break
      const key = `${dkey(pick.o)}|${pick.n.join(',')}`
      const g = groups.get(key)
      if (g) g.k++
      else groups.set(key, { o: pick.o, n: pick.n, k: 1 })
      q -= pick.units
    }
    for (const g of groups.values()) {
      const oa = [g.o.l, g.o.w, g.o.h]
      const D = [g.n[0] * oa[0], g.n[1] * oa[1], g.n[2] * oa[2]]
      const index = vspecs.length
      const rots: Dims[] = []
      const seen = new Set<string>()
      for (const [a, b, c] of PERMS) {
        const io: Dims = { l: oa[a], w: oa[b], h: oa[c] }
        if (!s.orients.some((x) => sameDims(x, io))) continue // e.g. "this side up" items cannot lie on their side
        const d: Dims = { l: D[a], w: D[b], h: D[c] }
        const k = dkey(d)
        if (seen.has(k)) continue
        seen.add(k)
        rots.push(d)
        meta.set(`${index}|${k}`, { nx: g.n[a], ny: g.n[b], nz: g.n[c], il: io.l, iw: io.w, ih: io.h })
      }
      add(s.index, { l: D[0], w: D[1], h: D[2] }, rots, g.k, g.k, BLOCK_SUPPORT, s.weight * g.n[0] * g.n[1] * g.n[2])
      blocks += g.k
    }
    if (q > 0) add(s.index, s.item.dims, s.orients, q, q, minSupport, s.weight)
  }
  const signature = vspecs.map((v) => `${base[v.index]}:${dkey(v.item.dims)}:${v.qty}`).join(';')
  return { vspecs, base, support, meta, blocks, signature }
}

function expandBlocks(boxes: Box[], set: BlockSet): Box[] {
  const out: Box[] = []
  for (const b of boxes) {
    const t = set.base[b.t]
    const m = set.meta.get(`${b.t}|${dkey(b)}`)
    if (!m) {
      out.push({ ...b, t })
      continue
    }
    for (let i = 0; i < m.nx; i++) {
      for (let j = 0; j < m.ny; j++) {
        for (let k = 0; k < m.nz; k++) {
          out.push({ t, x: round6(b.x + i * m.il), y: round6(b.y + j * m.iw), z: round6(b.z + k * m.ih), l: m.il, w: m.iw, h: m.ih })
        }
      }
    }
  }
  return out
}

interface BlockSearch {
  results: Box[][]
  passes: number
  blocks: number
  truncated: boolean
  stopped: boolean
}

/** Extreme-point passes over blocks, for a few block shapes. Shares the probe budget (`work`) with the caller. */
function blockSearch(ctx: Ctx, limits: { maxQueries: number; pieceLimit: number }, work: Work, wantComplete: (b: Box[]) => boolean, progress?: (step: number, steps: number) => void): BlockSearch {
  const out: BlockSearch = { results: [], passes: 0, blocks: 0, truncated: false, stopped: false }
  const seen = new Set<string>()
  const sorts: SortKey[] = ['volume', 'footprint']
  const policies: Policy[] = ['flat', 'lowTop']
  for (const [shape, cap] of BLOCK_VARIANTS) {
    const set = buildBlockSet(ctx.specs, ctx.box, shape, cap, ctx.minSupport)
    if (set.blocks === 0 || seen.has(set.signature)) continue // no identical items to group, or same as a variant already run
    seen.add(set.signature)
    out.blocks = Math.max(out.blocks, set.blocks)
    const vctx: Ctx = { box: ctx.box, specs: set.vspecs, minSupport: ctx.minSupport, pieceSupport: set.support }
    for (const sort of sorts) {
      for (const policy of policies) {
        if (out.passes > 0 && work.queries > limits.maxQueries) {
          out.stopped = true
          return out
        }
        const units: { t: number; k: number }[] = []
        for (const v of set.vspecs) {
          if (v.qty === null) continue
          for (let i = 0; i < v.qty; i++) units.push({ t: v.index, k: typeKey(v, sort) })
        }
        units.sort((a, b) => b.k - a.k || a.t - b.t)
        if (units.length > limits.pieceLimit) {
          units.length = limits.pieceLimit
          out.truncated = true
        }
        progress?.(out.passes + 1, BLOCK_VARIANTS.length * sorts.length * policies.length)
        const boxes = expandBlocks(epPass(vctx, units.map((u) => u.t), policy, work), set)
        out.passes++
        out.results.push(boxes)
        if (wantComplete(boxes)) return out
      }
    }
  }
  return out
}

// ---- Orchestration -------------------------------------------------------------------------------

const usedVolume = (boxes: Box[]): number => boxes.reduce((s, b) => s + b.l * b.w * b.h, 0)

function extentOf(boxes: Box[]): Dims {
  const e = { l: 0, w: 0, h: 0 }
  for (const b of boxes) {
    e.l = Math.max(e.l, b.x + b.l)
    e.w = Math.max(e.w, b.y + b.w)
    e.h = Math.max(e.h, b.z + b.h)
  }
  return e
}

function emptyLayout(box: Dims, items: BoxType[]): Layout {
  const ok = pos(box.l) && pos(box.w) && pos(box.h)
  if (ok) return layoutFromPlacements(box, items, [])
  return {
    box,
    placements: [],
    types: items.map((t) => ({ typeId: t.id, requested: t.qty, placed: 0, orientation: null })),
    placedCount: 0,
    totalCount: 0,
    unplacedCount: 0,
    boxVolumeMm3: 0,
    usedVolumeMm3: 0,
    freeVolumeMm3: 0,
    usedPct: 0,
  }
}

function rejected(box: Dims, items: BoxType[], reason: string): OptimizeResult {
  return {
    status: 'rejected',
    layout: emptyLayout(box, items),
    strategy: null,
    totalWeightKg: 0,
    extent: { l: 0, w: 0, h: 0 },
    bounds: { containerVolumeMm3: 0, requestedVolumeMm3: 0, exceedsContainer: false },
    warnings: [reason],
    stats: { candidates: [], passes: 0, queries: 0, verified: 'none', blockPasses: 0, effort: { reduced: false, notes: [] } },
  }
}

/**
 * Packs `items` into `box` automatically. Pure and synchronous (run it in a Web Worker for big orders).
 * Deterministic: the same inputs and options always give the same result.
 */
export function optimize(box: Dims, items: PackItem[], options: OptimizeOptions = {}): OptimizeResult {
  const o = {
    seed: options.seed ?? DEFAULTS.seed,
    minSupport: options.minSupport ?? DEFAULTS.minSupport,
    maxPasses: options.maxPasses ?? DEFAULTS.maxPasses,
    maxQueries: options.maxQueries ?? DEFAULTS.maxQueries,
    epLimit: options.epLimit ?? DEFAULTS.epLimit,
    passQueryCap: options.passQueryCap ?? DEFAULTS.passQueryCap,
    onProgress: options.onProgress,
    fillCap: options.fillCap ?? DEFAULTS.fillCap,
    maxItems: options.maxItems ?? DEFAULTS.maxItems,
  }

  // -- input validation
  if (!pos(box.l) || !pos(box.w) || !pos(box.h)) return rejected(box, items, 'Container dimensions must be positive numbers')
  if (items.length === 0) return rejected(box, items, 'No items to pack')
  if (new Set(items.map((i) => i.id)).size !== items.length) return rejected(box, items, 'Item ids must be unique')
  for (const it of items) {
    const d = it.dims
    if (!pos(d.l) || !pos(d.w) || !pos(d.h)) return rejected(box, items, `Item ${it.id}: dimensions must be positive numbers`)
    if (it.qty !== null && (!Number.isInteger(it.qty) || it.qty < 1)) return rejected(box, items, `Item ${it.id}: quantity must be a whole number of at least 1`)
    if (it.weightKg !== undefined && (!Number.isFinite(it.weightKg) || it.weightKg < 0)) return rejected(box, items, `Item ${it.id}: weight must be zero or positive`)
  }
  const fixedTotal = items.reduce((s, i) => s + (i.qty ?? 0), 0)
  if (fixedTotal > o.maxItems) return rejected(box, items, `Too many items requested (${fixedTotal}; limit ${o.maxItems})`)

  const warnings: string[] = []
  const containerVolumeMm3 = volume(box)
  const specs: Spec[] = items.map((item, index) => {
    let want = item.qty ?? 0
    if (item.qty === null) {
      const bound = Math.floor(containerVolumeMm3 / volume(item.dims) + EPS)
      want = Math.min(o.fillCap, bound)
      if (bound > o.fillCap) warnings.push(`Item ${item.id}: "as many as fit" is capped at ${o.fillCap}`)
    }
    return { index, item, qty: item.qty, want, weight: item.weightKg ?? 0, orients: itemOrientations(item) }
  })
  const requestedVolumeMm3 = specs.reduce((s, p) => (p.qty === null ? s : s + p.qty * volume(p.item.dims)), 0)
  const exceedsContainer = requestedVolumeMm3 > containerVolumeMm3 + 1e-6
  if (exceedsContainer) warnings.push('The requested items have more volume than the container, so not everything can fit')

  const ctx: Ctx = { box, specs, minSupport: o.minSupport }
  const hasNull = specs.some((s) => s.qty === null)
  const candidates: CandidateInfo[] = []
  const valid: { strategy: StrategyName; boxes: Box[]; used: number; extent: number; explicit: number }[] = []
  let verifiedBy: 'full' | 'indexed' | 'none' = 'none'

  /** Pieces of the types that have an explicit quantity. They always come before "as many as fit" types. */
  const explicitCount = (boxes: Box[]): number => boxes.reduce((n, b) => (specs[b.t].qty !== null ? n + 1 : n), 0)
  const rank = (a: Box[], b: Box[]): number =>
    explicitCount(b) - explicitCount(a) || usedVolume(b) - usedVolume(a) || extentOf(a).l * extentOf(a).w * extentOf(a).h - extentOf(b).l * extentOf(b).w * extentOf(b).h

  const wantTotal = specs.reduce((s, p) => s + p.want, 0)
  const isComplete = (boxes: Box[]): boolean => {
    const placed = new Array<number>(specs.length).fill(0)
    for (const b of boxes) placed[b.t]++
    return specs.every((s) => s.qty === null || placed[s.index] >= s.qty)
  }

  const check = (boxes: Box[]): 'full' | 'indexed' | null => {
    if (!verifyIndexed(box, boxes, o.minSupport)) return null
    if (boxes.length <= FULL_VERIFY_MAX && o.minSupport >= MIN_SUPPORT - 1e-12) {
      return verifyPlacements(box, toPlacements(boxes, specs, false)) ? 'full' : null
    }
    return 'indexed'
  }

  const consider = (strategy: StrategyName, raw: Box[]): void => {
    let boxes = raw
    let how = check(boxes)
    if (how === null) {
      boxes = repairSupport(box, raw, o.minSupport)
      how = check(boxes)
    }
    const used = usedVolume(boxes)
    candidates.push({ strategy, placedCount: boxes.length, usedVolumeMm3: used, removed: raw.length - boxes.length, valid: how !== null })
    if (how === null) {
      warnings.push(`Internal: a ${strategy} candidate failed verification and was discarded`)
      return
    }
    if (verifiedBy !== 'indexed') verifiedBy = how
    const e = extentOf(boxes)
    valid.push({ strategy, boxes, used, extent: e.l * e.w * e.h, explicit: explicitCount(boxes) })
  }

  const report = (phase: string, step: number, steps: number): void => o.onProgress?.({ phase, step, steps })
  // 1. layered slabs, three type orders
  report('Layered patterns', 1, 1)
  const orders = typeOrders(specs)
  for (const order of orders) consider('layer-dp-slabs', slabCandidate(ctx, order, false))
  // 2. safe fallback if no layered candidate survived verification
  if (valid.length === 0) for (const order of orders) consider('grid-slabs', slabCandidate(ctx, order, true))

  // 3. extreme points. Full detail up to `epLimit` items; above it only the largest `epLimit` are searched
  //    one by one. Identical items are also grouped into blocks (any size), which scales to big orders.
  const work: Work = { queries: 0, cap: o.passQueryCap }
  const effort = { reduced: false, notes: [] as string[] }
  const note = (text: string): void => {
    effort.reduced = true
    effort.notes.push(text)
    warnings.push(text)
  }
  let passes = 0
  let blockPasses = 0
  const done = valid.some((c) => isComplete(c.boxes))
  const searching = o.epLimit > 0 && (!done || hasNull)
  const considerBest = (strategy: StrategyName, results: Box[][]): void => {
    results.sort(rank)
    for (const r of results) {
      const before = valid.length
      consider(strategy, r)
      if (valid.length > before) break // the best valid pass is enough
    }
  }

  if (searching) {
    const oversize = wantTotal > o.epLimit
    const rand = rng(o.seed)
    const hasWeight = specs.some((s) => s.weight > 0)
    const sorts: SortKey[] = hasWeight ? ['weight', 'volume', 'footprint', 'longest'] : ['volume', 'footprint', 'longest']
    const plans: { sort: SortKey; policy: Policy; noise: boolean }[] = []
    for (const sort of sorts) for (const policy of POLICIES) plans.push({ sort, policy, noise: false })
    for (let i = plans.length; i < o.maxPasses; i++) plans.push({ sort: 'volume', policy: POLICIES[i % POLICIES.length], noise: true })
    // Orders with explicit quantities that did not fit in the layered patterns: also try the smallest items first, which
    // maximizes the piece count. Added at the front, so the least useful noise passes are the ones cut by maxPasses.
    if (!done && specs.some((x) => x.qty !== null)) plans.unshift({ sort: 'smallest', policy: 'flat', noise: false }, { sort: 'smallest', policy: 'lowTop', noise: false })

    /** Item-by-item passes. Oversize orders get two passes over the largest PIECE_LIMIT items only. */
    const runSingles = (): void => {
      const planned = oversize ? plans.slice(0, 2) : plans.slice(0, o.maxPasses)
      const results: Box[][] = []
      let truncated = false
      let stopped = false
      for (const p of planned) {
        if (passes > 0 && work.queries > o.maxQueries) {
          stopped = true
          break
        }
        const units: { t: number; k: number }[] = []
        for (const s of specs) {
          if (s.qty === null) continue
          for (let i = 0; i < s.qty; i++) units.push({ t: s.index, k: typeKey(s, p.sort) * (p.noise ? 1 + (rand() - 0.5) * 0.4 : 1) })
        }
        units.sort((a, b) => b.k - a.k || a.t - b.t)
        if (units.length > PIECE_LIMIT) {
          units.length = PIECE_LIMIT
          truncated = true
        }
        report('Item-by-item search', passes + 1, planned.length)
        const boxes = epPass(ctx, units.map((u) => u.t), p.policy, work)
        passes++
        results.push(boxes)
        if (!hasNull && isComplete(boxes)) break // everything placed: no need to keep searching
      }
      considerBest('extreme-points', results)
      if (truncated) note(`Large order (${wantTotal.toLocaleString('en-US')} items): the one-by-one search covered only the largest ${PIECE_LIMIT}.`)
      if (stopped) note(`The search stopped after ${passes} of ${planned.length} passes because of its work limit.`)
      if (work.hit) note(`A search pass was cut short at ${o.passQueryCap.toLocaleString('en-US')} placement checks.`)
    }

    /** Blocks: identical items grouped into grids. Own probe budget (half of maxQueries), so small orders keep their results. */
    const runBlocks = (): number => {
      if (!hasNull && valid.some((c) => isComplete(c.boxes))) return 0
      const bwork: Work = { queries: 0, cap: o.passQueryCap }
      const bs = blockSearch(ctx, { maxQueries: Math.floor(o.maxQueries / 2), pieceLimit: PIECE_LIMIT }, bwork, (b) => !hasNull && isComplete(b), (step, steps) => report('Grouping identical items', step, steps))
      blockPasses = bs.passes
      work.queries += bwork.queries
      considerBest('block-extreme-points', bs.results)
      if (oversize && bs.passes > 0) note(`Large order (${wantTotal.toLocaleString('en-US')} items): identical items were grouped into blocks (up to ${bs.blocks}) to keep the search fast.`)
      if (bs.truncated) note(`The block search covered only the largest ${PIECE_LIMIT} pieces.`)
      if (bs.stopped) note(`The block search stopped after ${bs.passes} passes because of its work limit.`)
      if (bwork.hit) note(`A block pass was cut short at ${o.passQueryCap.toLocaleString('en-US')} placement checks.`)
      return bs.passes
    }

    if (oversize) {
      // Blocks scale with the number of distinct pieces, so they run first. One item-by-item search over the
      // largest PIECE_LIMIT items follows (about one second at most): on orders with few identical items it is
      // the better of the two, and the final choice is simply the larger placed volume.
      runBlocks()
      if (!(!hasNull && valid.some((c) => isComplete(c.boxes)))) runSingles()
    } else {
      runSingles()
      runBlocks()
    }
  } else if (o.epLimit > 0 && wantTotal > o.epLimit) {
    note(`Large order (${wantTotal.toLocaleString('en-US')} items): only the layered patterns were tried.`)
  }

  // -- choose: most explicit-quantity pieces, then most volume placed, then the smallest bounding box, then strategy order
  valid.sort((a, b) => b.explicit - a.explicit || b.used - a.used || a.extent - b.extent)
  const best = valid[0]
  const chosen = best ? best.boxes : []
  const placements = toPlacements(chosen, specs, true)
  const layout = layoutFromPlacements(box, items, placements)
  const totalWeightKg = chosen.reduce((s, b) => s + specs[b.t].weight, 0)

  const anyFixedMissing = specs.some((s) => s.qty !== null && layout.types[s.index].placed < s.qty)
  const status: OptimizeStatus = chosen.length === 0 ? 'none' : anyFixedMissing ? 'partial' : 'complete'

  return {
    status,
    layout,
    strategy: chosen.length > 0 && best ? best.strategy : null,
    totalWeightKg,
    extent: extentOf(chosen),
    bounds: { containerVolumeMm3, requestedVolumeMm3, exceedsContainer },
    warnings,
    stats: { candidates, passes, queries: work.queries, verified: chosen.length > 0 ? verifiedBy : 'none', blockPasses, effort },
  }
}
