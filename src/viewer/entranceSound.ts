/**
 * Sound effects of the sample order's entrance, synthesized with the Web Audio API (no audio files): a soft click when the
 * zipper closes and a brief electric crackle with the single bolt. Everything is quiet, short and scheduled by the
 * animation's own cues, so it stays in sync with what is on screen.
 *
 *  - `unlock()` must be called from a user gesture (the Sound button, or the click that confirms the box): browsers keep
 *    an AudioContext suspended until then.
 *  - `silence()` stops every sound right away (turning Sound off, leaving Result, a cut-short entrance).
 */
const MASTER = 0.35

type Factory = () => AudioContext | null

const defaultFactory: Factory = () => {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return Ctor ? new Ctor() : null
}

export class EntranceSound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private active = new Set<AudioScheduledSourceNode>()
  private factory: Factory
  /** Called with 'unlock', 'zip', 'zap', 'thud', 'metal' and 'silence' (used by tests and to show state). */
  onEvent: ((name: string) => void) | null = null

  constructor(factory: Factory = defaultFactory) {
    this.factory = factory
  }

  /** Creates the audio context (once) and resumes it. Call from a click or tap. */
  unlock(): void {
    if (!this.ctx) {
      const ctx = this.factory()
      if (!ctx) return
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = MASTER
      this.master.connect(ctx.destination)
      // 0.4 s of white noise from a fixed seed: the same sound every time.
      const n = Math.floor(ctx.sampleRate * 0.4)
      const buf = ctx.createBuffer(1, n, ctx.sampleRate)
      const d = buf.getChannelData(0)
      let seed = 12345
      for (let i = 0; i < n; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0
        d[i] = (seed / 0xffffffff) * 2 - 1
      }
      this.noise = buf
    }
    void this.ctx.resume()
    this.onEvent?.('unlock')
  }

  /** The audio state ('running', 'suspended', ...) or 'none' before the first unlock. */
  get state(): string {
    return this.ctx?.state ?? 'none'
  }

  private start(src: AudioScheduledSourceNode, at: number, end: number): void {
    this.active.add(src)
    src.onended = () => this.active.delete(src)
    src.start(at)
    src.stop(end)
  }

  /** `delay` is how long from now the sound should start (the cues are sent slightly early). */
  private ready(delay: number): { ctx: AudioContext; master: GainNode; noise: AudioBuffer; t: number } | null {
    const { ctx, master, noise } = this
    if (!ctx || !master || !noise) return null
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    master.gain.cancelScheduledValues(now)
    master.gain.setValueAtTime(MASTER, now)
    return { ctx, master, noise, t: now + Math.max(0, delay) }
  }

  /** A soft click: a very short band of noise plus a tiny falling blip. */
  zipClick(delay = 0): void {
    const r = this.ready(delay)
    if (!r) return
    const { ctx, master, noise, t } = r
    const src = ctx.createBufferSource()
    src.buffer = noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2600
    bp.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.8, t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03)
    src.connect(bp).connect(g).connect(master)
    this.start(src, t, t + 0.05)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1100, t)
    osc.frequency.exponentialRampToValueAtTime(700, t + 0.025)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0, t)
    og.gain.linearRampToValueAtTime(0.22, t + 0.002)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.03)
    osc.connect(og).connect(master)
    this.start(osc, t, t + 0.05)
    this.onEvent?.('zip')
  }

  /** A brief electric crackle (about 0.3 s): a few decaying bursts of high noise over a low, fading buzz. Soft, never a blast. */
  zap(delay = 0): void {
    const r = this.ready(delay)
    if (!r) return
    const { ctx, master, noise, t } = r
    const src = ctx.createBufferSource()
    src.buffer = noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1800
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    for (const [at, dur, amp] of [
      [0, 0.014, 0.9],
      [0.035, 0.02, 0.6],
      [0.08, 0.016, 0.8],
      [0.13, 0.03, 0.45],
      [0.2, 0.05, 0.25],
    ] as const) {
      g.gain.setValueAtTime(0, t + at)
      g.gain.linearRampToValueAtTime(amp * 0.7, t + at + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0008, t + at + dur)
    }
    src.connect(hp).connect(g).connect(master)
    this.start(src, t, t + 0.32)
    const buzz = ctx.createOscillator()
    buzz.type = 'sawtooth'
    buzz.frequency.setValueAtTime(140, t)
    buzz.frequency.exponentialRampToValueAtTime(55, t + 0.28)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 700
    const bg = ctx.createGain()
    bg.gain.setValueAtTime(0, t)
    bg.gain.linearRampToValueAtTime(0.25, t + 0.01)
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
    buzz.connect(lp).connect(bg).connect(master)
    this.start(buzz, t, t + 0.32)
    this.onEvent?.('zap')
  }

  /** A soft low thud of a box settling. `strength` (0 to 1) is how many boxes landed together. */
  thud(strength: number, delay = 0): void {
    const r = this.ready(delay)
    if (!r) return
    const { ctx, master, t } = r
    const k = Math.min(1, Math.max(0.2, strength))
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(130, t)
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.11)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.55 * k, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14)
    osc.connect(g).connect(master)
    this.start(osc, t, t + 0.16)
    // a little muffled knock on top
    const src = ctx.createBufferSource()
    src.buffer = r.noise
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 600
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0, t)
    ng.gain.linearRampToValueAtTime(0.3 * k, t + 0.002)
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03)
    src.connect(lp).connect(ng).connect(master)
    this.start(src, t, t + 0.05)
    this.onEvent?.('thud')
  }

  /** A short metallic click with a faint ring: the temple screws going in. */
  metalClick(delay = 0): void {
    const r = this.ready(delay)
    if (!r) return
    const { ctx, master, noise, t } = r
    for (const [f, a, d] of [
      [3150, 0.18, 0.11],
      [4870, 0.12, 0.08],
    ] as const) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(a, t + 0.001)
      g.gain.exponentialRampToValueAtTime(0.0008, t + d)
      o.connect(g).connect(master)
      this.start(o, t, t + d + 0.02)
    }
    const src = ctx.createBufferSource()
    src.buffer = noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 5000
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0, t)
    ng.gain.linearRampToValueAtTime(0.35, t + 0.001)
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.012)
    src.connect(hp).connect(ng).connect(master)
    this.start(src, t, t + 0.03)
    this.onEvent?.('metal')
  }

  /** Stops everything at once (with a few milliseconds of fade so it does not click). */
  silence(): void {
    const { ctx, master } = this
    if (!ctx || !master) return
    const t = ctx.currentTime
    master.gain.cancelScheduledValues(t)
    master.gain.setTargetAtTime(0, t, 0.01)
    for (const s of this.active) {
      try {
        s.stop(t + 0.05)
      } catch {
        // already stopped
      }
    }
    this.active.clear()
    this.onEvent?.('silence')
  }

  dispose(): void {
    this.silence()
    void this.ctx?.close()
    this.ctx = null
    this.master = null
  }
}
