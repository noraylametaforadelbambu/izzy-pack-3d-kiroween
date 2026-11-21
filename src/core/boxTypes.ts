import type { CsvProduct } from './csv'
import type { PictogramKind } from './pictogram'
import { dimsToFields, editField, switchFields, validateFields, type DimsFields } from './fields'
import type { PackItem } from './optimizer'
import type { Dims } from './pack'
import type { Unit } from './units'
import { blankW, editW, switchW, wFromGrams, type WeightUnit, type WField } from './weight'

/** Distinct colors, assigned in order to new box types. */
export const PALETTE = [
  '#4fd1c5',
  '#f6ad55',
  '#b794f4',
  '#fc8181',
  '#68d391',
  '#63b3ed',
  '#f6e05e',
  '#f687b3',
] as const

export const MAX_TYPES = PALETTE.length
export const MAX_QTY = 100_000

/** One row of the box-type list as the user edits it. */
export interface TypeRow {
  id: string
  /** Product name shown in lists and the report. Empty means "Type n". */
  name: string
  color: string
  dims: DimsFields
  /** Text of the quantity field. Empty means "as many as fit". */
  qty: string
  /** Weight of one unit. Blank means unspecified (no weight limit from this type). */
  weight: WField
  /** Pictogram shown on this product's boxes in the 3D view. Only the sample order's products have one. */
  pictogram?: PictogramKind
}

let seq = 0

export function newRow(dims: Dims, qty: string, color: string, unit: Unit): TypeRow {
  return { id: `t${++seq}`, name: '', color, dims: dimsToFields(dims, unit), qty, weight: blankW() }
}

/** First palette color not used by the rows, else cycles. */
export function nextColor(rows: TypeRow[]): string {
  return PALETTE.find((c) => !rows.some((r) => r.color === c)) ?? PALETTE[rows.length % PALETTE.length]
}

/** A new row that starts with the same dimensions as `from`, a small quantity, and a fresh color. */
export function cloneRow(from: TypeRow, color: string): TypeRow {
  return { ...from, id: `t${++seq}`, name: '', color, qty: '5', pictogram: undefined }
}

export function editRowField(r: TypeRow, field: keyof Dims | 'qty', text: string, unit: Unit): TypeRow {
  if (field === 'qty') return { ...r, qty: text }
  return { ...r, dims: { ...r.dims, [field]: editField(text, unit) } }
}

export function editRowWeight(r: TypeRow, text: string, unit: WeightUnit): TypeRow {
  return { ...r, weight: editW(text, unit) }
}

export function switchRowWeight(r: TypeRow, unit: WeightUnit): TypeRow {
  return { ...r, weight: switchW(r.weight, unit) }
}

export function switchRow(r: TypeRow, unit: Unit): TypeRow {
  return { ...r, dims: switchFields(r.dims, unit) }
}

/** Blank is valid ("as many as fit"). Otherwise a whole number from 1 to MAX_QTY. */
export function parseQty(text: string): { ok: true; value: number | null } | { ok: false } {
  const t = text.trim()
  if (t === '') return { ok: true, value: null }
  if (!/^\d+$/.test(t)) return { ok: false }
  const n = Number(t)
  return n >= 1 && n <= MAX_QTY ? { ok: true, value: n } : { ok: false }
}

/** Returns box types ready for packing, or the keys of invalid fields ("<id>.l", "<id>.qty"). */
export function validateRows(rows: TypeRow[]): { types: PackItem[] } | { invalid: string[] } {
  const invalid: string[] = []
  const types: PackItem[] = []
  for (const r of rows) {
    const d = validateFields(r.dims)
    const q = parseQty(r.qty)
    if ('invalid' in d) d.invalid.forEach((k) => invalid.push(`${r.id}.${k}`))
    if (!q.ok) invalid.push(`${r.id}.qty`)
    if (!r.weight.valid) invalid.push(`${r.id}.wt`)
    if ('dims' in d && q.ok && r.weight.valid) {
      const item: PackItem = { id: r.id, color: r.color, dims: d.dims, qty: q.value }
      if (r.weight.g !== null) item.weightKg = r.weight.g / 1000
      types.push(item)
    }
  }
  return invalid.length > 0 ? { invalid } : { types }
}

/** Label for a row: its name, or "Type n" (n = position in the list, 1-based). */
export const rowLabel = (r: { name: string }, index: number): string => (r.name.trim() !== '' ? r.name.trim() : `Type ${index + 1}`)

/** Rows for imported products, shown in the selected units. Colors follow the palette in order. */
export function rowsFromProducts(products: CsvProduct[], unit: Unit, weightUnit: WeightUnit): TypeRow[] {
  return products.map((p, i) => ({
    ...newRow(p.dims, String(p.qty), PALETTE[i % PALETTE.length], unit),
    name: p.name,
    weight: wFromGrams(p.weightG, weightUnit),
  }))
}
