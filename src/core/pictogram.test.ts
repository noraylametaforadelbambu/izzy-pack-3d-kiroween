import { describe, expect, it } from 'vitest'
import { PALETTE, cloneRow, newRow, rowsFromProducts } from './boxTypes'
import { PICTOGRAM_KINDS, PICTOGRAM_LABELS } from './pictogram'
import { SAMPLE_PRODUCTS, rowsFromSample } from './sampleOrder'

describe('pictograms in the product list', () => {
  it('every kind has an accessible label', () => {
    expect(Object.keys(PICTOGRAM_LABELS).sort()).toEqual([...PICTOGRAM_KINDS].sort())
    expect(PICTOGRAM_KINDS.every((k) => PICTOGRAM_LABELS[k].length > 0)).toBe(true)
  })
  it('the sample rows carry their pictogram as data (skull, candle, pumpkin), whatever their names are', () => {
    const rows = rowsFromSample('mm', 'kg')
    expect(rows.map((r) => r.pictogram)).toEqual(['skull', 'candle', 'pumpkin'])
    const renamed = rows.map((r) => ({ ...r, name: 'Anything' }))
    expect(renamed.map((r) => r.pictogram)).toEqual(['skull', 'candle', 'pumpkin'])
  })
  it('ordinary rows have none: new, cloned from a sample row, or imported from a CSV, even with the sample names', () => {
    expect(newRow({ l: 10, w: 10, h: 10 }, '1', PALETTE[0], 'mm').pictogram).toBeUndefined()
    expect(cloneRow(rowsFromSample('mm', 'kg')[0], PALETTE[3]).pictogram).toBeUndefined()
    expect(rowsFromProducts(SAMPLE_PRODUCTS, 'mm', 'kg').map((r) => r.pictogram)).toEqual([undefined, undefined, undefined])
  })
})
