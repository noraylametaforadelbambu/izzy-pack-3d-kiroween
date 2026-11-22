import { describe, expect, it } from 'vitest'
import type { BoxTrial } from '../core/catalog'
import { trialReason } from './trialReason'

const base: BoxTrial = {
  boxId: 'c1',
  dims: { l: 300, w: 200, h: 150 },
  volumeMm3: 9_000_000,
  outcome: 'too-small',
  placed: 0,
  requested: 26,
  heldBackByWeight: 0,
  reducedEffort: false,
}
const ORDER = 36_604_000

describe('trialReason', () => {
  it('too-small: says it was not searched and compares volumes in the active unit', () => {
    expect(trialReason(base, ORDER, 'mm')).toBe("not searched: its volume (9,000,000 mm³) is below the order's (36,604,000 mm³)")
    expect(trialReason(base, ORDER, 'cm')).toBe("not searched: its volume (9,000 cm³) is below the order's (36,604 cm³)")
    expect(trialReason(base, ORDER, 'in')).toMatch(/in³\) is below the order's \(2,233\.\d in³\)$/)
  })
  it('partial: reports what the search placed and never claims impossibility', () => {
    const t: BoxTrial = { ...base, outcome: 'partial', placed: 20 }
    const text = trialReason(t, ORDER, 'mm')
    expect(text).toBe('placed 20 of 26 in this search')
    expect(text).not.toMatch(/cannot|impossible|does not fit/i)
  })
  it('partial: adds weight and reduced-search facts only when they apply', () => {
    const t: BoxTrial = { ...base, outcome: 'partial', placed: 20, heldBackByWeight: 3, reducedEffort: true }
    expect(trialReason(t, ORDER, 'mm')).toBe('placed 20 of 26 in this search; 3 more fit in space but not under the weight limit; search reduced')
  })
  it('fits', () => {
    expect(trialReason({ ...base, outcome: 'fits', placed: 26 }, ORDER, 'mm')).toBe('fits all 26')
  })
})
