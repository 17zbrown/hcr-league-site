import { Component, type ReactNode } from 'react'

/** Renders nothing if a child throws (e.g. WebGL unavailable) — keeps the page alive. */
export class SafeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    /* swallow — decorative only */
  }
  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}
