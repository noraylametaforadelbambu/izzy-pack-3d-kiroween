import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  EdgesGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { SoundEvent } from './entrance'
import { FRANK_COLORS, FRANK_PARTS, FRANK_PLATFORM, dropOffset, frankBounds, frankTimeline, hasStarted, partProgress, totalDuration, twistAt, type FrankColor } from './frankenstein'

const EDGE_COLOR = 0xd8c9ff
/** On wide screens the order panel covers the right side, so the figure is framed in the space left of it. */
const PANEL_SPACE = 392
const WIDE = 768

/**
 * A decorative Three.js scene for the Home screen: boxes fall and stack into a Frankenstein's monster, once.
 * It has its own renderer and scene and knows nothing about orders, layouts or the packing viewer.
 * With `animate = false` (reduced motion) it shows the finished figure and never moves.
 */
export class FrankensteinScene {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(32, 1, 0.1, 200)
  private observer: ResizeObserver
  private raf = 0
  private plays = 0
  private disposed = false
  private groups: Group[] = []
  private unit = new BoxGeometry(1, 1, 1)
  private unitEdges = new EdgesGeometry(this.unit)
  private materials = new Map<FrankColor, MeshLambertMaterial | MeshPhongMaterial>()
  private edgeMaterial = new LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.6 })
  private time = totalDuration() + 1
  private startedAt = 0
  private container: HTMLElement
  private timeline = frankTimeline()
  private soundPlaying = false
  /** Called once when the animation starts, with its whole soundtrack (times from now). */
  onSound: ((events: SoundEvent[]) => void) | null = null
  /** Called when the animation is cut short (replayed, or the screen is left): its sound stops with it. */
  onSoundEnd: (() => void) | null = null

  constructor(container: HTMLElement, animate: boolean) {
    this.container = container
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const canvas = this.renderer.domElement
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', 'Decorative figure: colored boxes stacking up into a Frankenstein’s monster')
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    container.appendChild(canvas)

    this.scene.add(new HemisphereLight(0xffffff, 0x3a3056, 1.6))
    this.scene.add(new AmbientLight(0xffffff, 0.45))
    const sun = new DirectionalLight(0xffffff, 2.1)
    sun.position.set(5, 9, 8)
    this.scene.add(sun)

    const platform = this.box('black', FRANK_PLATFORM.size, FRANK_PLATFORM.at)
    this.scene.add(platform)
    for (const p of FRANK_PARTS) {
      const g = this.box(p.color, p.size, p.at)
      g.visible = false
      this.groups.push(g)
      this.scene.add(g)
    }

    this.container.dataset.parts = String(FRANK_PARTS.length)
    this.container.dataset.soundEvents = String(this.timeline.length)
    this.container.dataset.plays = '0'
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)
    this.resize()
    if (animate) this.play()
    else this.finish('static')
  }

  /** One unit box scaled to `size` and edged, inside a group placed at `at` (the group is what moves). */
  private box(color: FrankColor, size: readonly [number, number, number], at: readonly [number, number, number]): Group {
    let m = this.materials.get(color)
    if (!m) {
      // Metal is shiny (specular highlight); the rest of the figure is matte.
      m = color === 'metal' ? new MeshPhongMaterial({ color: FRANK_COLORS[color], specular: 0xffffff, shininess: 90 }) : new MeshLambertMaterial({ color: FRANK_COLORS[color] })
      this.materials.set(color, m)
    }
    const mesh = new Mesh(this.unit, m)
    mesh.scale.set(size[0], size[1], size[2])
    mesh.add(new LineSegments(this.unitEdges, this.edgeMaterial))
    const g = new Group()
    g.add(mesh)
    g.position.set(at[0], at[1], at[2])
    return g
  }

  /** Plays the animation from the start. Safe to call while it is playing. */
  play(): void {
    if (this.disposed) return
    cancelAnimationFrame(this.raf)
    if (this.soundPlaying) this.onSoundEnd?.() // a replay cuts the sounds of the one in progress
    this.soundPlaying = true
    this.onSound?.(this.timeline)
    this.plays++
    this.container.dataset.plays = String(this.plays)
    this.container.dataset.state = 'playing'
    this.startedAt = performance.now()
    this.time = 0
    this.draw()
    const tick = (): void => {
      if (this.disposed) return
      this.time = (performance.now() - this.startedAt) / 1000
      if (this.time >= totalDuration()) return this.finish('done')
      this.draw()
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  /** Shows the finished figure and stops drawing until the size changes. */
  private finish(state: 'done' | 'static'): void {
    this.soundPlaying = false // the soundtrack is over by now (the last sound ends before the animation does)
    this.time = totalDuration() + 1
    this.container.dataset.state = state
    this.draw()
  }

  private draw(): void {
    FRANK_PARTS.forEach((p, i) => {
      const g = this.groups[i]
      const progress = partProgress(i, this.time)
      g.visible = hasStarted(i, this.time)
      g.position.y = p.at[1] + dropOffset(progress)
      g.rotation.y = twistAt(i, progress)
    })
    this.renderer.render(this.scene, this.camera)
  }

  /** Three-quarter view of the whole figure, framed in the space the panel leaves free. */
  private resize(): void {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    const wide = w >= WIDE
    const panel = wide ? PANEL_SPACE : 0
    const fitX = ((w - panel) / w) * 0.92
    const fitY = wide ? 0.8 : 0.94
    const b = frankBounds()
    const center = new Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2)
    const dir = new Vector3(Math.sin(0.5) * Math.cos(0.16), Math.sin(0.16), Math.cos(0.5) * Math.cos(0.16))
    const corners: Vector3[] = []
    const pb = FRANK_PLATFORM
    for (const [lo, hi] of [
      [b.min, b.max],
      [
        [pb.at[0] - pb.size[0] / 2, pb.at[1] - pb.size[1] / 2, pb.at[2] - pb.size[2] / 2],
        [pb.at[0] + pb.size[0] / 2, pb.at[1] + pb.size[1] / 2, pb.at[2] + pb.size[2] / 2],
      ],
    ] as const)
      for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) corners.push(new Vector3(x, y, z))
    const fits = (d: number): boolean => {
      this.camera.position.copy(center).addScaledVector(dir, d)
      this.camera.lookAt(center)
      this.camera.updateMatrixWorld(true)
      this.camera.updateProjectionMatrix()
      return corners.every((c) => {
        const n = c.clone().project(this.camera)
        return Math.abs(n.x) <= fitX && Math.abs(n.y) <= fitY
      })
    }
    let lo = 4
    let hi = 120
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) hi = mid
      else lo = mid
    }
    fits(hi)
    // Shift the picture left by half the panel so the figure is centered in the free space.
    if (panel > 0) this.camera.setViewOffset(w, h, panel / 2, 0, w, h)
    else this.camera.clearViewOffset()
    this.draw()
  }

  dispose(): void {
    if (this.soundPlaying) this.onSoundEnd?.() // leaving Home cuts the sounds
    this.onSound = null
    this.onSoundEnd = null
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.observer.disconnect()
    this.unit.dispose()
    this.unitEdges.dispose()
    this.edgeMaterial.dispose()
    this.materials.forEach((m) => m.dispose())
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
