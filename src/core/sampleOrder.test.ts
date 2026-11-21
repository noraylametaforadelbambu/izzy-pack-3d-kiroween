import { describe, expect, it } from 'vitest'
import { EXAMPLE_BOXES, newCatalogRow, recommendBox, validateCatalog } from './catalog'
import { PALETTE, cloneRow, editRowField, newRow, rowsFromProducts, switchRow, validateRows } from './boxTypes'
import { CSV_MAX_UNITS, parseProductsCsv } from './csv'
import { problems } from './layoutProblems'
import { SAMPLE_BOX, SAMPLE_ITEM } from './pack'
import { SAMPLE_PICTOGRAMS, SAMPLE_PRODUCTS, isUntouchedOrder, orderSignature, rowsFromSample, signatureOfProducts } from './sampleOrder'
import { weightOf } from './weight'
import { optimizeWeighted } from './weighted'

const none = { emptyG: 0, maxG: null }
const itemsOf = (unit: 'mm' | 'cm' | 'in' = 'mm', w: 'g' | 'kg' | 'lb' = 'kg') => {
  const v = validateRows(rowsFromProducts(SAMPLE_PRODUCTS, unit, w))
  if (!('types' in v)) throw new Error('the sample must be a valid order')
  return v.types
}
const catalog = () => {
  const v = validateCatalog(EXAMPLE_BOXES.map((d) => newCatalogRow(d, 'mm')))
  if (!('boxes' in v)) throw new Error('the example catalog must be valid')
  return v.boxes
}

describe('sample order content', () => {
  it('has three Halloween products: skull masks, black candles and jack-o’-lanterns', () => {
    expect(SAMPLE_PRODUCTS.map((p) => p.name)).toEqual(['Skull masks', 'Black candles', 'Jack-o’-lanterns'])
  })
  it('gives each product a different size, quantity and weight', () => {
    const sizes = new Set(SAMPLE_PRODUCTS.map((p) => `${p.dims.l}x${p.dims.w}x${p.dims.h}`))
    expect(sizes.size).toBe(3)
    expect(new Set(SAMPLE_PRODUCTS.map((p) => p.qty)).size).toBe(3)
    expect(new Set(SAMPLE_PRODUCTS.map((p) => p.weightG)).size).toBe(3)
    expect(SAMPLE_PRODUCTS.every((p) => p.weightG !== null && p.weightG > 0 && p.qty > 0)).toBe(true)
  })
  it('respects the CSV and model limits: it goes through the same CSV parser unchanged', () => {
    const csv = ['name,length_mm,width_mm,height_mm,quantity,weight_g', ...SAMPLE_PRODUCTS.map((p) => `${p.name},${p.dims.l},${p.dims.w},${p.dims.h},${p.qty},${p.weightG}`)].join('\n')
    const r = parseProductsCsv(csv)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.products.map((p) => [p.name, p.dims, p.qty, p.weightG])).toEqual(SAMPLE_PRODUCTS.map((p) => [p.name, p.dims, p.qty, p.weightG]))
      expect(r.totalUnits).toBe(26)
      expect(r.totalUnits).toBeLessThan(CSV_MAX_UNITS)
    }
  })
  it('becomes valid rows in every unit, with the same physical sizes and weights', () => {
    const mm = itemsOf('mm', 'g')
    for (const [u, w] of [['cm', 'kg'], ['in', 'lb'], ['mm', 'kg']] as const) {
      const t = itemsOf(u, w)
      expect(t.map((x) => x.qty)).toEqual([6, 12, 8])
      t.forEach((x, i) => {
        expect(x.dims.l).toBeCloseTo(mm[i].dims.l, 6)
        expect(x.dims.h).toBeCloseTo(mm[i].dims.h, 6)
        expect(x.weightKg).toBeCloseTo(mm[i].weightKg!, 6)
      })
    }
    const rows = rowsFromProducts(SAMPLE_PRODUCTS, 'cm', 'kg')
    expect([rows[0].dims.l.text, rows[0].dims.w.text, rows[0].dims.h.text, rows[0].weight.text, rows[0].qty]).toEqual(['24', '17', '7', '0.12', '6'])
    expect(rows.map((r) => r.color)).toEqual(PALETTE.slice(0, 3))
  })
})

describe('sample order flow: recommendation, 3D layout, report data', () => {
  it('recommends a box from the example catalog with the whole order placed', () => {
    const r = recommendBox(catalog(), itemsOf(), none)
    expect(r.status).toBe('found')
    expect(r.box).not.toBeNull()
    expect(r.orderUnits).toBe(26)
    expect(r.orderVolumeMm3).toBe(36_604_000)
    expect(r.result!.layout.unplacedCount).toBe(0)
    expect(r.result!.layout.placedCount).toBe(26)
    // skipped by volume first, then a real search in the first box that is large enough
    expect(r.trials[0].outcome).toBe('too-small')
    expect(r.trials[r.trials.length - 1].outcome).toBe('fits')
    expect(r.box!.dims.l * r.box!.dims.w * r.box!.dims.h).toBeGreaterThanOrEqual(r.orderVolumeMm3)
  })
  it('the layout is valid and the numbers a report shows add up', () => {
    const items = itemsOf()
    const r = recommendBox(catalog(), items, none)
    const res = r.result!
    expect(problems(r.box!.dims, res.layout.placements)).toEqual([])
    const per = Object.fromEntries(res.layout.types.map((t) => [t.typeId, t]))
    expect(items.map((i) => per[i.id].placed)).toEqual([6, 12, 8])
    expect(res.layout.usedVolumeMm3 + res.layout.freeVolumeMm3).toBeCloseTo(res.layout.boxVolumeMm3, 3)
    const unitG = new Map(items.map((i) => [i.id, (i.weightKg ?? 0) * 1000]))
    const w = weightOf(res.layout.placements, unitG, none)
    expect(w.productG).toBeCloseTo(6 * 120 + 12 * 320 + 8 * 85, 6) // 5,240 g
    expect(w.grossG).toBeCloseTo(5240, 6)
  })
  it('works with weight limits too (box 0.5 kg, maximum 15 kg)', () => {
    const r = recommendBox(catalog(), itemsOf(), { emptyG: 500, maxG: 15_000 })
    expect(r.status).toBe('found')
    expect(r.result!.weight.grossG).toBeCloseTo(5740, 6)
    expect(r.result!.weight.overLimit).toBe(false)
  })
  it('a limit below the order weight is reported, not hidden', () => {
    expect(recommendBox(catalog(), itemsOf(), { emptyG: 500, maxG: 5_000 }).status).toBe('over-weight')
  })
  it('Optimize in the default container also places everything', () => {
    const r = optimizeWeighted(SAMPLE_BOX, itemsOf(), none)
    expect(r.status).toBe('complete')
    expect(r.layout.placedCount).toBe(26)
  })
})

describe('when replacing an order needs confirmation', () => {
  const start = orderSignature([{ ...newRow(SAMPLE_ITEM, '', PALETTE[0], 'mm') }])
  const fresh = () => [newRow(SAMPLE_ITEM, '', PALETTE[0], 'mm')]
  it('does not ask for the start-up order', () => {
    expect(isUntouchedOrder(fresh(), start)).toBe(true)
  })
  it('does not ask for the untouched sample, in any unit', () => {
    for (const [u, w] of [['mm', 'g'], ['cm', 'kg'], ['in', 'lb']] as const) expect(isUntouchedOrder(rowsFromProducts(SAMPLE_PRODUCTS, u, w), start)).toBe(true)
    const rows = rowsFromProducts(SAMPLE_PRODUCTS, 'mm', 'g')
    expect(isUntouchedOrder(rows.map((r) => switchRow(r, 'in')).map((r) => switchRow(r, 'mm')), start)).toBe(true)
  })
  it('asks once the user changed anything: size, quantity, name, weight or the number of products', () => {
    const rows = rowsFromProducts(SAMPLE_PRODUCTS, 'mm', 'g')
    expect(isUntouchedOrder([editRowField(rows[0], 'l', '241', 'mm'), rows[1], rows[2]], start)).toBe(false)
    expect(isUntouchedOrder([rows[0], editRowField(rows[1], 'qty', '13', 'mm'), rows[2]], start)).toBe(false)
    expect(isUntouchedOrder([{ ...rows[0], name: 'Masks' }, rows[1], rows[2]], start)).toBe(false)
    expect(isUntouchedOrder([rows[0], rows[1]], start)).toBe(false)
    expect(isUntouchedOrder([...fresh(), ...fresh()], start)).toBe(false)
    expect(isUntouchedOrder([editRowField(fresh()[0], 'qty', '10', 'mm')], start)).toBe(false)
  })
  it('asks for an imported order', () => {
    const csv = 'name,length_mm,width_mm,height_mm,quantity\nA,10,10,10,3\n'
    const r = parseProductsCsv(csv)
    if (!r.ok) throw new Error('csv')
    expect(isUntouchedOrder(rowsFromProducts(r.products, 'mm', 'g'), start)).toBe(false)
  })
  it('signatures compare physical values, not text', () => {
    expect(orderSignature(rowsFromProducts(SAMPLE_PRODUCTS, 'cm', 'kg'))).toBe(signatureOfProducts(SAMPLE_PRODUCTS))
  })
})

describe('the sample order is Halloween, not Christmas', () => {
  it('names and pictogram kinds avoid ornaments, baubles, gold, green and holiday words', () => {
    const text = [...SAMPLE_PRODUCTS.map((p) => p.name), ...SAMPLE_PICTOGRAMS].join(' ').toLowerCase()
    for (const w of ['ornament', 'bauble', 'christmas', 'xmas', 'gold', 'green', 'holly', 'santa', 'snow', 'tree', 'gift']) expect(text).not.toContain(w)
  })
  it('keeps the sizes, quantities and weights it always had (only names and pictograms changed)', () => {
    expect(SAMPLE_PRODUCTS.map((p) => [p.dims, p.qty, p.weightG])).toEqual([
      [{ l: 240, w: 170, h: 70 }, 6, 120],
      [{ l: 70, w: 70, h: 150 }, 12, 320],
      [{ l: 110, w: 110, h: 110 }, 8, 85],
    ])
  })
})

describe('pictograms of the sample order', () => {
  it('skull masks, black candles and jack-o’-lanterns each have their own pictogram', () => {
    expect(SAMPLE_PICTOGRAMS).toEqual(['skull', 'candle', 'pumpkin'])
    expect(rowsFromSample('mm', 'g').map((r) => r.pictogram)).toEqual(['skull', 'candle', 'pumpkin'])
  })
  it('the rows are the same as an imported sample, plus the pictogram (same sizes, quantities, weights, names)', () => {
    for (const [u, w] of [['mm', 'g'], ['cm', 'kg'], ['in', 'lb']] as const) {
      const a = rowsFromSample(u, w)
      const b = rowsFromProducts(SAMPLE_PRODUCTS, u, w)
      expect(a.map((r) => [r.name, r.dims.l.mm, r.dims.w.mm, r.dims.h.mm, r.qty, r.weight.g, r.color])).toEqual(b.map((r) => [r.name, r.dims.l.mm, r.dims.w.mm, r.dims.h.mm, r.qty, r.weight.g, r.color]))
    }
  })
  it('ordinary rows have none: a new product, a copy of a sample product, an imported or edited one', () => {
    expect(newRow(SAMPLE_ITEM, '', PALETTE[0], 'mm').pictogram).toBeUndefined()
    const rows = rowsFromSample('mm', 'g')
    expect(cloneRow(rows[0], PALETTE[5]).pictogram).toBeUndefined()
    expect(rowsFromProducts(SAMPLE_PRODUCTS, 'mm', 'g').every((r) => r.pictogram === undefined)).toBe(true)
  })
  it('editing or switching units keeps the pictogram of that product', () => {
    const r = rowsFromSample('mm', 'g')[1]
    expect(editRowField(r, 'qty', '3', 'mm').pictogram).toBe('candle')
    expect(switchRow(r, 'in').pictogram).toBe('candle')
  })
  it('the order signature ignores pictograms, so the untouched sample still needs no confirmation', () => {
    expect(orderSignature(rowsFromSample('mm', 'g'))).toBe(signatureOfProducts(SAMPLE_PRODUCTS))
  })
})
