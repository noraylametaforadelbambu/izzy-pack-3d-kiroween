import { describe, expect, it } from 'vitest'
import {
  DROP_HEIGHT,
  FRANK_COLORS,
  FRANK_PARTS,
  FRANK_PLATFORM,
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
  it('uses boxes in exactly green, lilac and black, with different sizes', () => {
    expect(new Set(FRANK_PARTS.map((p) => p.color))).toEqual(new Set(['green', 'lilac', 'black']))
    expect(Object.keys(FRANK_COLORS).sort()).toEqual(['black', 'green', 'lilac'])
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
  it('stacks from the bottom up', () => {
    const bottoms = FRANK_PARTS.map(bottom)
    expect(bottoms).toEqual([...bottoms].sort((a, b) => a - b))
    expect(FRANK_PARTS[0].name).toMatch(/^boot/)
    expect(FRANK_PARTS[FRANK_PARTS.length - 1].name).toBe('hair')
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
