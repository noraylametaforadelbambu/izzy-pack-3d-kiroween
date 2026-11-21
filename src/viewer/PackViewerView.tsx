import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Layout } from '../core/layout'
import type { PictogramKind } from '../core/pictogram'
import { PackViewer, type Interaction } from './PackViewer'

export interface ViewerHandle {
  reset: () => void
}

interface Props {
  layout: Layout
  interaction: Interaction
  /** Halloween color theme (visual only). */
  halloween: boolean
  /** Pictogram of each product type that has one (the sample order). Empty for ordinary orders. */
  pictograms: Readonly<Record<string, PictogramKind>>
}

export const PackViewerView = forwardRef<ViewerHandle, Props>(function PackViewerView(
  { layout, interaction, halloween, pictograms },
  ref,
) {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<PackViewer | null>(null)
  const latest = useRef(layout)
  latest.current = layout
  const theme = useRef(halloween)
  theme.current = halloween
  const pics = useRef(pictograms)
  pics.current = pictograms

  useEffect(() => {
    const v = new PackViewer(host.current!)
    viewer.current = v
    v.setHalloween(theme.current)
    v.setLayout(latest.current, pics.current)
    return () => {
      v.dispose()
      viewer.current = null
    }
  }, [])

  useEffect(() => {
    viewer.current?.setLayout(layout, pictograms)
  }, [layout, pictograms])

  useEffect(() => {
    viewer.current?.setHalloween(halloween)
  }, [halloween])

  useEffect(() => {
    viewer.current?.setInteraction(interaction)
  })

  useImperativeHandle(ref, () => ({ reset: () => viewer.current?.resetView() }), [])

  return <div className={halloween ? 'viewer halloween' : 'viewer'} ref={host} data-testid="viewer" />
})
