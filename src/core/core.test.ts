import { describe, expect, it } from 'vitest'
import {
  dimsToFields,
  editField,
  switchFields,
  validateFields,
} from './fields'
import { gridCounts, pack, SAMPLE_BOX, SAMPLE_ITEM, orientations } from './pack'
import { formatDim, formatVolume, parseDim } from './units'

describe('sample case', () => {
  const r = pack(SAMPLE_BOX, SAMPLE_ITEM)
  it('fits 16 items, 49.5% used, 48,480,000 mm³ free', () => {
    expect(r.count).toBe(16)
    expect(r.usedPct).toBeCloseTo(49.5, 10)
    expect(r.freeVolumeMm3).toBe(48_480_000)
    expect(formatVolume(r.freeVolumeMm3, 'mm')).toBe('48,480,000')
  })
  it('breaks ties by fixed order: 220 × 150 × 90 grid 2 × 2 × 4', () => {
    expect(r.orientation).toEqual({ l: 220, w: 150, h: 90 })
    expect(r.counts).toEqual({ x: 2, y: 2, z: 4 })
  })
  it('evaluates six orientations with counts 16,16,16,16,12,12', () => {
    const counts = orientations(SAMPLE_ITEM).map((o) => {
      const g = gridCounts(SAMPLE_BOX, o)
      return g.x * g.y * g.z
    })
    expect(counts).toEqual([16, 16, 16, 16, 12, 12])
  })
})

describe('unit round trip', () => {
  it('preserves values, layout and result after mm -> in -> mm', () => {
    const before = {
      box: dimsToFields(SAMPLE_BOX, 'mm'),
      item: dimsToFields(SAMPLE_ITEM, 'mm'),
    }
    const inch = { box: switchFields(before.box, 'in'), item: switchFields(before.item, 'in') }
    expect(inch.box.l.text).toBe('23.622')
    const back = { box: switchFields(inch.box, 'mm'), item: switchFields(inch.item, 'mm') }
    expect(back).toEqual(before)

    const box = (validateFields(back.box) as { dims: typeof SAMPLE_BOX }).dims
    const item = (validateFields(back.item) as { dims: typeof SAMPLE_ITEM }).dims
    expect(pack(box, item)).toEqual(pack(SAMPLE_BOX, SAMPLE_ITEM))
  })
  it('packs the same from inch-typed values and shows free volume in in³', () => {
    const f = editField('23.622', 'in')
    expect(f.mm).toBeCloseTo(600, 1)
    const r = pack(SAMPLE_BOX, SAMPLE_ITEM)
    expect(formatVolume(r.freeVolumeMm3, 'in')).toBe('2,958.4')
  })
  it('formats dimensions without trailing zeros', () => {
    expect(formatDim(600, 'mm')).toBe('600')
    expect(formatDim(25.4, 'in')).toBe('1')
  })
})

describe('exact fit', () => {
  it('item equal to box gives 1 item, 100%, 0 free', () => {
    const d = { l: 300, w: 200, h: 100 }
    const r = pack(d, d)
    expect(r.count).toBe(1)
    expect(r.usedPct).toBe(100)
    expect(r.freeVolumeMm3).toBe(0)
  })
  it('exact multiples survive float error', () => {
    const r = pack({ l: 0.3, w: 0.3, h: 0.3 }, { l: 0.1, w: 0.1, h: 0.1 })
    expect(r.count).toBe(27)
  })
  it('exact multiples fill the box completely', () => {
    const r = pack({ l: 600, w: 400, h: 400 }, { l: 200, w: 200, h: 100 })
    expect(r.usedPct).toBeCloseTo(100, 9)
  })
})

describe('invalid dimensions', () => {
  it.each(['', '  ', 'abc', '0', '-5', '1e3', 'Infinity', 'NaN', '1.2.3'])(
    'rejects %j',
    (t) => expect(parseDim(t)).toBeNull(),
  )
  it('accepts decimals and comma separators', () => {
    expect(parseDim('12.5')).toBe(12.5)
    expect(parseDim('12,5')).toBe(12.5)
    expect(parseDim('.5')).toBe(0.5)
  })
  it('reports invalid fields and blocks dims', () => {
    const f = dimsToFields(SAMPLE_BOX, 'mm')
    f.w = editField('-3', 'mm')
    f.h = editField('', 'mm')
    expect(validateFields(f)).toEqual({ invalid: ['w', 'h'] })
  })
  it('keeps invalid text unchanged on unit switch', () => {
    const f = dimsToFields(SAMPLE_BOX, 'mm')
    f.l = editField('abc', 'mm')
    expect(switchFields(f, 'in').l.text).toBe('abc')
  })
})

describe('item does not fit', () => {
  const r = pack({ l: 100, w: 100, h: 100 }, { l: 101, w: 101, h: 101 })
  it('returns zero items, 0%, full box free, no orientation', () => {
    expect(r.count).toBe(0)
    expect(r.orientation).toBeNull()
    expect(r.usedPct).toBe(0)
    expect(r.freeVolumeMm3).toBe(1_000_000)
  })
})

describe('invariant', () => {
  it('count never exceeds floor(boxVol / itemVol)', () => {
    let seed = 12345
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let i = 0; i < 500; i++) {
      const box = { l: 1 + rnd() * 500, w: 1 + rnd() * 500, h: 1 + rnd() * 500 }
      const item = { l: 1 + rnd() * 200, w: 1 + rnd() * 200, h: 1 + rnd() * 200 }
      const r = pack(box, item)
      expect(r.count).toBeLessThanOrEqual(Math.floor(r.boxVolumeMm3 / (item.l * item.w * item.h)))
    }
  })
})
