import { useEffect, useRef } from 'react'
import { PICTOGRAM_LABELS, type PictogramKind } from '../core/pictogram'
import { drawPictogram } from '../viewer/pictograms'

const PIXELS = 72 // drawn at 72 px and shown at 26 px, so it stays sharp on phones

/** The same pictogram the 3D view puts on the boxes, drawn small. It comes from the product's own `pictogram` field. */
export function PictogramIcon({ kind }: { kind: PictogramKind }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, PIXELS, PIXELS)
    drawPictogram(ctx, kind, PIXELS)
  }, [kind])
  return <canvas ref={canvas} className="picon" width={PIXELS} height={PIXELS} role="img" aria-label={PICTOGRAM_LABELS[kind]} data-pictogram={kind} />
}
