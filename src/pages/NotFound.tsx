import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="container-hcr flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="font-display text-8xl text-[var(--color-brand)]">DNF</div>
      <p className="mt-4 text-xl text-[var(--color-muted)]">
        This page didn't make the finish. Let's get you back on track.
      </p>
      <Link
        to="/"
        className="mt-8 bg-[var(--color-brand)] px-6 py-3 font-display text-xl uppercase tracking-wide text-black"
      >
        Back to the Paddock
      </Link>
    </div>
  )
}
