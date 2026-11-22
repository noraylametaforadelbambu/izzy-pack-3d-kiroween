import { STEPS, canOpen, stepNumber, type StepId } from './steps'

interface Props {
  step: StepId
  /** The result matches the current inputs, so step 4 can be opened. */
  resultReady: boolean
  /** Steps with a field that needs fixing. */
  flagged: ReadonlySet<StepId>
  onGo: (s: Exclude<StepId, 'report'>) => void
}

/** "Step 2 of 4" with four numbered stops. Going back to an earlier step never loses data. */
export function StepIndicator({ step, resultReady, flagged, onGo }: Props) {
  const current = stepNumber(step)
  return (
    <nav className="steps" aria-label="Progress">
      <p className="stepline" data-testid="step-line">
        Step {current} of {STEPS.length}: <b>{STEPS[current - 1].label}</b>
      </p>
      <ol>
        {STEPS.map((s, i) => {
          const n = i + 1
          const open = canOpen(s.id, resultReady)
          const state = n === current ? 'current' : n < current ? 'done' : 'todo'
          return (
            <li key={s.id} className={`stop ${state}`}>
              <button type="button" aria-current={n === current ? 'step' : undefined} disabled={!open || n === current} onClick={() => onGo(s.id)} title={open ? s.label : 'Outdated: choose a box again to update it'}>
                <span className="stopno">{n < current ? '✓' : n}</span>
                <span className="stoplabel">{s.label}</span>
                {flagged.has(s.id) && (
                  <b className="tabflag" title="Needs attention" aria-label="needs attention">
                    !
                  </b>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
