import { describe, expect, it } from 'vitest'
import {
  EXAMPLE_BOXES,
  MAX_CATALOG,
  editCatalogRow,
  newCatalogRow,
  recommendBox,
  sortByVolume,
  switchCatalogRow,
  validateCatalog,
  type CatalogBox,
} from './catalog'
import { problems } from './layoutProblems'
import type { PackItem } from './optimizer'
import { volume, type Dims } from './pack'
import { toGrams, type WeightSpec } from './weight'
import { optimizeWeighted } from './weighted'

const none: WeightSpec = { emptyG: 0, maxG: null }
const box = (id: string, l: number, w: number, h: number): CatalogBox => ({ id, dims: { l, w, h } })
const item = (id: string, l: number, w: number, h: number, qty: number | null, weightKg?: number): PackItem => ({ id, color: '#fff', dims: { l, w, h }, qty, weightKg })
const sig = (r: { layout: { placements: { typeId: string; x: number; y: number; z: number; size: Dims }[] } }): string =>
  r.layout.placements.map((p) => `${p.typeId}:${p.x},${p.y},${p.z}:${p.size.l}x${p.size.w}x${p.size.h}`).join('|')

/** Reference: try the boxes by ascending volume with the plain optimizer and take the first complete one. */
function firstComplete(catalog: CatalogBox[], items: PackItem[], spec: WeightSpec): string | null {
  for (const b of sortByVolume(catalog)) {
    const r = optimizeWeighted(b.dims, items, spec)
    if (r.layout.unplacedCount === 0 && r.status === 'complete' && !r.weight.overLimit) return b.id
  }
  return null
}

describe('catalog ordering', () => {
  it('sorts by ascending interior volume', () => {
    const list = [box('big', 600, 400, 400), box('small', 100, 100, 100), box('mid', 300, 200, 150)]
    expect(sortByVolume(list).map((b) => b.id)).toEqual(['small', 'mid', 'big'])
  })
  it('keeps the catalog order for equal volumes and does not change the input list', () => {
    const list = [box('a', 200, 100, 100), box('b', 100, 200, 100), box('c', 100, 100, 200), box('z', 50, 50, 50)]
    const before = JSON.stringify(list)
    expect(sortByVolume(list).map((b) => b.id)).toEqual(['z', 'a', 'b', 'c'])
    expect(JSON.stringify(list)).toBe(before)
  })
  it('tries identical sizes once', () => {
    expect(sortByVolume([box('a', 100, 100, 100), box('b', 100, 100, 100), box('c', 90, 90, 90)]).map((b) => b.id)).toEqual(['c', 'a'])
  })
  it('ships examples that are valid and already in ascending volume', () => {
    expect(EXAMPLE_BOXES.length).toBeGreaterThan(1)
    const v = EXAMPLE_BOXES.map(volume)
    expect([...v].sort((a, b) => a - b)).toEqual(v)
    expect(MAX_CATALOG).toBeGreaterThanOrEqual(EXAMPLE_BOXES.length)
  })
})

describe('catalog rows and units (mm, cm, in)', () => {
  it('shows the sizes in the selected unit', () => {
    const r = newCatalogRow({ l: 300, w: 200, h: 150 }, 'cm')
    expect([r.dims.l.text, r.dims.w.text, r.dims.h.text]).toEqual(['30', '20', '15'])
    const inch = newCatalogRow({ l: 304.8, w: 203.2, h: 152.4 }, 'in')
    expect([inch.dims.l.text, inch.dims.w.text, inch.dims.h.text]).toEqual(['12', '8', '6'])
  })
  it('keeps the physical size through every unit and back', () => {
    const start = newCatalogRow({ l: 333.37, w: 99.99, h: 12.345 }, 'mm')
    let r = start
    for (const u of ['cm', 'in', 'mm', 'in', 'cm', 'mm'] as const) r = switchCatalogRow(r, u)
    expect(r.dims).toEqual(start.dims)
    const v = validateCatalog([r])
    expect('boxes' in v && v.boxes[0].dims).toEqual({ l: 333.37, w: 99.99, h: 12.345 })
  })
  it('typing the same size in cm or in mm gives the same box', () => {
    const base = newCatalogRow({ l: 1, w: 1, h: 1 }, 'cm')
    const typedCm = editCatalogRow(editCatalogRow(editCatalogRow(base, 'l', '30', 'cm'), 'w', '20', 'cm'), 'h', '15', 'cm')
    const typedMm = editCatalogRow(editCatalogRow(editCatalogRow(base, 'l', '300', 'mm'), 'w', '200', 'mm'), 'h', '150', 'mm')
    const a = validateCatalog([typedCm])
    const b = validateCatalog([typedMm])
    expect('boxes' in a && 'boxes' in b && a.boxes[0].dims).toEqual('boxes' in b ? b.boxes[0].dims : null)
  })
  it('flags empty, zero, negative and non-numeric sizes', () => {
    let r = newCatalogRow({ l: 300, w: 200, h: 150 }, 'mm')
    r = editCatalogRow(r, 'l', '', 'mm')
    r = editCatalogRow(r, 'w', '0', 'mm')
    r = editCatalogRow(r, 'h', 'abc', 'mm')
    expect(validateCatalog([r])).toEqual({ invalid: [`${r.id}.l`, `${r.id}.w`, `${r.id}.h`] })
    expect('boxes' in validateCatalog([newCatalogRow({ l: 1, w: 1, h: 1 }, 'mm')])).toBe(true)
    expect(editCatalogRow(r, 'l', '-5', 'mm').dims.l.mm).toBeNull()
  })
  it('gives each row a unique id', () => {
    const ids = Array.from({ length: 20 }, () => newCatalogRow({ l: 1, w: 1, h: 1 }, 'mm').id)
    expect(new Set(ids).size).toBe(20)
  })
})

describe('recommendation: smallest box with a complete arrangement', () => {
  const catalog = [box('big', 600, 400, 400), box('tiny', 100, 100, 100), box('mid', 400, 300, 200), box('large', 600, 400, 300)]

  it('takes the first box, by ascending volume, in which the optimizer places the whole order', () => {
    const items = [item('a', 220, 150, 90, 10)]
    const r = recommendBox(catalog, items, none)
    expect(r.status).toBe('found')
    expect(r.box?.id).toBe(firstComplete(catalog, items, none))
    // every box tried before it is smaller and not complete; the recommended one is the last trial
    const vols = r.trials.map((t) => t.volumeMm3)
    expect([...vols].sort((a, b) => a - b)).toEqual(vols)
    expect(r.trials.slice(0, -1).every((t) => t.outcome !== 'fits')).toBe(true)
    expect(r.trials[r.trials.length - 1]).toMatchObject({ boxId: r.box?.id, outcome: 'fits', placed: 10, requested: 10 })
    expect(r.trials.some((t) => t.boxId === 'tiny' && t.outcome === 'too-small')).toBe(true)
  })

  it('returns a layout of the whole order in that box, valid by an independent check', () => {
    const items = [item('a', 220, 150, 90, 10), item('b', 100, 100, 100, 12)]
    const r = recommendBox(catalog, items, none)
    expect(r.status).toBe('found')
    const ps = r.result!.layout.placements
    expect(problems(r.box!.dims, ps)).toEqual([])
    expect(ps.filter((p) => p.typeId === 'a')).toHaveLength(10)
    expect(ps.filter((p) => p.typeId === 'b')).toHaveLength(12)
    expect(r.result!.layout.unplacedCount).toBe(0)
    expect(r.result!.layout.box).toEqual(r.box!.dims)
    expect(r.result!.layout.usedVolumeMm3).toBe(10 * 220 * 150 * 90 + 12 * 1e6)
  })

  it('does not depend on the order of the catalog list', () => {
    const items = [item('a', 220, 150, 90, 10)]
    const a = recommendBox(catalog, items, none)
    const b = recommendBox([...catalog].reverse(), items, none)
    expect(b.box?.id).toBe(a.box?.id)
    expect(sig(b.result!)).toBe(sig(a.result!))
  })

  it('matches the plain optimizer for each box it tried (nothing is changed in the packing)', () => {
    const items = [item('a', 220, 150, 90, 30)] // 89 million mm³: too big for the small boxes by volume, partial in 600 x 400 x 400
    const r = recommendBox([...catalog, box('huge', 900, 600, 600)], items, none)
    expect(r.box?.id).toBe('huge')
    expect(r.trials.some((t) => t.outcome === 'partial')).toBe(true)
    for (const t of r.trials.filter((x) => x.outcome !== 'too-small')) {
      const direct = optimizeWeighted(t.dims, items, none)
      expect(t.placed).toBe(direct.layout.placedCount)
    }
    const direct = optimizeWeighted(r.box!.dims, items, none)
    expect(sig(r.result!)).toBe(sig(direct))
  })

  it('is deterministic', () => {
    const items = [item('a', 220, 150, 90, 20), item('b', 80, 80, 80, 15)]
    const a = recommendBox(catalog, items, none)
    const b = recommendBox(catalog, items, none)
    expect(b.box?.id).toBe(a.box?.id)
    expect(sig(b.result!)).toBe(sig(a.result!))
  })

  it('accepts a box that holds the order exactly', () => {
    const r = recommendBox([box('exact', 300, 200, 100)], [item('a', 100, 100, 100, 6)], none)
    expect(r.status).toBe('found')
    expect(r.result!.layout.usedPct).toBeCloseTo(100, 9)
  })

  it('skips boxes whose volume is smaller than the order without searching them', () => {
    const calls: string[] = []
    const r = recommendBox([box('small', 100, 100, 100), box('ok', 300, 300, 300)], [item('a', 100, 100, 100, 5)], none, {}, (p) => calls.push(p.phase))
    expect(r.trials[0]).toMatchObject({ boxId: 'small', outcome: 'too-small', placed: 0 })
    expect(r.box?.id).toBe('ok')
    expect(calls.some((c) => c.startsWith('Box 1 of 2'))).toBe(true)
    expect(calls.some((c) => c.startsWith('Box 2 of 2'))).toBe(true)
  })
})

describe('recommendation: partial arrangements never qualify', () => {
  it('a box that fits only part of the order is reported as partial and not recommended', () => {
    // 30 units are 89 million mm³ (the box has 96 million) but the search places fewer
    const items = [item('a', 220, 150, 90, 30)]
    const r = recommendBox([box('only', 600, 400, 400)], items, none)
    expect(r.status).toBe('not-found')
    expect(r.box).toBeNull()
    expect(r.result).toBeNull()
    const t = r.trials[0]
    expect(t.outcome).toBe('partial')
    expect(t.placed).toBeGreaterThan(0)
    expect(t.placed).toBeLessThan(30)
    expect(t.placed).toBe(optimizeWeighted(t.dims, items, none).layout.placedCount) // same number the optimizer gives alone
  })
  it('keeps looking at larger boxes after a partial one', () => {
    const items = [item('a', 220, 150, 90, 30)]
    const r = recommendBox([box('p', 600, 400, 400), box('q', 900, 600, 600)], items, none)
    expect(r.status).toBe('found')
    expect(r.box?.id).toBe('q')
    expect(r.trials[0].outcome).toBe('partial')
  })
})

describe('recommendation: weight limits', () => {
  const catalog = [box('s', 300, 200, 200), box('m', 400, 300, 300), box('l', 600, 400, 400)]
  const items = [item('a', 100, 100, 100, 10, 1)] // 10 kg of products

  it('recommends a box when the order is within the configured weight limit', () => {
    const r = recommendBox(catalog, items, { emptyG: 500, maxG: 12_000 })
    expect(r.status).toBe('found')
    expect(r.result!.weight.overLimit).toBe(false)
    expect(r.result!.weight.grossG).toBeLessThanOrEqual(12_000)
    expect(r.result!.weight.productG).toBe(10_000)
  })
  it('accepts a gross weight exactly at the limit', () => {
    const r = recommendBox(catalog, items, { emptyG: 2_000, maxG: 12_000 })
    expect(r.status).toBe('found')
    expect(r.result!.weight.grossG).toBe(12_000)
    expect(r.result!.weight.remainingG).toBe(0)
  })
  it('one gram over the limit: no box can hold the whole order, whatever its size', () => {
    const r = recommendBox(catalog, items, { emptyG: 2_001, maxG: 12_000 })
    expect(r.status).toBe('over-weight')
    expect(r.box).toBeNull()
    expect(r.trials).toEqual([]) // nothing was searched
    expect(r.orderWeightG).toBe(10_000)
  })
  it('uses the same limit for every box and works in pounds', () => {
    const lb = recommendBox(catalog, items, { emptyG: toGrams(1, 'lb'), maxG: toGrams(25, 'lb') })
    expect(lb.status).toBe('found')
    expect(lb.result!.weight.grossG).toBeLessThanOrEqual(toGrams(25, 'lb') + 1e-6)
    expect(recommendBox(catalog, items, { emptyG: toGrams(1, 'lb'), maxG: toGrams(20, 'lb') }).status).toBe('over-weight') // 22.05 lb of products
  })
  it('items without a weight do not limit anything', () => {
    expect(recommendBox(catalog, [item('a', 100, 100, 100, 10)], { emptyG: 500, maxG: 1_000 }).status).toBe('found')
  })
  it('the reference search agrees with the recommendation under a weight limit', () => {
    const spec = { emptyG: 300, maxG: 20_000 }
    const r = recommendBox(catalog, items, spec)
    expect(r.box?.id).toBe(firstComplete(catalog, items, spec))
  })
})

describe('recommendation: quantities must be explicit', () => {
  it('asks for quantities when any type is blank, and searches nothing', () => {
    const calls: string[] = []
    const r = recommendBox([box('a', 600, 400, 400)], [item('x', 100, 100, 100, 5), item('y', 50, 50, 50, null), item('z', 60, 60, 60, null)], none, {}, (p) => calls.push(p.phase))
    expect(r.status).toBe('needs-quantities')
    expect(r.needsQuantities).toEqual(['y', 'z'])
    expect(r.box).toBeNull()
    expect(r.trials).toEqual([])
    expect(calls).toEqual([])
  })
  it('blank quantities are reported before weight or catalog problems with the order', () => {
    expect(recommendBox([box('a', 10, 10, 10)], [item('x', 100, 100, 100, null, 50)], { emptyG: 0, maxG: 1 }).status).toBe('needs-quantities')
  })
})

describe('recommendation: nothing found', () => {
  const small = [box('a', 100, 100, 100), box('b', 200, 150, 120)]
  const big = [item('x', 100, 100, 100, 50)]
  it('says so without a proof of impossibility', () => {
    const r = recommendBox(small, big, none)
    expect(r.status).toBe('not-found')
    expect(r.box).toBeNull()
    expect(r.result).toBeNull()
    expect(r.message).toBe('')
    expect(r.trials).toHaveLength(2)
    expect(r.trials.every((t) => t.outcome !== 'fits')).toBe(true)
    expect(r.orderUnits).toBe(50)
  })
  it('an empty catalog is its own status', () => {
    expect(recommendBox([], big, none).status).toBe('empty-catalog')
  })
  it('an order without items is invalid', () => {
    const r = recommendBox(small, [], none)
    expect(r.status).toBe('invalid-order')
    expect(r.message).toMatch(/No items/)
  })
  it('an order the optimizer rejects is reported with its reason', () => {
    const r = recommendBox([box('a', 9000, 9000, 9000)], [item('x', 1, 1, 1, 100_001)], none)
    expect(r.status).toBe('invalid-order')
    expect(r.message).toMatch(/Too many items/)
  })
})

describe('recommendation: progress', () => {
  it('reports each box with a step that never exceeds the number of boxes', () => {
    const msgs: { phase: string; step: number; steps: number }[] = []
    recommendBox([box('a', 100, 100, 100), box('b', 200, 200, 200), box('c', 400, 300, 300)], [item('x', 150, 150, 150, 3)], none, {}, (p) => msgs.push(p))
    expect(msgs.length).toBeGreaterThan(2)
    for (const m of msgs) {
      expect(m.steps).toBe(3)
      expect(m.step).toBeGreaterThanOrEqual(1)
      expect(m.step).toBeLessThanOrEqual(3)
      expect(m.phase).toMatch(/^Box \d of 3: /)
    }
    expect(new Set(msgs.map((m) => m.step)).size).toBeGreaterThan(1)
  })
  it('progress callbacks do not change the answer', () => {
    const items = [item('a', 220, 150, 90, 12)]
    const cat = [box('a', 300, 200, 150), box('b', 600, 400, 400)]
    const quiet = recommendBox(cat, items, none)
    const noisy = recommendBox(cat, items, none, {}, () => {})
    expect(noisy.box?.id).toBe(quiet.box?.id)
    expect(sig(noisy.result!)).toBe(sig(quiet.result!))
  })
})

describe('recommendation: random orders and catalogs', () => {
  it('never recommends an incomplete, invalid or overweight layout, and always the first complete box', { timeout: 120_000 }, () => {
    let seed = 21
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    let found = 0
    for (let i = 0; i < 25; i++) {
      const cat = Array.from({ length: 2 + Math.floor(rnd() * 3) }, (_, k) => box(`c${k}`, 120 + rnd() * 400, 100 + rnd() * 300, 80 + rnd() * 300))
      const items = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, k) => item(`t${k}`, 30 + rnd() * 90, 30 + rnd() * 90, 30 + rnd() * 90, 2 + Math.floor(rnd() * 12), 0.1 + rnd()))
      const spec: WeightSpec = { emptyG: rnd() * 800, maxG: 6_000 + rnd() * 14_000 }
      const r = recommendBox(cat, items, spec)
      expect(r.box?.id ?? null).toBe(r.status === 'found' ? r.box!.id : null)
      if (r.status === 'found') {
        found++
        const res = r.result!
        expect(res.layout.unplacedCount).toBe(0)
        for (const it of items) expect(res.layout.placements.filter((p) => p.typeId === it.id)).toHaveLength(it.qty!)
        expect(problems(r.box!.dims, res.layout.placements)).toEqual([])
        expect(res.weight.grossG).toBeLessThanOrEqual(spec.maxG! + 1e-6)
        expect(r.box!.id).toBe(firstComplete(cat, items, spec))
      } else if (r.status === 'not-found') {
        expect(firstComplete(cat, items, spec)).toBeNull()
      }
    }
    expect(found).toBeGreaterThan(5)
  })
})
