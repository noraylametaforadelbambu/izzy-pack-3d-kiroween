import { describe, expect, it } from 'vitest'
import { EXAMPLE_BOXES, newCatalogRow, recommendBox, validateCatalog } from '../core/catalog'
import { validateRows } from '../core/boxTypes'
import type { Placement } from '../core/layout'
import type { PictogramKind } from '../core/pictogram'
import { rowsFromSample } from '../core/sampleOrder'
import { MAX_DECALS, planDecals, type Decal, type Face } from './decals'

const box = (id: string, x: number, y: number, z: number, l: number, w: number, h: number, typeId = 't'): Placement => ({ id, typeId, color: '#fff', x, y, z, size: { l, w, h } })
const all = (): PictogramKind => 'skull'

/** Independent check: the icon square of a decal is not touched by any other box on that face. */
function freeOfNeighbours(ps: Placement[], d: Decal): boolean {
  const p = ps[d.index]
  const s = d.size
  const spans =
    d.face === 'right'
      ? { plane: p.x + p.size.l, cu: p.y + p.size.w / 2, cv: p.z + p.size.h / 2 }
      : d.face === 'front'
        ? { plane: p.y + p.size.w, cu: p.x + p.size.l / 2, cv: p.z + p.size.h / 2 }
        : { plane: p.z + p.size.h, cu: p.x + p.size.l / 2, cv: p.y + p.size.w / 2 }
  return ps.every((b, j) => {
    if (j === d.index) return true
    const [start, u0, u1, v0, v1] =
      d.face === 'right'
        ? [b.x, b.y, b.y + b.size.w, b.z, b.z + b.size.h]
        : d.face === 'front'
          ? [b.y, b.x, b.x + b.size.l, b.z, b.z + b.size.h]
          : [b.z, b.x, b.x + b.size.l, b.y, b.y + b.size.w]
    if (Math.abs(start - spans.plane) > 1e-3) return true // not touching that plane
    const ou = Math.min(spans.cu + s / 2, u1) - Math.max(spans.cu - s / 2, u0)
    const ov = Math.min(spans.cv + s / 2, v1) - Math.max(spans.cv - s / 2, v0)
    return !(ou > 1e-6 && ov > 1e-6)
  })
}
const faceOf = (ds: Decal[], i: number): Face | undefined => ds.find((d) => d.index === i)?.face

describe('planDecals: which face carries the pictogram', () => {
  it('a lone box gets one, on the face that gives the biggest icon (weighted by camera view)', () => {
    const ds = planDecals([box('a', 0, 0, 0, 100, 100, 100)], all)
    expect(ds).toHaveLength(1)
    expect(ds[0].face).toBe('front') // equal faces: the face the default camera sees most directly
    expect(ds[0].size).toBeCloseTo(80, 6) // 0.8 of the 100 mm face
  })
  it('a flat box (wide top, thin sides) shows it on top', () => {
    const ds = planDecals([box('flat', 0, 0, 0, 240, 170, 70)], all)
    expect(ds[0].face).toBe('top')
    expect(ds[0].size).toBeCloseTo(136, 6)
  })
  it('a tall narrow box shows it on a side', () => {
    expect(planDecals([box('candle', 0, 0, 0, 70, 70, 150)], all)[0].face).toBe('front')
  })
  it('never puts it on a face another box touches', () => {
    // neighbour in front (+y), on the right (+x) and on top: only no face is free
    const ps = [box('c', 100, 100, 100, 100, 100, 100), box('f', 100, 200, 100, 100, 100, 100), box('r', 200, 100, 100, 100, 100, 100), box('t', 100, 100, 200, 100, 100, 100)]
    expect(faceOf(planDecals(ps, (id) => (id === 't' ? 'skull' : undefined)), 0)).toBeUndefined()
    const free = planDecals(ps.slice(0, 3), all)
    expect(faceOf(free, 0)).toBe('top') // front and right are covered, top is free
    free.forEach((d) => expect(freeOfNeighbours(ps.slice(0, 3), d)).toBe(true))
  })
  it('a face on the container wall counts as exterior', () => {
    // nothing else is there: the right face (x = 100) is the wall of a 100 mm container, and it is used
    const ps = [box('a', 0, 0, 0, 100, 100, 100), box('b', 0, 100, 0, 100, 100, 100)]
    const ds = planDecals(ps, all)
    expect(ds.map((d) => d.index)).toEqual([0, 1])
    expect(faceOf(ds, 0)).not.toBe('front') // covered by b
    expect(faceOf(ds, 1)).toBe('front') // b's front is free
  })
  it('a neighbour offset by half a box leaves room for a smaller icon', () => {
    const ps = [box('a', 0, 0, 0, 100, 100, 100), box('b', 0, 100, 0, 50, 100, 100)]
    const d = planDecals(ps, all).find((x) => x.index === 0)!
    expect(freeOfNeighbours(ps, d)).toBe(true)
    expect(d.size).toBeGreaterThan(0)
  })
  it('skips products without a pictogram and does not touch the input', () => {
    const ps = [box('a', 0, 0, 0, 50, 50, 50, 'x'), box('b', 100, 0, 0, 50, 50, 50, 'y')]
    const before = JSON.stringify(ps)
    const ds = planDecals(ps, (id) => (id === 'y' ? 'candle' : undefined))
    expect(ds.map((d) => [d.index, d.kind])).toEqual([[1, 'candle']])
    expect(JSON.stringify(ps)).toBe(before)
    expect(planDecals([], all)).toEqual([])
  })
  it('is deterministic and capped for huge layouts', () => {
    const grid: Placement[] = []
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) for (let k = 0; k < 2; k++) grid.push(box(`${i}-${j}-${k}`, i * 10, j * 10, k * 10, 10, 10, 10))
    const a = planDecals(grid, all)
    expect(JSON.stringify(planDecals(grid, all))).toBe(JSON.stringify(a))
    expect(a.length).toBeLessThanOrEqual(MAX_DECALS)
    a.slice(0, 200).forEach((d) => expect(freeOfNeighbours(grid, d)).toBe(true))
  })
})

describe('planDecals on a dense block', () => {
  const cube: Placement[] = []
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) cube.push(box(`${i}${j}${k}`, i * 100, j * 100, k * 100, 100, 100, 100))
  const ds = planDecals(cube, all)
  it('every pictogram is on an exposed face', () => {
    expect(ds.length).toBeGreaterThan(0)
    ds.forEach((d) => expect(freeOfNeighbours(cube, d)).toBe(true))
  })
  it('only the boxes that can show one get one: those with a free front, right or top face', () => {
    const shown = new Set(ds.map((d) => d.index))
    cube.forEach((b, i) => {
      const [x, y, z] = [b.x / 100, b.y / 100, b.z / 100]
      const canShow = x === 2 || y === 2 || z === 2 // an outer face on the +x, +y or +z side
      expect(shown.has(i)).toBe(canShow)
    })
    expect(ds).toHaveLength(27 - 8) // the 2 x 2 x 2 block of boxes that touch no outer face on those sides
  })
})

describe('planDecals on the real sample order', () => {
  it('every box that has a free exterior face gets exactly one, of its own product kind', () => {
    const rows = rowsFromSample('mm', 'kg')
    const v = validateRows(rows)
    if (!('types' in v)) throw new Error('rows')
    const c = validateCatalog(EXAMPLE_BOXES.map((d) => newCatalogRow(d, 'mm')))
    if (!('boxes' in c)) throw new Error('catalog')
    const rec = recommendBox(c.boxes, v.types, { emptyG: 0, maxG: null })
    expect(rec.status).toBe('found')
    const ps = rec.result!.layout.placements
    const kindOf = new Map(rows.map((r) => [r.id, r.pictogram]))
    const ds = planDecals(ps, (id) => kindOf.get(id))
    expect(ps).toHaveLength(26)
    // all three kinds appear, once per box at most
    expect(new Set(ds.map((d) => d.kind))).toEqual(new Set(['skull', 'candle', 'pumpkin']))
    expect(new Set(ds.map((d) => d.index)).size).toBe(ds.length)
    ds.forEach((d) => {
      expect(d.kind).toBe(kindOf.get(ps[d.index].typeId))
      expect(freeOfNeighbours(ps, d)).toBe(true)
    })
    // the boxes without one really have no free exterior face on the three visible sides
    const without = ps.map((_, i) => i).filter((i) => !ds.some((d) => d.index === i))
    const probe = (i: number) => planDecals([ps[i], ...ps.filter((_, j) => j !== i)], () => 'skull').some((d) => d.index === 0)
    without.forEach((i) => expect(probe(i)).toBe(false))
    expect(ds.length).toBeGreaterThanOrEqual(Math.ceil(ps.length * 0.6)) // most boxes show their pictogram
  })
})
