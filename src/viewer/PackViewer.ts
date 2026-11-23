import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Layout, Placement } from '../core/layout'
import type { PictogramKind } from '../core/pictogram'
import { planDecals } from './decals'
import { DEFAULT_SCENE, HALLOWEEN_SCENE, halloweenColor } from './halloween'
import { drawPictogram } from './pictograms'
import { EntranceLid } from './lid'
import { BOLT_START, BOLT_TIME, DROP_SHARE, FLASH_PEAK, LAND_TIME, LEAVE_START, TOTAL_TIME, ZIP_START, flashAmount, hasStarted, landingOrder, pieceProgress, remaining } from './entrance'

/** Longest box side in scene units. Keeps the camera framing independent of mm / in. */
const SCENE_SIZE = 10
/** Safety cap so tiny items cannot freeze the browser. */
export const MAX_RENDERED = 20000
/** Item outlines are skipped above this count. */
const MAX_OUTLINED = 3000

const DEFAULT_DIR = new Vector3(1, 0.75, 1.15).normalize()
/** Boxes are drawn a little smaller than their cell so neighbours show a thin gap. */
const ITEM_GAP = 0.97
/** Pictograms sit this far (scene units) in front of the face: inside the gap, so they never cut into a neighbour. */
const DECAL_LIFT = 0.006
const Q_RIGHT = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
// top face: lie flat, with the top of the icon pointing away from the default camera
const Q_TOP = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2))
/** Pointer travel (px) before a press on a box turns into a drag. */
const DRAG_THRESHOLD = 4

/** What the viewer needs from the app to support selecting and dragging boxes. */
export interface Interaction {
  enabled: boolean
  selectedId: string | null
  /** Where a box dragged to (x, y) would land (minimum corner, mm), and whether that is valid. */
  resolve: (id: string, x: number, y: number) => { placement: Placement; ok: boolean } | null
  onSelect: (id: string | null) => void
  onDrop: (id: string, x: number, y: number) => void
}

const NO_INTERACTION: Interaction = {
  enabled: false,
  selectedId: null,
  resolve: () => null,
  onSelect: () => {},
  onDrop: () => {},
}

interface Gesture {
  id: string | null
  startX: number
  startY: number
  moved: boolean
  plane: Plane | null
  offX: number
  offZ: number
  size: { l: number; w: number } | null
  lastX: number
  lastY: number
  hasLast: boolean
}

/** A box-shaped marker (translucent fill plus bright edges) scaled to a placement. */
class Marker {
  group = new Group()
  private fill: MeshBasicMaterial
  private line: LineBasicMaterial

  constructor(color: number, opacity: number, geo: BoxGeometry, edges: EdgesGeometry) {
    this.fill = new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
    this.line = new LineBasicMaterial({ color, depthTest: false, transparent: true })
    const fill = new Mesh(geo, this.fill)
    const lines = new LineSegments(edges, this.line)
    lines.renderOrder = 10
    this.group.add(fill, lines)
    this.group.visible = false
  }

  setColor(color: number): void {
    this.fill.color.set(color)
    this.line.color.set(color)
  }

  dispose(): void {
    this.fill.dispose()
    this.line.dispose()
  }
}

/** The sample order dropping into place (see `playEntrance`). Everything needed to put the boxes back exactly. */
interface Entrance {
  startedAt: number
  /** Place of each box in the landing order. */
  rank: number[]
  /** Final matrices of the boxes, of each pictogram mesh, and the final outline vertices. */
  boxes: Float32Array
  decals: Float32Array[]
  outline: Float32Array | null
  drop: number
  /** Called once, when the seam and the bolt are done (or at once if the entrance ends early): the numbers may be shown. */
  reveal: (() => void) | null
}

/** Out of sight: farther than the camera can see. */
const HIDDEN = 10000
/** Vertices per outlined box (the 12 edges of a cube). */
const EDGE_VERTS = 24

export class PackViewer {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(40, 1, 0.1, 200)
  private controls: OrbitControls
  private content = new Group()
  private observer: ResizeObserver
  private frame = 0
  private radius = 1
  private framed = false

  private container: HTMLElement
  private opts: Interaction = NO_INTERACTION
  private mesh: InstancedMesh | null = null
  private list: Placement[] = []
  private halloween = false
  /** One material (and so one texture) per pictogram kind, created on first use and reused by every box of that kind. */
  private decalMaterials = new Map<PictogramKind, MeshBasicMaterial>()
  private lastDrawCalls = -1
  private outlineGeo: BufferGeometry | null = null
  private decalSets: { mesh: InstancedMesh; boxIdx: number[] }[] = []
  private entrance: Entrance | null = null
  private lid: EntranceLid | null = null
  private entrancePlays = 0
  /** Position of each product type in the list, used by the Halloween palette. */
  private typeIndex = new Map<string, number>()
  private dims = { k: 1, bx: 1, by: 1, bz: 1, h: 1 }
  private unitBox = new BoxGeometry(1, 1, 1)
  private unitEdges = new EdgesGeometry(this.unitBox)
  // Materials live as long as the viewer: disposing and recreating them on every layout would make three.js
  // rebuild (and recompile) its shader programs each time, which stalls the page for hundreds of ms on slow GPUs.
  private shellMaterial = new MeshBasicMaterial({ color: DEFAULT_SCENE.shell, transparent: true, opacity: 0.09, depthWrite: false })
  private shellEdgeMaterial = new LineBasicMaterial({ color: DEFAULT_SCENE.shellEdges })
  private itemMaterial = new MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, transparent: true, opacity: 0.88 })
  private outlineMaterial = new LineBasicMaterial({ color: DEFAULT_SCENE.outline, transparent: true, opacity: 0.55 })
  private selection = new Marker(0xffe27a, 0.22, this.unitBox, this.unitEdges)
  private ghost = new Marker(0x6cff9a, 0.3, this.unitBox, this.unitEdges)
  private raycaster = new Raycaster()
  private gesture: Gesture | null = null

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.domElement.setAttribute('role', 'img')
    this.renderer.domElement.setAttribute('aria-label', '3D box with packed items')
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.touchAction = 'none'
    container.appendChild(this.renderer.domElement)

    this.scene.add(new HemisphereLight(0xffffff, 0x445066, 1.5))
    this.scene.add(new AmbientLight(0xffffff, 0.5))
    const sun = new DirectionalLight(0xffffff, 2)
    sun.position.set(6, 10, 8)
    this.scene.add(sun)
    this.scene.add(this.content, this.selection.group, this.ghost.group)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.enablePan = true
    this.controls.minDistance = 4
    this.controls.maxDistance = 60

    // Exposes the camera position so tests can confirm rotate, zoom and reset.
    this.controls.addEventListener('change', () => {
      const p = this.camera.position
      this.container.dataset.camera = [p.x, p.y, p.z].map((n) => n.toFixed(3)).join(',')
    })

    // Capture phase: runs before OrbitControls, so a press on a box can claim the gesture.
    container.addEventListener('pointerdown', this.onPointerDown, true)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)
    this.resize()
    this.resetView()
    this.loop()
  }

  /** Updates the interaction settings (cheap; call on every render). */
  setInteraction(opts: Interaction): void {
    const changed = opts.selectedId !== this.opts.selectedId || opts.enabled !== this.opts.enabled
    this.opts = opts
    if (!opts.enabled) this.cancelGesture()
    if (changed) this.updateSelection()
  }

  /** Scene-space center of a placement. */
  private center(p: Placement): Vector3 {
    const { k, bx, by, bz } = this.dims
    return new Vector3(
      -bx / 2 + (p.x + p.size.l / 2) * k,
      -by / 2 + (p.z + p.size.h / 2) * k,
      -bz / 2 + (p.y + p.size.w / 2) * k,
    )
  }

  private place(m: Marker, p: Placement, grow = 1): void {
    const { k } = this.dims
    m.group.position.copy(this.center(p))
    m.group.scale.set(p.size.l * k * grow, p.size.h * k * grow, p.size.w * k * grow)
    m.group.visible = true
  }

  private updateSelection(): void {
    const p = this.opts.enabled ? this.list.find((o) => o.id === this.opts.selectedId) : undefined
    if (p) {
      this.place(this.selection, p, 1.02)
      this.container.dataset.selected = p.id
      this.container.dataset.selectedPos = [p.x, p.y, p.z].map((n) => Math.round(n * 1000) / 1000).join(',')
      this.container.dataset.selectedSize = [p.size.l, p.size.w, p.size.h].map((n) => Math.round(n * 1000) / 1000).join(',')
    } else {
      this.selection.group.visible = false
      delete this.container.dataset.selected
      delete this.container.dataset.selectedPos
      delete this.container.dataset.selectedSize
    }
  }

  private pointer(e: PointerEvent): Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect()
    return new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1))
  }

  private pick(e: PointerEvent): string | null {
    if (!this.mesh) return null
    this.raycaster.setFromCamera(this.pointer(e), this.camera)
    const hit = this.raycaster.intersectObject(this.mesh)[0]
    return hit?.instanceId === undefined ? null : (this.list[hit.instanceId]?.id ?? null)
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.opts.enabled) return
    if (!e.isPrimary) {
      this.cancelGesture() // second finger: let the camera take over
      return
    }
    if (e.button !== 0) return
    const id = this.pick(e)
    const g: Gesture = {
      id, startX: e.clientX, startY: e.clientY, moved: false,
      plane: null, offX: 0, offZ: 0, size: null, lastX: 0, lastY: 0, hasLast: false,
    }
    if (id !== null) {
      this.controls.enabled = false // the box, not the camera, handles this drag
      this.opts.onSelect(id)
      const p = this.list.find((o) => o.id === id)!
      const c = this.center(p)
      const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), c)
      this.raycaster.setFromCamera(this.pointer(e), this.camera)
      const hit = this.raycaster.ray.intersectPlane(plane, new Vector3())
      if (hit) {
        g.plane = plane
        g.offX = hit.x - c.x
        g.offZ = hit.z - c.z
        g.size = { l: p.size.l, w: p.size.w }
      }
    }
    this.gesture = g
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.cancelGesture)
  }

  private onPointerMove = (e: PointerEvent): void => {
    const g = this.gesture
    if (!g) return
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD) return
    g.moved = true
    if (g.id === null || !g.plane || !g.size) return
    this.raycaster.setFromCamera(this.pointer(e), this.camera)
    const hit = this.raycaster.ray.intersectPlane(g.plane, new Vector3())
    if (!hit) return
    const { k, bx, bz } = this.dims
    g.lastX = (hit.x - g.offX + bx / 2) / k - g.size.l / 2
    g.lastY = (hit.z - g.offZ + bz / 2) / k - g.size.w / 2
    g.hasLast = true
    const r = this.opts.resolve(g.id, g.lastX, g.lastY)
    if (r) {
      this.ghost.setColor(r.ok ? 0x6cff9a : 0xff6b6b)
      this.place(this.ghost, r.placement)
    }
  }

  private onPointerUp = (): void => {
    const g = this.gesture
    this.endGesture()
    if (!g) return
    if (g.id === null) {
      if (!g.moved) this.opts.onSelect(null) // click on empty space
    } else if (g.moved && g.hasLast) {
      this.opts.onDrop(g.id, g.lastX, g.lastY)
    }
  }

  private cancelGesture = (): void => this.endGesture()

  private endGesture(): void {
    this.gesture = null
    this.ghost.group.visible = false
    this.controls.enabled = true
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.cancelGesture)
  }

  /**
   * Rebuilds the box and items from a layout.
   * Layout coordinates are x = length, y = width, z = height (up). Three.js uses
   * y as up, so this is the single place where width and height are swapped.
   */
  setLayout(layout: Layout, pictograms?: Readonly<Record<string, PictogramKind>>): void {
    this.endEntrance() // a new layout cancels an entrance in progress
    this.clear()
    const { box } = layout
    this.renderer.domElement.setAttribute('aria-label', `3D view: ${layout.placedCount} ${layout.placedCount === 1 ? 'box' : 'boxes'} placed in a container of ${box.l} × ${box.w} × ${box.h} mm. Drag to rotate, scroll to zoom.`)
    const k = SCENE_SIZE / Math.max(box.l, box.w, box.h)
    const bx = box.l * k
    const by = box.h * k
    const bz = box.w * k
    this.radius = Math.hypot(bx, by, bz) / 2
    this.dims = { k, bx, by, bz, h: box.h }
    if (!this.framed) {
      this.framed = true
      this.resetView()
    }

    const shell = new Mesh(
      new BoxGeometry(bx, by, bz),
      this.shellMaterial,
    )
    const shellEdges = new LineSegments(new EdgesGeometry(shell.geometry), this.shellEdgeMaterial)
    this.content.add(shell, shellEdges)

    const list = layout.placements.slice(0, MAX_RENDERED)
    this.list = list
    this.typeIndex = new Map(layout.types.map((t, i) => [t.typeId, i]))
    if (list.length > 0) {
      const gap = ITEM_GAP
      const mesh = new InstancedMesh(
        new BoxGeometry(1, 1, 1),
        this.itemMaterial,
        list.length,
      )
      const m = new Matrix4()
      const color = new Color()
      const outline: number[] = []
      const outlined = list.length <= MAX_OUTLINED
      const e = new EdgesGeometry(new BoxGeometry(1, 1, 1)).getAttribute('position')
      list.forEach((p, i) => {
        const sx = p.size.l * k
        const sy = p.size.h * k
        const sz = p.size.w * k
        const cx = -bx / 2 + (p.x + p.size.l / 2) * k
        const cy = -by / 2 + (p.z + p.size.h / 2) * k
        const cz = -bz / 2 + (p.y + p.size.w / 2) * k
        m.makeScale(sx * gap, sy * gap, sz * gap).setPosition(cx, cy, cz)
        mesh.setMatrixAt(i, m)
        // Type color, slightly lighter toward the top for depth.
        this.itemColor(p, color)
        mesh.setColorAt(i, color)
        if (outlined) {
          for (let v = 0; v < e.count; v++) {
            outline.push(
              cx + e.getX(v) * sx * gap,
              cy + e.getY(v) * sy * gap,
              cz + e.getZ(v) * sz * gap,
            )
          }
        }
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      this.content.add(mesh)
      this.mesh = mesh
      if (outline.length > 0) {
        const g = new BufferGeometry()
        g.setAttribute('position', new Float32BufferAttribute(outline, 3))
        this.outlineGeo = g
        this.content.add(
          new LineSegments(g, this.outlineMaterial),
        )
      }
    }
    // Lets tests and users' tools confirm what the scene currently shows.
    this.buildDecals(list, pictograms)
    this.container.dataset.instances = String(list.length)
    this.container.dataset.expected = String(layout.placedCount)
    this.publishTheme()
    this.updateSelection()
  }

  /** Material with the pictogram texture of one kind. Drawn once; null when canvas is not available. */
  private decalMaterial(kind: PictogramKind): MeshBasicMaterial | null {
    const cached = this.decalMaterials.get(kind)
    if (cached) return cached
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    drawPictogram(ctx, kind, 128)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    this.decalMaterials.set(kind, material)
    return material
  }

  /**
   * Pictograms for products that have one (the sample order). One instanced plane per kind, so a whole order costs at most
   * three extra draw calls. Nothing is added when no product has a pictogram: ordinary orders render exactly as before.
   */
  private buildDecals(list: Placement[], pictograms?: Readonly<Record<string, PictogramKind>>): void {
    const counts: Record<string, number> = {}
    if (pictograms && Object.keys(pictograms).length > 0 && list.length > 0) {
      const decals = planDecals(list, (id) => pictograms[id])
      const { k, bx, by, bz } = this.dims
      const byKind = new Map<PictogramKind, typeof decals>()
      for (const d of decals) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d])
      const m = new Matrix4()
      const pos = new Vector3()
      const one = new Vector3()
      for (const [kind, ds] of byKind) {
        const material = this.decalMaterial(kind)
        if (!material) continue
        const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, ds.length)
        ds.forEach((d, i) => {
          const p = list[d.index]
          pos.set(-bx / 2 + (p.x + p.size.l / 2) * k, -by / 2 + (p.z + p.size.h / 2) * k, -bz / 2 + (p.y + p.size.w / 2) * k)
          let q: Quaternion = new Quaternion()
          if (d.face === 'front') pos.z += (p.size.w * k * ITEM_GAP) / 2 + DECAL_LIFT
          else if (d.face === 'right') {
            pos.x += (p.size.l * k * ITEM_GAP) / 2 + DECAL_LIFT
            q = Q_RIGHT
          } else {
            pos.y += (p.size.h * k * ITEM_GAP) / 2 + DECAL_LIFT
            q = Q_TOP
          }
          const side = d.size * k * ITEM_GAP
          m.compose(pos, q, one.set(side, side, 1))
          mesh.setMatrixAt(i, m)
        })
        mesh.instanceMatrix.needsUpdate = true
        mesh.frustumCulled = false
        mesh.renderOrder = 4 // after the boxes, whose depth keeps hidden pictograms hidden
        this.content.add(mesh)
        this.decalSets.push({ mesh, boxIdx: ds.map((d) => d.index) })
        counts[kind] = ds.length
      }
    }
    // Test hooks: how many pictograms of each kind, and how many textures exist (at most one per kind).
    this.container.dataset.decals = JSON.stringify(counts)
    this.container.dataset.decalTextures = String(this.decalMaterials.size)
  }

  /** Color of one box: its own color, or (Halloween mode) the palette color of its type; plus the same height shading. */
  private itemColor(p: Placement, out: Color): void {
    const shade = ((p.z + p.size.h / 2) / this.dims.h - 0.5) * 0.14
    if (this.halloween) {
      const c = halloweenColor(this.typeIndex.get(p.typeId) ?? 0)
      out.set(c.hex).offsetHSL(0, 0, c.tint + shade)
    } else {
      out.set(p.color).offsetHSL(0, 0, shade)
    }
  }

  /**
   * Turns the Halloween theme on or off. Only colors change: the boxes, their positions, the camera and the selection
   * are left alone. Turning it off restores the original colors exactly.
   */
  setHalloween(on: boolean): void {
    if (on === this.halloween) return
    this.halloween = on
    const scene = on ? HALLOWEEN_SCENE : DEFAULT_SCENE
    this.shellMaterial.color.set(scene.shell)
    this.shellEdgeMaterial.color.set(scene.shellEdges)
    this.outlineMaterial.color.set(scene.outline)
    if (this.mesh) {
      const c = new Color()
      this.list.forEach((p, i) => {
        this.itemColor(p, c)
        this.mesh!.setColorAt(i, c)
      })
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    }
    this.publishTheme()
  }

  /** Test hook: which theme is on and the base color of each product type. */
  private publishTheme(): void {
    this.container.dataset.theme = this.halloween ? 'halloween' : 'default'
    const colors: Record<string, string> = {}
    for (const p of this.list) {
      if (colors[p.typeId]) continue
      colors[p.typeId] = this.halloween ? halloweenColor(this.typeIndex.get(p.typeId) ?? 0).hex : p.color
    }
    this.container.dataset.typeColors = JSON.stringify(colors)
  }

  resetView(): void {
    const vfov = (this.camera.fov * Math.PI) / 180
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect)
    const dist = (this.radius * 1.15) / Math.sin(Math.min(vfov, hfov) / 2)
    // Without damping, update() consumes any pending rotate/zoom motion, so the
    // camera lands exactly on the default position.
    this.controls.enableDamping = false
    this.controls.update()
    this.camera.position.copy(DEFAULT_DIR).multiplyScalar(dist)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
    this.controls.enableDamping = true
  }

  dispose(): void {
    this.endEntrance()
    this.endGesture()
    this.container.removeEventListener('pointerdown', this.onPointerDown, true)
    this.selection.dispose()
    this.ghost.dispose()
    this.shellMaterial.dispose()
    this.shellEdgeMaterial.dispose()
    this.itemMaterial.dispose()
    this.outlineMaterial.dispose()
    this.unitEdges.dispose()
    this.unitBox.dispose()
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.controls.dispose()
    this.clear()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private clear(): void {
    this.mesh = null
    this.outlineGeo = null
    this.decalSets = []
    for (const obj of [...this.content.children]) {
      this.content.remove(obj)
      obj.traverse((o) => {
        const n = o as Mesh
        n.geometry?.dispose()
        if (o instanceof InstancedMesh) o.dispose() // materials are shared and disposed with the viewer
      })
    }
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  // ---- Entrance of the sample order -------------------------------------------------------------

  /**
   * Drops the boxes of the current layout into their real positions, bottom layer first, then a discreet flash (about
   * 1.3 s), then a schematic translucent lid with a zipper seam comes down, one soft bolt strikes it and the lid lifts away and
   * fades (3.5 s in all, once per call). Only the drawing changes: the layout, the camera and the pictograms are untouched, and every
   * box ends exactly where it was. Does nothing with `prefers-reduced-motion` or an empty layout. Returns whether it started.
   */
  playEntrance(onReveal?: () => void): boolean {
    this.endEntrance()
    const mesh = this.mesh
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!mesh || this.list.length === 0 || reduced) {
      this.container.dataset.entrance = 'skipped'
      onReveal?.() // nothing to wait for: show the numbers at once
      return false
    }
    mesh.computeBoundingSphere() // with the final positions, before any box is moved out of place
    const order = landingOrder(this.list)
    const rank = new Array<number>(this.list.length)
    order.forEach((boxIndex, r) => (rank[boxIndex] = r))
    const outline = this.outlineGeo && this.outlineGeo.getAttribute('position').count === this.list.length * EDGE_VERTS ? Float32Array.from(this.outlineGeo.getAttribute('position').array) : null
    this.entrance = {
      startedAt: performance.now(),
      rank,
      boxes: Float32Array.from(mesh.instanceMatrix.array),
      decals: this.decalSets.map((d) => Float32Array.from(d.mesh.instanceMatrix.array)),
      outline,
      drop: this.dims.by * DROP_SHARE,
      reveal: onReveal ?? null,
    }
    this.entrancePlays++
    this.container.dataset.entrancePlays = String(this.entrancePlays)
    this.container.dataset.entrance = 'playing'
    this.lid = new EntranceLid(this.dims.bx, this.dims.by, this.dims.bz)
    this.content.add(this.lid.group)
    this.stepEntrance(0)
    return true
  }

  /** Draws the entrance at `time` seconds. */
  private stepEntrance(time: number): void {
    const e = this.entrance
    const mesh = this.mesh
    if (!e || !mesh) return
    const n = this.list.length
    const offset = new Float32Array(n)
    for (let i = 0; i < n; i++) offset[i] = hasStarted(e.rank[i], n, time) ? e.drop * remaining(pieceProgress(e.rank[i], n, time)) : HIDDEN
    const boxes = mesh.instanceMatrix.array as Float32Array
    boxes.set(e.boxes)
    for (let i = 0; i < n; i++) boxes[i * 16 + 13] += offset[i]
    mesh.instanceMatrix.needsUpdate = true
    this.decalSets.forEach((d, k) => {
      const a = d.mesh.instanceMatrix.array as Float32Array
      a.set(e.decals[k])
      d.boxIdx.forEach((boxIndex, i) => (a[i * 16 + 13] += offset[boxIndex]))
      d.mesh.instanceMatrix.needsUpdate = true
    })
    if (e.outline && this.outlineGeo) {
      const attr = this.outlineGeo.getAttribute('position')
      const a = attr.array as Float32Array
      a.set(e.outline)
      for (let i = 0; i < n; i++) for (let v = 0; v < EDGE_VERTS; v++) a[(i * EDGE_VERTS + v) * 3 + 1] += offset[i]
      attr.needsUpdate = true
    }
    this.lid?.update(time)
    if (time >= LEAVE_START) this.revealNumbers(e)
    // Test hooks: which part of the entrance is on screen, and whether the lid and the bolt have been shown.
    const phase = time < LAND_TIME ? 'pieces' : time < ZIP_START ? 'lid' : time < BOLT_START ? 'zip' : time < BOLT_START + BOLT_TIME ? 'bolt' : time < LEAVE_START ? 'hold' : 'leave'
    this.container.dataset.entrancePhase = phase
    if (phase !== 'pieces') this.container.dataset.lidShown = '1'
    if (phase === 'bolt') this.container.dataset.boltShown = '1'
    const f = flashAmount(time)
    this.itemMaterial.emissive.set(f > 0 ? 0xcdb8ff : 0x000000)
    this.itemMaterial.emissiveIntensity = FLASH_PEAK * f
  }

  /** Tells the app (once) that the numbers can be shown. */
  private revealNumbers(e: Entrance): void {
    const f = e.reveal
    e.reveal = null
    f?.()
  }

  /** Puts everything back exactly where the layout has it and stops the entrance (also when it is cut short). */
  endEntrance(): void {
    const e = this.entrance
    if (!e) return
    this.entrance = null
    this.revealNumbers(e) // cut short or finished: the numbers are never left hidden
    const mesh = this.mesh
    if (mesh) {
      ;(mesh.instanceMatrix.array as Float32Array).set(e.boxes)
      mesh.instanceMatrix.needsUpdate = true
    }
    this.decalSets.forEach((d, k) => {
      ;(d.mesh.instanceMatrix.array as Float32Array).set(e.decals[k])
      d.mesh.instanceMatrix.needsUpdate = true
    })
    if (e.outline && this.outlineGeo) {
      const attr = this.outlineGeo.getAttribute('position')
      ;(attr.array as Float32Array).set(e.outline)
      attr.needsUpdate = true
    }
    this.lid?.dispose()
    this.lid = null
    this.itemMaterial.emissive.set(0x000000)
    this.itemMaterial.emissiveIntensity = 1
    this.container.dataset.entrance = 'done'
    this.container.dataset.entrancePhase = 'none'
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop)
    if (this.entrance) {
      const t = (performance.now() - this.entrance.startedAt) / 1000
      if (t >= TOTAL_TIME) this.endEntrance()
      else this.stepEntrance(Math.min(t, TOTAL_TIME))
    }
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    const calls = this.renderer.info.render.calls
    if (calls !== this.lastDrawCalls) {
      this.lastDrawCalls = calls
      this.container.dataset.drawCalls = String(calls) // test hook
    }
  }
}
