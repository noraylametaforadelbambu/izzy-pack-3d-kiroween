import { describe, expect, it } from 'vitest'
import {
  DROP_HEIGHT,
  DROP_TIME,
  FRANK_COLORS,
  FRANK_PARTS,
  FRANK_PLATFORM,
  FIRST_IMPACT,
  GROUP_WINDOW,
  frankSoundEvents,
  impactTime,
  STAGGER,
  dropOffset,
  easeOutBounce,
  frankBounds,
  hasStarted,
  partProgress,
  totalDuration,
  twistAt,
} from './frankenstein'

const bottom = (p: (typeof FRANK_PARTS)[number]): number => p.at[1] - p.size[1] / 2

describe('Frankenstein figure', () => {
  it('uses boxes in green, lilac and black, with different sizes; metal only on the two temple bolts', () => {
    expect(new Set(FRANK_PARTS.map((p) => p.color))).toEqual(new Set(['green', 'lilac', 'black', 'metal']))
    expect(Object.keys(FRANK_COLORS).sort()).toEqual(['black', 'green', 'lilac', 'metal'])
    const metal = FRANK_PARTS.filter((p) => p.color === 'metal')
    expect(metal.length).toBe(4) // a shaft and a cap per bolt
    expect(metal.every((p) => p.name.startsWith('temple-bolt-'))).toBe(true)
    expect(new Set(FRANK_PARTS.map((p) => p.size.join('x'))).size).toBeGreaterThan(15)
    expect(FRANK_PARTS.every((p) => p.size.every((s) => s > 0))).toBe(true)
  })
  it('has the features that make it a Frankenstein: flat head, hair, eyes, scar, mouth stitches, neck bolts, outstretched arms', () => {
    const names = FRANK_PARTS.map((p) => p.name)
    for (const n of ['head', 'hair', 'brow', 'eye-left', 'eye-right', 'scar', 'mouth', 'bolt-left', 'bolt-right', 'sleeve-left', 'hand-right', 'boot-left']) expect(names).toContain(n)
    expect(names.filter((n) => n.startsWith('mouth-stitch')).length).toBe(4)
    expect(new Set(names).size).toBe(names.length)
    const head = FRANK_PARTS.find((p) => p.name === 'head')!
    expect(head.color).toBe('green')
    expect(head.size[0]).toBeGreaterThan(head.size[2]) // wide, flat-topped block
  })
  it('stands on the platform, with the arms reaching toward +z and the face on the +z side', () => {
    expect(Math.min(...FRANK_PARTS.map(bottom))).toBeCloseTo(0, 6)
    const { min, max } = frankBounds()
    expect(max[1]).toBeGreaterThan(6.5)
    const hand = FRANK_PARTS.find((p) => p.name === 'hand-left')!
    expect(hand.at[2]).toBeGreaterThan(2)
    const eye = FRANK_PARTS.find((p) => p.name === 'eye-left')!
    expect(eye.at[2]).toBeGreaterThan(FRANK_PARTS.find((p) => p.name === 'head')!.size[2] / 2)
    expect(FRANK_PLATFORM.at[1] + FRANK_PLATFORM.size[1] / 2).toBeCloseTo(0, 6)
    expect(FRANK_PLATFORM.size[0] / 2).toBeGreaterThan(Math.max(Math.abs(min[0]), Math.abs(max[0])))
  })
  it('has one metal screw on each temple, on the sides of the head, at the end of the animation', () => {
    const head = FRANK_PARTS.find((p) => p.name === 'head')!
    for (const side of ['left', 'right']) {
      const shaft = FRANK_PARTS.find((p) => p.name === `temple-bolt-${side}-shaft`)!
      const cap = FRANK_PARTS.find((p) => p.name === `temple-bolt-${side}-cap`)!
      const slot = FRANK_PARTS.find((p) => p.name === `temple-bolt-${side}-slot`)!
      const sign = side === 'left' ? -1 : 1
      // outside the head, level with the temple, touching the head side, cap wider than the shaft, slot outermost
      expect(sign * shaft.at[0] - shaft.size[0] / 2).toBeLessThanOrEqual(head.size[0] / 2 + 1e-9)
      expect(sign * shaft.at[0] + shaft.size[0] / 2).toBeGreaterThan(head.size[0] / 2)
      expect(sign * cap.at[0]).toBeGreaterThan(sign * shaft.at[0])
      expect(sign * slot.at[0]).toBeGreaterThan(sign * cap.at[0])
      expect(cap.size[1]).toBeGreaterThan(shaft.size[1])
      expect(shaft.at[1]).toBeGreaterThan(head.at[1])
      expect(shaft.at[1]).toBeLessThan(head.at[1] + head.size[1] / 2)
    }
    const n = FRANK_PARTS.length
    expect(FRANK_PARTS.slice(n - 6).every((p) => p.name.startsWith('temple-bolt-'))).toBe(true) // the last six parts
    expect(FRANK_PARTS.slice(0, n - 6).some((p) => p.name.startsWith('temple-bolt-'))).toBe(false)
  })
  it('stacks from the bottom up, then the temple bolts', () => {
    const body = FRANK_PARTS.filter((p) => !p.name.startsWith('temple-bolt-'))
    const bottoms = body.map(bottom)
    expect(bottoms).toEqual([...bottoms].sort((a, b) => a - b))
    expect(FRANK_PARTS[0].name).toMatch(/^boot/)
    expect(body[body.length - 1].name).toBe('hair')
  })
})

describe('Frankenstein timing', () => {
  it('is brief and plays once', () => {
    expect(totalDuration()).toBeGreaterThan(2)
    expect(totalDuration()).toBeLessThan(4.5)
    const last = FRANK_PARTS.length - 1
    expect(partProgress(last, totalDuration())).toBe(1)
    expect(dropOffset(partProgress(last, totalDuration()))).toBe(0)
    expect(dropOffset(partProgress(0, totalDuration() + 10))).toBe(0)
  })
  it('a part falls from above and never goes below its place', () => {
    expect(dropOffset(0)).toBe(DROP_HEIGHT)
    for (let i = 0; i <= 200; i++) expect(dropOffset(i / 200)).toBeGreaterThanOrEqual(0)
    expect(easeOutBounce(0)).toBe(0)
    expect(easeOutBounce(1)).toBeCloseTo(1, 6)
  })
  it('starts parts one after the other and twists them back to straight', () => {
    expect(hasStarted(0, 0)).toBe(true)
    expect(hasStarted(3, 3 * STAGGER - 0.001)).toBe(false)
    expect(hasStarted(3, 3 * STAGGER)).toBe(true)
    expect(twistAt(5, 1)).toBe(0)
    expect(Math.abs(twistAt(5, 0))).toBeLessThanOrEqual(0.5)
  })
})

describe('Frankenstein sound events', () => {
  const events = frankSoundEvents()
  it('a part first touches its place when its bounce first reaches 1', () => {
    expect(easeOutBounce(FIRST_IMPACT)).toBeCloseTo(1, 6)
    expect(easeOutBounce(FIRST_IMPACT - 0.01)).toBeLessThan(1)
    expect(impactTime(0)).toBeCloseTo(DROP_TIME * FIRST_IMPACT, 9)
    expect(impactTime(10) - impactTime(9)).toBeCloseTo(STAGGER, 9)
  })
  it('simultaneous impacts are grouped: far fewer sounds than parts, heavier when more parts land together', () => {
    const thuds = events.filter((e) => e.kind === 'thud')
    expect(thuds.length).toBeLessThan(FRANK_PARTS.length / 2)
    expect(thuds.length).toBeGreaterThanOrEqual(8)
    expect(thuds.every((e) => e.strength >= 0.3 && e.strength <= 1)).toBe(true)
    expect(Math.max(...thuds.map((e) => e.strength))).toBeGreaterThan(Math.min(...thuds.map((e) => e.strength)))
    for (let i = 1; i < thuds.length; i++) expect(thuds[i].time - thuds[i - 1].time).toBeGreaterThan(GROUP_WINDOW / 2)
  })
  it('there is exactly one metallic click, last, when the last temple screw lands', () => {
    const metal = events.filter((e) => e.kind === 'metal')
    expect(metal.length).toBe(1)
    expect(events[events.length - 1]).toEqual(metal[0])
    expect(metal[0].time).toBeCloseTo(impactTime(FRANK_PARTS.length - 1), 9)
    const screws = FRANK_PARTS.filter((p) => p.late).length
    expect(screws).toBe(6)
    // the screws do not thud: the thuds cover only the other parts
    const lastThud = events.filter((e) => e.kind === 'thud').pop()!
    expect(lastThud.time).toBeLessThan(impactTime(FRANK_PARTS.length - screws - 1) + GROUP_WINDOW)
  })
  it('every sound happens inside the animation, in order', () => {
    expect(events.every((e) => e.time > 0 && e.time < totalDuration())).toBe(true)
    expect(events.map((e) => e.time)).toEqual([...events.map((e) => e.time)].sort((a, b) => a - b))
  })
})

