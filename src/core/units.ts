export type Unit = 'mm' | 'cm' | 'in'
export const UNITS = ['mm', 'cm', 'in'] as const

export const MM_PER_IN = 25.4
export const MM_PER_CM = 10
const MM_PER: Record<Unit, number> = { mm: 1, cm: MM_PER_CM, in: MM_PER_IN }
/** Decimals shown in dimension fields (mm are stored exactly; this is display only). */
const DIM_DECIMALS: Record<Unit, number> = { mm: 2, cm: 3, in: 3 }

/** Millimetres to the number shown in the given unit. */
export function toDisplay(mm: number, unit: Unit): number {
  return mm / MM_PER[unit]
}

/** A number typed in the given unit to millimetres. */
export function fromDisplay(value: number, unit: Unit): number {
  return value * MM_PER[unit]
}

function trim(n: number, decimals: number): string {
  return n.toFixed(decimals).replace(/\.?0+$/, '')
}

/** Text for a dimension field: up to 2 decimals in mm, 3 in cm and inches. */
export function formatDim(mm: number, unit: Unit): string {
  return trim(toDisplay(mm, unit), DIM_DECIMALS[unit])
}

/** Volume in mm³ or in³ with thousands separators. */
export function formatVolume(mm3: number, unit: Unit): string {
  const v = mm3 / MM_PER[unit] ** 3
  if (unit === 'mm') return Math.round(v).toLocaleString('en-US')
  return v.toLocaleString('en-US', {
    minimumFractionDigits: unit === 'in' ? 1 : 0,
    maximumFractionDigits: 1,
  })
}

export function volumeUnitLabel(unit: Unit): string {
  return `${unit}³`
}

/** Parse user text. Returns null when it is not a finite number greater than 0. */
export function parseDim(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (t === '' || !/^(\d+\.?\d*|\.\d+)$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}
