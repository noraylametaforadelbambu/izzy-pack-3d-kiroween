import { describe, expect, it } from 'vitest'
import { BENCH_BOX, groupedOrder, tilingOrder, totalQty } from './benchmarkData'
import type { Placement } from './layout'
import { checkPlacement } from './manual'
import { problems } from './layoutProblems'
import { optimize, type PackItem } from './optimizer'
import type { Dims } from './pack'
import { optimizeWeighted } from './weighted'

const util = (r: ReturnType<typeof optimize>): number => (r.layout.usedVolumeMm3 / r.layout.boxVolumeMm3) * 100

/** Everything the layout reports must match the boxes that were really placed. */
function expectConsistent(items: PackItem[], r: ReturnType<typeof optimize>, box: Dims): void {
  const ps = r.layout.placements
  expect(problems(box, ps)).toEqual([])
  expect(r.layout.placedCount).toBe(ps.length)
  expect(r.layout.usedVolumeMm3).toBeCloseTo(ps.reduce((s, p) => s + p.size.l * p.size.w * p.size.h, 0), 3)
  expect(r.layout.usedVolumeMm3 + r.layout.freeVolumeMm3).toBeCloseTo(box.l * box.w * box.h, 3)
  for (const it of items) {
    const mine = ps.filter((p) => p.typeId === it.id)
    if (it.qty !== null) expect(mine.length).toBeLessThanOrEqual(it.qty)
    const dims = [it.dims.l, it.dims.w, it.dims.h].sort((a, b) => a - b)
    for (const p of mine) expect([p.size.l, p.size.w, p.size.h].sort((a, b) => a - b)).toEqual(dims) // only 90-degree turns
  }
}

describe('independent checker', () => {
  const box: Dims = { l: 100, w: 100, h: 100 }
  const mk = (id: string, x: number, y: number, z: number, l = 50, w = 50, h = 50): Placement => ({ id, typeId: 't', color: '#fff', x, y, z, size: { l, w, h } })
  it('accepts valid layouts and finds each kind of defect', () => {
    expect(problems(box, [mk('a', 0, 0, 0), mk('b', 50, 0, 0), mk('c', 0, 0, 50)])).toEqual([])
    expect(problems(box, [mk('a', 0, 0, 0), mk('b', 25, 0, 0)])).toEqual(['a overlaps b'])
    expect(problems(box, [mk('a', 60, 0, 0)])).toEqual(['a outside the container'])
    expect(problems(box, [mk('a', 0, 0, 20)])).toEqual(['a is not supported'])
  })
})

describe('large mixed orders (perfectly packable test cases)', () => {
  // Before the change these orders fell back to the layered slabs alone: 8% to 77% used.
  it('many different item types, 400+ items: no cliff above 250 items', { timeout: 120_000 }, () => {
    for (const seed of [1, 2]) {
      const items = tilingOrder(400, seed)
      expect(items.length).toBeGreaterThan(100) // many distinct types
      const r = optimize(BENCH_BOX, items)
      expectConsistent(items, r, BENCH_BOX)
      expect(util(r)).toBeGreaterThan(70)
      expect(r.layout.placedCount).toBeGreaterThan(0.6 * totalQty(items))
    }
  })
  it('few types with large quantities (identical items grouped into blocks)', { timeout: 120_000 }, () => {
    for (const types of [10, 50]) {
      const items = groupedOrder(types, 400, 1)
      const r = optimize(BENCH_BOX, items)
      expectConsistent(items, r, BENCH_BOX)
      expect(util(r)).toBeGreaterThan(types === 10 ? 80 : 70)
      expect(r.stats.blockPasses).toBeGreaterThan(0)
    }
  })
  it('1,000 items stay valid, finish, and say that the search was reduced', { timeout: 120_000 }, () => {
    const items = groupedOrder(25, 1000, 2)
    const r = optimize(BENCH_BOX, items)
    expectConsistent(items, r, BENCH_BOX)
    expect(util(r)).toBeGreaterThan(60)
    expect(r.stats.effort.reduced).toBe(true)
    expect(r.stats.effort.notes.join(' ')).toMatch(/Large order/)
    expect(r.warnings).toEqual(expect.arrayContaining(r.stats.effort.notes))
  })
  it('every placement also passes the project placement check (manual mode compatibility)', { timeout: 120_000 }, () => {
    const r = optimize(BENCH_BOX, groupedOrder(10, 300, 3))
    const ps = r.layout.placements
    expect(ps.length).toBeGreaterThan(100)
    for (const p of ps) expect(checkPlacement(BENCH_BOX, ps, p)).toEqual({ ok: true })
  })
  it('is deterministic', { timeout: 120_000 }, () => {
    const items = groupedOrder(25, 400, 4)
    const sig = (r: ReturnType<typeof optimize>) => r.layout.placements.map((p) => `${p.typeId}:${p.x},${p.y},${p.z}:${p.size.l}x${p.size.w}x${p.size.h}`).join('|')
    expect(sig(optimize(BENCH_BOX, items))).toBe(sig(optimize(BENCH_BOX, items)))
  })
})

describe('blocks keep the item rules', () => {
  it('"this side up" items stay upright inside blocks', { timeout: 60_000 }, () => {
    const items = groupedOrder(10, 300, 5).map((i) => ({ ...i, upright: true }))
    const r = optimize(BENCH_BOX, items)
    expectConsistent(items, r, BENCH_BOX)
    expect(r.stats.blockPasses).toBeGreaterThan(0)
    for (const p of r.layout.placements) expect(p.size.h).toBe(items.find((i) => i.id === p.typeId)!.dims.h)
  })
  it('never places more than requested and reports what was left out', { timeout: 60_000 }, () => {
    const items = [
      { id: 'a', color: '#fff', dims: { l: 100, w: 100, h: 100 }, qty: 300 },
      { id: 'b', color: '#fff', dims: { l: 60, w: 60, h: 60 }, qty: 300 },
    ]
    const r = optimize(BENCH_BOX, items)
    expectConsistent(items, r, BENCH_BOX)
    expect(r.layout.placedCount + r.layout.unplacedCount).toBe(600)
    expect(r.status).toBe('partial')
  })
  it('"as many as fit" types still work next to blocks', { timeout: 60_000 }, () => {
    const items: PackItem[] = [
      { id: 'a', color: '#fff', dims: { l: 100, w: 100, h: 100 }, qty: 60 },
      { id: 'b', color: '#fff', dims: { l: 50, w: 50, h: 50 }, qty: null },
    ]
    const r = optimize(BENCH_BOX, items)
    expectConsistent(items, r, BENCH_BOX)
    expect(r.layout.types[0].placed).toBe(60)
    expect(r.layout.types[1].placed).toBeGreaterThan(0)
  })
})

describe('reporting reduced effort', () => {
  it('stays silent when the full search ran', () => {
    const r = optimize(BENCH_BOX, [{ id: 'a', color: '#fff', dims: { l: 220, w: 150, h: 90 }, qty: 30 }])
    expect(r.stats.effort).toEqual({ reduced: false, notes: [] })
  })
  it('reports a work limit that stopped the search early', () => {
    const items = groupedOrder(10, 200, 6)
    const r = optimize(BENCH_BOX, items, { maxQueries: 1 })
    expect(r.stats.effort.reduced).toBe(true)
    expect(r.stats.effort.notes.join(' ')).toMatch(/work limit/)
  })
  it('reports a pass that was cut short by the probe cap, and the result is still valid', { timeout: 60_000 }, () => {
    const items = tilingOrder(200, 7)
    const r = optimize(BENCH_BOX, items, { passQueryCap: 2_000 })
    expect(r.stats.effort.notes.join(' ')).toMatch(/cut short/)
    expectConsistent(items, r, BENCH_BOX)
  })
  it('passQueryCap limits ONE pass, not the sum of all passes', { timeout: 60_000 }, () => {
    // 100 items: every pass costs far less than the cap, but all passes together cost more than the cap.
    const items = tilingOrder(100, 1)
    const unlimited = optimize(BENCH_BOX, items, { passQueryCap: 1e12 })
    const capped = optimize(BENCH_BOX, items, { passQueryCap: 300_000 })
    expect(unlimited.stats.queries).toBeGreaterThan(300_000) // the passes together are over the cap
    expect(capped.stats.effort.notes.join(' ')).not.toMatch(/cut short/)
    const sig = (r: ReturnType<typeof optimize>) => r.layout.placements.map((p) => `${p.typeId}:${p.x},${p.y},${p.z}:${p.size.l}x${p.size.w}x${p.size.h}`).join('|')
    expect(sig(capped)).toBe(sig(unlimited))
  })
  it('epLimit 0 turns the extreme-point searches off', () => {
    const r = optimize(BENCH_BOX, groupedOrder(10, 400, 8), { epLimit: 0 })
    expect(r.stats.passes).toBe(0)
    expect(r.stats.blockPasses).toBe(0)
  })
})

describe('with weight limits', () => {
  it('large orders respect the maximum gross weight and stay valid', { timeout: 120_000 }, () => {
    const items = groupedOrder(10, 300, 9).map((i, k) => ({ ...i, weightKg: 0.5 + k * 0.1 }))
    const r = optimizeWeighted(BENCH_BOX, items, { emptyG: 500, maxG: 60_000 })
    expect(r.weight.grossG).toBeLessThanOrEqual(60_000 + 1e-6)
    expect(r.weightLimited).toBe(true)
    expect(problems(BENCH_BOX, r.layout.placements)).toEqual([])
    expect(r.layout.placedCount).toBeGreaterThan(0)
  })
})
