import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="container-hcr flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="font-display text-8xl text-[var(--color-ink)]">
        D<span className="text-[var(--color-brand-deep)]">N</span>F
      </h1>
      <p className="mt-4 text-xl text-[var(--color-muted)]">
        This page didn't make the finish. Let's get you back on track.
      </p>
      <Link
        to="/"
        className="mt-8 rounded-xl bg-[var(--color-brand)] px-7 py-3.5 font-alt text-lg font-bold uppercase tracking-wide text-black transition-transform hover:-translate-y-1"
      >
        Back to the Paddock
      </Link>
    </div>
  )
}
