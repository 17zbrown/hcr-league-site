import { useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { DiscordButton } from '../components/DiscordButton'

/**
 * Discord is the only advertised way in — server roles decide which portal you
 * land in, so there is one identity to manage instead of two.
 *
 * The email form still exists behind ?recovery=1. It is not a second front door
 * for members; it is the lockout escape hatch. If Discord is down, the league
 * owner leaves the server, or a role id is mistyped, the commissioner would
 * otherwise have no way back into the admin portal that fixes it.
 */
export default function Login() {
  const { signIn } = useAuth()
  const [params] = useSearchParams()
  const recovery = params.get('recovery') === '1'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitRecovery = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
      // Full reload rather than a router push: guards and profile read cleanly
      // from a fresh session instead of a half-updated context.
      window.location.assign('/portal')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <div className="container-hcr flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <div className="eyebrow mb-2">Member access</div>
        <h1 className="text-5xl">Sign in</h1>
        <p className="mt-3 text-[var(--color-muted)]">
          HCR League runs on Discord. Sign in with the account you race under — your server roles
          decide which portal you land in.
        </p>

        <DiscordButton className="mt-8 w-full" onError={(m) => setError(m || null)} />

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
            {error}
          </p>
        )}

        <p className="mt-4 text-center text-xs text-[var(--color-faint)]">
          Not in the server yet? Ask a commissioner for an invite, then sign in here.
        </p>

        {recovery && (
          <form onSubmit={submitRecovery} className="mt-10 space-y-4 rounded-xl border border-dashed border-[var(--color-line-2)] p-5">
            <div>
              <h2 className="text-xl">Staff recovery</h2>
              <p className="mt-1 font-body text-sm text-[var(--color-muted)]">
                Email sign-in for commissioners, kept only so a Discord problem can never lock the
                league out of its own admin portal.
              </p>
            </div>
            <label className="block">
              <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Email</span>
              <input
                className="hcr-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Password</span>
              <input
                className="hcr-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
            <button type="submit" disabled={busy} className="hcr-btn hcr-btn-dark w-full">
              {busy ? 'Working…' : 'Sign in with email'}
            </button>
          </form>
        )}

        <Link to="/" className="mt-8 inline-block text-sm text-[var(--color-faint)] hover:text-[var(--color-ink)]">
          ← Back to the paddock
        </Link>
      </div>
    </div>
  )
}
