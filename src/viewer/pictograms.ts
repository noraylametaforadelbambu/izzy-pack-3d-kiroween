import type { PictogramKind } from '../core/pictogram'

/**
 * The pictograms, drawn with plain canvas paths (no images, no fonts): a skull with dark eye sockets, a black candle with
 * an orange flame and a carved jack-o’-lantern. Each sits on a dark round badge with a white ring, so it reads on boxes of any
 * color. Only bone white, black, lavender, orange and brown are used: no gold, no green, no ornaments. They are drawn once
 * per product type and reused as a texture by every box of that type.
 */

/** The small part of the 2D canvas API used here (a real CanvasRenderingContext2D fits; tests use a recorder). */
export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  clearRect(x: number, y: number, w: number, h: number): void
  save(): void
  restore(): void
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void
  rect(x: number, y: number, w: number, h: number): void
  fill(rule?: CanvasFillRule): void
  stroke(): void
  clip(): void
}

const WHITE = '#ffffff'
const BONE = '#f4f1e8'
const DARK = '#0d0814'
const BODY_BLACK = '#15101f'
const LAVENDER = '#c9b5ff'
const ORANGE = '#ff8a1f'
const ORANGE_LIGHT = '#ffb066'
const ORANGE_DARK = '#c4540a'
const BROWN = '#7a4a1e'
const CARVED = '#1a0a06'
const BADGE = 'rgba(14, 8, 28, 0.82)'

export function drawPictogram(ctx: Ctx2D, kind: PictogramKind, size = 128): void {
  const S = (v: number): number => v * size
  ctx.clearRect(0, 0, size, size)
  // badge
  ctx.beginPath()
  ctx.arc(S(0.5), S(0.5), S(0.47), 0, Math.PI * 2)
  ctx.fillStyle = BADGE
  ctx.fill()
  ctx.lineWidth = S(0.035)
  ctx.strokeStyle = WHITE
  ctx.stroke()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (kind === 'skull') skull(ctx, S)
  else if (kind === 'candle') blackCandle(ctx, S)
  else jackOLantern(ctx, S)
}

type Scale = (v: number) => number

/** A skull: round cranium, jaw, and dark eye sockets and nose cut out of it. */
function skull(ctx: Ctx2D, S: Scale): void {
  ctx.beginPath()
  ctx.moveTo(S(0.25), S(0.46))
  ctx.bezierCurveTo(S(0.25), S(0.16), S(0.75), S(0.16), S(0.75), S(0.46))
  ctx.bezierCurveTo(S(0.75), S(0.55), S(0.7), S(0.59), S(0.67), S(0.63))
  ctx.lineTo(S(0.67), S(0.74))
  ctx.bezierCurveTo(S(0.67), S(0.81), S(0.63), S(0.84), S(0.58), S(0.84))
  ctx.lineTo(S(0.42), S(0.84))
  ctx.bezierCurveTo(S(0.37), S(0.84), S(0.33), S(0.81), S(0.33), S(0.74))
  ctx.lineTo(S(0.33), S(0.63))
  ctx.bezierCurveTo(S(0.3), S(0.59), S(0.25), S(0.55), S(0.25), S(0.46))
  ctx.closePath()
  // eye sockets and nose are part of the same path, so an even-odd fill leaves them dark
  ctx.moveTo(S(0.485), S(0.48))
  ctx.ellipse(S(0.4), S(0.48), S(0.085), S(0.09), 0, 0, Math.PI * 2)
  ctx.moveTo(S(0.685), S(0.48))
  ctx.ellipse(S(0.6), S(0.48), S(0.085), S(0.09), 0, 0, Math.PI * 2)
  ctx.moveTo(S(0.5), S(0.56))
  ctx.lineTo(S(0.455), S(0.65))
  ctx.lineTo(S(0.545), S(0.65))
  ctx.closePath()
  ctx.fillStyle = BONE
  ctx.fill('evenodd')
  // teeth
  ctx.strokeStyle = DARK
  ctx.lineWidth = S(0.022)
  for (const x of [0.42, 0.5, 0.58]) {
    ctx.beginPath()
    ctx.moveTo(S(x), S(0.72))
    ctx.lineTo(S(x), S(0.84))
    ctx.stroke()
  }
}

/** A black candle (outlined so it shows on the dark badge) with an orange flame. */
function blackCandle(ctx: Ctx2D, S: Scale): void {
  // dish
  ctx.beginPath()
  ctx.ellipse(S(0.5), S(0.82), S(0.23), S(0.055), 0, 0, Math.PI * 2)
  ctx.fillStyle = BODY_BLACK
  ctx.fill()
  ctx.lineWidth = S(0.02)
  ctx.strokeStyle = LAVENDER
  ctx.stroke()
  // black wax
  ctx.beginPath()
  ctx.rect(S(0.39), S(0.42), S(0.22), S(0.4))
  ctx.fillStyle = BODY_BLACK
  ctx.fill()
  ctx.stroke()
  // a pale highlight on the left edge gives it shape
  ctx.beginPath()
  ctx.rect(S(0.42), S(0.46), S(0.03), S(0.3))
  ctx.fillStyle = LAVENDER
  ctx.fill()
  // wick
  ctx.beginPath()
  ctx.moveTo(S(0.5), S(0.42))
  ctx.lineTo(S(0.5), S(0.35))
  ctx.lineWidth = S(0.024)
  ctx.strokeStyle = LAVENDER
  ctx.stroke()
  // orange flame with a lighter core
  ctx.beginPath()
  ctx.moveTo(S(0.5), S(0.08))
  ctx.bezierCurveTo(S(0.63), S(0.21), S(0.64), S(0.33), S(0.5), S(0.38))
  ctx.bezierCurveTo(S(0.36), S(0.33), S(0.37), S(0.21), S(0.5), S(0.08))
  ctx.closePath()
  ctx.fillStyle = ORANGE
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(S(0.5), S(0.2))
  ctx.bezierCurveTo(S(0.56), S(0.27), S(0.56), S(0.33), S(0.5), S(0.36))
  ctx.bezierCurveTo(S(0.44), S(0.33), S(0.44), S(0.27), S(0.5), S(0.2))
  ctx.closePath()
  ctx.fillStyle = ORANGE_LIGHT
  ctx.fill()
}

/** An orange pumpkin with carved triangular eyes, nose and a toothy smile. */
function jackOLantern(ctx: Ctx2D, S: Scale): void {
  // stem
  ctx.beginPath()
  ctx.moveTo(S(0.46), S(0.2))
  ctx.lineTo(S(0.5), S(0.1))
  ctx.lineTo(S(0.56), S(0.12))
  ctx.lineTo(S(0.55), S(0.24))
  ctx.closePath()
  ctx.fillStyle = BROWN
  ctx.fill()
  // body: three lobes
  ctx.fillStyle = ORANGE
  for (const [cx, rx, ry] of [[0.3, 0.17, 0.27], [0.7, 0.17, 0.27], [0.5, 0.21, 0.3]] as const) {
    ctx.beginPath()
    ctx.ellipse(S(cx), S(0.57), S(rx), S(ry), 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // ribs between the lobes
  ctx.strokeStyle = ORANGE_DARK
  ctx.lineWidth = S(0.016)
  for (const x of [0.37, 0.63]) {
    ctx.beginPath()
    ctx.moveTo(S(x), S(0.3))
    ctx.bezierCurveTo(S(x - 0.03), S(0.45), S(x - 0.03), S(0.69), S(x), S(0.84))
    ctx.stroke()
  }
  // carved face
  ctx.fillStyle = CARVED
  ctx.beginPath()
  ctx.moveTo(S(0.3), S(0.5))
  ctx.lineTo(S(0.44), S(0.5))
  ctx.lineTo(S(0.37), S(0.37))
  ctx.closePath()
  ctx.moveTo(S(0.56), S(0.5))
  ctx.lineTo(S(0.7), S(0.5))
  ctx.lineTo(S(0.63), S(0.37))
  ctx.closePath()
  ctx.moveTo(S(0.5), S(0.52))
  ctx.lineTo(S(0.465), S(0.59))
  ctx.lineTo(S(0.535), S(0.59))
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(S(0.28), S(0.64))
  ctx.lineTo(S(0.36), S(0.69))
  ctx.lineTo(S(0.43), S(0.64))
  ctx.lineTo(S(0.5), S(0.69))
  ctx.lineTo(S(0.57), S(0.64))
  ctx.lineTo(S(0.64), S(0.69))
  ctx.lineTo(S(0.72), S(0.64))
  ctx.bezierCurveTo(S(0.71), S(0.75), S(0.62), S(0.81), S(0.5), S(0.81))
  ctx.bezierCurveTo(S(0.38), S(0.81), S(0.29), S(0.75), S(0.28), S(0.64))
  ctx.closePath()
  ctx.fill()
}
