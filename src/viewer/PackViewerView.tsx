import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Layout } from '../core/layout'
import { PackViewer, type Interaction } from './PackViewer'

export interface ViewerHandle {
  reset: () => void
}

interface Props {
  layout: Layout
  interaction: Interaction
  /** Halloween color theme (visual only). */
  halloween: boolean
}

export const PackViewerView = forwardRef<ViewerHandle, Props>(function PackViewerView(
  { layout, interaction, halloween },
  ref,
) {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<PackViewer | null>(null)
  const latest = useRef(layout)
  latest.current = layout
  const theme = useRef(halloween)
  theme.current = halloween

  useEffect(() => {
    const v = new PackViewer(host.current!)
    viewer.current = v
    v.setHalloween(theme.current)
    v.setLayout(latest.current)
    return () => {
      v.dispose()
      viewer.current = null
    }
  }, [])

  useEffect(() => {
    viewer.current?.setLayout(layout)
  }, [layout])

  useEffect(() => {
    viewer.current?.setHalloween(halloween)
  }, [halloween])

  useEffect(() => {
    viewer.current?.setInteraction(interaction)
  })

  useImperativeHandle(ref, () => ({ reset: () => viewer.current?.resetView() }), [])

  return <div className={halloween ? 'viewer halloween' : 'viewer'} ref={host} data-testid="viewer" />
})
