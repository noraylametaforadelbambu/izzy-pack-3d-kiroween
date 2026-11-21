import { describe, expect, it } from 'vitest'
import { BENCH_BOX, groupedOrder, tilingOrder } from '../core/benchmarkData'
import { recommendBox, type CatalogBox, type Recommendation } from '../core/catalog'
import { newPlacementId, type Placement } from '../core/layout'
import type { PackItem } from '../core/optimizer'
import { SAMPLE_BOX, SAMPLE_ITEM } from '../core/pack'
import { toGrams, type WeightSpec } from '../core/weight'
import { optimizeWeighted, type WeightedResult } from '../core/weighted'
import {
  InlineWorker,
  JobBusyError,
  JobCancelledError,
  OptimizerRunner,
  runJob,
  type JobMessage,
  type JobRequest,
  type WorkerLike,
} from './jobs'

const none: WeightSpec = { emptyG: 0, maxG: null }
const sample: PackItem[] = [{ id: 'a', color: '#4fd1c5', dims: SAMPLE_ITEM, qty: null }]
const request = (over: Partial<JobRequest> = {}): JobRequest => ({ box: SAMPLE_BOX, items: sample, spec: none, ...over })

/** Everything that matters about a layout, without the ids (ids are per thread). */
const sig = (r: WeightedResult): string =>
  r.layout.placements.map((p) => `${p.typeId}:${p.x},${p.y},${p.z}:${p.size.l}x${p.size.w}x${p.size.h}`).join('|')
const summary = (r: WeightedResult) => ({
  status: r.status,
  strategy: r.strategy,
  placed: r.layout.placedCount,
  unplaced: r.layout.unplacedCount,
  used: r.layout.usedVolumeMm3,
  free: r.layout.freeVolumeMm3,
  types: r.layout.types,
  weight: r.weight,
  weightLimited: r.weightLimited,
  held: r.heldBackByWeight,
  totalKg: r.totalWeightKg,
  extent: r.extent,
  warnings: r.warnings,
  effort: r.stats.effort,
  passes: r.stats.passes,
  blockPasses: r.stats.blockPasses,
  queries: r.stats.queries,
})

/** A worker that never answers (a long calculation), to test cancellation and busy handling. */
class HangingWorker implements WorkerLike {
  onmessage: ((e: { data: JobMessage }) => void) | null = null
  onerror: ((e: { message?: string }) => void) | null = null
  terminated = 0
  posted: JobRequest[] = []
  postMessage(req: JobRequest): void {
    this.posted.push(req)
  }
  terminate(): void {
    this.terminated++
  }
}

/** A worker that fails in the ways real workers fail. */
class FailingWorker extends HangingWorker {
  private how: 'error-event' | 'throw-on-post'
  constructor(how: 'error-event' | 'throw-on-post') {
    super()
    this.how = how
  }
  override postMessage(req: JobRequest): void {
    if (this.how === 'throw-on-post') throw new Error('cannot clone the request')
    super.postMessage(req)
    setTimeout(() => this.onerror?.({ message: 'Script error in the worker' }), 0)
  }
}

describe('runJob (what runs inside the worker)', () => {
  it('reports progress, then the same result as a direct call', () => {
    const msgs: JobMessage[] = []
    runJob(request(), (m) => msgs.push(m))
    expect(msgs.length).toBeGreaterThan(2)
    expect(msgs.slice(0, -1).every((m) => m.type === 'progress')).toBe(true)
    const last = msgs[msgs.length - 1]
    expect(last.type).toBe('result')
    if (last.type !== 'result') return
    const direct = optimizeWeighted(SAMPLE_BOX, sample, none)
    expect(sig(last.result)).toBe(sig(direct))
    expect(summary(last.result)).toEqual(summary(direct))
    expect(last.result.layout.placedCount).toBeGreaterThanOrEqual(24)
  })
  it('progress messages name the phase and never exceed their step count', () => {
    const msgs: JobMessage[] = []
    runJob(request({ box: BENCH_BOX, items: groupedOrder(10, 300, 1) }), (m) => msgs.push(m))
    const phases = msgs.flatMap((m) => (m.type === 'progress' ? [m.progress] : []))
    expect(phases.map((p) => p.phase)).toEqual(expect.arrayContaining(['Layered patterns', 'Grouping identical items']))
    for (const p of phases) {
      expect(p.step).toBeGreaterThanOrEqual(1)
      expect(p.step).toBeLessThanOrEqual(p.steps)
    }
  })
  it('turns an unexpected exception into an error message instead of throwing', () => {
    const msgs: JobMessage[] = []
    expect(() => runJob(request({ box: null as never }), (m) => msgs.push(m))).not.toThrow()
    expect(msgs[msgs.length - 1].type).toBe('error')
  })
  it('reports invalid input as a rejected result, not as an error', () => {
    const msgs: JobMessage[] = []
    runJob(request({ items: [] }), (m) => msgs.push(m))
    const last = msgs[msgs.length - 1]
    expect(last.type === 'result' && last.result.status).toBe('rejected')
  })
})

describe('results are equivalent to the direct (non-worker) computation', () => {
  const cases: [string, JobRequest][] = [
    ['sample', request()],
    ['weight limited', request({ spec: { emptyG: 500, maxG: 9_000 }, items: [{ ...sample[0], weightKg: 0.75 }] })],
    ['pounds', request({ spec: { emptyG: toGrams(1, 'lb'), maxG: toGrams(20, 'lb') }, items: [{ ...sample[0], weightKg: 0.9 }] })],
    ['mixed types', request({ items: [{ id: 'a', color: '#fff', dims: { l: 220, w: 150, h: 90 }, qty: 10 }, { id: 'b', color: '#fff', dims: { l: 100, w: 100, h: 100 }, qty: 40 }] })],
    ['large grouped order', request({ box: BENCH_BOX, items: groupedOrder(25, 400, 2) })],
    ['large order, many types', request({ box: BENCH_BOX, items: tilingOrder(300, 3) })],
  ]
  for (const [name, req] of cases) {
    it(`${name}: same layout, statistics, weights, warnings and effort`, { timeout: 120_000 }, async () => {
      const runner = new OptimizerRunner(() => new InlineWorker())
      const viaWorker = await runner.run(req)
      const direct = optimizeWeighted(req.box, req.items, req.spec, req.options)
      expect(sig(viaWorker)).toBe(sig(direct))
      expect(summary(viaWorker)).toEqual(summary(direct))
    })
  }
  it('progress callbacks do not change the result', () => {
    const quiet = optimizeWeighted(BENCH_BOX, groupedOrder(10, 300, 4), { emptyG: 0, maxG: 40_000 })
    const noisy = optimizeWeighted(BENCH_BOX, groupedOrder(10, 300, 4), { emptyG: 0, maxG: 40_000 }, { onProgress: () => {} })
    expect(sig(noisy)).toBe(sig(quiet))
  })
})

describe('OptimizerRunner: asynchronous execution', () => {
  it('returns a promise that resolves later, not during the call', async () => {
    const runner = new OptimizerRunner(() => new InlineWorker())
    let done = false
    const p = runner.run(request()).then((r) => {
      done = true
      return r
    })
    expect(done).toBe(false)
    expect(runner.busy).toBe(true)
    const r = await p
    expect(done).toBe(true)
    expect(runner.busy).toBe(false)
    expect(r.layout.placedCount).toBeGreaterThanOrEqual(24)
  })
  it('delivers progress before the result', async () => {
    const runner = new OptimizerRunner(() => new InlineWorker())
    const seen: string[] = []
    await runner.run(request(), (p) => seen.push(p.phase))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toBe('Layered patterns')
  })
  it('terminates the worker when the job is done and can run again', async () => {
    const workers: InlineWorker[] = []
    const runner = new OptimizerRunner(() => {
      const w = new InlineWorker()
      workers.push(w)
      return w
    })
    const a = await runner.run(request())
    const b = await runner.run(request())
    expect(workers).toHaveLength(2)
    expect(sig(a)).toBe(sig(b))
  })
  it('gives placements ids that cannot collide with ids made later on this thread', async () => {
    const runner = new OptimizerRunner(() => new InlineWorker())
    const r = await runner.run(request())
    const later: Placement['id'][] = Array.from({ length: 50 }, () => newPlacementId())
    const ids = [...r.layout.placements.map((p) => p.id), ...later]
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('OptimizerRunner: one job at a time', () => {
  it('refuses a second job while one runs, and the first still completes', async () => {
    const runner = new OptimizerRunner(() => new InlineWorker())
    const first = runner.run(request())
    await expect(runner.run(request())).rejects.toBeInstanceOf(JobBusyError)
    await expect(runner.run(request())).rejects.toThrow('already running')
    expect(runner.busy).toBe(true)
    expect((await first).layout.placedCount).toBeGreaterThanOrEqual(24)
    expect(runner.busy).toBe(false)
  })
  it('does not start a second worker for a refused job', async () => {
    let created = 0
    const runner = new OptimizerRunner(() => (created++, new HangingWorker()))
    const first = runner.run(request())
    await runner.run(request()).catch(() => {})
    expect(created).toBe(1)
    runner.cancel()
    await first.catch(() => {})
  })
})

describe('OptimizerRunner: cancellation', () => {
  it('rejects with JobCancelledError, terminates the worker and frees the runner', async () => {
    const worker = new HangingWorker()
    const runner = new OptimizerRunner(() => worker)
    const p = runner.run(request())
    expect(runner.busy).toBe(true)
    expect(worker.posted).toHaveLength(1)
    runner.cancel()
    await expect(p).rejects.toBeInstanceOf(JobCancelledError)
    expect(worker.terminated).toBe(1)
    expect(runner.busy).toBe(false)
  })
  it('ignores messages that arrive after cancellation', async () => {
    const worker = new HangingWorker()
    const runner = new OptimizerRunner(() => worker)
    const seen: string[] = []
    const p = runner.run(request(), (x) => seen.push(x.phase))
    const late = worker.onmessage
    runner.cancel()
    await p.catch(() => {})
    // a message that was already on its way when the user pressed Cancel
    const direct = optimizeWeighted(SAMPLE_BOX, sample, none)
    late?.({ data: { type: 'progress', progress: { phase: 'late', step: 1, steps: 1 } } })
    late?.({ data: { type: 'result', result: direct } })
    expect(seen).toEqual([])
    expect(runner.busy).toBe(false)
  })
  it('can start a new job after a cancel, and that job is not affected by the old one', async () => {
    const hang = new HangingWorker()
    let n = 0
    const runner = new OptimizerRunner(() => (n++ === 0 ? hang : new InlineWorker()))
    const first = runner.run(request())
    runner.cancel()
    await first.catch(() => {})
    const second = await runner.run(request())
    expect(second.layout.placedCount).toBeGreaterThanOrEqual(24)
    expect(hang.terminated).toBe(1)
  })
  it('cancel while idle does nothing', () => {
    const runner = new OptimizerRunner(() => new InlineWorker())
    expect(() => runner.cancel()).not.toThrow()
    expect(runner.busy).toBe(false)
  })
  it('an InlineWorker that is terminated before it starts never runs the job', async () => {
    const w = new InlineWorker()
    let got = 0
    w.onmessage = () => got++
    w.postMessage(request())
    w.terminate()
    await new Promise((r) => setTimeout(r, 20))
    expect(got).toBe(0)
  })
})

describe('OptimizerRunner: error handling', () => {
  it('rejects with the message when the job throws, and frees the runner', async () => {
    const runner = new OptimizerRunner(() => new InlineWorker())
    await expect(runner.run(request({ box: null as never }))).rejects.toThrow()
    expect(runner.busy).toBe(false)
    expect((await runner.run(request())).layout.placedCount).toBeGreaterThan(0) // still usable
  })
  it('rejects when the worker script fails (worker error event) and terminates it', async () => {
    const w = new FailingWorker('error-event')
    const runner = new OptimizerRunner(() => w)
    await expect(runner.run(request())).rejects.toThrow('Script error in the worker')
    expect(w.terminated).toBe(1)
    expect(runner.busy).toBe(false)
  })
  it('rejects when the request cannot be sent', async () => {
    const w = new FailingWorker('throw-on-post')
    const runner = new OptimizerRunner(() => w)
    await expect(runner.run(request())).rejects.toThrow('cannot clone')
    expect(w.terminated).toBe(1)
    expect(runner.busy).toBe(false)
  })
  it('rejects when no worker can be created', async () => {
    const runner = new OptimizerRunner(() => {
      throw new Error('Workers are blocked')
    })
    await expect(runner.run(request())).rejects.toThrow('Workers are blocked')
    expect(runner.busy).toBe(false)
  })
  it('passes through the optimizer\'s own rejection of bad input as a result', async () => {
    const runner = new OptimizerRunner(() => new InlineWorker())
    const r = await runner.run(request({ box: { l: 0, w: 10, h: 10 } }))
    expect(r.status).toBe('rejected')
    expect(r.warnings[0]).toMatch(/Container dimensions/)
  })
})


describe('recommend job (smallest catalog box)', () => {
  const catalog: CatalogBox[] = [
    { id: 'big', dims: { l: 600, w: 400, h: 400 } },
    { id: 'mid', dims: { l: 400, w: 300, h: 200 } },
    { id: 'tiny', dims: { l: 100, w: 100, h: 100 } },
  ]
  const order: PackItem[] = [
    { id: 'a', color: '#4fd1c5', dims: { l: 220, w: 150, h: 90 }, qty: 10, weightKg: 0.5 },
    { id: 'b', color: '#f6ad55', dims: { l: 100, w: 100, h: 100 }, qty: 8, weightKg: 0.2 },
  ]
  const spec: WeightSpec = { emptyG: 400, maxG: 20_000 }
  const rec = (over: Partial<Parameters<OptimizerRunner['recommend']>[0]> = {}) => ({ catalog, items: order, spec, ...over })
  const summaryOf = (r: Recommendation) => ({
    status: r.status,
    box: r.box,
    trials: r.trials,
    needs: r.needsQuantities,
    units: r.orderUnits,
    volume: r.orderVolumeMm3,
    weight: r.orderWeightG,
    message: r.message,
    layout: r.result ? sig(r.result) : null,
    gross: r.result?.weight.grossG ?? null,
  })

  it('runJob reports progress per box, then the same recommendation as a direct call', () => {
    const msgs: JobMessage[] = []
    runJob({ kind: 'recommend', catalog, items: order, spec }, (m) => msgs.push(m))
    const last = msgs[msgs.length - 1]
    expect(last.type).toBe('recommendation')
    expect(msgs.slice(0, -1).every((m) => m.type === 'progress')).toBe(true)
    const phases = msgs.flatMap((m) => (m.type === 'progress' ? [m.progress.phase] : []))
    expect(phases.some((p) => /^Box 1 of 3/.test(p))).toBe(true)
    if (last.type !== 'recommendation') return
    expect(summaryOf(last.recommendation)).toEqual(summaryOf(recommendBox(catalog, order, spec)))
    expect(last.recommendation.status).toBe('found')
  })

  it('through the runner: asynchronous, same answer as a direct call, ids unique', async () => {
    const runner = new OptimizerRunner(() => new InlineWorker())
    let done = false
    const p = runner.recommend(rec()).then((r) => ((done = true), r))
    expect(done).toBe(false)
    expect(runner.busy).toBe(true)
    const viaWorker = await p
    expect(runner.busy).toBe(false)
    expect(summaryOf(viaWorker)).toEqual(summaryOf(recommendBox(catalog, order, spec)))
    const later = Array.from({ length: 30 }, () => newPlacementId())
    const ids = [...viaWorker.result!.layout.placements.map((x) => x.id), ...later]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('delivers progress to the caller', async () => {
    const runner = new OptimizerRunner(() => new InlineWorker())
    const seen: string[] = []
    await runner.recommend(rec(), (p) => seen.push(`${p.step}/${p.steps}`))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toBe('1/3')
  })

  it('answers needs-quantities, empty catalog and over-weight without error', async () => {
    const runner = new OptimizerRunner(() => new InlineWorker())
    expect((await runner.recommend(rec({ items: [{ ...order[0], qty: null }] }))).status).toBe('needs-quantities')
    expect((await runner.recommend(rec({ catalog: [] }))).status).toBe('empty-catalog')
    expect((await runner.recommend(rec({ spec: { emptyG: 400, maxG: 1_000 } }))).status).toBe('over-weight')
  })

  it('runs one job at a time across both kinds', async () => {
    const runner = new OptimizerRunner(() => new InlineWorker())
    const first = runner.recommend(rec())
    await expect(runner.run(request())).rejects.toBeInstanceOf(JobBusyError)
    await expect(runner.recommend(rec())).rejects.toBeInstanceOf(JobBusyError)
    expect((await first).status).toBe('found')
    const second = runner.run(request())
    await expect(runner.recommend(rec())).rejects.toBeInstanceOf(JobBusyError)
    expect((await second).layout.placedCount).toBeGreaterThanOrEqual(24)
  })

  it('cancel stops a recommendation, terminates the worker and ignores late answers', async () => {
    const worker = new HangingWorker()
    const runner = new OptimizerRunner(() => worker)
    const seen: string[] = []
    const p = runner.recommend(rec(), (x) => seen.push(x.phase))
    const late = worker.onmessage
    expect(worker.posted).toHaveLength(1)
    expect((worker.posted[0] as { kind?: string }).kind).toBe('recommend')
    runner.cancel()
    await expect(p).rejects.toBeInstanceOf(JobCancelledError)
    expect(worker.terminated).toBe(1)
    late?.({ data: { type: 'recommendation', recommendation: recommendBox(catalog, order, spec) } })
    late?.({ data: { type: 'progress', progress: { phase: 'late', step: 1, steps: 1 } } })
    expect(seen).toEqual([])
    expect(runner.busy).toBe(false)
    expect((await new OptimizerRunner(() => new InlineWorker()).recommend(rec())).status).toBe('found') // usable again
  })

  it('worker failures are rejected and free the runner', async () => {
    const runner = new OptimizerRunner(() => new FailingWorker('error-event'))
    await expect(runner.recommend(rec())).rejects.toThrow('Script error in the worker')
    expect(runner.busy).toBe(false)
    const bad = new OptimizerRunner(() => new InlineWorker())
    await expect(bad.recommend(rec({ catalog: null as never }))).rejects.toThrow()
    expect(bad.busy).toBe(false)
  })

  it('a result message is not accepted as the answer to a recommendation', async () => {
    const worker = new HangingWorker()
    const runner = new OptimizerRunner(() => worker)
    const p = runner.recommend(rec())
    worker.onmessage?.({ data: { type: 'result', result: optimizeWeighted(SAMPLE_BOX, sample, none) } })
    expect(runner.busy).toBe(true) // still waiting for the real answer
    worker.onmessage?.({ data: { type: 'recommendation', recommendation: recommendBox(catalog, order, spec) } })
    expect((await p).status).toBe('found')
  })
})
