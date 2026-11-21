import type { Placement } from './layout'
import { MIN_SUPPORT } from './manual'
import type { Dims } from './pack'

/**
 * Independent checker: written here, shares no code with the optimizer's own verifier. Returns a list of
 * problems (empty = the layout is valid): out of bounds, overlapping boxes, unsupported boxes.
 */
export function problems(box: Dims, ps: Placement[], minSupport = MIN_SUPPORT): string[] {
  const out: string[] = []
  const e = 1e-6
  for (const p of ps) {
    if (p.x < -e || p.y < -e || p.z < -e) out.push(`${p.id} below the origin`)
    if (p.x + p.size.l > box.l + e || p.y + p.size.w > box.w + e || p.z + p.size.h > box.h + e) out.push(`${p.id} outside the container`)
  }
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i]
    let supported = 0
    for (let j = 0; j < ps.length; j++) {
      if (i === j) continue
      const b = ps[j]
      const ox = Math.min(a.x + a.size.l, b.x + b.size.l) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.size.w, b.y + b.size.w) - Math.max(a.y, b.y)
      const oz = Math.min(a.z + a.size.h, b.z + b.size.h) - Math.max(a.z, b.z)
      if (j > i && ox > e && oy > e && oz > e) out.push(`${a.id} overlaps ${b.id}`)
      if (ox > e && oy > e && Math.abs(b.z + b.size.h - a.z) <= e) supported += ox * oy
    }
    if (a.z > e && supported / (a.size.l * a.size.w) < minSupport - 1e-9) out.push(`${a.id} is not supported`)
  }
  return out
}
