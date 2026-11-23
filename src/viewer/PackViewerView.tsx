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
  /**
   * Token of an entrance animation to play once (the sample order after "Use this box"). A new token plays it again;
   * the same token never does, and leaving the Result screen (null) cuts it short with the boxes in place.
   */
  entrance?: number | null
}

export const PackViewerView = forwardRef<ViewerHandle, Props>(function PackViewerView(
  { layout, interaction, halloween, pictograms, entrance = null },
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

  // After the layout effect above, so the boxes are the new ones when the entrance starts.
  const played = useRef<number | null>(null)
  useEffect(() => {
    if (entrance === null || entrance === played.current) return
    played.current = entrance
    viewer.current?.playEntrance()
    return () => viewer.current?.endEntrance()
  }, [entrance])

  useEffect(() => {
    viewer.current?.setInteraction(interaction)
  })

  useImperativeHandle(ref, () => ({ reset: () => viewer.current?.resetView() }), [])

  return <div className={halloween ? 'viewer halloween' : 'viewer'} ref={host} data-testid="viewer" />
})
