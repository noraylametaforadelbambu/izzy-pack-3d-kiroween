/**
 * The guided flow: Home → Your order → Choose a box → Result (and its Report). Pure helpers, no React.
 * Report is the second screen of step 4, so the indicator shows four steps.
 */
export type StepId = 'home' | 'order' | 'box' | 'result' | 'report'

/** The four steps shown in the indicator. */
export const STEPS: { id: Exclude<StepId, 'report'>; label: string }[] = [
  { id: 'home', label: 'Start' },
  { id: 'order', label: 'Your order' },
  { id: 'box', label: 'Choose a box' },
  { id: 'result', label: 'Result' },
]

/** 1 to 4 (the report counts as step 4). */
export const stepNumber = (s: StepId): number => (s === 'report' ? 4 : STEPS.findIndex((x) => x.id === s) + 1)

/** Where "Back" goes. Home has no back. */
export function backTarget(s: StepId): StepId | null {
  switch (s) {
    case 'order':
      return 'home'
    case 'box':
      return 'order'
    case 'result':
      return 'box'
    case 'report':
      return 'result'
    default:
      return null
  }
}

/**
 * Which steps the indicator lets the user open. Home, order and box are always open (nothing is lost when
 * going back). The result is open only while it matches the inputs: after any change to the order, the weight
 * limits or the container it is outdated, and a new one has to be made in "Choose a box".
 */
export function canOpen(target: Exclude<StepId, 'report'>, resultReady: boolean): boolean {
  return target === 'result' ? resultReady : true
}

/** The step a highlighted field lives in. `rowIds` are the ids of the products in the order. */
export function stepOfKey(key: string, rowIds: ReadonlySet<string>): 'order' | 'box' {
  if (key.startsWith('box.') || key.startsWith('w.')) return 'box'
  return rowIds.has(key.split('.')[0]) ? 'order' : 'box' // catalog rows are in "Choose a box"
}

/** The earliest step that has something to fix (order comes before box), or null. */
export function firstProblemStep(keys: Iterable<string>, rowIds: ReadonlySet<string>): 'order' | 'box' | null {
  const steps = new Set([...keys].map((k) => stepOfKey(k, rowIds)))
  return steps.has('order') ? 'order' : steps.has('box') ? 'box' : null
}
