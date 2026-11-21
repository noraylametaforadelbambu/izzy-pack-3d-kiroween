import { rowsFromProducts, type TypeRow } from './boxTypes'
import type { CsvProduct } from './csv'
import type { PictogramKind } from './pictogram'
import type { Unit } from './units'
import type { WeightUnit } from './weight'

/**
 * "Try a sample order": three Halloween products (skull masks, black candles, jack-o’-lanterns) with different sizes, quantities and weights. It is loaded through the
 * same path as an imported CSV (`rowsFromProducts`), so units, validation, recommendation and report behave as usual.
 * Sizes in mm, weights in grams. Together they take about 36.6 million mm³, which a medium catalog box holds.
 */
export const SAMPLE_PRODUCTS: CsvProduct[] = [
  { row: 2, name: 'Skull masks', dims: { l: 240, w: 170, h: 70 }, qty: 6, weightG: 120 },
  { row: 3, name: 'Black candles', dims: { l: 70, w: 70, h: 150 }, qty: 12, weightG: 320 },
  { row: 4, name: 'Jack-o’-lanterns', dims: { l: 110, w: 110, h: 110 }, qty: 8, weightG: 85 },
]

/** The pictogram of each sample product, in the same order as SAMPLE_PRODUCTS: skull, black candle, jack-o’-lantern. */
export const SAMPLE_PICTOGRAMS: readonly PictogramKind[] = ['skull', 'candle', 'pumpkin']

/** The sample order as product rows in the selected units, each with its pictogram. */
export function rowsFromSample(unit: Unit, weightUnit: WeightUnit): TypeRow[] {
  return rowsFromProducts(SAMPLE_PRODUCTS, unit, weightUnit).map((r, i) => ({ ...r, pictogram: SAMPLE_PICTOGRAMS[i] }))
}

const round = (v: number | null): number | null => (v === null ? null : Math.round(v * 1e6) / 1e6)

/**
 * What the order is, regardless of the units it is shown in: name, size in mm, quantity text and weight in g, per product.
 * Two orders with the same signature are the same order.
 */
export function orderSignature(rows: TypeRow[]): string {
  return JSON.stringify(
    rows.map((r) => [r.name.trim(), round(r.dims.l.mm), round(r.dims.w.mm), round(r.dims.h.mm), r.qty.trim(), round(r.weight.g)]),
  )
}

export const signatureOfProducts = (products: CsvProduct[]): string =>
  JSON.stringify(products.map((p) => [p.name, round(p.dims.l), round(p.dims.w), round(p.dims.h), String(p.qty), round(p.weightG)]))

/** True when the products are exactly the start-up order or the untouched sample: replacing them loses nothing. */
export function isUntouchedOrder(rows: TypeRow[], startSignature: string): boolean {
  const sig = orderSignature(rows)
  return sig === startSignature || sig === signatureOfProducts(SAMPLE_PRODUCTS)
}
