import type { Dims } from './pack'
import { formatDim, fromDisplay, parseDim, type Unit } from './units'

/**
 * One dimension input. `text` is what the user sees. `mm` is the physical size
 * (null while the text is invalid). Unit switches re-render `text` from `mm`,
 * so converting back and forth never accumulates rounding error.
 */
export interface Field {
  text: string
  mm: number | null
}

export type DimsFields = Record<keyof Dims, Field>

export function fieldFromMm(mm: number, unit: Unit): Field {
  return { text: formatDim(mm, unit), mm }
}

export function editField(text: string, unit: Unit): Field {
  const n = parseDim(text)
  return { text, mm: n === null ? null : fromDisplay(n, unit) }
}

export function switchField(f: Field, unit: Unit): Field {
  // Invalid text has no physical size; leave it for the user to fix.
  return f.mm === null ? f : fieldFromMm(f.mm, unit)
}

export function dimsToFields(d: Dims, unit: Unit): DimsFields {
  return { l: fieldFromMm(d.l, unit), w: fieldFromMm(d.w, unit), h: fieldFromMm(d.h, unit) }
}

export function switchFields(f: DimsFields, unit: Unit): DimsFields {
  return { l: switchField(f.l, unit), w: switchField(f.w, unit), h: switchField(f.h, unit) }
}

/** Returns the dimensions in mm, or the keys of invalid fields. */
export function validateFields(f: DimsFields): { dims: Dims } | { invalid: (keyof Dims)[] } {
  const invalid = (['l', 'w', 'h'] as const).filter((k) => f[k].mm === null)
  if (invalid.length > 0) return { invalid }
  return { dims: { l: f.l.mm!, w: f.w.mm!, h: f.h.mm! } }
}
