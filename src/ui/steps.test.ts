import { describe, expect, it } from 'vitest'
import { STEPS, backTarget, canOpen, firstProblemStep, stepNumber, stepOfKey } from './steps'

describe('guided steps', () => {
  it('has four numbered steps and the report belongs to step 4', () => {
    expect(STEPS.map((s) => s.label)).toEqual(['Start', 'Your order', 'Choose a box', 'Result'])
    expect(['home', 'order', 'box', 'result', 'report'].map((s) => stepNumber(s as never))).toEqual([1, 2, 3, 4, 4])
  })
  it('back goes one screen up the chain and Home has none', () => {
    expect(backTarget('home')).toBeNull()
    expect(backTarget('order')).toBe('home')
    expect(backTarget('box')).toBe('order')
    expect(backTarget('result')).toBe('box')
    expect(backTarget('report')).toBe('result')
  })
  it('the result can be opened only while it matches the inputs', () => {
    expect(canOpen('result', false)).toBe(false)
    expect(canOpen('result', true)).toBe(true)
    expect(['home', 'order', 'box'].every((s) => canOpen(s as never, false))).toBe(true)
  })
  it('maps a highlighted field to its step and picks the earliest', () => {
    const ids = new Set(['t1', 't2'])
    expect(stepOfKey('t1.l', ids)).toBe('order')
    expect(stepOfKey('t2.wt', ids)).toBe('order')
    expect(stepOfKey('box.w', ids)).toBe('box')
    expect(stepOfKey('w.max', ids)).toBe('box')
    expect(stepOfKey('c7.h', ids)).toBe('box')
    expect(firstProblemStep(['c7.h', 't1.qty'], ids)).toBe('order')
    expect(firstProblemStep(['c7.h', 'w.max'], ids)).toBe('box')
    expect(firstProblemStep([], ids)).toBeNull()
  })
})
