import { MAX_QTY, MAX_TYPES } from './boxTypes'
import type { Dims } from './pack'
import { MM_PER_CM, MM_PER_IN, formatDim, type Unit } from './units'
import { G_PER_KG, G_PER_LB, fromGrams, type WeightUnit } from './weight'

/**
 * CSV import of products (local, in the browser). Pure functions, no UI.
 *
 * Columns, in any order. The unit is part of the header, so nothing is guessed:
 *   name                     required, at most 60 characters
 *   length_mm | length_cm | length_in      required   (same for width_* and height_*)
 *   quantity                 required, whole number from 1 to 100,000
 *   weight_g | weight_kg | weight_lb       optional column; a blank cell means "no weight"
 * Headers are case-insensitive. "Length (mm)" is accepted as well as "length_mm". Other columns are ignored with a warning.
 *
 * Delimiter: comma, semicolon or tab, detected from the header line. A comma is a decimal separator only in files that
 * use ";" or tab (spreadsheet exports in many locales); in a comma-separated file use a dot, so "1,500" is never guessed.
 *
 * Nothing here changes the order: `parseProductsCsv` only validates and converts. The caller applies the products after
 * the user confirms, and only when there are no errors.
 */

export const CSV_MAX_BYTES = 512 * 1024
export const CSV_MAX_NAME = 60
/** Largest single side accepted (mm). */
export const CSV_MAX_SIDE_MM = 100_000
/** Same limit as the optimizer's `maxItems`. */
export const CSV_MAX_UNITS = 100_000
const MAX_ISSUES = 30

export interface CsvProduct {
  /** Line of the file the product came from (the header is line 1). */
  row: number
  name: string
  /** Product size in mm. */
  dims: Dims
  qty: number
  /** Weight of one unit in grams, or null when the cell was blank / the column absent. */
  weightG: number | null
}

export interface CsvIssue {
  /** Line of the file (header = 1), or null for problems of the file as a whole. */
  row: number | null
  column: string | null
  message: string
}

export type CsvResult =
  | { ok: true; products: CsvProduct[]; warnings: string[]; totalUnits: number }
  | { ok: false; errors: CsvIssue[]; /** True when more problems exist than are listed. */ truncated: boolean }

// ---- Reading the text ------------------------------------------------------------------------------

interface CsvRecord {
  line: number
  cells: string[]
}

function detectDelimiter(text: string): ',' | ';' | '\t' {
  const first = text.split(/\r\n|\n|\r/).find((l) => l.trim() !== '') ?? ''
  let inQ = false
  const n = { ',': 0, ';': 0, '\t': 0 }
  for (const c of first) {
    if (c === '"') inQ = !inQ
    else if (!inQ && (c === ',' || c === ';' || c === '\t')) n[c]++
  }
  if (n[';'] > n[','] && n[';'] >= n['\t']) return ';'
  if (n['\t'] > n[','] && n['\t'] > n[';']) return '\t'
  return ','
}

/** RFC 4180 style reading: quoted cells, "" for a quote, line breaks inside quotes. Blank lines are skipped. */
function readRecords(text: string, delimiter: string): { records: CsvRecord[]; error: string | null } {
  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let inQ = false
  let line = 1
  let startLine = 1
  const endRecord = (): void => {
    cells.push(cell)
    if (cells.some((c) => c.trim() !== '')) records.push({ line: startLine, cells })
    cells = []
    cell = ''
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQ = false
      } else {
        if (c === '\n') line++
        cell += c
      }
    } else if (c === '"' && cell.trim() === '') {
      inQ = true
      cell = ''
    } else if (c === delimiter) {
      cells.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      endRecord()
      line++
      startLine = line
    } else cell += c
  }
  if (inQ) return { records, error: `A quoted cell that starts on line ${startLine} is never closed` }
  if (cell !== '' || cells.length > 0) endRecord()
  return { records, error: null }
}

// ---- Headers -----------------------------------------------------------------------------------------

type DimKey = 'length' | 'width' | 'height'
type Column =
  | { kind: 'name' }
  | { kind: 'qty' }
  | { kind: 'dim'; key: DimKey; unit: Unit }
  | { kind: 'weight'; unit: WeightUnit }

const DIM_UNITS = ['mm', 'cm', 'in']
const WEIGHT_UNITS = ['g', 'kg', 'lb']

/** Accepts "length_mm", "Length (mm)", "length mm". */
function readHeader(raw: string): { column: Column | null; problem: string | null } {
  const h = raw.trim().toLowerCase().replace(/\ufeff/g, '')
  if (h === 'name' || h === 'product') return { column: { kind: 'name' }, problem: null }
  if (h === 'quantity' || h === 'qty') return { column: { kind: 'qty' }, problem: null }
  const m = /^(length|width|height|weight)\s*(?:[_\s([-]\s*)?([a-z]+)?\s*[)\]]?$/.exec(h)
  if (!m) return { column: null, problem: null }
  const [, base, unit] = m
  if (base === 'weight') {
    if (!unit || !WEIGHT_UNITS.includes(unit)) return { column: null, problem: `"${raw.trim()}": say the unit, for example weight_g, weight_kg or weight_lb` }
    return { column: { kind: 'weight', unit: unit as WeightUnit }, problem: null }
  }
  if (!unit || !DIM_UNITS.includes(unit)) return { column: null, problem: `"${raw.trim()}": say the unit, for example ${base}_mm, ${base}_cm or ${base}_in` }
  return { column: { kind: 'dim', key: base as DimKey, unit: unit as Unit }, problem: null }
}

// ---- Values ------------------------------------------------------------------------------------------

/** A positive or zero decimal. Comma decimals only when the file's delimiter is not a comma. */
function readNumber(raw: string, delimiter: string): { value: number } | { error: string } {
  const t = raw.trim()
  if (t === '') return { error: 'is empty' }
  if (t.includes(',')) {
    if (delimiter === ',') return { error: 'uses a comma decimal inside a comma-separated file; write it with a dot (12.5)' }
    if (!/^\d+,\d+$/.test(t)) return { error: 'is not a plain number' }
  }
  const n = t.replace(',', '.')
  if (!/^(\d+\.?\d*|\.\d+)$/.test(n)) return { error: 'is not a plain number (digits and one decimal separator only)' }
  const v = Number(n)
  return Number.isFinite(v) ? { value: v } : { error: 'is not a finite number' }
}

const toMm = (v: number, u: Unit): number => (u === 'mm' ? v : u === 'cm' ? v * MM_PER_CM : v * MM_PER_IN)
const toG = (v: number, u: WeightUnit): number => (u === 'g' ? v : u === 'kg' ? v * G_PER_KG : v * G_PER_LB)

// ---- Parsing -----------------------------------------------------------------------------------------

export function parseProductsCsv(input: string): CsvResult {
  const errors: CsvIssue[] = []
  const warnings: string[] = []
  let truncated = false
  const fail = (row: number | null, column: string | null, message: string): void => {
    if (errors.length >= MAX_ISSUES) truncated = true
    else errors.push({ row, column, message })
  }

  if (input.length > CSV_MAX_BYTES) return { ok: false, errors: [{ row: null, column: null, message: `The file is too large (limit ${CSV_MAX_BYTES / 1024} KB)` }], truncated: false }
  const text = input.replace(/^\ufeff/, '')
  if (text.includes('\u0000')) return { ok: false, errors: [{ row: null, column: null, message: 'This does not look like a text CSV file' }], truncated: false }
  if (text.trim() === '') return { ok: false, errors: [{ row: null, column: null, message: 'The file is empty' }], truncated: false }

  const delimiter = detectDelimiter(text)
  const { records, error } = readRecords(text, delimiter)
  if (error) return { ok: false, errors: [{ row: null, column: null, message: error }], truncated: false }
  const header = records[0]
  const body = records.slice(1)

  // header: every column must be understood or ignored on purpose, and the required ones must be there
  const cols: (Column | null)[] = []
  const seen = new Map<string, number>()
  const flagged = new Set<string>() // columns whose header was understood as a column but is wrong: no second error for them
  header.cells.forEach((raw, i) => {
    const { column, problem } = readHeader(raw)
    if (problem) {
      fail(header.line, raw.trim(), problem)
      flagged.add(/^(length|width|height|weight)/.exec(raw.trim().toLowerCase())?.[1] ?? '')
    }
    else if (!column) {
      if (raw.trim() !== '') warnings.push(`Column "${raw.trim()}" is not used and was ignored`)
    } else {
      const id = column.kind === 'dim' ? column.key : column.kind
      if (seen.has(id)) fail(header.line, raw.trim(), `Column "${id}" appears twice`)
      seen.set(id, i)
    }
    cols.push(column)
  })
  for (const need of ['name', 'length', 'width', 'height', 'qty']) {
    if (!seen.has(need) && !flagged.has(need)) fail(header.line, null, `Missing column: ${need === 'qty' ? 'quantity' : need === 'name' ? 'name' : `${need}_mm, ${need}_cm or ${need}_in`}`)
  }
  if (errors.length > 0) return { ok: false, errors, truncated }

  if (body.length === 0) return { ok: false, errors: [{ row: null, column: null, message: 'The file has a header but no products' }], truncated: false }
  if (body.length > MAX_TYPES) fail(body[MAX_TYPES].line, null, `Too many products: at most ${MAX_TYPES} are supported (this file has ${body.length})`)

  const products: CsvProduct[] = []
  let totalUnits = 0
  for (const rec of body.slice(0, MAX_TYPES)) {
    const before = errors.length
    if (rec.cells.length > cols.length && rec.cells.slice(cols.length).some((c) => c.trim() !== '')) fail(rec.line, null, `Has ${rec.cells.length} cells but the header has ${cols.length}`)
    const cell = (i: number): string => rec.cells[i] ?? ''
    const name = cell(seen.get('name')!).trim()
    if (name === '') fail(rec.line, 'name', 'is empty')
    else if (name.length > CSV_MAX_NAME) fail(rec.line, 'name', `is longer than ${CSV_MAX_NAME} characters`)

    const dims: Partial<Record<DimKey, number>> = {}
    for (const key of ['length', 'width', 'height'] as const) {
      const i = seen.get(key)!
      const col = cols[i] as Extract<Column, { kind: 'dim' }>
      const label = `${key}_${col.unit}`
      const n = readNumber(cell(i), delimiter)
      if ('error' in n) fail(rec.line, label, n.error)
      else if (n.value <= 0) fail(rec.line, label, 'must be above 0')
      else if (toMm(n.value, col.unit) > CSV_MAX_SIDE_MM) fail(rec.line, label, `is larger than ${CSV_MAX_SIDE_MM / 1000} m`)
      else dims[key] = toMm(n.value, col.unit)
    }

    let qty = 0
    const q = cell(seen.get('qty')!).trim()
    if (q === '') fail(rec.line, 'quantity', 'is empty (a whole number is required)')
    else if (!/^\d+$/.test(q)) fail(rec.line, 'quantity', 'must be a whole number such as 12')
    else if (Number(q) < 1 || Number(q) > MAX_QTY) fail(rec.line, 'quantity', `must be between 1 and ${MAX_QTY.toLocaleString('en-US')}`)
    else qty = Number(q)

    let weightG: number | null = null
    const wi = seen.get('weight')
    if (wi !== undefined) {
      const wc = cols[wi] as Extract<Column, { kind: 'weight' }>
      if (cell(wi).trim() !== '') {
        const w = readNumber(cell(wi), delimiter)
        if ('error' in w) fail(rec.line, `weight_${wc.unit}`, w.error)
        else weightG = toG(w.value, wc.unit)
      }
    }

    if (errors.length === before && !truncated) {
      products.push({ row: rec.line, name, dims: { l: dims.length!, w: dims.width!, h: dims.height! }, qty, weightG })
      totalUnits += qty
    }
  }
  if (errors.length === 0 && totalUnits > CSV_MAX_UNITS) fail(null, 'quantity', `The order has ${totalUnits.toLocaleString('en-US')} units; the limit is ${CSV_MAX_UNITS.toLocaleString('en-US')}`)

  if (errors.length > 0) return { ok: false, errors: errors.sort((a, b) => (a.row ?? 0) - (b.row ?? 0)), truncated }
  return { ok: true, products, warnings, totalUnits }
}

// ---- Template --------------------------------------------------------------------------------------

export const TEMPLATE_FILENAME = 'izzy-pack-products-template.csv'

/**
 * A CSV the importer accepts, in the units currently selected (so the numbers match what the user sees).
 * Two sample products; the second one has no weight, to show that the cell can be left blank.
 */
export function productsTemplate(unit: Unit, weightUnit: WeightUnit): string {
  const w = (g: number): string => fromGrams(g, weightUnit).toFixed(3).replace(/\.?0+$/, '')
  const rows: string[][] = [
    ['name', `length_${unit}`, `width_${unit}`, `height_${unit}`, 'quantity', `weight_${weightUnit}`],
    ['Product A', formatDim(220, unit), formatDim(150, unit), formatDim(90, unit), '10', w(450)],
    ['Product B', formatDim(100, unit), formatDim(100, unit), formatDim(100, unit), '20', ''],
  ]
  return rows.map((r) => r.join(',')).join('\r\n') + '\r\n'
}
