import { TRACK_MAPS } from '../lib/trackMaps'

/**
 * Renders a circuit outline (from OpenStreetMap geometry) as a clean SVG.
 * Returns null if we don't have geometry for this track.
 */
export function TrackMap({
  name,
  className = '',
  stroke = 'var(--color-ink)',
  strokeWidth = 2,
  showStart = true,
}: {
  name?: string | null
  className?: string
  stroke?: string
  strokeWidth?: number
  showStart?: boolean
}) {
  const map = name ? TRACK_MAPS[name] : undefined
  if (!map) return null

  // First point of the path = start/finish.
  const m = map.path.match(/^M\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/)
  const start = m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null
  const [, , vw] = map.viewBox.split(' ').map(Number)
  const dot = Math.max(6, (vw || 1000) * 0.02)

  return (
    <svg viewBox={map.viewBox} className={className} fill="none" role="img" aria-label={`${name} circuit map`}>
      {/* soft backing */}
      <path d={map.path} stroke="var(--color-line-2)" strokeWidth={strokeWidth + 2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.5} />
      {/* main line */}
      <path d={map.path} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {/* start / finish */}
      {showStart && start && <circle cx={start.x} cy={start.y} r={dot} fill="var(--color-brand)" stroke="var(--color-ink)" strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

export function hasTrackMap(name?: string | null) {
  return !!(name && TRACK_MAPS[name])
}
