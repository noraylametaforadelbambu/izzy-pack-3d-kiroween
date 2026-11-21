import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Layout } from '../core/layout'
import { PackViewer, type Interaction } from './PackViewer'

export interface ViewerHandle {
  reset: () => void
}

interface Props {
  layout: Layout
  interaction: Interaction
}

export const PackViewerView = forwardRef<ViewerHandle, Props>(function PackViewerView(
  { layout, interaction },
  ref,
) {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<PackViewer | null>(null)
  const latest = useRef(layout)
  latest.current = layout

  useEffect(() => {
    const v = new PackViewer(host.current!)
    viewer.current = v
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
    viewer.current?.setInteraction(interaction)
  })

  useImperativeHandle(ref, () => ({ reset: () => viewer.current?.resetView() }), [])

  return <div className="viewer" ref={host} data-testid="viewer" />
})
