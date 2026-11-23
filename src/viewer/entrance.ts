/**
 * Entrance animation of the sample order in the Result view: the boxes drop into their real positions, bottom layer first,
 * then a schematic lid with a zipper seam and one soft bolt, which lifts away. Pure timing, no Three.js. Nothing here
 * touches the layout: the boxes always end exactly in place.
 */

/** Seconds between the first and the last piece starting, and how long each piece takes. */
export const STAGGER_SPAN = 0.55
export const PIECE_TIME = 0.75
/** The pieces have all landed at this time. */
export const LAND_TIME = STAGGER_SPAN + PIECE_TIME
/**
 * After the pieces land, a schematic lid comes down over the container, its zipper closes, one soft bolt strikes the
 * seam, and the lid lifts away and fades so the boxes can be inspected. Each phase is smooth and there is a single bolt
 * (one soft pulse of about half a second, never a flicker).
 */
export const LID_START = LAND_TIME + 0.1
export const LID_ARRIVE = 0.45
export const ZIP_START = LID_START + LID_ARRIVE
export const ZIP_TIME = 0.55
export const BOLT_START = ZIP_START + ZIP_TIME
export const BOLT_TIME = 0.45
export const LEAVE_START = BOLT_START + BOLT_TIME + 0.1
export const LID_LEAVE = 0.6
export const TOTAL_TIME = LEAVE_START + LID_LEAVE
/** How translucent the lid is at most (0 = invisible, 1 = solid). */
export const LID_OPACITY = 0.3
/** How far above its seat the lid hovers when it arrives and leaves, as a share of the container height. */
export const LID_HOVER = 0.45
/** Peak emissive intensity of the glow that goes with the bolt (0 = none, 1 = fully lit): kept low so it stays discreet. */
export const FLASH_PEAK = 0.22
/** How high above its place a piece starts, as a share of the container height (scene units are scaled by the caller). */
export const DROP_SHARE = 1.1

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t))
const easeOut = (t: number): number => 1 - (1 - t) ** 3
const smooth = (t: number): number => t * t * (3 - 2 * t)

export interface LidState {
  visible: boolean
  /** Lid opacity, 0 to LID_OPACITY. */
  opacity: number
  /** Height above its seat as a share of the container height (0 = seated). */
  rise: number
  /** How far the zipper is closed, 0 to 1. */
  zip: number
}

/** The lid at `time` seconds: arrives and seats, holds while the zipper closes, then lifts and fades out. */
export function lidState(time: number): LidState {
  const zip = smooth(clamp01((time - ZIP_START) / ZIP_TIME))
  if (time < LID_START || time >= TOTAL_TIME) return { visible: false, opacity: 0, rise: LID_HOVER, zip }
  const arrive = clamp01((time - LID_START) / LID_ARRIVE)
  const leave = clamp01((time - LEAVE_START) / LID_LEAVE)
  return {
    visible: true,
    opacity: LID_OPACITY * easeOut(arrive) * (1 - smooth(leave)),
    rise: LID_HOVER * ((1 - easeOut(arrive)) + smooth(leave)),
    zip,
  }
}

/** The single bolt: 0 outside its window, one smooth rise and fall in between (never a flicker). */
export function boltAmount(time: number): number {
  const t = (time - BOLT_START) / BOLT_TIME
  if (t <= 0 || t >= 1) return 0
  return Math.sin(Math.PI * t) ** 2
}

/** The glow of the boxes follows the bolt exactly. */
export const flashAmount = boltAmount

/** Indices of the pieces in landing order: lowest first, then by x and y, so the stack builds up from the floor. */
export function landingOrder(list: ReadonlyArray<{ x: number; y: number; z: number }>): number[] {
  return list
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.z - b.p.z || a.p.x - b.p.x || a.p.y - b.p.y || a.i - b.i)
    .map((x) => x.i)
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3

/** 0 before a piece starts, 1 once it has landed. `rank` is its place in the landing order. */
export function pieceProgress(rank: number, count: number, time: number): number {
  const start = count > 1 ? (rank / (count - 1)) * STAGGER_SPAN : 0
  if (time >= start + PIECE_TIME - 1e-9) return 1
  return Math.max(0, (time - start) / PIECE_TIME)
}

/** Share of the starting height still to fall at `progress` (1 = at the start, 0 = in place). Never negative: no overshoot. */
export const remaining = (progress: number): number => 1 - easeOutCubic(Math.min(1, Math.max(0, progress)))

/** A piece is drawn only after it starts to fall (before that it is out of sight above the container). */
export const hasStarted = (rank: number, count: number, time: number): boolean => time >= (count > 1 ? (rank / (count - 1)) * STAGGER_SPAN : 0)
