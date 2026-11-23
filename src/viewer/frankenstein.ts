import type { SoundEvent } from './entrance'

/**
 * The Home animation: a decorative figure of rectangular boxes (green, lilac, black) that stack up into an original
 * Frankenstein's monster. Pure data and timing, no Three.js; it has nothing to do with the order or the packing.
 * The body is green, lilac and black; only the two temple bolts are metal, and they are screwed on last.
 *
 * Coordinates: x to the right, y up, z toward the viewer; the figure stands on y = 0 and faces +z, so the arms
 * reach out toward the camera. Every part is a box: `size` is width, height and depth, `at` its center.
 */
export type FrankColor = 'green' | 'lilac' | 'black' | 'metal'

export const FRANK_COLORS: Record<FrankColor, number> = {
  green: 0x62c46a,
  lilac: 0xb79cff,
  black: 0x1c1530,
  /** Only the two temple bolts. */
  metal: 0xc3ccd9,
}

export interface FrankPart {
  name: string
  color: FrankColor
  size: readonly [number, number, number]
  at: readonly [number, number, number]
  /** Stacked after everything else (the finishing touch). */
  late?: boolean
}

const part = (name: string, color: FrankColor, size: [number, number, number], at: [number, number, number], late = false): FrankPart => (late ? { name, color, size, at, late } : { name, color, size, at })

/** A box whose lowest face is at `bottom`. */
const onFloor = (name: string, color: FrankColor, size: [number, number, number], x: number, bottom: number, z: number): FrankPart =>
  part(name, color, size, [x, bottom + size[1] / 2, z])

const HEAD_BASE = 4.65
const HEAD_FRONT = 0.85 // head depth is 1.7, centered on z = 0

const raw: FrankPart[] = [
  // Feet and legs (black boots and trousers)
  onFloor('boot-left', 'black', [0.95, 0.5, 1.5], -0.55, 0, 0.3),
  onFloor('boot-right', 'black', [0.95, 0.5, 1.5], 0.55, 0, 0.3),
  onFloor('leg-left', 'black', [0.75, 1.5, 0.75], -0.55, 0.5, 0),
  onFloor('leg-right', 'black', [0.75, 1.5, 0.75], 0.55, 0.5, 0),
  // Body: lilac belt, black jacket, lilac shirt
  onFloor('belt', 'lilac', [2.44, 0.25, 1.24], 0, 2.0, 0),
  onFloor('jacket', 'black', [2.4, 2.0, 1.2], 0, 2.25, 0),
  onFloor('shirt', 'lilac', [0.8, 1.6, 0.12], 0, 2.45, 0.63),
  // Arms stretched out toward the viewer: black sleeves, lilac cuffs, green hands
  onFloor('sleeve-left', 'black', [0.6, 0.7, 1.8], -1.5, 3.55, 0.9),
  onFloor('sleeve-right', 'black', [0.6, 0.7, 1.8], 1.5, 3.55, 0.9),
  onFloor('cuff-left', 'lilac', [0.68, 0.78, 0.14], -1.5, 3.51, 1.87),
  onFloor('cuff-right', 'lilac', [0.68, 0.78, 0.14], 1.5, 3.51, 1.87),
  onFloor('hand-left', 'green', [0.62, 0.62, 0.62], -1.5, 3.59, 2.25),
  onFloor('hand-right', 'green', [0.62, 0.62, 0.62], 1.5, 3.59, 2.25),
  // Neck with two bolts
  onFloor('neck', 'green', [0.8, 0.4, 0.8], 0, 4.25, 0),
  onFloor('bolt-left', 'lilac', [0.5, 0.28, 0.28], -0.62, 4.31, 0),
  onFloor('bolt-right', 'lilac', [0.5, 0.28, 0.28], 0.62, 4.31, 0),
  // Head: a flat-topped green block
  onFloor('head', 'green', [2.0, 1.9, 1.7], 0, HEAD_BASE, 0),
  onFloor('mouth', 'black', [1.0, 0.14, 0.1], 0, HEAD_BASE + 0.3, HEAD_FRONT + 0.05),
  onFloor('mouth-stitch-1', 'lilac', [0.08, 0.34, 0.12], -0.36, HEAD_BASE + 0.2, HEAD_FRONT + 0.06),
  onFloor('mouth-stitch-2', 'lilac', [0.08, 0.34, 0.12], -0.12, HEAD_BASE + 0.2, HEAD_FRONT + 0.06),
  onFloor('mouth-stitch-3', 'lilac', [0.08, 0.34, 0.12], 0.12, HEAD_BASE + 0.2, HEAD_FRONT + 0.06),
  onFloor('mouth-stitch-4', 'lilac', [0.08, 0.34, 0.12], 0.36, HEAD_BASE + 0.2, HEAD_FRONT + 0.06),
  onFloor('nose', 'green', [0.3, 0.55, 0.35], 0, HEAD_BASE + 0.62, HEAD_FRONT + 0.17),
  onFloor('eye-left', 'lilac', [0.44, 0.26, 0.12], -0.5, HEAD_BASE + 0.8, HEAD_FRONT + 0.06),
  onFloor('eye-right', 'lilac', [0.44, 0.26, 0.12], 0.5, HEAD_BASE + 0.8, HEAD_FRONT + 0.06),
  onFloor('pupil-left', 'black', [0.16, 0.2, 0.06], -0.5, HEAD_BASE + 0.83, HEAD_FRONT + 0.15),
  onFloor('pupil-right', 'black', [0.16, 0.2, 0.06], 0.5, HEAD_BASE + 0.83, HEAD_FRONT + 0.15),
  onFloor('brow', 'black', [1.7, 0.17, 0.16], 0, HEAD_BASE + 1.1, HEAD_FRONT + 0.08),
  onFloor('scar', 'black', [0.8, 0.1, 0.1], 0.6, HEAD_BASE + 1.33, HEAD_FRONT + 0.05),
  onFloor('scar-stitch-1', 'lilac', [0.07, 0.3, 0.12], 0.3, HEAD_BASE + 1.23, HEAD_FRONT + 0.06),
  onFloor('scar-stitch-2', 'lilac', [0.07, 0.3, 0.12], 0.6, HEAD_BASE + 1.23, HEAD_FRONT + 0.06),
  onFloor('scar-stitch-3', 'lilac', [0.07, 0.3, 0.12], 0.9, HEAD_BASE + 1.23, HEAD_FRONT + 0.06),
  // Black hair: a flat slab with three points over the forehead
  onFloor('fringe-left', 'black', [0.5, 0.3, 0.16], -0.7, HEAD_BASE + 1.6, HEAD_FRONT + 0.06),
  onFloor('fringe-middle', 'black', [0.5, 0.42, 0.16], -0.05, HEAD_BASE + 1.48, HEAD_FRONT + 0.06),
  onFloor('fringe-right', 'black', [0.5, 0.3, 0.16], 0.7, HEAD_BASE + 1.6, HEAD_FRONT + 0.06),
  onFloor('hair', 'black', [2.24, 0.6, 1.94], 0, HEAD_BASE + 1.9, 0),
  ...(([-1, 1] as const).flatMap((side) => {
    const side_ = side < 0 ? 'left' : 'right'
    const y = HEAD_BASE + 1.2 // temple height
    return [
      // A metal screw on each temple: a shaft into the head, a wider cap, and a dark slot in the cap.
      part(`temple-bolt-${side_}-shaft`, 'metal', [0.36, 0.2, 0.2], [side * 1.18, y, 0.2], true),
      part(`temple-bolt-${side_}-cap`, 'metal', [0.14, 0.5, 0.5], [side * 1.43, y, 0.2], true),
      part(`temple-bolt-${side_}-slot`, 'black', [0.05, 0.38, 0.08], [side * 1.52, y, 0.2], true),
    ]
  })),
]

/** The parts in the order they are stacked: lowest first, so every part lands on or beside one already there; the temple bolts last. */
export const FRANK_PARTS: readonly FrankPart[] = raw
  .map((p, i) => ({ p, i }))
  .sort((a, b) => Number(a.p.late === true) - Number(b.p.late === true) || a.p.at[1] - a.p.size[1] / 2 - (b.p.at[1] - b.p.size[1] / 2) || a.i - b.i)
  .map((x) => x.p)

/** The platform the figure stands on: black, static, drawn from the start. */
export const FRANK_PLATFORM = { size: [5.4, 0.3, 4.6] as const, at: [0, -0.15, 0.5] as const }

/** What the camera has to frame: the figure's bounding box. */
export function frankBounds(): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const p of FRANK_PARTS) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p.at[k] - p.size[k] / 2)
      max[k] = Math.max(max[k], p.at[k] + p.size[k] / 2)
    }
  }
  return { min, max }
}

// ---- Timing ------------------------------------------------------------------------------------

/** Seconds between the start of two parts, and how long one part takes to land. */
export const STAGGER = 0.06
export const DROP_TIME = 0.8
/** How far above its final place a part starts. */
export const DROP_HEIGHT = 9

/** The whole animation in seconds. It plays once. */
export const totalDuration = (count: number = FRANK_PARTS.length): number => (count - 1) * STAGGER + DROP_TIME

/** Standard "ease out bounce": 0 → 1, touching 1 at the first landing and bouncing back from there. */
export function easeOutBounce(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  const n = 7.5625
  const d = 2.75
  if (x < 1 / d) return n * x * x
  if (x < 2 / d) return n * (x - 1.5 / d) ** 2 + 0.75
  if (x < 2.5 / d) return n * (x - 2.25 / d) ** 2 + 0.9375
  return n * (x - 2.625 / d) ** 2 + 0.984375
}

/** 0 before a part starts, 1 once it has landed for good. `index` is the part's place in the stacking order. */
export function partProgress(index: number, time: number): number {
  const start = index * STAGGER
  if (time >= start + DROP_TIME - 1e-9) return 1 // exact 1 once landed, whatever the rounding
  return Math.max(0, (time - start) / DROP_TIME)
}

/** How far above its final place a part is at `progress` (0 = in place). Never negative, so nothing sinks into the stack. */
export const dropOffset = (progress: number): number => DROP_HEIGHT * (1 - easeOutBounce(progress))

/** A part is drawn only after it starts to fall. */
export const hasStarted = (index: number, time: number): boolean => time >= index * STAGGER

/** Small, fixed twist (radians) a part has while falling, easing to 0 as it lands. */
export const startTwist = (index: number): number => ((index * 37) % 11 - 5) * 0.09
export const twistAt = (index: number, progress: number): number => startTwist(index) * (1 - Math.min(1, progress * 1.4)) ** 2

// ---- Sound events ----------------------------------------------------------------------------------

/** A part first touches its place when the bounce first reaches 1 (see `easeOutBounce`). */
export const FIRST_IMPACT = 1 / 2.75
/** Impacts closer together than this are one sound (a heavier thud), not a rattle. */
export const GROUP_WINDOW = 0.15

export type FrankSoundKind = 'thud' | 'metal'
export interface FrankSoundEvent {
  /** Seconds from the start of the animation. */
  time: number
  kind: FrankSoundKind
  /** 0 to 1: how heavy the parts that hit together are (thud); always 1 for the metal click. */
  strength: number
}

/** When part number `index` (in stacking order) first touches its place. */
export const impactTime = (index: number): number => index * STAGGER + DROP_TIME * FIRST_IMPACT

/**
 * The sounds of the animation, on its own clock: one soft thud per group of parts that land together (impacts within
 * `GROUP_WINDOW` of each other are merged, at their mean time, and sound heavier the bigger the parts are), and one metallic click
 * when the last of the temple screws lands. The screws do not thud: they make the click.
 */
export function frankSoundEvents(parts: readonly FrankPart[] = FRANK_PARTS): FrankSoundEvent[] {
  const events: FrankSoundEvent[] = []
  let group: number[] = []
  let volume = 0
  const flush = (): void => {
    if (group.length === 0) return
    const time = group.reduce((a, b) => a + b, 0) / group.length
    // Heavier (bigger, more) parts landing together make a heavier thud; never silent, never at full blast.
    events.push({ time, kind: 'thud', strength: Math.min(1, 0.3 + (0.7 * Math.sqrt(volume)) / 3.5) })
    group = []
    volume = 0
  }
  let screwTime = -1
  parts.forEach((p, i) => {
    const t = impactTime(i)
    if (p.late) {
      screwTime = Math.max(screwTime, t)
      return
    }
    if (group.length > 0 && t - group[0] > GROUP_WINDOW) flush()
    group.push(t)
    volume += p.size[0] * p.size[1] * p.size[2]
  })
  flush()
  if (screwTime >= 0) events.push({ time: screwTime, kind: 'metal', strength: 1 })
  return events.sort((a, b) => a.time - b.time)
}

/** The soundtrack of the Home animation as a timeline (see `SoundEvent`). */
export const frankTimeline = (parts: readonly FrankPart[] = FRANK_PARTS): SoundEvent[] =>
  frankSoundEvents(parts).map((e) => ({ at: e.time, kind: e.kind, strength: e.strength }))

