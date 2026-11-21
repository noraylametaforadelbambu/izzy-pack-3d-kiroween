export interface Dims {
  l: number
  w: number
  h: number
}

export interface Counts {
  x: number
  y: number
  z: number
}

export interface PackResult {
  /** Item size along box length, width, height (mm). Null when nothing fits. */
  orientation: Dims | null
  counts: Counts
  count: number
  /** 0 to 100 */
  usedPct: number
  freeVolumeMm3: number
  boxVolumeMm3: number
  /** The box used for this result (mm). */
  box: Dims
}

/** Permutations of (l, w, h). Earlier entries win ties. */
const ORDER: ReadonlyArray<readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

/** Guards against float error such as 0.3 / 0.1 = 2.9999999999999996. */
const EPS = 1e-9

export const volume = (d: Dims): number => d.l * d.w * d.h

function fit(box: number, item: number): number {
  return Math.floor(box / item + EPS)
}

export function gridCounts(box: Dims, size: Dims): Counts {
  return { x: fit(box.l, size.l), y: fit(box.w, size.w), z: fit(box.h, size.h) }
}

export function orientations(item: Dims): Dims[] {
  const s = [item.l, item.w, item.h]
  return ORDER.map(([a, b, c]) => ({ l: s[a], w: s[b], h: s[c] }))
}

export function pack(box: Dims, item: Dims): PackResult {
  let best: Dims | null = null
  let bestCounts: Counts = { x: 0, y: 0, z: 0 }
  let bestCount = 0
  for (const size of orientations(item)) {
    const c = gridCounts(box, size)
    const n = c.x * c.y * c.z
    if (n > bestCount) {
      best = size
      bestCounts = c
      bestCount = n
    }
  }
  const boxVolumeMm3 = volume(box)
  const used = bestCount * volume(item)
  return {
    orientation: best,
    counts: bestCounts,
    count: bestCount,
    usedPct: (used / boxVolumeMm3) * 100,
    freeVolumeMm3: Math.max(0, boxVolumeMm3 - used),
    boxVolumeMm3,
    box,
  }
}

export const SAMPLE_BOX: Dims = { l: 600, w: 400, h: 400 }
export const SAMPLE_ITEM: Dims = { l: 220, w: 150, h: 90 }
