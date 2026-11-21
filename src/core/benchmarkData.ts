import type { PackItem } from './optimizer'
import type { Dims } from './pack'

/**
 * Reproducible, perfectly packable test orders (a 100% fill exists by construction). Used by the tests and by
 * the benchmark. Everything is derived from the seed, so the same arguments give the same order.
 */

/** Container used by the benchmark (mm). */
export const BENCH_BOX: Dims = { l: 600, w: 400, h: 400 }
/** Sizes are multiples of this (mm). */
const G = 10

/** Small deterministic PRNG (LCG). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

type Cell = [number, number, number]

function cut(parts: Cell[], r: () => number, pickLongest: (c: Cell) => number): void {
  let bi = 0
  let bv = 0
  parts.forEach((p, i) => {
    if (Math.max(...p) >= 2 && p[0] * p[1] * p[2] > bv) {
      bv = p[0] * p[1] * p[2]
      bi = i
    }
  })
  const p = parts[bi]
  const a = pickLongest(p)
  const at = Math.max(1, Math.min(p[a] - 1, Math.round(p[a] * (0.3 + 0.4 * r()))))
  const q: Cell = [...p]
  const t: Cell = [...p]
  q[a] = at
  t[a] = p[a] - at
  parts.splice(bi, 1, q, t)
}

/**
 * `n` pieces from guillotine cuts of the container. Positions are multiples of 10 mm, so equal sizes repeat
 * naturally: many types, small quantities each.
 */
export function tilingOrder(n: number, seed: number, box: Dims = BENCH_BOX): PackItem[] {
  const r = lcg(seed)
  const parts: Cell[] = [[box.l / G, box.w / G, box.h / G]]
  while (parts.length < n) {
    cut(parts, r, (p) => {
      const axes = [0, 1, 2].filter((a) => p[a] >= 2).sort((a, b) => p[b] - p[a])
      return r() < 0.7 ? axes[0] : axes[Math.floor(r() * axes.length)]
    })
  }
  const types = new Map<string, { dims: Dims; qty: number }>()
  for (const p of parts) {
    const k = p.join('x')
    const e = types.get(k)
    if (e) e.qty++
    else types.set(k, { dims: { l: p[0] * G, w: p[1] * G, h: p[2] * G }, qty: 1 })
  }
  return [...types.values()].map((t, i) => ({ id: `t${i}`, color: '#8899aa', dims: t.dims, qty: t.qty }))
}

/**
 * `types` regions from guillotine cuts, each filled with a regular grid of identical items: about `target`
 * items in total, few distinct types, large quantities each.
 */
export function groupedOrder(types: number, target: number, seed: number, box: Dims = BENCH_BOX): PackItem[] {
  const r = lcg(seed)
  const parts: Cell[] = [[box.l / G, box.w / G, box.h / G]]
  while (parts.length < types) cut(parts, r, (p) => [0, 1, 2].filter((a) => p[a] >= 2).sort((a, b) => p[b] - p[a])[0])
  const divisors = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1).filter((d) => n % d === 0)
  const per = target / types
  return parts.map((p, i) => {
    let best: Cell = [1, 1, 1]
    let bd = Infinity
    for (let k = 0; k < 60; k++) {
      const c = p.map((e) => {
        const d = divisors(e)
        return d[Math.floor(r() * d.length)]
      }) as Cell
      const dist = Math.abs(Math.log((c[0] * c[1] * c[2]) / per))
      if (dist < bd) {
        bd = dist
        best = c
      }
    }
    return {
      id: `g${i}`,
      color: '#8899aa',
      dims: { l: (p[0] / best[0]) * G, w: (p[1] / best[1]) * G, h: (p[2] / best[2]) * G },
      qty: best[0] * best[1] * best[2],
    }
  })
}

export const totalQty = (items: PackItem[]): number => items.reduce((s, i) => s + (i.qty ?? 0), 0)
