import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, commit, createHistory, redo, undo } from './history'
import { layoutFromPlacements, type BoxType, type Placement } from './layout'
import {
  MANUAL_MAX_BOXES,
  addBox,
  checkPlacement,
  moveBy,
  orientationLabel,
  removeBox,
  resolveDrop,
  rotate,
  supportRatio,
} from './manual'
import type { Dims } from './pack'

const BOX: Dims = { l: 600, w: 400, h: 400 }
const pl = (id: string, x: number, y: number, z: number, l: number, w: number, h: number): Placement => ({
  id, typeId: 't', color: '#fff', x, y, z, size: { l, w, h },
})
const ok = <T extends { ok: boolean }>(r: T) => {
  expect(r.ok).toBe(true)
  return r as Extract<T, { ok: true }>
}
const fail = (r: { ok: boolean; reason?: string }, reason: string) => {
  expect(r.ok).toBe(false)
  expect(r.reason).toBe(reason)
}
const get = (ps: Placement[], id: string) => ps.find((p) => p.id === id)!

describe('movement', () => {
  const A = pl('A', 0, 0, 0, 100, 100, 100)
  it('moves along x and y', () => {
    const r = ok(moveBy(BOX, [A], 'A', 'x', 50))
    expect(get(r.placements, 'A')).toMatchObject({ x: 50, y: 0, z: 0 })
    const r2 = ok(moveBy(BOX, r.placements, 'A', 'y', 30))
    expect(get(r2.placements, 'A')).toMatchObject({ x: 50, y: 30, z: 0 })
  })
  it('does not mutate the input', () => {
    const before = JSON.stringify([A])
    moveBy(BOX, [A], 'A', 'x', 50)
    expect(JSON.stringify([A])).toBe(before)
  })
  it('allows boxes to touch', () => {
    const B = pl('B', 150, 0, 0, 100, 100, 100)
    const r = ok(moveBy(BOX, [A, B], 'A', 'x', 50))
    expect(get(r.placements, 'A').x).toBe(50)
  })
})

describe('container boundaries', () => {
  const A = pl('A', 500, 0, 0, 100, 100, 100)
  it('rejects a move past a wall and keeps the old layout', () => {
    fail(moveBy(BOX, [A], 'A', 'x', 1), 'Outside the container')
    fail(moveBy(BOX, [A], 'A', 'y', -1), 'Outside the container')
  })
  it('accepts a move that ends exactly on the wall', () => {
    const r = ok(moveBy(BOX, [pl('A', 400, 0, 0, 100, 100, 100)], 'A', 'x', 100))
    expect(get(r.placements, 'A').x).toBe(500)
  })
  it('rejects placements above the ceiling', () => {
    expect(checkPlacement(BOX, [], pl('T', 0, 0, 350, 100, 100, 100)).ok).toBe(false)
  })
})

describe('collisions', () => {
  const A = pl('A', 0, 0, 0, 100, 100, 100)
  const B = pl('B', 50, 0, 0, 100, 100, 100)
  it('detects overlapping boxes', () => {
    const c = checkPlacement(BOX, [A], B)
    expect(c).toEqual({ ok: false, reason: 'Overlaps another box' })
  })
  it('does not flag boxes that only share a face', () => {
    expect(checkPlacement(BOX, [A], pl('B', 100, 0, 0, 100, 100, 100)).ok).toBe(true)
  })
  it('rejects sliding partly onto a neighbour without enough support', () => {
    const left = pl('A', 0, 0, 0, 100, 100, 100)
    const right = pl('B', 150, 0, 0, 100, 100, 100)
    fail(moveBy(BOX, [left, right], 'A', 'x', 100), 'Not enough support')
  })
})

describe('stacking and support', () => {
  const base = pl('B', 0, 0, 0, 100, 100, 100)
  it('accepts a box fully supported from below', () => {
    expect(checkPlacement(BOX, [base], pl('S', 0, 0, 100, 100, 100, 50)).ok).toBe(true)
  })
  it('rejects a floating box', () => {
    fail(checkPlacement(BOX, [base], pl('S', 0, 0, 50, 100, 100, 50)) as never, 'Overlaps another box')
    fail(checkPlacement(BOX, [], pl('S', 300, 0, 50, 100, 100, 50)) as never, 'Not enough support')
  })
  it('requires 70% of the footprint to be supported', () => {
    expect(supportRatio(pl('S', 30, 0, 100, 100, 100, 50), [base])).toBeCloseTo(0.7, 10)
    expect(checkPlacement(BOX, [base], pl('S', 30, 0, 100, 100, 100, 50)).ok).toBe(true)
    expect(checkPlacement(BOX, [base], pl('S', 31, 0, 100, 100, 100, 50)).ok).toBe(false)
  })
  it('adds support from several boxes', () => {
    const b1 = pl('B1', 0, 0, 0, 50, 100, 100)
    const b2 = pl('B2', 50, 0, 0, 50, 100, 100)
    expect(supportRatio(pl('S', 0, 0, 100, 100, 100, 50), [b1, b2])).toBe(1)
  })
  it('drops a moved box onto the surface below it', () => {
    const top = pl('T', 300, 0, 0, 100, 100, 50)
    const r = ok(moveBy(BOX, [base, top], 'T', 'x', -300))
    expect(get(r.placements, 'T')).toMatchObject({ x: 0, z: 100 })
  })
  it('lets a box fall back to the floor when it slides off a stack', () => {
    const top = pl('T', 0, 0, 100, 100, 100, 50)
    const r = ok(moveBy(BOX, [base, top], 'T', 'x', 100))
    expect(get(r.placements, 'T')).toMatchObject({ x: 100, z: 0 })
  })
  it('rejects moving a box that supports another', () => {
    const top = pl('T', 0, 0, 100, 100, 100, 50)
    fail(moveBy(BOX, [base, top], 'B', 'x', 200), 'Boxes above would lose support')
    fail(removeBox([base, top], 'B'), 'Remove the boxes above first')
  })
  it('allows removing the top box and then the base', () => {
    const top = pl('T', 0, 0, 100, 100, 100, 50)
    const r1 = ok(removeBox([base, top], 'T'))
    expect(ok(removeBox(r1.placements, 'B')).placements).toEqual([])
  })
  it('keeps a stacked box when a second support remains', () => {
    const wide = pl('W', 0, 0, 100, 100, 100, 50)
    const left = pl('L', 0, 0, 0, 50, 100, 100)
    const right = pl('R', 50, 0, 0, 50, 100, 100)
    expect(ok(removeBox([left, right, wide], 'W')).placements).toHaveLength(2)
  })
})

describe('vertical moves inside a stack', () => {
  const lower = pl('L', 0, 0, 0, 100, 100, 100)
  const upper = pl('U', 0, 0, 100, 100, 100, 50)
  it('swaps a box with the one above (z+)', () => {
    const r = ok(moveBy(BOX, [lower, upper], 'L', 'z', 1))
    expect(get(r.placements, 'U')).toMatchObject({ z: 0 })
    expect(get(r.placements, 'L')).toMatchObject({ z: 50 })
  })
  it('swaps a box with the one below (z-)', () => {
    const r = ok(moveBy(BOX, [lower, upper], 'U', 'z', -1))
    expect(get(r.placements, 'U').z).toBe(0)
    expect(get(r.placements, 'L').z).toBe(50)
  })
  it('rejects when there is nothing to swap with', () => {
    fail(moveBy(BOX, [lower, upper], 'U', 'z', 1), 'Nothing above to swap with')
    fail(moveBy(BOX, [lower, upper], 'L', 'z', -1), 'Nothing below to swap with')
  })
  it('rejects when more boxes are stacked above', () => {
    const third = pl('X', 0, 0, 150, 100, 100, 50)
    fail(moveBy(BOX, [lower, upper, third], 'L', 'z', 1), 'Move the boxes above first')
  })
})

describe('rotation', () => {
  const A = pl('A', 100, 100, 0, 200, 100, 50)
  it('swaps the occupied dimensions around each axis', () => {
    const z = ok(rotate(BOX, [A], 'A', 'z')).placements[0]
    expect(z.size).toEqual({ l: 100, w: 200, h: 50 })
    const x = ok(rotate(BOX, [A], 'A', 'x')).placements[0]
    expect(x.size).toEqual({ l: 200, w: 50, h: 100 })
    const y = ok(rotate(BOX, [A], 'A', 'y')).placements[0]
    expect(y.size).toEqual({ l: 50, w: 100, h: 200 })
  })
  it('rotates about the center and keeps the box on the floor', () => {
    const z = ok(rotate(BOX, [A], 'A', 'z')).placements[0]
    expect(z).toMatchObject({ x: 150, y: 50, z: 0 })
  })
  it('returns to the original after four turns', () => {
    let ps = [A]
    for (let i = 0; i < 4; i++) ps = ok(rotate(BOX, ps, 'A', 'z')).placements
    expect(ps[0]).toMatchObject({ x: 100, y: 100, z: 0, size: { l: 200, w: 100, h: 50 } })
  })
  it('rejects a rotation that leaves the container', () => {
    const small: Dims = { l: 300, w: 100, h: 100 }
    fail(rotate(small, [pl('A', 0, 0, 0, 200, 50, 50)], 'A', 'z'), 'Outside the container')
  })
  it('rejects a rotation that collides', () => {
    const blocker = pl('B', 0, 60, 0, 200, 50, 50)
    fail(rotate(BOX, [pl('A', 0, 0, 0, 200, 50, 50), blocker], 'A', 'z'), 'Overlaps another box')
  })
  it('rejects a rotation that would reach the ceiling', () => {
    const tall = pl('A', 0, 0, 0, 300, 100, 100)
    fail(rotate({ l: 400, w: 400, h: 200 }, [tall], 'A', 'y'), 'Outside the container')
  })
  it('treats a cube rotation as no change', () => {
    const r = ok(rotate(BOX, [pl('C', 0, 0, 0, 100, 100, 100)], 'C', 'z'))
    expect(r.changed).toBe(false)
  })
})

describe('drag resolution and snapping', () => {
  const A = pl('A', 0, 0, 0, 100, 100, 100)
  const N = pl('N', 300, 0, 0, 100, 100, 100)
  it('clamps into the container', () => {
    const r = resolveDrop(BOX, [A], 'A', 900, -50)!
    expect(r.placement).toMatchObject({ x: 500, y: 0, z: 0 })
    expect(r.check.ok).toBe(true)
  })
  it('snaps to a neighbour face and to walls', () => {
    const r = resolveDrop(BOX, [A, N], 'A', 195, 4, 10)!
    expect(r.placement).toMatchObject({ x: 200, y: 0 })
    expect(r.check.ok).toBe(true)
  })
  it('does not snap when far away', () => {
    const r = resolveDrop(BOX, [A, N], 'A', 120, 150, 10)!
    expect(r.placement).toMatchObject({ x: 120, y: 150 })
  })
  it('lands on top of a box and reports unsupported overlaps', () => {
    const onTop = resolveDrop(BOX, [A, N], 'A', 300, 0, 0)!
    expect(onTop.placement.z).toBe(100)
    expect(onTop.check.ok).toBe(true)
    const half = resolveDrop(BOX, [A, N], 'A', 350, 0, 0)!
    expect(half.check).toEqual({ ok: false, reason: 'Not enough support' })
  })
  it('never returns a valid result that overlaps or leaves the container', () => {
    let seed = 3
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let i = 0; i < 300; i++) {
      const r = resolveDrop(BOX, [A, N], 'A', rnd() * 700 - 50, rnd() * 500 - 50)!
      if (r.check.ok) expect(checkPlacement(BOX, [N], r.placement).ok).toBe(true)
    }
  })
})

describe('adding and removing boxes', () => {
  const type: BoxType = { id: 'T', color: '#4fd1c5', dims: { l: 100, w: 100, h: 100 }, qty: null }
  it('adds at the first free floor spot', () => {
    const r1 = ok(addBox(BOX, [], type))
    expect(r1.placements[0]).toMatchObject({ x: 0, y: 0, z: 0, typeId: 'T', color: '#4fd1c5' })
    const r2 = ok(addBox(BOX, r1.placements, type))
    expect(r2.placements).toHaveLength(2)
    expect(checkPlacement(BOX, [r2.placements[0]], r2.placements[1]).ok).toBe(true)
  })
  it('fills the container without overlaps, then stacks, then reports no room', () => {
    let ps: Placement[] = []
    const cube: BoxType = { ...type, dims: { l: 200, w: 200, h: 200 } }
    for (let i = 0; i < 12; i++) ps = ok(addBox(BOX, ps, cube)).placements
    expect(ps).toHaveLength(12) // 3 × 2 × 2
    fail(addBox(BOX, ps, cube), 'No room for this box')
    for (const p of ps) expect(checkPlacement(BOX, ps, p).ok).toBe(true)
  })
  it('turns a box when only another orientation fits', () => {
    const slim: BoxType = { ...type, dims: { l: 100, w: 100, h: 500 } }
    const r = ok(addBox({ l: 500, w: 100, h: 100 }, [], slim))
    expect(r.placements[0].size).toEqual({ l: 500, w: 100, h: 100 })
  })
  it('stops at the manual box limit', () => {
    const many = Array.from({ length: MANUAL_MAX_BOXES }, (_, i) => pl(`m${i}`, 0, 0, 0, 1, 1, 1))
    expect(addBox(BOX, many, type).ok).toBe(false)
  })
  it('gives each new box a unique id', () => {
    let ps: Placement[] = []
    for (let i = 0; i < 5; i++) ps = ok(addBox(BOX, ps, type)).placements
    expect(new Set(ps.map((p) => p.id)).size).toBe(5)
  })
})

describe('statistics follow the arrangement', () => {
  const types: BoxType[] = [
    { id: 'a', color: '#fff', dims: { l: 100, w: 100, h: 100 }, qty: 4 },
    { id: 'b', color: '#fff', dims: { l: 50, w: 50, h: 50 }, qty: null },
  ]
  const mk = (id: string, typeId: string, n: number): Placement => ({ ...pl(id, 0, 0, 0, n, n, n), typeId })
  it('counts placed, unplaced, used and free from the placements', () => {
    const l = layoutFromPlacements(BOX, types, [mk('1', 'a', 100), mk('2', 'a', 100), mk('3', 'b', 50)])
    expect(l.placedCount).toBe(3)
    expect(l.totalCount).toBe(5) // 4 requested + 1 "as many as fit" placed
    expect(l.unplacedCount).toBe(2)
    expect(l.usedVolumeMm3).toBe(2e6 + 125000)
    expect(l.freeVolumeMm3).toBe(96e6 - 2125000)
    expect(l.usedPct).toBeCloseTo((2125000 / 96e6) * 100, 10)
  })
  it('updates after a removal', () => {
    const before = [mk('1', 'a', 100), mk('2', 'a', 100)]
    const after = ok(removeBox(before, '2')).placements
    expect(layoutFromPlacements(BOX, types, after).placedCount).toBe(1)
  })
})

describe('history', () => {
  it('undoes and redoes', () => {
    let h = createHistory<number[]>([])
    h = commit(h, [1])
    h = commit(h, [1, 2])
    expect(canUndo(h) && !canRedo(h)).toBe(true)
    h = undo(h)
    expect(h.present).toEqual([1])
    h = redo(h)
    expect(h.present).toEqual([1, 2])
    h = undo(undo(h))
    expect(h.present).toEqual([])
    expect(undo(h)).toBe(h)
  })
  it('drops redo states after a new action and ignores no-ops', () => {
    let h = createHistory<string>('a')
    h = commit(h, 'b')
    h = undo(h)
    h = commit(h, 'c')
    expect(canRedo(h)).toBe(false)
    expect(commit(h, h.present)).toBe(h)
  })
})

describe('orientation label', () => {
  it('shows which of L, W, H lies along x, y, z', () => {
    const d = { l: 220, w: 150, h: 90 }
    expect(orientationLabel(d, { l: 220, w: 150, h: 90 })).toBe('L × W × H')
    expect(orientationLabel(d, { l: 150, w: 90, h: 220 })).toBe('W × H × L')
    expect(orientationLabel({ l: 100, w: 100, h: 50 }, { l: 100, w: 50, h: 100 })).toBe('L × H × W')
  })
})
