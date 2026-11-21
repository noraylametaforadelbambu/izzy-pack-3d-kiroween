import { describe, expect, it } from 'vitest'
import { BENCH_BOX, groupedOrder, lcg, tilingOrder } from './benchmarkData'
import { problems } from './layoutProblems'
import { optimize, type OptimizeResult, type PackItem } from './optimizer'
import type { Dims } from './pack'
import { optimizeWeighted } from './weighted'

/**
 * Orders with explicit quantities that do not fit whole. The choice among the candidate arrangements is:
 * (1) most pieces of the explicit-quantity types, (2) most placed volume, (3) smallest bounding box.
 * "As many as fit" types never take priority over explicit quantities, and weight limits still apply.
 */

const CUBE: Dims = { l: 100, w: 100, h: 100 }
const item = (id: string, l: number, w: number, h: number, qty: number | null, weightKg?: number): PackItem => ({ id, color: '#fff', dims: { l, w, h }, qty, weightKg })
const placed = (r: OptimizeResult, id: string): number => r.layout.placements.filter((p) => p.typeId === id).length

describe('pieces first, then volume (explicit quantities that do not fit)', () => {
  const big = item('big', 100, 100, 90, 1) // one piece, 900,000 mm³
  const small = item('small', 30, 30, 30, 27) // 27 pieces, 729,000 mm³

  it('places more pieces even when fewer, larger pieces would fill more volume', () => {
    const r = optimize(CUBE, [big, small])
    expect(r.status).toBe('partial')
    expect(placed(r, 'small')).toBe(27)
    expect(placed(r, 'big')).toBe(0)
    expect(r.layout.placedCount).toBe(27)
    expect(r.layout.usedVolumeMm3).toBe(729_000) // less volume than the single big piece (900,000)
    expect(r.layout.unplacedCount).toBe(1)
    expect(problems(CUBE, r.layout.placements)).toEqual([])
  })
  it('does not depend on the order the types are entered', () => {
    const a = optimize(CUBE, [big, small])
    const b = optimize(CUBE, [small, big])
    expect(b.layout.placedCount).toBe(a.layout.placedCount)
    expect(placed(b, 'small')).toBe(27)
  })
  it('breaks a tie in pieces by placed volume', () => {
    // either one 100 mm cube or one 10 mm cube fits (never both): one piece each, so the volume decides
    const r = optimize(CUBE, [item('tiny', 10, 10, 10, 1), item('full', 100, 100, 100, 1)])
    expect(r.layout.placedCount).toBe(1)
    expect(placed(r, 'full')).toBe(1)
    expect(r.layout.usedVolumeMm3).toBe(1_000_000)
  })
  it('keeps choosing by volume when everything fits', () => {
    const r = optimize({ l: 600, w: 400, h: 400 }, [item('a', 220, 150, 90, 16)])
    expect(r.status).toBe('complete')
    expect(r.layout.placedCount).toBe(16)
    expect(r.layout.usedPct).toBeCloseTo(49.5, 9)
  })
})

describe('explicit quantities come before "as many as fit" types', () => {
  it('places the explicit piece rather than a thousand unspecified ones of the same volume', () => {
    const r = optimize(CUBE, [item('fill', 10, 10, 10, null), item('one', 100, 100, 100, 1)])
    expect(placed(r, 'one')).toBe(1)
    expect(placed(r, 'fill')).toBe(0)
    expect(r.status).toBe('complete')
  })
  it('fills the leftover space with the unspecified type after the explicit pieces', () => {
    const r = optimize(CUBE, [item('fill', 10, 10, 10, null), item('slab', 100, 100, 50, 1)])
    expect(placed(r, 'slab')).toBe(1)
    expect(placed(r, 'fill')).toBeGreaterThan(100) // the remaining 100 x 100 x 50 mm
    expect(problems(CUBE, r.layout.placements)).toEqual([])
  })
  it('under a weight limit the explicit pieces still win over the lighter unspecified ones', () => {
    // payload 12 kg: lightest-first would take the 0.1 kg pieces and leave out the 5 kg ones
    const items = [item('heavy', 100, 100, 100, 2, 5), item('light', 10, 10, 10, null, 0.1)]
    const r = optimizeWeighted({ l: 300, w: 200, h: 100 }, items, { emptyG: 0, maxG: 12_000 })
    expect(placed(r, 'heavy')).toBe(2)
    expect(r.weight.grossG).toBeLessThanOrEqual(12_000 + 1e-6)
    expect(r.weight.overLimit).toBe(false)
    expect(r.layout.unplacedCount).toBe(0)
  })
})

describe('weight limits still apply to partial orders', () => {
  it('never exceeds the maximum and stays valid for explicit orders that do not fit', () => {
    const rand = lcg(77)
    for (let i = 0; i < 12; i++) {
      const items = [0, 1, 2].map((k) => item(`t${k}`, 40 + rand() * 120, 40 + rand() * 120, 30 + rand() * 90, 8 + Math.floor(rand() * 25), 0.2 + rand() * 2))
      const spec = { emptyG: rand() * 500, maxG: 4_000 + rand() * 12_000 }
      const r = optimizeWeighted({ l: 500, w: 350, h: 300 }, items, spec)
      expect(r.weight.grossG).toBeLessThanOrEqual(spec.maxG + 1e-6)
      expect(problems({ l: 500, w: 350, h: 300 }, r.layout.placements)).toEqual([])
      expect(r.layout.placedCount + r.layout.unplacedCount).toBe(items.reduce((s, it) => s + it.qty!, 0))
    }
  })
})

describe('strategies and the new choice', () => {
  const partial = (seed: number): { box: Dims; items: PackItem[] } => {
    const rand = lcg(seed)
    return {
      box: { l: 300 + Math.floor(rand() * 300), w: 250 + Math.floor(rand() * 200), h: 200 + Math.floor(rand() * 200) },
      items: Array.from({ length: 2 + Math.floor(rand() * 3) }, (_, i) => item(`t${i}`, 40 + Math.floor(rand() * 110), 40 + Math.floor(rand() * 90), 30 + Math.floor(rand() * 80), 30 + Math.floor(rand() * 60))),
    }
  }
  it('the chosen layout has the most pieces among all valid candidates, then the most volume', () => {
    let partials = 0
    for (let seed = 1; seed <= 20; seed++) {
      const { box, items } = partial(seed)
      const r = optimize(box, items)
      const ok = r.stats.candidates.filter((c) => c.valid)
      expect(ok.length).toBeGreaterThan(0)
      const maxCount = Math.max(...ok.map((c) => c.placedCount))
      expect(r.layout.placedCount).toBe(maxCount)
      expect(r.layout.usedVolumeMm3).toBe(Math.max(...ok.filter((c) => c.placedCount === maxCount).map((c) => c.usedVolumeMm3)))
      expect(problems(box, r.layout.placements)).toEqual([])
      if (r.status === 'partial') partials++
    }
    expect(partials).toBeGreaterThan(10) // most of these orders really do not fit whole
  }, 120_000)

  it('the layered patterns, the extreme-point search and (large orders) blocks all take part', () => {
    const { box, items } = partial(3)
    const r = optimize(box, items)
    const strategies = new Set(r.stats.candidates.map((c) => c.strategy))
    expect(strategies.has('layer-dp-slabs')).toBe(true)
    expect(strategies.has('extreme-points')).toBe(true)
    const big = optimize(BENCH_BOX, groupedOrder(10, 700, 1)) // far more volume than the box holds
    expect(big.status).toBe('partial')
    expect(new Set(big.stats.candidates.map((c) => c.strategy)).has('block-extreme-points')).toBe(true)
    const ok = big.stats.candidates.filter((c) => c.valid)
    expect(big.layout.placedCount).toBe(Math.max(...ok.map((c) => c.placedCount)))
    expect(problems(BENCH_BOX, big.layout.placements)).toEqual([])
  }, 120_000)

  it('is deterministic', () => {
    const { box, items } = partial(5)
    const sig = (r: OptimizeResult): string => r.layout.placements.map((p) => `${p.typeId}:${p.x},${p.y},${p.z}:${p.size.l}x${p.size.w}x${p.size.h}`).join('|')
    expect(sig(optimize(box, items))).toBe(sig(optimize(box, items)))
  })

  it('reports every unit that was left out, per type, and never places more than requested', () => {
    const { box, items } = partial(8)
    const r = optimize(box, items)
    for (const it of items) expect(placed(r, it.id)).toBeLessThanOrEqual(it.qty!)
    expect(r.layout.placedCount + r.layout.unplacedCount).toBe(items.reduce((s, it) => s + it.qty!, 0))
    expect(r.layout.types.map((t) => t.requested! - t.placed).reduce((a, b) => a + b, 0)).toBe(r.layout.unplacedCount)
  })

  it('perfectly packable large orders stay valid and reasonably full with the new choice', { timeout: 120_000 }, () => {
    const items = tilingOrder(300, 2)
    const r = optimize(BENCH_BOX, items)
    expect(problems(BENCH_BOX, r.layout.placements)).toEqual([])
    expect(r.layout.usedPct).toBeGreaterThan(60)
  })
})
