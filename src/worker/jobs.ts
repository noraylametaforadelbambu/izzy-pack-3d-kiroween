import { newPlacementId } from '../core/layout'
import type { OptimizeOptions, OptimizeProgress, PackItem } from '../core/optimizer'
import type { Dims } from '../core/pack'
import { recommendBox, type CatalogBox, type Recommendation } from '../core/catalog'
import type { WeightSpec } from '../core/weight'
import { optimizeWeighted, type WeightedResult } from '../core/weighted'

/**
 * Optimization jobs. The computation itself is `optimizeWeighted` (unchanged); this module only moves it off the
 * main thread and keeps the user interface consistent:
 *   - `runJob`           runs one job where it is called (inside the Web Worker) and reports through `post`.
 *   - `OptimizerRunner`  main-thread side: one job at a time, progress, cancellation, errors.
 *   - `InlineWorker`     same interface as a Worker but runs in the current thread (fallback and tests).
 */

export interface JobRequest {
  /** Omitted for an ordinary optimization. */
  kind?: 'optimize'
  box: Dims
  items: PackItem[]
  spec: WeightSpec
  /** Plain options only (functions cannot cross the worker boundary). */
  options?: Omit<OptimizeOptions, 'onProgress'>
}

/** Find the smallest catalog box that holds the whole order (see core/catalog.ts). */
export interface RecommendRequest {
  kind: 'recommend'
  catalog: CatalogBox[]
  items: PackItem[]
  spec: WeightSpec
  options?: Omit<OptimizeOptions, 'onProgress'>
}

export type WorkerRequest = JobRequest | RecommendRequest

export type JobMessage =
  | { type: 'progress'; progress: OptimizeProgress }
  | { type: 'result'; result: WeightedResult }
  | { type: 'recommendation'; recommendation: Recommendation }
  | { type: 'error'; message: string }

/** Runs a job and reports everything through `post`. Never throws: failures become an `error` message. */
export function runJob(req: WorkerRequest, post: (m: JobMessage) => void): void {
  try {
    if (req.kind === 'recommend') {
      const recommendation = recommendBox(req.catalog, req.items, req.spec, req.options, (progress) => post({ type: 'progress', progress }))
      post({ type: 'recommendation', recommendation })
      return
    }
    const result = optimizeWeighted(req.box, req.items, req.spec, {
      ...req.options,
      onProgress: (progress) => post({ type: 'progress', progress }),
    })
    post({ type: 'result', result })
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

/** The part of the Web Worker interface the runner uses. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void
  terminate(): void
  onmessage: ((e: { data: JobMessage }) => void) | null
  onerror: ((e: { message?: string }) => void) | null
}

export class JobBusyError extends Error {
  constructor() {
    super('An optimization is already running')
    this.name = 'JobBusyError'
  }
}

export class JobCancelledError extends Error {
  constructor() {
    super('Optimization cancelled')
    this.name = 'JobCancelledError'
  }
}

/**
 * Placement ids come from a counter in the thread that made them. A worker starts counting at 1 again, so its ids
 * could collide with boxes the main thread creates later (manual mode). Give every placement a fresh id here.
 */
export function adoptIds(result: WeightedResult): WeightedResult {
  const placements = result.layout.placements.map((p) => ({ ...p, id: newPlacementId() }))
  return { ...result, layout: { ...result.layout, placements } }
}

/** Same for the layout inside a recommendation. */
export function adoptRecommendationIds(r: Recommendation): Recommendation {
  return r.result ? { ...r, result: adoptIds(r.result) } : r
}

export class OptimizerRunner {
  private createWorker: () => WorkerLike
  private active: { worker: WorkerLike; reject: (e: Error) => void } | null = null

  constructor(createWorker: () => WorkerLike) {
    this.createWorker = createWorker
  }

  /** True while a job is running. Starting another one is refused, not queued. */
  get busy(): boolean {
    return this.active !== null
  }

  /** Optimizes one container. */
  run(req: JobRequest, onProgress?: (p: OptimizeProgress) => void): Promise<WeightedResult> {
    return this.start<WeightedResult>(req, onProgress, (m) => (m.type === 'result' ? adoptIds(m.result) : undefined))
  }

  /** Finds the smallest catalog box that holds the whole order. Same one-job-at-a-time rule as `run`. */
  recommend(req: Omit<RecommendRequest, 'kind'>, onProgress?: (p: OptimizeProgress) => void): Promise<Recommendation> {
    return this.start<Recommendation>({ ...req, kind: 'recommend' }, onProgress, (m) => (m.type === 'recommendation' ? adoptRecommendationIds(m.recommendation) : undefined))
  }

  private start<T>(req: WorkerRequest, onProgress: ((p: OptimizeProgress) => void) | undefined, accept: (m: JobMessage) => T | undefined): Promise<T> {
    if (this.active) return Promise.reject(new JobBusyError())
    return new Promise<T>((resolve, reject) => {
      let worker: WorkerLike
      try {
        worker = this.createWorker()
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
        return
      }
      const entry = { worker, reject }
      this.active = entry
      const finish = (): boolean => {
        if (this.active !== entry) return false // cancelled or already finished: ignore late messages
        this.active = null
        worker.onmessage = null
        worker.onerror = null
        worker.terminate()
        return true
      }
      worker.onmessage = (e) => {
        const m = e.data
        if (m.type === 'progress') {
          if (this.active === entry) onProgress?.(m.progress)
        } else if (m.type === 'error') {
          if (finish()) reject(new Error(m.message))
        } else {
          const value = accept(m)
          if (value !== undefined && finish()) resolve(value)
        }
      }
      worker.onerror = (e) => {
        if (finish()) reject(new Error(e.message || 'The optimizer stopped unexpectedly'))
      }
      try {
        worker.postMessage(req)
      } catch (e) {
        if (finish()) reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  /** Stops the running job (the worker is terminated, so the computation really ends). No-op when idle. */
  cancel(): void {
    const a = this.active
    if (!a) return
    this.active = null
    a.worker.onmessage = null
    a.worker.onerror = null
    a.worker.terminate()
    a.reject(new JobCancelledError())
  }
}

/** Runs the job in the current thread, asynchronously, through the Worker interface. */
export class InlineWorker implements WorkerLike {
  onmessage: ((e: { data: JobMessage }) => void) | null = null
  onerror: ((e: { message?: string }) => void) | null = null
  private stopped = false

  postMessage(req: WorkerRequest): void {
    setTimeout(() => {
      if (this.stopped) return
      runJob(req, (data) => {
        if (!this.stopped) this.onmessage?.({ data })
      })
    }, 0)
  }

  terminate(): void {
    this.stopped = true
  }
}
