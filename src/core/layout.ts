import { gridCounts, orientations, volume, type Dims } from './pack'

/**
 * Coordinate system used by every placement calculation (millimetres):
 *   x = container length, y = container width, z = container height (up).
 * The origin is the container's minimum corner, so a placement occupies
 * [x, x + size.l] × [y, y + size.w] × [z, z + size.h].
 * The 3D viewer converts this to Three.js axes (y up) in one place.
 */
export interface BoxType {
  id: string
  color: string
  dims: Dims
  /** Requested quantity. Null means "as many as fit". */
  qty: number | null
}

let placementSeq = 0
/** Unique id for a placed box (stable while the box is moved or rotated). */
export const newPlacementId = (): string => `p${++placementSeq}`

export interface Placement {
  id: string
  typeId: string
  color: string
  x: number
  y: number
  z: number
  /** Size along x, y, z after orientation. */
  size: Dims
}

export interface TypeSummary {
  typeId: string
  /** Null when the type asked for "as many as fit". */
  requested: number | null
  placed: number
  /** Orientation used (size along x, y, z), or null when nothing was placed. */
  orientation: Dims | null
}

export interface Layout {
  box: Dims
  placements: Placement[]
  types: TypeSummary[]
  placedCount: number
  /** Requested boxes; "as many as fit" types count as what was placed. */
  totalCount: number
  unplacedCount: number
  boxVolumeMm3: number
  usedVolumeMm3: number
  freeVolumeMm3: number
  /** 0 to 100 */
  usedPct: number
}

/**
 * Sequential slab layout. Each type, in list order, is packed as a regular grid
 * (one orientation) into a slab along the container length. The next type uses
 * the length that is left. Slabs cannot overlap by construction.
 *
 * This is a simple heuristic, not an optimal solution. Mixed-size packing that
 * shares space between types is planned for a later phase.
 */
export function packTypes(box: Dims, types: BoxType[]): Layout {
  const placements: Placement[] = []
  let x0 = 0

  for (const t of types) {
    const remaining: Dims = { l: box.l - x0, w: box.w, h: box.h }
    const want = t.qty ?? Infinity

    let best: { size: Dims; n: number; extent: number; ny: number; nz: number } | null = null
    if (remaining.l > 0) {
      for (const size of orientations(t.dims)) {
        const g = gridCounts(remaining, size)
        const cap = g.x * g.y * g.z
        const n = Math.min(want, cap)
        if (n === 0) continue
        const cols = Math.ceil(n / (g.y * g.z))
        const extent = cols * size.l
        // More boxes first, then the shortest slab, then the earlier orientation.
        if (!best || n > best.n || (n === best.n && extent < best.extent)) {
          best = { size, n, extent, ny: g.y, nz: g.z }
        }
      }
    }

    if (!best) continue

    // Fill column by column along x, then layer by layer upward, then across y.
    let i = 0
    outer: for (let ix = 0; ; ix++) {
      for (let iz = 0; iz < best.nz; iz++) {
        for (let iy = 0; iy < best.ny; iy++) {
          if (i >= best.n) break outer
          placements.push({
            id: newPlacementId(),
            typeId: t.id,
            color: t.color,
            x: x0 + ix * best.size.l,
            y: iy * best.size.w,
            z: iz * best.size.h,
            size: best.size,
          })
          i++
        }
      }
    }
    x0 += best.extent
  }

  return layoutFromPlacements(box, types, placements)
}

/** Statistics for any arrangement (automatic or manual), computed from the placements themselves. */
export function layoutFromPlacements(box: Dims, types: BoxType[], placements: Placement[]): Layout {
  const summaries: TypeSummary[] = types.map((t) => {
    const mine = placements.filter((p) => p.typeId === t.id)
    return { typeId: t.id, requested: t.qty, placed: mine.length, orientation: mine[0]?.size ?? null }
  })
  const placedCount = placements.length
  const totalCount = summaries.reduce((s, t) => s + (t.requested ?? t.placed), 0)
  const boxVolumeMm3 = volume(box)
  const usedVolumeMm3 = placements.reduce((s, p) => s + volume(p.size), 0)
  return {
    box,
    placements,
    types: summaries,
    placedCount,
    totalCount,
    unplacedCount: totalCount - placedCount,
    boxVolumeMm3,
    usedVolumeMm3,
    freeVolumeMm3: Math.max(0, boxVolumeMm3 - usedVolumeMm3),
    usedPct: (usedVolumeMm3 / boxVolumeMm3) * 100,
  }
}
