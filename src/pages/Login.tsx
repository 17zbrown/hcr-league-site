import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { signIn, signUp } = useAuth()
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
