import { describe, expect, it } from 'vitest'
import type { Placement } from './layout'
import { optimize, verifyPlacements, type PackItem } from './optimizer'
import { SAMPLE_BOX, SAMPLE_ITEM, type Dims } from './pack'
import {
  blankW,
  editW,
  formatWeight,
  fromGrams,
  parseWeight,
  switchW,
  toGrams,
  weightOf,
  weightText,
} from './weight'
import { optimizeWeighted, remainingItems } from './weighted'

const item = (id: string, dims: Dims, qty: number | null, weightKg?: number): PackItem => ({
  id, color: '#fff', dims, qty, weightKg,
})
const sample = (qty: number | null, weightKg?: number) => item('a', SAMPLE_ITEM, qty, weightKg)
const none = { emptyG: 0, maxG: null }
const count = (ps: Placement[], id: string) => ps.filter((p) => p.typeId === id).length

describe('weight units', () => {
  it('converts between g and kg', () => {
    expect(toGrams(2.5, 'kg')).toBe(2500)
    expect(toGrams(250, 'g')).toBe(250)
    expect(fromGrams(250, 'kg')).toBe(0.25)
    expect(fromGrams(250, 'g')).toBe(250)
  })
  it('keeps the same weight when the unit is switched and back', () => {
    const f = editW('0.25', 'kg')
    expect(f.g).toBe(250)
    const g = switchW(f, 'g')
    expect(g.text).toBe('250')
    expect(g.g).toBe(250)
    expect(switchW(g, 'kg')).toEqual({ text: '0.25', g: 250, valid: true })
    // Grams that kg text cannot show exactly are not lost: the stored value stays.
    const odd = switchW(editW('1234.6', 'g'), 'kg')
    expect(odd.text).toBe('1.235')
    expect(odd.g).toBe(1234.6)
  })
  it('formats for display', () => {
    expect(formatWeight(12345, 'kg')).toBe('12.345 kg')
    expect(formatWeight(12345, 'g')).toBe('12,345 g')
    expect(formatWeight(0, 'kg')).toBe('0 kg')
    expect(weightText(1500, 'kg')).toBe('1.5')
  })
  it('parses weights', () => {
    expect(parseWeight('')).toEqual({ ok: true, value: null })
    expect(parseWeight('0')).toEqual({ ok: true, value: 0 })
    expect(parseWeight('1,5')).toEqual({ ok: true, value: 1.5 })
    for (const bad of ['-1', 'abc', '1e3', '1.2.3', 'Infinity']) expect(parseWeight(bad).ok).toBe(false)
    expect(editW('abc', 'kg')).toEqual({ text: 'abc', g: null, valid: false })
    expect(blankW()).toEqual({ text: '', g: null, valid: true })
  })
})

describe('weight totals', () => {
  const g = new Map([['a', 500], ['b', 250]])
  const ps = [{ typeId: 'a' }, { typeId: 'a' }, { typeId: 'b' }]
  it('adds product, empty box and gross weight', () => {
    const w = weightOf(ps, g, { emptyG: 300, maxG: 2000 })
    expect(w.productG).toBe(1250)
    expect(w.grossG).toBe(1550)
    expect(w.remainingG).toBe(450)
    expect(w.overLimit).toBe(false)
    expect(w.ratio).toBeCloseTo(0.775, 10)
  })
  it('flags an arrangement over the limit and reports by how much', () => {
    const w = weightOf(ps, g, { emptyG: 300, maxG: 1500 })
    expect(w.overLimit).toBe(true)
    expect(w.overByG).toBe(50)
    expect(w.remainingG).toBe(0)
  })
  it('treats exactly the limit as allowed', () => {
    const w = weightOf(ps, g, { emptyG: 250, maxG: 1500 })
    expect(w.overLimit).toBe(false)
    expect(w.remainingG).toBe(0)
  })
  it('has no limit and no remaining capacity figure when the maximum is blank', () => {
    const w = weightOf(ps, g, { emptyG: 0, maxG: null })
    expect(w.remainingG).toBeNull()
    expect(w.ratio).toBeNull()
    expect(w.overLimit).toBe(false)
  })
  it('does not trip on float sums (3 × 0.1 kg against 0.3 kg)', () => {
    const three = [{ typeId: 'x' }, { typeId: 'x' }, { typeId: 'x' }]
    expect(weightOf(three, new Map([['x', 100 * 1.0000000001]]), { emptyG: 0, maxG: 300 }).overLimit).toBe(false)
  })
})

describe('weight-aware packing', () => {
  it('is identical to the plain optimizer when no limit is set', () => {
    const items = [sample(null, 1)]
    const plain = optimize(SAMPLE_BOX, items)
    const r = optimizeWeighted(SAMPLE_BOX, items, none)
    expect(r.layout.placedCount).toBe(plain.layout.placedCount)
    expect(r.layout.placedCount).toBeGreaterThanOrEqual(24)
    expect(r.weightLimited).toBe(false)
    expect(r.heldBackByWeight).toBe(0)
  })
  it('is identical to the plain optimizer when the limit is not reached', () => {
    const plain = optimize(SAMPLE_BOX, [sample(null, 1)])
    const r = optimizeWeighted(SAMPLE_BOX, [sample(null, 1)], { emptyG: 500, maxG: 1e6 })
    expect(r.layout.placedCount).toBe(plain.layout.placedCount)
    expect(r.weightLimited).toBe(false)
  })
  it('stops placing units once the weight limit would be exceeded', () => {
    // 26 fit in space, but 10 kg of 1 kg units allows only 10.
    const r = optimizeWeighted(SAMPLE_BOX, [sample(null, 1)], { emptyG: 0, maxG: 10_000 })
    expect(r.layout.placedCount).toBe(10)
    expect(r.weight.productG).toBe(10_000)
    expect(r.weight.overLimit).toBe(false)
    expect(r.weightLimited).toBe(true)
    expect(r.heldBackByWeight).toBeGreaterThanOrEqual(16)
    expect(r.warnings.join(' ')).toMatch(/Weight limit reached/)
    expect(verifyPlacements(SAMPLE_BOX, r.layout.placements)).toBe(true)
  })
  it('counts the empty box against the limit', () => {
    const r = optimizeWeighted(SAMPLE_BOX, [sample(null, 1)], { emptyG: 2_000, maxG: 10_000 })
    expect(r.layout.placedCount).toBe(8)
    expect(r.weight.grossG).toBe(10_000)
    expect(r.weight.remainingG).toBe(0)
  })
  it('reports a fixed quantity that does not fit by weight as unplaced', () => {
    const r = optimizeWeighted(SAMPLE_BOX, [sample(20, 1)], { emptyG: 0, maxG: 12_500 })
    expect(r.layout.placedCount).toBe(12)
    expect(r.layout.totalCount).toBe(20)
    expect(r.layout.unplacedCount).toBe(8)
    expect(r.status).toBe('partial')
    expect(r.heldBackByWeight).toBe(8)
  })
  it('weighs the exact limit as allowed', () => {
    const r = optimizeWeighted(SAMPLE_BOX, [sample(5, 2)], { emptyG: 0, maxG: 10_000 })
    expect(r.layout.placedCount).toBe(5)
    expect(r.weight.overLimit).toBe(false)
    expect(r.weightLimited).toBe(false)
  })
  it('places nothing when the maximum is not above the empty box', () => {
    const r = optimizeWeighted(SAMPLE_BOX, [sample(5, 1)], { emptyG: 5_000, maxG: 5_000 })
    expect(r.layout.placedCount).toBe(0)
    expect(r.status).toBe('none')
    expect(r.warnings.join(' ')).toMatch(/not above the empty box/)
    expect(r.layout.unplacedCount).toBe(5)
  })
  it('ignores weight for items without one', () => {
    const r = optimizeWeighted(SAMPLE_BOX, [sample(null)], { emptyG: 0, maxG: 100 })
    expect(r.layout.placedCount).toBeGreaterThanOrEqual(24)
  })
  it('keeps heavy and light types within the limit and fills with the lighter ones first', () => {
    const heavy = item('h', { l: 200, w: 200, h: 100 }, 10, 5)
    const light = item('l', { l: 100, w: 100, h: 100 }, 60, 0.1)
    const r = optimizeWeighted(SAMPLE_BOX, [heavy, light], { emptyG: 0, maxG: 20_000 })
    const ps = r.layout.placements
    expect(r.weight.productG).toBeLessThanOrEqual(20_000)
    expect(count(ps, 'l')).toBe(60) // all light units (6 kg)
    expect(count(ps, 'h')).toBe(2) // 14 kg left: two 5 kg units
    expect(verifyPlacements(SAMPLE_BOX, ps)).toBe(true)
  })
  it('keeps the statistics identical to the placements', () => {
    const r = optimizeWeighted(SAMPLE_BOX, [sample(null, 0.75)], { emptyG: 400, maxG: 9_000 })
    const used = r.layout.placements.reduce((s, p) => s + p.size.l * p.size.w * p.size.h, 0)
    expect(r.layout.usedVolumeMm3).toBe(used)
    expect(r.layout.freeVolumeMm3).toBe(96e6 - used)
    expect(r.layout.placedCount).toBe(r.layout.placements.length)
    expect(r.weight.productG).toBeCloseTo(r.layout.placedCount * 750, 6)
    expect(r.totalWeightKg).toBeCloseTo(r.layout.placedCount * 0.75, 9)
  })
  it('is deterministic', () => {
    const items = [item('h', { l: 200, w: 200, h: 100 }, 10, 5), item('l', { l: 100, w: 100, h: 100 }, 60, 0.1)]
    const a = optimizeWeighted(SAMPLE_BOX, items, { emptyG: 0, maxG: 20_000 })
    const b = optimizeWeighted(SAMPLE_BOX, items, { emptyG: 0, maxG: 20_000 })
    const sig = (r: typeof a) => r.layout.placements.map((p) => `${p.typeId}${p.x},${p.y},${p.z},${p.size.l}`).join('|')
    expect(sig(a)).toBe(sig(b))
  })
  it('never exceeds the limit in random cases and always returns valid placements', () => {
    let seed = 11
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let i = 0; i < 25; i++) {
      const items = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, k) =>
        item(`t${k}`, { l: 40 + rnd() * 160, w: 40 + rnd() * 160, h: 40 + rnd() * 160 }, rnd() < 0.3 ? null : 1 + Math.floor(rnd() * 20), 0.1 + rnd() * 3),
      )
      const maxG = 2000 + rnd() * 20_000
      const emptyG = rnd() * 1500
      const r = optimizeWeighted(SAMPLE_BOX, items, { emptyG, maxG })
      expect(r.weight.grossG).toBeLessThanOrEqual(maxG + 1e-6)
      expect(verifyPlacements(SAMPLE_BOX, r.layout.placements)).toBe(true)
    }
  })
  it('rejects invalid input like the optimizer does', () => {
    expect(optimizeWeighted(SAMPLE_BOX, [], none).status).toBe('rejected')
  })
})

describe('preparing for multi-box orders', () => {
  it('returns what is left to pack into the next box', () => {
    const items = [sample(40, 1), item('b', { l: 50, w: 50, h: 50 }, 7, 0.1), item('c', { l: 50, w: 50, h: 50 }, null, 0.1)]
    const r = optimizeWeighted(SAMPLE_BOX, items, { emptyG: 0, maxG: 10_000 })
    const left = remainingItems(items, r.layout)
    for (const l of left) {
      const original = items.find((i) => i.id === l.id)!
      expect(l.qty).toBe((original.qty as number) - (r.layout.types.find((t) => t.typeId === l.id)!.placed))
    }
    expect(left.some((l) => l.id === 'c')).toBe(false) // "as many as fit" is never carried over
    const placed = r.layout.placedCount
    expect(placed).toBeGreaterThan(0)
    const next = optimizeWeighted(SAMPLE_BOX, left, { emptyG: 0, maxG: 10_000 })
    expect(next.layout.placedCount).toBeGreaterThan(0)
  })
})
