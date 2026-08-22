import { useState } from 'react'
import { useAuth } from '../lib/auth'

/**
 * ONE WAY IN, RENDERED IN ONE PLACE.
 *
 * There is no account to create — `handle_new_user` makes the profile the first time
 * somebody comes back from Discord, and there has never been a sign-up form to fill
 * in. So a button reading "Create Account" described a step that does not exist and
 * cost a hop: /signup sent you to /login, where the only thing to do was press
 * Continue with Discord. This is that button, and the sign-up page now carries it
 * directly.
 *
 * Login owns the same markup no longer — it renders this too, so the Discord blue,
 * the glyph and the "Opening Discord…" wording cannot drift between the two pages.
 */
export function DiscordButton({
  label = 'Continue with Discord',
  className = '',
  onError,
}: {
  label?: string
  /** Extra classes for layout only — the brand colours are fixed here on purpose. */
  className?: string
  /** Login shows the failure in its own alert; the sign-up page falls back to inline text. */
  onError?: (message: string) => void
}) {
  const { signInWithDiscord } = useAuth()
  const [busy, setBusy] = useState(false)
  const [ownError, setOwnError] = useState<string | null>(null)

  const go = async () => {
    setOwnError(null)
    onError?.('')
    setBusy(true)
    try {
      // Sends the browser to Discord; nothing after this runs on success.
      await signInWithDiscord()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not reach Discord.'
      if (onError) onError(message)
      else setOwnError(message)
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className={`flex min-h-11 items-center justify-center gap-2.5 rounded-xl bg-[#5865f2] px-7 py-3.5 font-alt text-sm font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60 ${className}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.3 5.4A17.6 17.6 0 0015 4l-.2.5c1.6.4 2.9 1 4.1 1.9A13.9 13.9 0 003 6.4 16 16 0 019.2 4.5L9 4a17.6 17.6 0 00-4.3 1.4C2 9.5 1.3 13.5 1.6 17.4a17.7 17.7 0 005.4 2.7l1.1-1.7c-.6-.2-1.2-.5-1.7-.9l.4-.3a12.6 12.6 0 0010.4 0l.4.3c-.5.4-1.1.7-1.7.9l1.1 1.7a17.7 17.7 0 005.4-2.7c.4-4.5-.6-8.5-2.9-12zM8.6 15c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1S9.6 15 8.6 15zm6.8 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1z" />
        </svg>
        {busy ? 'Opening Discord…' : label}
      </button>
      {ownError && (
        <p role="alert" className="mt-3 w-full text-sm text-[var(--color-red)]">
          {ownError}
        </p>
      )}
    </>
  )
}
