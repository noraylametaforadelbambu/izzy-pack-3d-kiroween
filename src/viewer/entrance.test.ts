import { describe, expect, it } from 'vitest'
import {
  BOLT_CUE,
  BOLT_START,
  entranceTimeline,
  IMPACT_PROGRESS,
  LANDING_GROUP_WINDOW,
  landingSounds,
  landingTime,
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
  ZIP_CUE,
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

describe('sound cues', () => {
  it('the zipper click comes as the seam closes, just before the bolt window', () => {
    expect(ZIP_CUE).toBeGreaterThan(ZIP_START + ZIP_TIME * 0.8)
    expect(ZIP_CUE).toBeLessThanOrEqual(BOLT_START)
    expect(lidState(ZIP_CUE).zip).toBeGreaterThan(0.95)
  })
  it('the crackle comes as the bolt strikes: inside its window, while it is still rising', () => {
    expect(BOLT_CUE).toBeGreaterThan(BOLT_START)
    expect(BOLT_CUE).toBeLessThan(BOLT_START + BOLT_TIME / 2)
    expect(boltAmount(BOLT_CUE)).toBeGreaterThan(0.2)
    expect(boltAmount(BOLT_CUE)).toBeLessThan(0.6)
  })
  it('the two sounds are distinct (at least 100 ms apart) and both happen before the lid leaves', () => {
    expect(BOLT_CUE - ZIP_CUE).toBeGreaterThanOrEqual(0.1)
    expect(BOLT_CUE).toBeLessThan(LEAVE_START)
  })
})

describe('entrance soundtrack', () => {
  it('is one timeline: thuds first, then the zipper click, then the crackle, in order and inside the animation', () => {
    const landings = landingSounds(Array.from({ length: 26 }, () => 1))
    const tl = entranceTimeline(landings)
    expect(tl.length).toBe(landings.length + 2)
    expect(tl.map((e) => e.at)).toEqual([...tl.map((e) => e.at)].sort((a, b) => a - b))
    expect(tl.slice(-2).map((e) => e.kind)).toEqual(['zip', 'zap'])
    expect(tl.slice(0, -2).every((e) => e.kind === 'thud')).toBe(true)
    expect(tl[tl.length - 2].at).toBe(ZIP_CUE)
    expect(tl[tl.length - 1].at).toBe(BOLT_CUE)
    expect(tl.every((e) => e.at > 0 && e.at < TOTAL_TIME)).toBe(true)
    expect(tl.every((e) => e.strength > 0 && e.strength <= 1)).toBe(true)
  })
})

describe('landing thuds', () => {
  const same = Array.from({ length: 26 }, () => 1)
  it('a box lands when its fall is over (ease-out, no bounce): never before it has fallen, never after all have landed', () => {
    expect(IMPACT_PROGRESS).toBeGreaterThan(0.8)
    expect(remaining(IMPACT_PROGRESS)).toBeLessThan(0.002)
    for (let r = 0; r < 26; r++) {
      expect(landingTime(r, 26)).toBeGreaterThanOrEqual(PIECE_TIME * IMPACT_PROGRESS - 1e-9)
      expect(landingTime(r, 26)).toBeLessThanOrEqual(LAND_TIME)
    }
    expect(landingTime(0, 26)).toBeCloseTo(PIECE_TIME * IMPACT_PROGRESS, 9)
    expect(landingTime(25, 26)).toBeCloseTo(STAGGER_SPAN + PIECE_TIME * IMPACT_PROGRESS, 9)
  })
  it('only boxes landing at (almost) the same moment are grouped: one thud per box, or per pair at 22 ms apart', () => {
    const s = landingSounds(same)
    expect(s.length).toBeGreaterThan(26 / 3)
    expect(s.length).toBeLessThanOrEqual(26)
    for (let i = 1; i < s.length; i++) expect(s[i].time - s[i - 1].time).toBeGreaterThan(0)
    // the same grouping, counted independently: a new group starts when a box lands more than the window after the group's first
    let groups = 0
    let first = -Infinity
    for (let r = 0; r < 26; r++) {
      const t = landingTime(r, 26)
      if (t - first > LANDING_GROUP_WINDOW) {
        groups++
        first = t
      }
    }
    expect(s.length).toBe(groups)
    expect(landingSounds([1, 1]).length).toBe(2) // two boxes 0.55 s apart are never merged
    expect(landingSounds([1])).toHaveLength(1)
    expect(landingSounds([])).toEqual([])
  })
  it('two boxes landing together make a heavier thud than one box alone', () => {
    expect(landingSounds(same)[0].strength).toBeGreaterThan(landingSounds([1])[0].strength)
  })
  it('thuds are soft, scale with the size of the boxes, and all come before the lid', () => {
    const mixed = Array.from({ length: 26 }, (_, i) => (i % 3 === 0 ? 2.86 : i % 3 === 1 ? 0.735 : 1.33))
    const s = landingSounds(mixed)
    expect(s.every((x) => x.strength >= 0.25 && x.strength <= 0.8)).toBe(true)
    expect(Math.max(...s.map((x) => x.strength))).toBeGreaterThan(Math.min(...s.map((x) => x.strength)))
    expect(s[s.length - 1].time).toBeLessThanOrEqual(LAND_TIME)
    expect(s[s.length - 1].time).toBeLessThan(LID_START)
    expect(landingSounds(same).every((x) => x.time < ZIP_CUE - 0.5)).toBe(true)
  })
})
