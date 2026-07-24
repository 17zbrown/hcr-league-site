import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Without this, one thrown render error (or a lazy chunk that fails to load
 * after a deploy) unmounts the whole app and leaves a blank white page. Catch
 * it, keep the shell, and offer a way out.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    // A stale chunk reference after a redeploy is the common case — a reload
    // fetches the new bundle and fixes it, so lead with that.
    const isChunkError = /dynamically imported module|Loading chunk|Failed to fetch/i.test(
      this.state.error.message,
    )

    return (
      <div className="container-hcr flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="font-display text-7xl text-[var(--color-ink)]">
          Red<span className="text-[var(--color-red)]"> flag</span>
        </h1>
        <p className="mt-4 max-w-md text-lg text-[var(--color-muted)]">
          {isChunkError
            ? 'The site updated while you were here. A refresh will pull in the new version.'
            : 'Something went wrong rendering this page. The rest of the site is fine.'}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button onClick={() => window.location.reload()} className="hcr-btn hcr-btn-primary">
            Reload
          </button>
          <a href="/" className="hcr-btn hcr-btn-ghost">Back to the paddock</a>
        </div>
      </div>
    )
  }
}
