import { useEffect, useRef, useState } from 'react'
import type { SoundEvent } from '../viewer/entrance'
import { FrankensteinScene } from '../viewer/FrankensteinScene'

interface Props {
  /** Play the animation when this screen opens. False when the user comes back to Home: the finished figure is shown. */
  playOnMount: boolean
  /** Called once when the animation starts for the first time. */
  onPlayed: () => void
  /** The whole soundtrack, once per play, when the animation starts (soft thuds, the metallic click). */
  onSound?: (events: SoundEvent[]) => void
  /** The animation was cut short: stop its sound. */
  onSoundEnd?: () => void
  /** Replay was pressed (a user gesture: the place to unlock audio). */
  onReplay?: () => void
}

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Home decoration: boxes stack into a Frankenstein's monster, once, with a discreet Replay button. With
 * prefers-reduced-motion the finished figure is shown and there is nothing to replay. Separate from the order.
 */
export function FrankensteinHome({ playOnMount, onPlayed, onSound, onSoundEnd, onReplay }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<FrankensteinScene | null>(null)
  const [reduced] = useState(reducedMotion)
  const first = useRef({ playOnMount, onPlayed })
  const handlers = useRef({ onSound, onSoundEnd })
  useEffect(() => {
    handlers.current = { onSound, onSoundEnd }
  })

  useEffect(() => {
    const s = new FrankensteinScene(host.current!, first.current.playOnMount && !reduced)
    scene.current = s
    s.onSound = (events) => handlers.current.onSound?.(events)
    s.onSoundEnd = () => handlers.current.onSoundEnd?.()
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
