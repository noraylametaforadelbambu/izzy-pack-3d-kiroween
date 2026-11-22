import { useEffect, useRef, useState } from 'react'
import { FrankensteinScene } from '../viewer/FrankensteinScene'

interface Props {
  /** Play the animation when this screen opens. False when the user comes back to Home: the finished figure is shown. */
  playOnMount: boolean
  /** Called once when the animation starts for the first time. */
  onPlayed: () => void
}

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Home decoration: boxes stack into a Frankenstein's monster, once, with a discreet Replay button. With
 * prefers-reduced-motion the finished figure is shown and there is nothing to replay. Separate from the order.
 */
export function FrankensteinHome({ playOnMount, onPlayed }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<FrankensteinScene | null>(null)
  const [reduced] = useState(reducedMotion)
  const first = useRef({ playOnMount, onPlayed })

  useEffect(() => {
    const s = new FrankensteinScene(host.current!, first.current.playOnMount && !reduced)
    scene.current = s
    if (first.current.playOnMount && !reduced) first.current.onPlayed()
    return () => {
      s.dispose()
      scene.current = null
    }
  }, [reduced])

  return (
    <>
      <div className="frank" ref={host} data-testid="frank" />
      {!reduced && (
        <button type="button" className="reset replay" aria-label="Replay animation" title="Replay animation" onClick={() => scene.current?.play()}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 4l14 8-14 8z" />
          </svg>
        </button>
      )}
    </>
  )
}
