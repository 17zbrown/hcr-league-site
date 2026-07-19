import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { signIn, signUp, signInWithDiscord } = useAuth()
  const nav = useNavigate()
  const location = useLocation() as { state?: { from?: string } }
  const from = location.state?.from ?? '/account'

  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'in') {
        await signIn(email, password)
        nav(from, { replace: true })
      } else {
        const { needsConfirm } = await signUp(email, password, displayName)
        if (needsConfirm) {
          setInfo('Account created. Check your email to confirm, then sign in.')
          setMode('in')
        } else {
          nav(from, { replace: true })
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container-hcr flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <div className="eyebrow mb-2">{mode === 'in' ? 'Member access' : 'Create account'}</div>
        <h1 className="text-5xl">{mode === 'in' ? 'Sign in' : 'Join HCR'}</h1>
        <p className="mt-3 text-[var(--color-muted)]">
          {mode === 'in'
            ? 'Sign in to enter the season and manage your driver profile.'
            : 'Create a member account to register for the season.'}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          {mode === 'up' && (
            <Field label="Display name">
              <input
                className="hcr-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                placeholder="How your name appears on the grid"
              />
            </Field>
          )}
          <Field label="Email">
            <input
              className="hcr-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </Field>
          <Field label="Password">
            <input
              className="hcr-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              minLength={6}
            />
          </Field>

          {error && <p className="rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">{error}</p>}
          {info && <p className="rounded-lg bg-[var(--color-green)]/10 px-4 py-3 text-sm text-[var(--color-green)]">{info}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-[var(--color-brand)] py-3.5 font-display text-lg font-bold uppercase tracking-wide text-black transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {busy ? 'Working…' : mode === 'in' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {/* Discord SSO — grants the right portal from your server roles */}
        <div className="mt-6">
          <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-[var(--color-faint)]">
            <span className="h-px flex-1 bg-[var(--color-line)]" />
            or
            <span className="h-px flex-1 bg-[var(--color-line)]" />
          </div>
          <button
            type="button"
            onClick={async () => {
              setError(null)
              try { await signInWithDiscord() } catch (e) { setError((e as Error).message) }
            }}
            className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#5865f2] py-3.5 font-display text-lg font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-0.5"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19.3 5.4A17.6 17.6 0 0015 4l-.2.5c1.6.4 2.9 1 4.1 1.9A13.9 13.9 0 003 6.4 16 16 0 019.2 4.5L9 4a17.6 17.6 0 00-4.3 1.4C2 9.5 1.3 13.5 1.6 17.4a17.7 17.7 0 005.4 2.7l1.1-1.7c-.6-.2-1.2-.5-1.7-.9l.4-.3a12.6 12.6 0 0010.4 0l.4.3c-.5.4-1.1.7-1.7.9l1.1 1.7a17.7 17.7 0 005.4-2.7c.4-4.5-.6-8.5-2.9-12zM8.6 15c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1S9.6 15 8.6 15zm6.8 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1z" />
            </svg>
            Continue with Discord
          </button>
          <p className="mt-2 text-center text-xs text-[var(--color-faint)]">
            Your server roles decide which portal you land in.
          </p>
        </div>

        <div className="mt-6 text-sm text-[var(--color-muted)]">
          {mode === 'in' ? (
            <>
              New here?{' '}
              <button className="font-semibold text-[var(--color-blue)]" onClick={() => { setMode('up'); setError(null) }}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already a member?{' '}
              <button className="font-semibold text-[var(--color-blue)]" onClick={() => { setMode('in'); setError(null) }}>
                Sign in
              </button>
            </>
          )}
        </div>

        <Link to="/" className="mt-8 inline-block text-sm text-[var(--color-faint)] hover:text-[var(--color-ink)]">
          ← Back to the paddock
        </Link>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">{label}</span>
      {children}
    </label>
  )
}
