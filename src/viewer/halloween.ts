/**
 * Halloween mode: a purely visual theme for the 3D view. Same boxes, same geometry; only colors change.
 * High-contrast orange, purple and green, one per product type in list order. With more than three types the
 * colors repeat, and every second repeat is a lighter tint so neighbouring types can still be told apart.
 */
export const HALLOWEEN_PALETTE = ['#ff8a1f', '#a35bff', '#38e07b'] as const

/** Lightness added to the repeats (types 4, 5, 6 ... get a lighter tint, types 7, 8, 9 the base color again). */
const TINT = 0.14

export function halloweenColor(typeIndex: number): { hex: string; tint: number } {
  const i = Number.isFinite(typeIndex) && typeIndex > 0 ? Math.floor(typeIndex) : 0
  return { hex: HALLOWEEN_PALETTE[i % HALLOWEEN_PALETTE.length], tint: Math.floor(i / HALLOWEEN_PALETTE.length) % 2 === 1 ? TINT : 0 }
}

/** Colors of the box and the outlines when the theme is on (hex numbers for three.js). */
export const HALLOWEEN_SCENE = { shell: 0xb48cff, shellEdges: 0xe2d2ff, outline: 0x06020c } as const
/** The colors the viewer always had, restored exactly when the theme is turned off. */
export const DEFAULT_SCENE = { shell: 0x7fb4ff, shellEdges: 0xbcd7ff, outline: 0x0b1a33 } as const
