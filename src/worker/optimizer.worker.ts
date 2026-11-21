import { runJob, type JobMessage, type WorkerRequest } from './jobs'

// Web Worker entry: one request in (optimize or recommend), progress and one result (or error) out. No other state.
interface WorkerScope {
  onmessage: ((e: { data: WorkerRequest }) => void) | null
  postMessage(message: JobMessage): void
}
const scope = self as unknown as WorkerScope

scope.onmessage = (e) => runJob(e.data, (m) => scope.postMessage(m))
