import { describe, it } from 'vitest'
import { BENCH_BOX, groupedOrder, tilingOrder, totalQty } from './benchmarkData'
import { optimize, type PackItem } from './optimizer'

/**
 * Reproducible benchmark. Skipped in normal runs; run it with
 *     BENCH=1 NODE_OPTIONS=--expose-gc npx vitest --run src/core/optimizer.benchmark.test.ts
 * Orders are perfectly packable (100% exists), so utilization shows how far the heuristic is from a full fill.
 * Memory is the heap growth during one call (no garbage collection in between), not a true peak.
 */
// Node's `process` is not in the app's type setup; read it without importing Node typings.
const proc = (globalThis as { process?: { env: Record<string, string | undefined>; memoryUsage: () => { heapUsed: number } } }).process
const cases: { name: string; make: (seed: number) => PackItem[] }[] = [
  ...[100, 250, 251, 400, 600, 1000].map((n) => ({ name: `many types ${n}`, make: (s: number) => tilingOrder(n, s) })),
  ...[10, 25, 50].flatMap((k) => [400, 1000].map((n) => ({ name: `${k} types ~${n}`, make: (s: number) => groupedOrder(k, n, s) }))),
]

describe.skipIf(!proc?.env.BENCH)('optimizer benchmark', () => {
  it('prints the table', { timeout: 1_800_000 }, () => {
    const rows: string[] = ['case               items | used avg (min)  | time avg (max) ms | heap MB | strategy             | effort']
    for (const c of cases) {
      const us: number[] = []
      const ts: number[] = []
      let heap = 0
      let items = 0
      let strategy = ''
      let reduced = false
      for (const seed of [1, 2, 3]) {
        const order = c.make(seed)
        items += totalQty(order)
        ;(globalThis as { gc?: () => void }).gc?.()
        const m0 = (proc?.memoryUsage().heapUsed ?? 0)
        const t0 = performance.now()
        const r = optimize(BENCH_BOX, order)
        ts.push(performance.now() - t0)
        heap = Math.max(heap, (proc?.memoryUsage().heapUsed ?? 0) - m0)
        us.push((r.layout.usedVolumeMm3 / r.layout.boxVolumeMm3) * 100)
        strategy = r.strategy ?? '-'
        reduced ||= r.stats.effort.reduced
      }
      const avg = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length
      rows.push(
        `${c.name.padEnd(18)} ${String(Math.round(items / 3)).padStart(5)} | ${avg(us).toFixed(1).padStart(5)}% (${Math.min(...us).toFixed(1)}) | ${avg(ts).toFixed(0).padStart(6)} (${Math.max(...ts).toFixed(0)}) | ${(heap / 1048576).toFixed(0).padStart(5)} | ${strategy.padEnd(20)} | ${reduced ? 'reduced (reported)' : 'full'}`,
      )
    }
    console.log('\n' + rows.join('\n'))
  })
})
