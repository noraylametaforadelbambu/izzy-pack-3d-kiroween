import { useEffect, useState } from 'react'
import type { OptimizeProgress } from '../core/optimizer'

interface Props {
  /** What is running, e.g. "Optimizing" or "Finding a box". */
  label: string
  progress: OptimizeProgress | null
  onCancel: () => void
}

/** Shown while an optimization runs in the background: what it is doing, elapsed time, and a Cancel button. */
export function JobStatus({ label, progress, onCancel }: Props) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t0 = performance.now()
    const id = window.setInterval(() => setElapsed(performance.now() - t0), 200)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="jobstatus" role="status" aria-live="polite" data-testid="job-status">
      <span className="spinner" aria-hidden="true" />
      <span className="jobtext">
        {label}
        {progress && (
          <>
            : <span data-testid="job-phase">{progress.phase}</span>
            {progress.steps > 1 && ` (${Math.min(progress.step, progress.steps)}/${progress.steps})`}
          </>
        )}
        <i> {(elapsed / 1000).toFixed(1)} s</i>
      </span>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <span className="jobbar" aria-hidden="true" />
    </div>
  )
}
