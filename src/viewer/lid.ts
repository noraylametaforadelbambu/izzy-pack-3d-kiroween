import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { boltAmount, lidState } from './entrance'

const LID_COLOR = 0xcdb8ff
const EDGE_COLOR = 0xe8deff
const BOLT_COLOR = 0xf3ecff
/** Lid thickness and the gap between the container and the lid (scene units; the container's longest side is 10). */
const THICKNESS = 0.05
const GAP = 0.03
const TEETH = 44
const UP = new Vector3(0, 1, 0)

/**
 * The schematic lid of the entrance animation: a translucent slab over the container with a zipper seam along its length
 * and a single soft bolt that strikes it. It is drawn by `update(time)` only: it never touches the boxes, and `dispose`
 * removes everything. `bx`, `by`, `bz` are the container's size in scene units (x, up, z).
 */
export class EntranceLid {
  readonly group = new Group()
  private slabGeo: BoxGeometry
  private edgeGeo: EdgesGeometry
  private toothGeo = new BoxGeometry(1, 1, 1)
  private boltGeo = new CylinderGeometry(1, 1, 1, 6)
  private lidMat = new MeshBasicMaterial({ color: LID_COLOR, transparent: true, opacity: 0, depthWrite: false })
  private edgeMat = new LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0 })
  private toothMat = new MeshBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0, depthWrite: false })
  private pullMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
  private coreMat = new MeshBasicMaterial({ color: BOLT_COLOR, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending })
  private glowMat = new MeshBasicMaterial({ color: LID_COLOR, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending })
  private teeth: InstancedMesh
  private pull: Mesh
  private bolt = new Group()
  private seatY: number

  private bx: number
  private by: number
  private bz: number

  constructor(bx: number, by: number, bz: number) {
    this.bx = bx
    this.by = by
    this.bz = bz
    this.seatY = by / 2 + GAP + THICKNESS / 2
    this.slabGeo = new BoxGeometry(bx * 1.02, THICKNESS, bz * 1.02)
    this.edgeGeo = new EdgesGeometry(this.slabGeo)
    const slab = new Mesh(this.slabGeo, this.lidMat)
    slab.renderOrder = 5
    const edges = new LineSegments(this.edgeGeo, this.edgeMat)
    edges.renderOrder = 6
    this.teeth = new InstancedMesh(this.toothGeo, this.toothMat, TEETH)
    this.teeth.renderOrder = 6
    this.teeth.frustumCulled = false
    this.pull = new Mesh(this.toothGeo, this.pullMat)
    this.pull.scale.set(bx * 0.03, THICKNESS * 3.2, bz * 0.07)
    this.pull.renderOrder = 7
    this.group.add(slab, edges, this.teeth, this.pull, this.bolt)
    this.buildBolt()
    this.group.visible = false
    this.group.position.y = this.seatY
    this.update(0)
  }

  /** A jagged bolt from above the lid down to the seam, made of thin cylinders (so it reads from any camera angle). */
  private buildBolt(): void {
    const { bx, bz } = this
    const x0 = bx * 0.18
    const topY = this.by * 0.95 // above the lid, in lid-local coordinates
    const wiggle = [0, 0.09, -0.07, 0.08, -0.05, 0.06, 0]
    const pts = wiggle.map((w, i) => {
      const t = i / (wiggle.length - 1)
      return new Vector3(x0 + w * bx, topY * (1 - t) + (THICKNESS / 2 + 0.01) * t, (i % 2 === 0 ? 1 : -1) * 0.02 * bz * (1 - t))
    })
    const q = new Quaternion()
    const mid = new Vector3()
    const dir = new Vector3()
    for (let i = 0; i < pts.length - 1; i++) {
      dir.subVectors(pts[i + 1], pts[i])
      const len = dir.length()
      mid.addVectors(pts[i], pts[i + 1]).multiplyScalar(0.5)
      q.setFromUnitVectors(UP, dir.normalize())
      for (const [mat, r] of [
        [this.coreMat, 0.035],
        [this.glowMat, 0.11],
      ] as const) {
        const seg = new Mesh(this.boltGeo, mat)
        seg.position.copy(mid)
        seg.quaternion.copy(q)
        seg.scale.set(r, len, r)
        seg.renderOrder = 8
        this.bolt.add(seg)
      }
    }
  }

  /** Draws the lid, zipper and bolt at `time` seconds of the entrance. */
  update(time: number): void {
    const s = lidState(time)
    this.group.visible = s.visible
    if (!s.visible) return
    const { bx, by, bz } = this
    this.group.position.y = this.seatY + s.rise * by
    const k = s.opacity
    this.lidMat.opacity = k
    this.edgeMat.opacity = Math.min(1, k * 2.6)
    this.toothMat.opacity = Math.min(1, k * 2.8)
    this.pullMat.opacity = Math.min(1, k * 3)
    // Zipper: teeth left of the pull are interlocked (a staggered zig-zag along the seam), the rest are still apart.
    const pullX = -bx / 2 + s.zip * bx
    const m = new Matrix4()
    const pos = new Vector3()
    const scale = new Vector3()
    const toothW = (bx / TEETH) * 1.5
    const toothH = THICKNESS * 1.5
    const toothD = bz * 0.032
    for (let i = 0; i < TEETH; i++) {
      const x = -bx / 2 + (i + 0.5) * (bx / TEETH)
      const side = i % 2 === 0 ? 1 : -1
      const closed = x <= pullX
      pos.set(x, THICKNESS / 2 + toothH / 2, side * (closed ? toothD * 0.55 : bz * 0.05 + toothD))
      this.teeth.setMatrixAt(i, m.compose(pos, new Quaternion(), scale.set(toothW, toothH, toothD)))
    }
    this.teeth.instanceMatrix.needsUpdate = true
    this.pull.position.set(pullX, THICKNESS / 2 + THICKNESS * 1.6, 0)
    // The bolt: one soft rise and fall.
    const b = boltAmount(time)
    this.bolt.visible = b > 0
    this.coreMat.opacity = 0.85 * b
    this.glowMat.opacity = 0.28 * b
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const g of [this.slabGeo, this.edgeGeo, this.toothGeo, this.boltGeo]) g.dispose()
    for (const m of [this.lidMat, this.edgeMat, this.toothMat, this.pullMat, this.coreMat, this.glowMat]) m.dispose()
    this.teeth.dispose()
  }
}
