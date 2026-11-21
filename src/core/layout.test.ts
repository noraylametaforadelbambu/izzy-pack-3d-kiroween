import { describe, expect, it } from 'vitest'
import { newRow, parseQty, validateRows, cloneRow, nextColor, PALETTE } from './boxTypes'
import { packTypes, type BoxType, type Layout } from './layout'
import { pack, SAMPLE_BOX, SAMPLE_ITEM, type Dims } from './pack'

const type = (id: string, dims: Dims, qty: number | null): BoxType => ({ id, color: '#fff', dims, qty })

/** True if any two placements overlap or any leaves the container. */
function invalid(l: Layout): boolean {
  const ps = l.placements
  for (const p of ps) {
    if (p.x < 0 || p.y < 0 || p.z < 0) return true
    if (p.x + p.size.l > l.box.l + 1e-9 || p.y + p.size.w > l.box.w + 1e-9 || p.z + p.size.h > l.box.h + 1e-9) return true
  }
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j]
      const overlap =
        a.x < b.x + b.size.l - 1e-9 && b.x < a.x + a.size.l - 1e-9 &&
        a.y < b.y + b.size.w - 1e-9 && b.y < a.y + a.size.w - 1e-9 &&
        a.z < b.z + b.size.h - 1e-9 && b.z < a.z + a.size.h - 1e-9
      if (overlap) return true
    }
  }
  return false
}

describe('single type, quantity "as many as fit"', () => {
  const l = packTypes(SAMPLE_BOX, [type('a', SAMPLE_ITEM, null)])
  it('matches the original optimizer on the sample case', () => {
    const old = pack(SAMPLE_BOX, SAMPLE_ITEM)
    expect(l.placedCount).toBe(16)
    expect(l.usedPct).toBeCloseTo(49.5, 10)
    expect(l.freeVolumeMm3).toBe(48_480_000)
    expect(l.types[0].orientation).toEqual(old.orientation)
    expect(l.unplacedCount).toBe(0)
    expect(l.placements).toHaveLength(16)
  })
  it('has no overlaps and stays inside the container', () => {
    expect(invalid(l)).toBe(false)
  })
})

describe('quantities', () => {
  it('places only the requested quantity', () => {
    const l = packTypes(SAMPLE_BOX, [type('a', SAMPLE_ITEM, 5)])
    expect(l.placedCount).toBe(5)
    expect(l.totalCount).toBe(5)
    expect(l.unplacedCount).toBe(0)
    expect(l.usedVolumeMm3).toBe(5 * 220 * 150 * 90)
    expect(invalid(l)).toBe(false)
  })
  it('reports boxes that do not fit', () => {
    const l = packTypes(SAMPLE_BOX, [type('a', SAMPLE_ITEM, 20)])
    expect(l.placedCount).toBe(16)
    expect(l.unplacedCount).toBe(4)
    expect(l.types[0]).toMatchObject({ requested: 20, placed: 16 })
  })
  it('reports everything unplaced when the item is too big', () => {
    const l = packTypes({ l: 100, w: 100, h: 100 }, [type('a', { l: 101, w: 101, h: 101 }, 3)])
    expect(l.placedCount).toBe(0)
    expect(l.unplacedCount).toBe(3)
    expect(l.freeVolumeMm3).toBe(1_000_000)
    expect(l.usedPct).toBe(0)
    expect(l.types[0].orientation).toBeNull()
  })
})

describe('multiple types', () => {
  const types = [
    type('a', { l: 220, w: 150, h: 90 }, 8),
    type('b', { l: 100, w: 100, h: 100 }, 20),
    type('c', { l: 300, w: 200, h: 100 }, 4),
  ]
  const l = packTypes(SAMPLE_BOX, types)
  it('places each type with its own size and reports what did not fit', () => {
    // Slabs along the length leave 180 mm for the last type, so only 2 of 4 fit.
    expect(l.types.map((t) => t.placed)).toEqual([8, 20, 2])
    expect(l.placedCount).toBe(30)
    expect(l.totalCount).toBe(32)
    expect(l.unplacedCount).toBe(2)
  })
  it('never overlaps or leaves the container', () => {
    expect(invalid(l)).toBe(false)
  })
  it('keeps statistics consistent with the placements', () => {
    const used = 8 * 220 * 150 * 90 + 20 * 1e6 + 2 * 300 * 200 * 100
    expect(l.usedVolumeMm3).toBe(used)
    expect(l.freeVolumeMm3).toBe(l.boxVolumeMm3 - used)
    expect(l.usedPct).toBeCloseTo((used / l.boxVolumeMm3) * 100, 10)
    expect(l.placements.filter((p) => p.typeId === 'b')).toHaveLength(20)
  })
  it('reports the types that no longer fit', () => {
    const tight = packTypes({ l: 300, w: 200, h: 100 }, [
      type('a', { l: 300, w: 200, h: 100 }, 1),
      type('b', { l: 10, w: 10, h: 10 }, 5),
    ])
    expect(tight.types.map((t) => t.placed)).toEqual([1, 0])
    expect(tight.unplacedCount).toBe(5)
    expect(invalid(tight)).toBe(false)
  })
  it('random mixes are always valid', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let i = 0; i < 200; i++) {
      const box = { l: 50 + rnd() * 400, w: 50 + rnd() * 400, h: 50 + rnd() * 400 }
      const ts = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, k) =>
        type(`t${k}`, { l: 10 + rnd() * 150, w: 10 + rnd() * 150, h: 10 + rnd() * 150 }, rnd() < 0.3 ? null : 1 + Math.floor(rnd() * 30)),
      )
      const r = packTypes(box, ts)
      expect(invalid(r)).toBe(false)
      expect(r.usedVolumeMm3).toBeLessThanOrEqual(r.boxVolumeMm3 + 1e-6)
    }
  })
})

describe('box type rows', () => {
  it('parses quantities', () => {
    expect(parseQty('')).toEqual({ ok: true, value: null })
    expect(parseQty(' 12 ')).toEqual({ ok: true, value: 12 })
    for (const bad of ['0', '-1', '1.5', 'abc', '1e3', '100001']) expect(parseQty(bad).ok).toBe(false)
  })
  it('validates dimensions and quantity per row', () => {
    const ok = newRow(SAMPLE_ITEM, '4', PALETTE[0], 'mm')
    const bad = { ...newRow(SAMPLE_ITEM, 'x', PALETTE[1], 'mm') }
    bad.dims = { ...bad.dims, w: { text: '0', mm: null } }
    const v = validateRows([ok, bad])
    expect(v).toEqual({ invalid: [`${bad.id}.w`, `${bad.id}.qty`] })
    expect('types' in validateRows([ok])).toBe(true)
  })
  it('assigns distinct colors to new types', () => {
    let rows = [newRow(SAMPLE_ITEM, '', PALETTE[0], 'mm')]
    for (let i = 0; i < 7; i++) rows = [...rows, cloneRow(rows[rows.length - 1], nextColor(rows))]
    expect(new Set(rows.map((r) => r.color)).size).toBe(8)
    expect(new Set(rows.map((r) => r.id)).size).toBe(8)
  })
})
