import { describe, expect, it } from 'vitest'
import { PICTOGRAM_KINDS } from '../core/pictogram'
import { drawPictogram, type Ctx2D } from './pictograms'

/** A canvas stand-in that records every call and every coordinate it receives. */
function recorder() {
  const calls: string[] = []
  const colors = new Set<string>()
  let xs: number[] = []
  const track = (...n: number[]) => (xs = xs.concat(n))
  const ctx: Record<string, unknown> & { fillStyle: unknown; strokeStyle: unknown } = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    clearRect: () => calls.push('clearRect'),
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    closePath: () => calls.push('closePath'),
    moveTo: (x: number, y: number) => (calls.push('moveTo'), track(x, y)),
    lineTo: (x: number, y: number) => (calls.push('lineTo'), track(x, y)),
    bezierCurveTo: (...a: number[]) => (calls.push('bezierCurveTo'), track(...a)),
    arc: (x: number, y: number, r: number) => (calls.push('arc'), track(x - r, x + r, y - r, y + r)),
    ellipse: (x: number, y: number, rx: number, ry: number) => (calls.push('ellipse'), track(x - rx, x + rx, y - ry, y + ry)),
    rect: (x: number, y: number, w: number, h: number) => (calls.push('rect'), track(x, y, x + w, y + h)),
    fill: (rule?: string) => (calls.push(rule ? `fill:${rule}` : 'fill'), colors.add(String(ctx.fillStyle))),
    stroke: () => (calls.push('stroke'), colors.add(String(ctx.strokeStyle))),
    clip: () => calls.push('clip'),
  }
  return { ctx: ctx as unknown as Ctx2D, calls, colors, coords: () => xs }
}

describe('pictogram drawing', () => {
  it('draws something different for each kind, on a badge, and ends balanced (save/restore)', () => {
    const seq = PICTOGRAM_KINDS.map((k) => {
      const r = recorder()
      drawPictogram(r.ctx, k, 128)
      expect(r.calls[0]).toBe('clearRect')
      expect(r.calls.filter((c) => c.startsWith('fill')).length).toBeGreaterThanOrEqual(2) // the badge and the figure
      expect(r.calls.filter((c) => c === 'save').length).toBe(r.calls.filter((c) => c === 'restore').length)
      return r.calls.join(',')
    })
    expect(new Set(seq).size).toBe(3)
  })
  it('stays inside the canvas', () => {
    for (const k of PICTOGRAM_KINDS) {
      const r = recorder()
      drawPictogram(r.ctx, k, 128)
      const xs = r.coords()
      expect(xs.length).toBeGreaterThan(20)
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...xs)).toBeLessThanOrEqual(128)
    }
  })
  it('scales with the canvas size', () => {
    const a = recorder()
    const b = recorder()
    drawPictogram(a.ctx, 'candle', 64)
    drawPictogram(b.ctx, 'candle', 128)
    expect(Math.max(...b.coords())).toBeCloseTo(2 * Math.max(...a.coords()), 6)
  })
  it('the skull is filled even-odd, so its eye sockets and nose stay dark', () => {
    const r = recorder()
    drawPictogram(r.ctx, 'skull', 128)
    expect(r.calls).toContain('fill:evenodd')
    expect(r.calls.filter((c) => c === 'ellipse')).toHaveLength(2) // two eye sockets
  })
  it('the jack-o’-lantern has three lobes, triangular eyes, a nose and a smile; the candle has a flame and a wick', () => {
    const j = recorder()
    drawPictogram(j.ctx, 'pumpkin', 128)
    expect(j.calls.filter((c) => c === 'ellipse')).toHaveLength(3) // three pumpkin lobes
    expect(j.calls.filter((c) => c === 'closePath').length).toBeGreaterThanOrEqual(5) // stem, eyes, nose, smile
    const c = recorder()
    drawPictogram(c.ctx, 'candle', 128)
    expect(c.calls.filter((x) => x === 'bezierCurveTo').length).toBeGreaterThanOrEqual(4) // flame and its core
    expect(c.calls).toContain('rect')
  })
})

/** hue (0-360), saturation and lightness (0-1) of '#rrggbb' or 'rgba(r, g, b, a)'. */
function hsl(color: string): { h: number; s: number; l: number } {
  let r: number, g: number, b: number
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex) [r, g, b] = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16))
  else [r, g, b] = (/rgba?\(([^)]*)\)/.exec(color)?.[1] ?? '0,0,0').split(',').slice(0, 3).map((x) => Number(x))
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

describe('pictograms keep to a Halloween palette (no Christmas look)', () => {
  const used = new Set<string>()
  for (const k of PICTOGRAM_KINDS) {
    const r = recorder()
    drawPictogram(r.ctx, k, 128)
    r.colors.forEach((c) => used.add(c))
  }
  it('uses only a handful of colors', () => {
    expect(used.size).toBeGreaterThan(5)
    expect(used.size).toBeLessThanOrEqual(14)
  })
  it('has no green (Christmas green or any other)', () => {
    for (const c of used) {
      const { h, s } = hsl(c)
      expect(!(s > 0.2 && h >= 70 && h <= 175), `green color ${c}`).toBe(true)
    }
  })
  it('has no gold or yellow', () => {
    for (const c of used) {
      const { h, s, l } = hsl(c)
      expect(!(s > 0.55 && l > 0.4 && h >= 38 && h <= 70), `gold/yellow color ${c}`).toBe(true)
    }
  })
  it('has no red (the other Christmas color)', () => {
    for (const c of used) {
      const { h, s, l } = hsl(c)
      expect(!(s > 0.5 && l > 0.2 && (h <= 10 || h >= 345)), `red color ${c}`).toBe(true)
    }
  })
  it('is bone white, black, lavender, orange and brown', () => {
    // near-black and near-white colors have no real hue; the rest must be orange, brown or lavender
    const hues = [...used].map((c) => hsl(c)).filter((x) => x.s > 0.2 && x.l > 0.12 && x.l < 0.85)
    for (const { h } of hues) expect((h >= 15 && h <= 36) || (h >= 240 && h <= 275)).toBe(true) // orange / brown, lavender
  })
})
