import { describe, expect, it } from 'vitest'
import { packTypes, type BoxType, type Placement } from './layout'
import { checkPlacement } from './manual'
import { optimize, verifyPlacements, verifyPlacementsIndexed, type PackItem } from './optimizer'
import { SAMPLE_BOX, type Dims } from './pack'

const item = (id: string, l: number, w: number, h: number, qty: number | null, extra: Partial<PackItem> = {}): PackItem => ({
  id,
  color: '#fff',
  dims: { l, w, h },
  qty,
  ...extra,
})

const placedOf = (r: ReturnType<typeof optimize>, id: string): number => r.layout.placements.filter((p) => p.typeId === id).length

/** Small deterministic generator for the randomized tests. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

describe('sample case', () => {
  const r = optimize(SAMPLE_BOX, [item('a', 220, 150, 90, null)])

  it('beats the single-orientation grid (16) with a verified arrangement', () => {
    // A hand-built layered pattern with 24 boxes exists (16 upright + 4 + 4 flat), so 24 is a floor.
    expect(r.layout.placedCount).toBeGreaterThanOrEqual(24)
    expect(verifyPlacements(SAMPLE_BOX, r.layout.placements)).toBe(true)
    expect(r.status).toBe('complete')
  })

  it('reports statistics from the placements', () => {
    expect(r.layout.usedPct).toBeGreaterThan(49.5)
    expect(r.layout.usedVolumeMm3 + r.layout.freeVolumeMm3).toBeCloseTo(96_000_000, 3)
    expect(r.stats.verified).toBe('full')
    expect(r.strategy).not.toBeNull()
  })

  it('layered patterns alone already reach 24 (no extreme-points search)', () => {
    const layered = optimize(SAMPLE_BOX, [item('a', 220, 150, 90, null)], { epLimit: 0 })
    expect(layered.layout.placedCount).toBeGreaterThanOrEqual(24)
    expect(layered.strategy).toBe('layer-dp-slabs')
  })
})

describe('quantities', () => {
  it('places exactly the requested quantity when it fits', () => {
    const r = optimize(SAMPLE_BOX, [item('a', 220, 150, 90, 20)])
    expect(r.layout.placedCount).toBe(20)
    expect(r.status).toBe('complete')
    expect(r.layout.unplacedCount).toBe(0)
  })

  it('reports a partial result when the request is larger than what fits', () => {
    const r = optimize(SAMPLE_BOX, [item('a', 220, 150, 90, 500)])
    expect(r.status).toBe('partial')
    expect(r.layout.placedCount).toBeGreaterThan(24)
    expect(r.layout.placedCount).toBeLessThan(500)
    expect(r.layout.unplacedCount).toBe(500 - r.layout.placedCount)
    expect(r.bounds.exceedsContainer).toBe(true)
  })

  it('"as many as fit" types go after fixed quantities, so they cannot starve them', () => {
    const r = optimize(SAMPLE_BOX, [item('big', 200, 150, 100, null), item('cube', 100, 100, 100, 50)])
    expect(placedOf(r, 'cube')).toBe(50)
    expect(placedOf(r, 'big')).toBeGreaterThan(0)
    expect(verifyPlacements(SAMPLE_BOX, r.layout.placements)).toBe(true)
  })

  it('never places more than requested, per type', () => {
    const r = optimize(SAMPLE_BOX, [item('a', 250, 180, 120, 6), item('b', 140, 90, 60, 20), item('c', 90, 90, 90, 15)])
    expect(placedOf(r, 'a')).toBeLessThanOrEqual(6)
    expect(placedOf(r, 'b')).toBeLessThanOrEqual(20)
    expect(placedOf(r, 'c')).toBeLessThanOrEqual(15)
  })
})

describe('mixed types', () => {
  const items = [item('a', 250, 180, 120, 6), item('b', 140, 90, 60, 20), item('c', 90, 90, 90, 15)]
  const r = optimize(SAMPLE_BOX, items)

  it('places an easy mixed order completely and validly', () => {
    expect(r.status).toBe('complete')
    expect(r.layout.placedCount).toBe(41)
    expect(verifyPlacements(SAMPLE_BOX, r.layout.placements)).toBe(true)
  })

  it('does not claim optimality: the only certificate is the volume bound', () => {
    expect(r.bounds.exceedsContainer).toBe(false)
    expect(r.bounds.requestedVolumeMm3).toBe(6 * 250 * 180 * 120 + 20 * 140 * 90 * 60 + 15 * 90 * 90 * 90)
    expect(r.layout.usedVolumeMm3).toBeLessThanOrEqual(r.bounds.containerVolumeMm3)
  })

  it('an extra search is never worse than layered patterns alone', () => {
    const dense = [item('p', 200, 150, 100, 20), item('q', 120, 120, 120, 20)]
    const withEp = optimize(SAMPLE_BOX, dense)
    const without = optimize(SAMPLE_BOX, dense, { epLimit: 0 })
    expect(withEp.layout.usedVolumeMm3).toBeGreaterThanOrEqual(without.layout.usedVolumeMm3)
  })
})

describe('orientation rules', () => {
  it('upright items keep their own height vertical', () => {
    const r = optimize(SAMPLE_BOX, [item('bottle', 100, 60, 250, null, { upright: true })])
    expect(r.layout.placedCount).toBeGreaterThan(0)
    for (const p of r.layout.placements) expect(p.size.h).toBe(250)
    expect(verifyPlacements(SAMPLE_BOX, r.layout.placements)).toBe(true)
  })

  it('free orientation fits at least as many as upright', () => {
    const free = optimize(SAMPLE_BOX, [item('a', 100, 60, 250, null)])
    const up = optimize(SAMPLE_BOX, [item('a', 100, 60, 250, null, { upright: true })])
    expect(free.layout.usedVolumeMm3).toBeGreaterThanOrEqual(up.layout.usedVolumeMm3)
  })
})

describe('edge cases', () => {
  it('an item larger than the container is reported, not placed', () => {
    const r = optimize(SAMPLE_BOX, [item('a', 700, 500, 500, 3)])
    expect(r.status).toBe('none')
    expect(r.layout.placedCount).toBe(0)
    expect(r.strategy).toBeNull()
    expect(r.layout.freeVolumeMm3).toBe(96_000_000)
  })

  it('an exact fit gives 100%', () => {
    const r = optimize({ l: 100, w: 50, h: 30 }, [item('a', 100, 50, 30, 1)])
    expect(r.layout.placedCount).toBe(1)
    expect(r.layout.usedPct).toBeCloseTo(100, 6)
  })

  it('an exact multiple fills the container despite float error', () => {
    const r = optimize({ l: 0.3, w: 0.2, h: 0.1 }, [item('a', 0.1, 0.1, 0.1, null)])
    expect(r.layout.placedCount).toBe(6)
    expect(r.layout.usedPct).toBeCloseTo(100, 6)
    const inch = optimize({ l: 12 * 25.4, w: 12 * 25.4, h: 12 * 25.4 }, [item('a', 3 * 25.4, 3 * 25.4, 3 * 25.4, null)])
    expect(inch.layout.placedCount).toBe(64)
  })

  it('sums weight in kilograms', () => {
    const r = optimize(SAMPLE_BOX, [item('a', 100, 100, 100, 10, { weightKg: 1.5 }), item('b', 100, 100, 100, 4, { weightKg: 0.25 })])
    expect(r.status).toBe('complete')
    expect(r.totalWeightKg).toBeCloseTo(10 * 1.5 + 4 * 0.25, 9)
  })

  it('reports the bounding box of what was placed', () => {
    const r = optimize(SAMPLE_BOX, [item('a', 100, 100, 100, 2)])
    expect(r.extent.l).toBeLessThanOrEqual(200)
    expect(r.extent.w).toBeLessThanOrEqual(200)
    expect(r.extent.h).toBeLessThanOrEqual(200)
    expect(r.extent.l * r.extent.w * r.extent.h).toBeGreaterThanOrEqual(2_000_000)
  })
})

describe('input validation', () => {
  const bad = (box: Dims, items: PackItem[], options = {}): string => {
    const r = optimize(box, items, options)
    expect(r.status).toBe('rejected')
    expect(r.layout.placedCount).toBe(0)
    return r.warnings[0]
  }
  it('rejects invalid containers, items, quantities and weights', () => {
    expect(bad({ l: 0, w: 1, h: 1 }, [item('a', 1, 1, 1, 1)])).toMatch(/Container/)
    expect(bad({ l: NaN, w: 1, h: 1 }, [item('a', 1, 1, 1, 1)])).toMatch(/Container/)
    expect(bad(SAMPLE_BOX, [])).toMatch(/No items/)
    expect(bad(SAMPLE_BOX, [item('a', -1, 1, 1, 1)])).toMatch(/dimensions/)
    expect(bad(SAMPLE_BOX, [item('a', 1, 1, 1, 0)])).toMatch(/quantity/)
    expect(bad(SAMPLE_BOX, [item('a', 1, 1, 1, 1.5)])).toMatch(/quantity/)
    expect(bad(SAMPLE_BOX, [item('a', 1, 1, 1, 1, { weightKg: -1 })])).toMatch(/weight/)
    expect(bad(SAMPLE_BOX, [item('a', 1, 1, 1, 1), item('a', 2, 2, 2, 1)])).toMatch(/unique/)
    expect(bad(SAMPLE_BOX, [item('a', 1, 1, 1, 5000)], { maxItems: 1000 })).toMatch(/Too many/)
  })
})

describe('performance limits', () => {
  it('caps "as many as fit" for tiny items instead of generating millions of boxes', () => {
    // 1 mm cubes in 600 x 400 x 400 would be 96,000,000 boxes.
    const t0 = Date.now()
    const r = optimize(SAMPLE_BOX, [item('dust', 1, 1, 1, null)])
    expect(r.layout.placedCount).toBe(20_000)
    expect(r.warnings.some((w) => w.includes('capped'))).toBe(true)
    expect(Date.now() - t0).toBeLessThan(5_000)
  }, 20_000)

  it('handles a large fixed order with the indexed verifier', () => {
    const big: Dims = { l: 1200, w: 800, h: 1000 }
    const r = optimize(big, [item('a', 50, 40, 30, 5000)])
    expect(r.layout.placedCount).toBe(5000)
    expect(r.stats.verified).toBe('indexed')
    expect(verifyPlacementsIndexed(big, r.layout.placements)).toBe(true)
  }, 30_000)

  it('respects the work budget of the extreme-points search', () => {
    // Dense mixed order: layered patterns cannot place everything, so the search really runs.
    const dense = [item('p', 200, 150, 100, 20), item('q', 120, 120, 120, 20)]
    const capped = optimize(SAMPLE_BOX, dense, { maxQueries: 1 })
    expect(capped.stats.passes).toBe(1) // the first pass always runs; none after the budget is spent
    expect(optimize(SAMPLE_BOX, dense).stats.passes).toBeGreaterThan(1)
    expect(verifyPlacements(SAMPLE_BOX, capped.layout.placements)).toBe(true)
  }, 20_000)
})

describe('determinism', () => {
  const items = [item('a', 130, 70, 45, 30), item('b', 90, 90, 60, 25), item('c', 60, 40, 30, null)]
  const strip = (ps: Placement[]) => ps.map(({ typeId, x, y, z, size }) => ({ typeId, x, y, z, size }))
  it('same inputs and seed give the same arrangement', () => {
    const a = optimize(SAMPLE_BOX, items, { seed: 7 })
    const b = optimize(SAMPLE_BOX, items, { seed: 7 })
    expect(strip(a.layout.placements)).toEqual(strip(b.layout.placements))
  }, 20_000)
  it('any seed still gives a valid arrangement', () => {
    for (const seed of [1, 2, 3]) {
      const r = optimize(SAMPLE_BOX, items, { seed })
      expect(verifyPlacements(SAMPLE_BOX, r.layout.placements)).toBe(true)
    }
  }, 30_000)
})

describe('integration with existing code', () => {
  it('returns a normal Layout and ids that manual mode can use', () => {
    const r = optimize(SAMPLE_BOX, [item('a', 220, 150, 90, 12)])
    const ids = new Set(r.layout.placements.map((p) => p.id))
    expect(ids.size).toBe(12)
    for (const p of r.layout.placements) expect(checkPlacement(SAMPLE_BOX, r.layout.placements, p).ok).toBe(true)
    expect(r.layout.types[0]).toMatchObject({ typeId: 'a', requested: 12, placed: 12 })
  })
})

describe('verifier agreement', () => {
  it('the indexed verifier agrees with checkPlacement on valid and corrupted layouts', () => {
    const rand = lcg(42)
    let invalid = 0
    for (let trial = 0; trial < 120; trial++) {
      const r = optimize(SAMPLE_BOX, [item('a', 120 + (trial % 5) * 15, 80, 60 + (trial % 3) * 10, 14), item('b', 70, 70, 50, 10)], { epLimit: 0 })
      const ps: Placement[] = r.layout.placements.map((p) => ({ ...p, size: { ...p.size } }))
      if (trial % 3 !== 0 && ps.length > 0) {
        // corrupt one box: shift it, lift it, or grow it
        const p = ps[Math.floor(rand() * ps.length)]
        const kind = Math.floor(rand() * 3)
        if (kind === 0) p.x += (rand() - 0.5) * 120
        else if (kind === 1) p.z += rand() * 80
        else p.size = { ...p.size, l: p.size.l * (1 + rand() * 0.5) }
      }
      const reference = verifyPlacements(SAMPLE_BOX, ps)
      if (!reference) invalid++
      expect(verifyPlacementsIndexed(SAMPLE_BOX, ps)).toBe(reference)
    }
    expect(invalid).toBeGreaterThan(20) // the corrupted cases really exercised the failure paths
  }, 60_000)
})

describe('random orders', () => {
  const toBoxTypes = (items: PackItem[]): BoxType[] => items.map(({ id, color, dims, qty }) => ({ id, color, dims, qty }))

  it('are always valid, never over-fill, and (fixed quantities) match or beat the old slab layout in pieces, then volume', () => {
    const rand = lcg(2026)
    let better = 0
    const cases = 40
    for (let c = 0; c < cases; c++) {
      const box: Dims = { l: 300 + Math.floor(rand() * 500), w: 250 + Math.floor(rand() * 300), h: 200 + Math.floor(rand() * 300) }
      const n = 1 + Math.floor(rand() * 4)
      const items: PackItem[] = []
      for (let i = 0; i < n; i++) {
        items.push(item(`t${i}`, 30 + Math.floor(rand() * 150), 30 + Math.floor(rand() * 120), 20 + Math.floor(rand() * 100), 1 + Math.floor(rand() * 40)))
      }
      const r = optimize(box, items)
      expect(verifyPlacements(box, r.layout.placements)).toBe(true)
      items.forEach((it) => expect(placedOf(r, it.id)).toBeLessThanOrEqual(it.qty!))
      const old = packTypes(box, toBoxTypes(items))
      // Fixed quantities are ranked by pieces first, then by volume.
      expect(r.layout.placedCount).toBeGreaterThanOrEqual(old.placedCount)
      if (r.layout.placedCount === old.placedCount) expect(r.layout.usedVolumeMm3).toBeGreaterThanOrEqual(old.usedVolumeMm3 - 1e-6)
      if (r.layout.placedCount > old.placedCount || r.layout.usedVolumeMm3 > old.usedVolumeMm3 + 1e-6) better++
    }
    expect(better).toBeGreaterThan(0) // it is not just matching: some orders really improve
  }, 120_000)
})
