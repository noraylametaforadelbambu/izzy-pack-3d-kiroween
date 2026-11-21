import { InlineWorker, type WorkerLike } from './jobs'

/** A new optimizer worker. Falls back to running in the page where Web Workers do not exist. */
export function createOptimizerWorker(): WorkerLike {
  if (typeof Worker === 'undefined') return new InlineWorker()
  return new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike
}
