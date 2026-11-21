import { describe, expect, it } from 'vitest'
import { editRowField, editRowWeight, newRow, switchRow, switchRowWeight, validateRows } from './boxTypes'
import { dimsToFields, editField, switchFields, validateFields } from './fields'
import { verifyPlacements } from './optimizer'
import { SAMPLE_BOX, SAMPLE_ITEM, type Dims } from './pack'
import { UNITS, formatDim, formatVolume, fromDisplay, parseDim, toDisplay, volumeUnitLabel } from './units'
import {
  G_PER_LB,
  WEIGHT_UNITS,
  editW,
  formatWeight,
  fromGrams,
  switchW,
  toGrams,
  weightText,
  weightOf,
} from './weight'
import { optimizeWeighted } from './weighted'

const sig = (ps: { typeId: string; x: number; y: number; z: number; size: Dims }[]) =>
  ps.map((p) => `${p.typeId}:${p.x},${p.y},${p.z}:${p.size.l}x${p.size.w}x${p.size.h}`).join('|')

describe('dimension units: mm, cm, in', () => {
  it('offers the three units', () => {
    expect([...UNITS]).toEqual(['mm', 'cm', 'in'])
  })
  it('converts exactly between mm and cm', () => {
    expect(toDisplay(600, 'cm')).toBe(60)
    expect(fromDisplay(60, 'cm')).toBe(600)
    expect(fromDisplay(22, 'cm')).toBe(220)
    expect(fromDisplay(1.5, 'cm')).toBe(15)
    expect(toDisplay(25.4, 'in')).toBe(1)
  })
  it('formats dimensions without trailing zeros', () => {
    expect(formatDim(600, 'cm')).toBe('60')
    expect(formatDim(225, 'cm')).toBe('22.5')
    expect(formatDim(220, 'mm')).toBe('220')
    expect(formatDim(220, 'in')).toBe('8.661')
  })
  it('formats volumes in mm³, cm³ and in³', () => {
    expect(formatVolume(48_480_000, 'mm')).toBe('48,480,000')
    expect(formatVolume(48_480_000, 'cm')).toBe('48,480')
    expect(formatVolume(48_480_000, 'in')).toBe('2,958.4')
    expect(formatVolume(1_500, 'cm')).toBe('1.5')
    expect(['mm', 'cm', 'in'].map((u) => volumeUnitLabel(u as never))).toEqual(['mm³', 'cm³', 'in³'])
  })
  it('keeps parsing rules', () => {
    expect(parseDim('22,5')).toBe(22.5)
    for (const bad of ['', '0', '-1', 'abc']) expect(parseDim(bad)).toBeNull()
  })
  it('shows the sample in cm', () => {
    const f = dimsToFields(SAMPLE_BOX, 'cm')
    expect([f.l.text, f.w.text, f.h.text]).toEqual(['60', '40', '40'])
    const i = dimsToFields(SAMPLE_ITEM, 'cm')
    expect([i.l.text, i.w.text, i.h.text]).toEqual(['22', '15', '9'])
  })
  it('never changes the stored size when switching through every unit and back', () => {
    const odd: Dims = { l: 333.37, w: 99.99, h: 12.345 }
    const start = dimsToFields(odd, 'mm')
    let f = start
    for (const u of ['cm', 'in', 'mm', 'in', 'cm', 'mm'] as const) f = switchFields(f, u)
    const out = validateFields(f)
    expect('dims' in out && out.dims).toEqual(odd)
    expect(f).toEqual(start)
  })
  it('gives the same packing whether the sizes were typed in mm or cm', () => {
    const typed = (u: 'mm' | 'cm', v: number[]) => ({
      l: editField(String(v[0]), u), w: editField(String(v[1]), u), h: editField(String(v[2]), u),
    })
    const box = (u: 'mm' | 'cm', k: number) => validateFields(typed(u, [600 / k, 400 / k, 400 / k])) as { dims: Dims }
    const item = (u: 'mm' | 'cm', k: number) => validateFields(typed(u, [220 / k, 150 / k, 90 / k])) as { dims: Dims }
    expect(box('cm', 10).dims).toEqual(box('mm', 1).dims)
    const run = (u: 'mm' | 'cm', k: number) =>
      optimizeWeighted(box(u, k).dims, [{ id: 'a', color: '#fff', dims: item(u, k).dims, qty: null }], { emptyG: 0, maxG: null })
    const a = run('mm', 1)
    const b = run('cm', 10)
    expect(sig(b.layout.placements)).toBe(sig(a.layout.placements))
    expect(b.layout.placedCount).toBeGreaterThanOrEqual(24)
  })
  it('switches whole box-type rows without changing them', () => {
    let r = newRow(SAMPLE_ITEM, '5', '#4fd1c5', 'mm')
    r = editRowField(r, 'l', '225', 'mm')
    const before = JSON.stringify(validateRows([r]))
    for (const u of ['cm', 'in', 'cm', 'mm'] as const) r = switchRow(r, u)
    expect(JSON.stringify(validateRows([r]))).toBe(before)
  })
})

describe('weight units: g, kg, lb', () => {
  it('offers the three units', () => {
    expect([...WEIGHT_UNITS]).toEqual(['g', 'kg', 'lb'])
  })
  it('converts with the exact pound definition', () => {
    expect(G_PER_LB).toBe(453.59237)
    expect(toGrams(1, 'lb')).toBe(453.59237)
    expect(toGrams(2, 'lb')).toBeCloseTo(907.18474, 9)
    expect(fromGrams(453.59237, 'lb')).toBe(1)
    expect(fromGrams(1000, 'lb')).toBeCloseTo(2.2046226218, 9)
    expect(toGrams(1, 'kg')).toBe(1000)
  })
  it('formats pounds', () => {
    expect(weightText(453.59237, 'lb')).toBe('1')
    expect(weightText(1000, 'lb')).toBe('2.205')
    expect(formatWeight(10_000, 'lb')).toBe('22.046 lb')
    expect(formatWeight(500, 'g')).toBe('500 g')
  })
  it('keeps the same weight through g, kg and lb', () => {
    const f = editW('1234.6', 'g')
    let x = f
    for (const u of ['kg', 'lb', 'g', 'lb', 'kg', 'g'] as const) x = switchW(x, u)
    expect(x.g).toBe(1234.6)
    expect(x.text).toBe('1234.6')
    expect(switchW(editW('2', 'lb'), 'g').text).toBe('907.18')
    expect(switchW(editW('2', 'lb'), 'g').g).toBeCloseTo(907.18474, 9)
  })
  it('keeps row weights when the weight unit changes', () => {
    let r = editRowWeight(newRow(SAMPLE_ITEM, '', '#fff', 'mm'), '0.5', 'kg')
    for (const u of ['lb', 'g', 'kg'] as const) r = switchRowWeight(r, u)
    expect(r.weight.g).toBe(500)
    expect(r.weight.text).toBe('0.5')
  })
  it('does not trip on pound totals exactly at the limit', () => {
    const unit = toGrams(2, 'lb')
    const ps = Array.from({ length: 10 }, () => ({ typeId: 'a' }))
    expect(weightOf(ps, new Map([['a', unit]]), { emptyG: 0, maxG: toGrams(20, 'lb') }).overLimit).toBe(false)
    expect(weightOf(ps, new Map([['a', unit]]), { emptyG: 0, maxG: toGrams(19.9, 'lb') }).overLimit).toBe(true)
  })
})

describe('automatic optimization with cm and lb inputs', () => {
  const type = (id: string, cm: [number, number, number], qty: number | null, lb: number) => {
    let r = newRow({ l: 1, w: 1, h: 1 }, qty === null ? '' : String(qty), '#fff', 'cm')
    r = { ...r, id }
    r = editRowField(editRowField(editRowField(r, 'l', String(cm[0]), 'cm'), 'w', String(cm[1]), 'cm'), 'h', String(cm[2]), 'cm')
    return editRowWeight(r, String(lb), 'lb')
  }
  const box = { l: 600, w: 400, h: 400 } // 60 × 40 × 40 cm
  it('respects the weight limit entered in pounds', () => {
    // 2 lb units, 20 lb limit, 1 lb box: 9 units (19 lb) at most, although 26+ fit in space.
    const v = validateRows([type('a', [22, 15, 9], null, 2)])
    const r = optimizeWeighted(box, 'types' in v ? v.types : [], { emptyG: toGrams(1, 'lb'), maxG: toGrams(20, 'lb') })
    expect(r.layout.placedCount).toBe(9)
    expect(r.weight.grossG).toBeLessThanOrEqual(toGrams(20, 'lb') + 1e-6)
    expect(r.weight.overLimit).toBe(false)
    expect(r.heldBackByWeight).toBeGreaterThanOrEqual(17)
    expect(verifyPlacements(box, r.layout.placements)).toBe(true)
  })
  it('gives the same layout for the same physical weights in g, kg and lb', () => {
    const run = (maxText: string, u: 'g' | 'kg' | 'lb', wText: string) => {
      let row = type('a', [22, 15, 9], null, 0)
      row = editRowWeight(row, wText, u)
      const v = validateRows([row])
      return optimizeWeighted(box, 'types' in v ? v.types : [], { emptyG: 0, maxG: editW(maxText, u).g })
    }
    const g = run('10000', 'g', '1000')
    const kg = run('10', 'kg', '1')
    expect(sig(kg.layout.placements)).toBe(sig(g.layout.placements))
    expect(g.layout.placedCount).toBe(10)
    // The same limit expressed in pounds (rounded up to a whole gram-equivalent) allows the same 10 units.
    const lb = run('22.0463', 'lb', '2.2046226218')
    expect(lb.layout.placedCount).toBe(10)
  })
  it('keeps boxes inside the container and apart in a mixed order with a limit', () => {
    const v = validateRows([type('a', [22, 15, 9], 12, 1.5), type('b', [10, 10, 10], 80, 0.25), type('c', [30, 20, 10], 6, 4)])
    const types = 'types' in v ? v.types : []
    const r = optimizeWeighted(box, types, { emptyG: toGrams(2, 'lb'), maxG: toGrams(50, 'lb') })
    expect(verifyPlacements(box, r.layout.placements)).toBe(true)
    expect(r.weight.grossG).toBeLessThanOrEqual(toGrams(50, 'lb') + 1e-6)
    expect(r.layout.placedCount).toBe(r.layout.placements.length)
    expect(r.layout.usedVolumeMm3 + r.layout.freeVolumeMm3).toBeCloseTo(96e6, 3)
    expect(r.layout.placedCount).toBeGreaterThan(0)
  })
})
