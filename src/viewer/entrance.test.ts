import { describe, expect, it } from 'vitest'
import {
  BOLT_START,
  BOLT_TIME,
  FLASH_PEAK,
  LAND_TIME,
  LEAVE_START,
  LID_HOVER,
  LID_LEAVE,
  LID_OPACITY,
  LID_START,
  PIECE_TIME,
  STAGGER_SPAN,
  TOTAL_TIME,
  ZIP_START,
  ZIP_TIME,
  boltAmount,
  flashAmount,
  hasStarted,
  landingOrder,
  lidState,
  pieceProgress,
  remaining,
} from './entrance'

describe('entrance timing', () => {
  it('the boxes land in 1 to 2 seconds; the lid sequence follows and the whole thing stays short', () => {
    expect(LAND_TIME).toBeCloseTo(STAGGER_SPAN + PIECE_TIME, 9)
    expect(LAND_TIME).toBeGreaterThanOrEqual(1)
    expect(LAND_TIME).toBeLessThanOrEqual(2)
    expect(TOTAL_TIME).toBeLessThanOrEqual(4)
  })
  it('orders pieces from the floor up, then by x and y, and is stable', () => {
    const list = [
      { x: 5, y: 0, z: 10 },
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ]
    expect(landingOrder(list)).toEqual([1, 2, 3, 0])
  })
  it('every piece has landed exactly (progress 1, nothing left to fall) when the lid arrives', () => {
    for (let rank = 0; rank < 26; rank++) {
      expect(pieceProgress(rank, 26, LAND_TIME)).toBe(1)
      expect(remaining(pieceProgress(rank, 26, LAND_TIME))).toBe(0)
      expect(pieceProgress(rank, 26, TOTAL_TIME + 5)).toBe(1)
    }
  })
  it('starts the lowest piece at once and the last one after the stagger span', () => {
    expect(hasStarted(0, 26, 0)).toBe(true)
    expect(hasStarted(25, 26, STAGGER_SPAN - 0.001)).toBe(false)
    expect(hasStarted(25, 26, STAGGER_SPAN)).toBe(true)
    expect(pieceProgress(25, 26, STAGGER_SPAN)).toBe(0)
    expect(hasStarted(0, 1, 0)).toBe(true)
  })
  it('a piece only falls toward its place: remaining goes from 1 to 0 without ever dipping below', () => {
    expect(remaining(0)).toBe(1)
    let last = 1
    for (let i = 0; i <= 200; i++) {
      const r = remaining(i / 200)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(last + 1e-12)
      last = r
    }
    expect(remaining(2)).toBe(0)
  })
})

describe('lid, zipper and bolt', () => {
  it('the lid is not there until the boxes have landed, and is gone at the end so the boxes can be inspected', () => {
    expect(lidState(0).visible).toBe(false)
    expect(lidState(LAND_TIME).visible).toBe(false)
    expect(LID_START).toBeGreaterThanOrEqual(LAND_TIME)
    expect(lidState(LID_START + 0.01).visible).toBe(true)
    expect(lidState(TOTAL_TIME).visible).toBe(false)
    expect(lidState(TOTAL_TIME + 3).opacity).toBe(0)
  })
  it('the lid is translucent at every moment and moves smoothly: no jumps between frames', () => {
    let prev = lidState(LID_START)
    for (let t = LID_START; t <= TOTAL_TIME; t += 1 / 60) {
      const s = lidState(t)
      expect(s.opacity).toBeGreaterThanOrEqual(0)
      expect(s.opacity).toBeLessThanOrEqual(LID_OPACITY + 1e-9)
      expect(s.rise).toBeGreaterThanOrEqual(-1e-9)
      expect(s.rise).toBeLessThanOrEqual(LID_HOVER + 1e-9)
      expect(Math.abs(s.opacity - prev.opacity)).toBeLessThan(0.05) // at most 5 % of full opacity per frame at 60 fps
      expect(Math.abs(s.rise - prev.rise)).toBeLessThan(0.08) // under 8 % of the container height per frame
      prev = s
    }
  })
  it('the lid is seated and fully shown while the zipper closes and the bolt strikes, then it leaves', () => {
    expect(lidState(ZIP_START).rise).toBeCloseTo(0, 6)
    expect(lidState(ZIP_START).opacity).toBeCloseTo(LID_OPACITY, 6)
    expect(lidState(BOLT_START + BOLT_TIME / 2).rise).toBeCloseTo(0, 6)
    expect(lidState(LEAVE_START).opacity).toBeCloseTo(LID_OPACITY, 6)
    expect(lidState(LEAVE_START + LID_LEAVE / 2).rise).toBeGreaterThan(0)
    expect(lidState(TOTAL_TIME - 0.001).opacity).toBeLessThan(0.01)
  })
  it('the zipper closes from 0 to 1 while the lid is seated, never going back', () => {
    expect(lidState(ZIP_START).zip).toBe(0)
    expect(lidState(ZIP_START + ZIP_TIME).zip).toBe(1)
    let last = 0
    for (let t = 0; t <= TOTAL_TIME; t += 1 / 60) {
      const z = lidState(t).zip
      expect(z).toBeGreaterThanOrEqual(last - 1e-12)
      last = z
    }
    expect(BOLT_START).toBeCloseTo(ZIP_START + ZIP_TIME, 9)
  })
  it('there is a single soft bolt: one smooth bump of about half a second, never a flicker', () => {
    expect(boltAmount(BOLT_START - 0.01)).toBe(0)
    expect(boltAmount(BOLT_START + BOLT_TIME + 0.01)).toBe(0)
    expect(boltAmount(BOLT_START + BOLT_TIME / 2)).toBeCloseTo(1, 9)
    expect(BOLT_TIME).toBeGreaterThanOrEqual(0.4)
    let rises = 0
    let falls = 0
    let prev = 0
    let peak = 0
    for (let t = 0; t <= TOTAL_TIME; t += 1 / 60) {
      const b = boltAmount(t)
      expect(Math.abs(b - prev)).toBeLessThan(0.2) // no fast jumps
      if (b > prev + 1e-9 && prev <= 1e-9) rises++
      if (b < prev - 1e-9 && b <= 1e-9) falls++
      peak = Math.max(peak, b)
      prev = b
    }
    expect(rises).toBe(1)
    expect(falls).toBe(1)
    expect(peak).toBeCloseTo(1, 1)
  })
  it('the glow of the boxes is the same single bump and stays discreet', () => {
    expect(flashAmount(BOLT_START + BOLT_TIME / 2)).toBe(boltAmount(BOLT_START + BOLT_TIME / 2))
    expect(flashAmount(LAND_TIME)).toBe(0)
    expect(flashAmount(TOTAL_TIME)).toBe(0)
    expect(FLASH_PEAK).toBeLessThanOrEqual(0.3)
  })
})
