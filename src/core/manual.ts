import { newPlacementId, type BoxType, type Placement } from './layout'
import { orientations, type Dims } from './pack'

/**
 * Manual placement rules. Pure functions, no rendering.
 * Coordinates are the ones from layout.ts: x = length, y = width, z = height (up),
 * millimetres, origin at the container's minimum corner.
 *
 * Rules:
 * - A box must stay inside the container and may not overlap another box (touching is fine).
 * - A box above the floor needs support: boxes whose top face is at its bottom height
 *   must cover at least MIN_SUPPORT of its footprint.
 * - A move that would leave another box unsupported is rejected.
 * - Moves along x and y settle the box onto the highest surface under its footprint.
 */

export const EPS = 1e-6
/** Share of a box's footprint that must rest on boxes below. */
export const MIN_SUPPORT = 0.7
/** Manual mode limit, to keep placement searches fast. */
export const MANUAL_MAX_BOXES = 400

export type Axis = 'x' | 'y' | 'z'
export type Check = { ok: true } | { ok: false; reason: string }
export type Change =
  | { ok: true; placements: Placement[]; changed: boolean; moved?: Placement }
  | { ok: false; reason: string }

type Rect = Pick<Placement, 'x' | 'y' | 'size'>

const round = (v: number): number => Math.round(v * 1e6) / 1e6
const span = (a0: number, a1: number, b0: number, b1: number): number => Math.min(a1, b1) - Math.max(a0, b0)

/** Overlap area of two footprints (0 when they only touch). */
function footprintOverlap(a: Rect, b: Rect): number {
  const ox = span(a.x, a.x + a.size.l, b.x, b.x + b.size.l)
  const oy = span(a.y, a.y + a.size.w, b.y, b.y + b.size.w)
  return ox > EPS && oy > EPS ? ox * oy : 0
}

function volumesOverlap(a: Placement, b: Placement): boolean {
  return footprintOverlap(a, b) > 0 && span(a.z, a.z + a.size.h, b.z, b.z + b.size.h) > EPS
}

export function inBounds(box: Dims, p: Placement): boolean {
  return (
    p.x >= -EPS &&
    p.y >= -EPS &&
    p.z >= -EPS &&
    p.x + p.size.l <= box.l + EPS &&
    p.y + p.size.w <= box.w + EPS &&
    p.z + p.size.h <= box.h + EPS
  )
}

/** Share (0 to 1) of the footprint resting on the floor or on top faces at the same height. */
export function supportRatio(p: Placement, others: Placement[]): number {
  if (p.z <= EPS) return 1
  let area = 0
  for (const o of others) {
    if (o.id !== p.id && Math.abs(o.z + o.size.h - p.z) <= EPS) area += footprintOverlap(p, o)
  }
  return area / (p.size.l * p.size.w)
}

/** Height of the highest top face under a footprint (0 for the floor). */
export function restHeight(others: Placement[], r: Rect): number {
  let z = 0
  for (const o of others) {
    if (footprintOverlap(r, o) > 0) z = Math.max(z, o.z + o.size.h)
  }
  return round(z)
}

/** Validates one placement against the container and the other boxes. */
export function checkPlacement(box: Dims, others: Placement[], p: Placement): Check {
  if (!inBounds(box, p)) return { ok: false, reason: 'Outside the container' }
  for (const o of others) {
    if (o.id !== p.id && volumesOverlap(p, o)) return { ok: false, reason: 'Overlaps another box' }
  }
  if (supportRatio(p, others) < MIN_SUPPORT - 1e-9) return { ok: false, reason: 'Not enough support' }
  return { ok: true }
}

/** Boxes resting directly on top of `p`. */
function dependentsOf(p: Placement, others: Placement[]): Placement[] {
  return others.filter(
    (o) => o.id !== p.id && Math.abs(o.z - (p.z + p.size.h)) <= EPS && footprintOverlap(p, o) > 0,
  )
}

/** Validates replacing box `id` with `next`, including the boxes that rest on it. */
export function checkMove(box: Dims, all: Placement[], id: string, next: Placement): Check {
  const others = all.filter((o) => o.id !== id)
  const c = checkPlacement(box, others, next)
  if (!c.ok) return c
  const old = all.find((o) => o.id === id)
  if (old) {
    const world = [...others, next]
    for (const d of dependentsOf(old, others)) {
      if (supportRatio(d, world) < MIN_SUPPORT - 1e-9) {
        return { ok: false, reason: 'Boxes above would lose support' }
      }
    }
  }
  return { ok: true }
}

const replace = (all: Placement[], next: Placement): Placement[] => all.map((o) => (o.id === next.id ? next : o))

function commitMove(box: Dims, all: Placement[], old: Placement, next: Placement): Change {
  const c = checkMove(box, all, old.id, next)
  if (!c.ok) return c
  const changed = old.x !== next.x || old.y !== next.y || old.z !== next.z || old.size !== next.size
  return { ok: true, placements: changed ? replace(all, next) : all, changed, moved: next }
}

/**
 * Vertical move inside a stack. Boxes cannot float, so moving up or down means
 * swapping places with the box directly above or below. Both boxes must stay
 * supported, and no other box may rest on either of them.
 */
function stackSwap(box: Dims, all: Placement[], p: Placement, dir: 'up' | 'down'): Change {
  let lower = p
  if (dir === 'down') {
    const below = all.filter(
      (o) => o.id !== p.id && Math.abs(o.z + o.size.h - p.z) <= EPS && footprintOverlap(p, o) > 0,
    )
    if (below.length === 0) return { ok: false, reason: 'Nothing below to swap with' }
    lower = below.reduce((a, b) => (footprintOverlap(p, b) > footprintOverlap(p, a) ? b : a))
  }
  const rest = all.filter((o) => o.id !== lower.id)
  const above = dependentsOf(lower, rest)
  if (above.length === 0) return { ok: false, reason: 'Nothing above to swap with' }
  if (above.length > 1 || dependentsOf(above[0], rest).length > 0) {
    return { ok: false, reason: 'Move the boxes above first' }
  }
  const upper = above[0]
  const world = rest.filter((o) => o.id !== upper.id)
  const upper2: Placement = { ...upper, z: restHeight(world, upper) }
  const lower2: Placement = { ...lower, z: round(upper2.z + upper2.size.h) }
  const c1 = checkPlacement(box, world, upper2)
  if (!c1.ok) return c1
  const c2 = checkPlacement(box, [...world, upper2], lower2)
  if (!c2.ok) return c2
  const placements = all.map((o) => (o.id === lower.id ? lower2 : o.id === upper.id ? upper2 : o))
  return { ok: true, placements, changed: true, moved: dir === 'up' ? lower2 : upper2 }
}

/**
 * Moves a box along one axis.
 * x and y: shifts by `delta` mm, then the box settles onto the surface below it.
 * z: swaps places with the box above (delta > 0) or below (delta < 0) in its stack.
 */
export function moveBy(box: Dims, all: Placement[], id: string, axis: Axis, delta: number): Change {
  const p = all.find((o) => o.id === id)
  if (!p) return { ok: false, reason: 'Box not found' }
  const others = all.filter((o) => o.id !== id)

  if (axis === 'z') return delta > 0 ? stackSwap(box, all, p, 'up') : stackSwap(box, all, p, 'down')

  const x = round(axis === 'x' ? p.x + delta : p.x)
  const y = round(axis === 'y' ? p.y + delta : p.y)
  const z = restHeight(others, { x, y, size: p.size })
  return commitMove(box, all, p, { ...p, x, y, z })
}

/** Rotates a box by 90 degrees around the container's x, y or z axis. */
export function rotate(box: Dims, all: Placement[], id: string, axis: Axis): Change {
  const p = all.find((o) => o.id === id)
  if (!p) return { ok: false, reason: 'Box not found' }
  const { l, w, h } = p.size
  const size: Dims = axis === 'x' ? { l, w: h, h: w } : axis === 'y' ? { l: h, w, h: l } : { l: w, w: l, h }
  // Rotate about the box center, then keep it inside the container if it can fit there.
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(0, max))
  const x = round(clamp(p.x + l / 2 - size.l / 2, box.l - size.l))
  const y = round(clamp(p.y + w / 2 - size.w / 2, box.w - size.w))
  const others = all.filter((o) => o.id !== id)
  // The box stays at its height (so a clash is reported as a collision), or settles
  // lower when its new footprint no longer rests on what it did before.
  const z = Math.min(p.z, restHeight(others, { x, y, size }))
  const unchanged = size.l === l && size.w === w && size.h === h
  const next: Placement = unchanged ? p : { ...p, x, y, z, size }
  return commitMove(box, all, p, next)
}

/** Removes a box. Rejected while other boxes would be left without support. */
export function removeBox(all: Placement[], id: string): Change {
  const p = all.find((o) => o.id === id)
  if (!p) return { ok: false, reason: 'Box not found' }
  const rest = all.filter((o) => o.id !== id)
  for (const d of dependentsOf(p, rest)) {
    if (supportRatio(d, rest) < MIN_SUPPORT - 1e-9) return { ok: false, reason: 'Remove the boxes above first' }
  }
  return { ok: true, placements: rest, changed: true }
}

/** Distance within which a dragged box snaps to container walls and neighbouring boxes. */
export function snapDistance(box: Dims): number {
  return Math.max(8, Math.max(box.l, box.w, box.h) * 0.02)
}

function snapAxis(value: number, max: number, edges: number[], dist: number): number {
  let best = value
  let bestD = dist
  for (const e of edges) {
    if (e < -EPS || e > max + EPS) continue
    const d = Math.abs(e - value)
    if (d <= bestD) {
      best = e
      bestD = d
    }
  }
  return round(best)
}

/**
 * Where a dragged box would land. `wantX` and `wantY` are the desired minimum corner.
 * The position is clamped into the container, snapped to walls and neighbouring faces,
 * and dropped onto the surface below. `check` tells whether the result is valid.
 */
export function resolveDrop(
  box: Dims,
  all: Placement[],
  id: string,
  wantX: number,
  wantY: number,
  snap: number = snapDistance(box),
): { placement: Placement; check: Check } | null {
  const p = all.find((o) => o.id === id)
  if (!p) return null
  const others = all.filter((o) => o.id !== id)
  const maxX = box.l - p.size.l
  const maxY = box.w - p.size.w
  const cx = Math.min(Math.max(wantX, 0), Math.max(0, maxX))
  const cy = Math.min(Math.max(wantY, 0), Math.max(0, maxY))
  const xe = [0, maxX]
  const ye = [0, maxY]
  for (const o of others) {
    xe.push(o.x + o.size.l, o.x - p.size.l, o.x, o.x + o.size.l - p.size.l)
    ye.push(o.y + o.size.w, o.y - p.size.w, o.y, o.y + o.size.w - p.size.w)
  }
  const x = snapAxis(cx, maxX, xe, snap)
  const y = snapAxis(cy, maxY, ye, snap)
  const z = restHeight(others, { x, y, size: p.size })
  const placement = { ...p, x, y, z }
  return { placement, check: checkMove(box, all, id, placement) }
}

/** First free spot for a new box of `size` (lowest, then back-left), or null. */
function findSpot(box: Dims, all: Placement[], size: Dims): { x: number; y: number; z: number } | null {
  const xs = [...new Set([0, ...all.flatMap((o) => [round(o.x), round(o.x + o.size.l)])])]
    .filter((x) => x + size.l <= box.l + EPS)
    .sort((a, b) => a - b)
  const ys = [...new Set([0, ...all.flatMap((o) => [round(o.y), round(o.y + o.size.w)])])]
    .filter((y) => y + size.w <= box.w + EPS)
    .sort((a, b) => a - b)
  let best: { x: number; y: number; z: number } | null = null
  const probe: Placement = { id: '', typeId: '', color: '', x: 0, y: 0, z: 0, size }
  for (const x of xs) {
    for (const y of ys) {
      const z = restHeight(all, { x, y, size })
      if (z + size.h > box.h + EPS) continue
      if (best && z >= best.z - EPS) continue
      if (checkPlacement(box, all, { ...probe, x, y, z }).ok) {
        best = { x, y, z }
        if (z <= EPS) return best
      }
    }
  }
  return best
}

/** Adds one box of `type` at the first free spot, trying its orientations in order. */
export function addBox(box: Dims, all: Placement[], type: BoxType): Change {
  if (all.length >= MANUAL_MAX_BOXES) return { ok: false, reason: `Manual mode is limited to ${MANUAL_MAX_BOXES} boxes` }
  const seen = new Set<string>()
  for (const size of orientations(type.dims)) {
    const key = `${size.l}|${size.w}|${size.h}`
    if (seen.has(key)) continue
    seen.add(key)
    const spot = findSpot(box, all, size)
    if (spot) {
      const placement: Placement = { id: newPlacementId(), typeId: type.id, color: type.color, ...spot, size }
      return { ok: true, placements: [...all, placement], changed: true, moved: placement }
    }
  }
  return { ok: false, reason: 'No room for this box' }
}

/** Which of the type's L, W, H lies along the container's x, y, z, e.g. "W × L × H". */
export function orientationLabel(typeDims: Dims, size: Dims): string {
  const letters = ['L', 'W', 'H']
  const src = [typeDims.l, typeDims.w, typeDims.h]
  const dst = [size.l, size.w, size.h]
  const used = new Set<number>()
  return dst
    .map((v) => {
      const i = src.findIndex((s, k) => !used.has(k) && Math.abs(s - v) <= EPS)
      used.add(i)
      return letters[i] ?? '?'
    })
    .join(' × ')
}
