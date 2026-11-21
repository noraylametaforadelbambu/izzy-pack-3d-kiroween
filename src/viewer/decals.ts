import type { Placement } from '../core/layout'
import type { PictogramKind } from '../core/pictogram'

/**
 * Where to put the pictogram of each box. Pure geometry, no rendering. Coordinates are the layout ones (mm):
 * x = length, y = width, z = height (up).
 *
 * Each box gets at most one pictogram on an exterior face that the default camera sees: the front face (+y), the right
 * face (+x) or the top (+z). A face counts as exterior when no other box touches the square the icon would occupy, so a
 * pictogram never ends up between two boxes. Among the usable faces the one that gives the biggest icon (weighted by how
 * directly the default camera sees it) wins. A box that is completely surrounded has no exterior face and gets none.
 */

export type Face = 'front' | 'right' | 'top'

export interface Decal {
  /** Index into the placements list. */
  index: number
  kind: PictogramKind
  face: Face
  /** Side of the square icon (mm). It is centered on the face. */
  size: number
}

const WEIGHT: Record<Face, number> = { front: 1, right: 0.9, top: 0.75 }
const FACE_ORDER: Face[] = ['front', 'right', 'top']
/** Icon side as a share of the shorter side of the face, then smaller fallbacks when a neighbour covers part of the face. */
const FILL = 0.8
const FACTORS = [1, 0.7, 0.5]
/** Share of the icon square that may be touched by a neighbouring box. */
const MAX_COVERED = 0.02
/** Safety limit for big layouts: at most this many pictograms. */
export const MAX_DECALS = 1500
const KEY = 1000 // plane coordinates are grouped at micrometre precision

interface Geometry {
  /** Coordinate of the plane the face lies in. */
  plane: number
  /** Face center and size along its two axes. */
  cu: number
  cv: number
  du: number
  dv: number
}

function geometry(p: Placement, face: Face): Geometry {
  const { x, y, z, size } = p
  if (face === 'right') return { plane: x + size.l, cu: y + size.w / 2, cv: z + size.h / 2, du: size.w, dv: size.h }
  if (face === 'front') return { plane: y + size.w, cu: x + size.l / 2, cv: z + size.h / 2, du: size.l, dv: size.h }
  return { plane: z + size.h, cu: x + size.l / 2, cv: y + size.w / 2, du: size.l, dv: size.w }
}

/** The part of box `b` that touches a face lying in the plane that starts at `b`: its extent along the face axes. */
function contact(b: Placement, face: Face): { u0: number; u1: number; v0: number; v1: number; start: number } {
  const { x, y, z, size } = b
  if (face === 'right') return { start: x, u0: y, u1: y + size.w, v0: z, v1: z + size.h }
  if (face === 'front') return { start: y, u0: x, u1: x + size.l, v0: z, v1: z + size.h }
  return { start: z, u0: x, u1: x + size.l, v0: y, v1: y + size.w }
}

export function planDecals(placements: readonly Placement[], kindOf: (typeId: string) => PictogramKind | undefined): Decal[] {
  if (placements.length === 0) return []
  // boxes grouped by the plane in which they begin, for each face direction
  const groups: Record<Face, Map<number, number[]>> = { front: new Map(), right: new Map(), top: new Map() }
  placements.forEach((b, i) => {
    for (const f of FACE_ORDER) {
      const k = Math.round(contact(b, f).start * KEY)
      const list = groups[f].get(k)
      if (list) list.push(i)
      else groups[f].set(k, [i])
    }
  })

  const out: Decal[] = []
  for (let i = 0; i < placements.length && out.length < MAX_DECALS; i++) {
    const p = placements[i]
    const kind = kindOf(p.typeId)
    if (!kind) continue
    let best: { face: Face; size: number; score: number } | null = null
    for (const face of FACE_ORDER) {
      const g = geometry(p, face)
      const nominal = FILL * Math.min(g.du, g.dv)
      const key = Math.round(g.plane * KEY)
      const near = [key - 1, key, key + 1].flatMap((k) => groups[face].get(k) ?? [])
      for (const f of FACTORS) {
        const s = nominal * f
        const u0 = g.cu - s / 2, u1 = g.cu + s / 2, v0 = g.cv - s / 2, v1 = g.cv + s / 2
        let covered = 0
        for (const j of near) {
          if (j === i) continue
          const c = contact(placements[j], face)
          const ou = Math.min(u1, c.u1) - Math.max(u0, c.u0)
          const ov = Math.min(v1, c.v1) - Math.max(v0, c.v0)
          if (ou > 0 && ov > 0) covered += ou * ov
        }
        if (covered <= MAX_COVERED * s * s) {
          const score = s * WEIGHT[face]
          if (!best || score > best.score + 1e-9) best = { face, size: s, score }
          break // the largest size that fits on this face
        }
      }
    }
    if (best) out.push({ index: i, kind, face: best.face, size: best.size })
  }
  return out
}
