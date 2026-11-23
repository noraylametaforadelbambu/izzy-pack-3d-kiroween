import { useEffect, useRef, useState } from 'react'
import type { FrankSoundEvent } from '../viewer/frankenstein'
import { FrankensteinScene } from '../viewer/FrankensteinScene'

interface Props {
  /** Play the animation when this screen opens. False when the user comes back to Home: the finished figure is shown. */
  playOnMount: boolean
  /** Called once when the animation starts for the first time. */
  onPlayed: () => void
  /** The sounds of the animation (soft thuds, the metallic click); 'end' when it is cut short. Ignored when Sound is off. */
  onCue?: (e: FrankSoundEvent | 'end', delay: number) => void
  /** Replay was pressed (a user gesture: the place to unlock audio). */
  onReplay?: () => void
}

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Home decoration: boxes stack into a Frankenstein's monster, once, with a discreet Replay button. With
 * prefers-reduced-motion the finished figure is shown and there is nothing to replay. Separate from the order.
 */
export function FrankensteinHome({ playOnMount, onPlayed, onCue, onReplay }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<FrankensteinScene | null>(null)
  const [reduced] = useState(reducedMotion)
  const first = useRef({ playOnMount, onPlayed })
  const cue = useRef(onCue)
  useEffect(() => {
    cue.current = onCue
  })

  useEffect(() => {
    const s = new FrankensteinScene(host.current!, first.current.playOnMount && !reduced)
    scene.current = s
    s.onCue = (e, delay) => cue.current?.(e, delay)
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
        <button type="button" className="reset replay" aria-label="Replay animation" title="Replay animation" onClick={() => {
            onReplay?.()
            scene.current?.play()
          }}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 4l14 8-14 8z" />
          </svg>
        </button>
      )}
    </>
  )
}
