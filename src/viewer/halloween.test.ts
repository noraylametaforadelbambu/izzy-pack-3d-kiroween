import { describe, expect, it } from 'vitest'
import { DEFAULT_SCENE, HALLOWEEN_PALETTE, HALLOWEEN_SCENE, halloweenColor } from './halloween'

describe('Halloween palette', () => {
  it('uses bone white, lavender and pumpkin orange, one per product type', () => {
    expect(HALLOWEEN_PALETTE).toEqual(['#f2e8d5', '#a35bff', '#f97316'])
    expect([0, 1, 2].map((i) => halloweenColor(i).hex)).toEqual([...HALLOWEEN_PALETTE])
    expect(new Set([0, 1, 2].map((i) => halloweenColor(i).hex)).size).toBe(3)
    expect([0, 1, 2].every((i) => halloweenColor(i).tint === 0)).toBe(true)
  })
  it('repeats with a lighter tint on every second round, so neighbours stay distinguishable', () => {
    expect(halloweenColor(3)).toEqual({ hex: '#f2e8d5', tint: 0.14 })
    expect(halloweenColor(5)).toEqual({ hex: '#f97316', tint: 0.14 })
    expect(halloweenColor(6)).toEqual({ hex: '#f2e8d5', tint: 0 })
    const firstEight = Array.from({ length: 8 }, (_, i) => halloweenColor(i))
    const keys = firstEight.map((c) => `${c.hex}/${c.tint}`)
    expect(new Set(keys).size).toBe(6) // six different looks before the cycle starts over
    for (let i = 1; i < firstEight.length; i++) expect(keys[i]).not.toBe(keys[i - 1]) // never the same as the previous type
  })
  it('is deterministic and tolerates odd indexes', () => {
    expect(halloweenColor(4)).toEqual(halloweenColor(4))
    expect(halloweenColor(-1)).toEqual(halloweenColor(0))
    expect(halloweenColor(Number.NaN)).toEqual(halloweenColor(0))
    expect(halloweenColor(2.9)).toEqual(halloweenColor(2))
  })
  it('keeps the original scene colors as the "off" values and a darker outline for the theme', () => {
    expect(DEFAULT_SCENE).toEqual({ shell: 0x7fb4ff, shellEdges: 0xbcd7ff, outline: 0x0b1a33 })
    expect(HALLOWEEN_SCENE.outline).toBeLessThan(DEFAULT_SCENE.outline)
  })
})
