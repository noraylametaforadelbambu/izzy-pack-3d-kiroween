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
/**
 * Sound cues, as times on the same clock as the animation. The click of the zipper closing comes just as the pull reaches the
 * end of the seam; the electric crackle comes as the bolt strikes (the bolt is rising, before its peak).
 */
export const ZIP_CUE = ZIP_START + ZIP_TIME * 0.92
export const BOLT_CUE = BOLT_START + BOLT_TIME * 0.2

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

/** One sound of an animation, on that animation's own clock. */
export interface SoundEvent {
  /** Seconds from the start of the animation. */
  at: number
  kind: 'thud' | 'zip' | 'zap' | 'metal'
  /** 0 to 1: how loud (thuds); 1 for the others. */
  strength: number
}

/** A box is landed (visually in place) when its fall has covered this share of its time: the ease-out is flat from there on. */
export const IMPACT_PROGRESS = 0.9
/** Boxes landing within this many seconds of each other count as simultaneous and make one thud. */
export const LANDING_GROUP_WINDOW = 0.04

export interface LandingSound {
  /** Seconds from the start of the entrance. */
  time: number
  /** 0.25 to 0.8: how heavy the boxes that land together are. Softer than the Home thuds because there are many. */
  strength: number
}

/** When the box with landing rank `rank` (of `count`) lands. */
export const landingTime = (rank: number, count: number): number => (count > 1 ? (rank / (count - 1)) * STAGGER_SPAN : 0) + PIECE_TIME * IMPACT_PROGRESS

/**
 * The thuds of the boxes landing, on the animation's clock. `volumesByRank[r]` is the volume of the box that lands r-th.
 * Only boxes that land at (almost) the same time are merged (at their mean time, a little heavier); every other box
 * has its own soft thud, at the moment it lands.
 */
export function landingSounds(volumesByRank: readonly number[]): LandingSound[] {
  const n = volumesByRank.length
  if (n === 0) return []
  const biggest = Math.max(...volumesByRank, 1e-9)
  const out: LandingSound[] = []
  let times: number[] = []
  let volume = 0
  const flush = (): void => {
    if (times.length === 0) return
    const time = times.reduce((a, b) => a + b, 0) / times.length
    out.push({ time, strength: Math.min(0.8, 0.25 + 0.5 * Math.sqrt(volume / (2 * biggest))) })
    times = []
    volume = 0
  }
  for (let r = 0; r < n; r++) {
    const t = landingTime(r, n)
    if (times.length > 0 && t - times[0] > LANDING_GROUP_WINDOW) flush()
    times.push(t)
    volume += volumesByRank[r]
  }
  flush()
  return out
}

/**
 * The whole soundtrack of the Result entrance, scheduled once when it starts: a soft thud for each box (or group landing
 * together), then the zipper click and the crackle of the bolt. Because every sound is placed on the audio clock at the
 * start, a late frame cannot bunch or shift them.
 */
export function entranceTimeline(landings: readonly LandingSound[]): SoundEvent[] {
  const events: SoundEvent[] = landings.map((l) => ({ at: l.time, kind: 'thud' as const, strength: l.strength }))
  events.push({ at: ZIP_CUE, kind: 'zip', strength: 1 }, { at: BOLT_CUE, kind: 'zap', strength: 1 })
  return events.sort((x, y) => x.at - y.at)
}

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
