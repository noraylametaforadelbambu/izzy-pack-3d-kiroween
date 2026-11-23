interface Props {
  on: boolean
  onToggle: () => void
}

/** "Sound": switches the sound effects of the animations on and off. Off by default. The state is in `aria-pressed`. */
export function SoundToggle({ on, onToggle }: Props) {
  return (
    <button
      type="button"
      className={on ? 'hwtoggle soundbtn on' : 'hwtoggle soundbtn'}
      aria-pressed={on}
      title={on ? 'Sound effects are on' : 'Sound effects are off'}
      data-testid="sound-toggle"
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4z" />
        {on ? (
          <>
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </>
        ) : (
          <>
            <path d="m16 9 5 6" />
            <path d="m21 9-5 6" />
          </>
        )}
      </svg>
      <span className="sndlabel">Sound</span>
    </button>
  )
}
