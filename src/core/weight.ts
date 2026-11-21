/**
 * Weight units, parsing and totals. Pure functions, no UI.
 * Internally every weight is in grams (the user may enter g or kg).
 */

export type WeightUnit = 'g' | 'kg' | 'lb'
export const WEIGHT_UNITS = ['g', 'kg', 'lb'] as const

export const G_PER_KG = 1000
/** Exact by definition of the international avoirdupois pound. */
export const G_PER_LB = 453.59237
const G_PER: Record<WeightUnit, number> = { g: 1, kg: G_PER_KG, lb: G_PER_LB }
const FIELD_DECIMALS: Record<WeightUnit, number> = { g: 2, kg: 3, lb: 3 }
/** Tolerance (grams) so float sums such as 3 × 0.1 kg never count as over the limit. */
export const WEIGHT_EPS_G = 1e-6

export const toGrams = (v: number, u: WeightUnit): number => v * G_PER[u]
export const fromGrams = (g: number, u: WeightUnit): number => g / G_PER[u]

/** A weight field: `text` as typed, `g` the weight in grams (null when blank), `valid` false for bad text. */
export interface WField {
  text: string
  g: number | null
  valid: boolean
}

export const blankW = (): WField => ({ text: '', g: null, valid: true })

/** Blank is allowed (null). Otherwise a number of zero or more. */
export function parseWeight(text: string): { ok: true; value: number | null } | { ok: false } {
  const t = text.trim().replace(',', '.')
  if (t === '') return { ok: true, value: null }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return { ok: false }
  const n = Number(t)
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false }
}

export function editW(text: string, unit: WeightUnit): WField {
  const p = parseWeight(text)
  if (!p.ok) return { text, g: null, valid: false }
  return { text, g: p.value === null ? null : toGrams(p.value, unit), valid: true }
}

/** Text for a field: up to 2 decimals in g, 3 in kg and lb, without trailing zeros. */
export function weightText(g: number, unit: WeightUnit): string {
  return fromGrams(g, unit)
    .toFixed(FIELD_DECIMALS[unit])
    .replace(/\.?0+$/, '')
}

export function wFromGrams(g: number | null, unit: WeightUnit): WField {
  return g === null ? blankW() : { text: weightText(g, unit), g, valid: true }
}

/** Re-renders the text in another unit; the stored grams do not change, so nothing drifts. */
export function switchW(f: WField, unit: WeightUnit): WField {
  return f.valid && f.g !== null ? wFromGrams(f.g, unit) : f
}

/** Display text with thousands separators, e.g. "12,345 g" or "12.345 kg". */
export function formatWeight(g: number, unit: WeightUnit): string {
  const v = fromGrams(g, unit)
  const text = v.toLocaleString('en-US', { maximumFractionDigits: unit === 'g' ? 1 : 3 })
  return `${text} ${unit}`
}

// ---- Totals ----------------------------------------------------------------------------------

export interface WeightSpec {
  /** Weight of the empty shipping box (grams). */
  emptyG: number
  /** Maximum gross weight (grams), or null for no limit. */
  maxG: number | null
}

export interface WeightSummary {
  productG: number
  emptyG: number
  /** Products plus the empty box. */
  grossG: number
  maxG: number | null
  /** Capacity left (never negative), or null without a limit. */
  remainingG: number | null
  overLimit: boolean
  /** Grams above the limit (0 when within it). */
  overByG: number
  /** gross / max, or null without a limit. */
  ratio: number | null
}

/** Weight of an arrangement, from the boxes actually placed. `unitG` maps a type id to grams per unit. */
export function weightOf(
  placements: ReadonlyArray<{ typeId: string }>,
  unitG: ReadonlyMap<string, number>,
  spec: WeightSpec,
): WeightSummary {
  let productG = 0
  for (const p of placements) productG += unitG.get(p.typeId) ?? 0
  const grossG = productG + spec.emptyG
  const max = spec.maxG
  const overByG = max !== null && grossG > max + WEIGHT_EPS_G ? grossG - max : 0
  return {
    productG,
    emptyG: spec.emptyG,
    grossG,
    maxG: max,
    remainingG: max === null ? null : Math.max(0, max - grossG),
    overLimit: overByG > 0,
    overByG,
    ratio: max === null || max <= 0 ? null : grossG / max,
  }
}
