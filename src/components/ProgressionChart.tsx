import { useState } from 'react'
import type { Progression } from '../lib/standings'

/** Nice round ceiling for the y-axis given a max value. */
function niceMax(v: number): number {
  if (v <= 0) return 10
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}

const W = 960
const H = 400
const PAD = { top: 24, right: 148, bottom: 40, left: 48 }

/**
 * Cumulative championship-points line chart. Every series opens at 0 (season
 * start) so a single completed round already draws a line. The leader is
 * emphasised in the class colour; hovering any line lifts it to the front.
 */
export function ProgressionChart({ data, color, max = 8 }: { data: Progression; color: string; max?: number }) {
  const [hover, setHover] = useState<string | null>(null)
  const { rounds, series } = data
  if (!rounds.length || !series.length) return null

  const shown = series.slice(0, max)
  const yMax = niceMax(Math.max(...shown.map((s) => s.total), 1))

  // x columns: index 0 = season open (0 pts), then one per round.
  const cols = rounds.length + 1
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (cols === 1 ? plotW / 2 : (plotW * i) / (cols - 1))
  const y = (v: number) => PAD.top + plotH - (plotH * v) / yMax

  const ticks = 4
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => (yMax * i) / ticks)

  const pointsFor = (cum: number[]) => [0, ...cum].map((v, i) => `${x(i)},${y(v)}`).join(' ')

  const colorFor = (rank: number, key: string) => {
    if (hover === key) return color
    if (rank === 0) return color
    if (rank <= 2) return 'var(--color-ink-2)'
    return 'var(--color-line-2)'
  }
  const widthFor = (rank: number, key: string) => (hover === key ? 3.5 : rank === 0 ? 3 : 1.75)
  const opacityFor = (key: string) => (hover && hover !== key ? 0.25 : 1)

  return (
    <div className="shadow-card rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 md:p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
          Points progression
        </h3>
        <span className="font-mono text-xs text-[var(--color-faint)]">
          {rounds.length} {rounds.length === 1 ? 'round' : 'rounds'} scored
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Championship points progression by round">
        {/* horizontal gridlines + y labels */}
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.left - 10} y={y(v) + 4} textAnchor="end" className="fill-[var(--color-faint)]" fontSize={13} fontFamily="var(--font-mono, monospace)">
              {Math.round(v)}
            </text>
          </g>
        ))}

        {/* x ticks: season open + each round */}
        <text x={x(0)} y={H - PAD.bottom + 22} textAnchor="middle" className="fill-[var(--color-faint)]" fontSize={12} fontFamily="var(--font-mono, monospace)">
          START
        </text>
        {rounds.map((r, i) => (
          <text key={r.round} x={x(i + 1)} y={H - PAD.bottom + 22} textAnchor="middle" className="fill-[var(--color-muted)]" fontSize={12} fontFamily="var(--font-mono, monospace)">
            {r.short}
          </text>
        ))}

        {/* series lines (leader drawn last / hovered raised) */}
        {shown
          .map((s, rank) => ({ s, rank }))
          .sort((a, b) => {
            if (hover === a.s.key) return 1
            if (hover === b.s.key) return -1
            return b.rank - a.rank // higher rank (index 0 = leader) drawn last
          })
          .map(({ s, rank }) => (
            <g key={s.key} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
              {/* fat invisible hit area */}
              <polyline points={pointsFor(s.cumulative)} fill="none" stroke="transparent" strokeWidth={14} />
              <polyline
                points={pointsFor(s.cumulative)}
                fill="none"
                stroke={colorFor(rank, s.key)}
                strokeWidth={widthFor(rank, s.key)}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={opacityFor(s.key)}
                vectorEffect="non-scaling-stroke"
              />
              {/* end marker + label for the leader or hovered line */}
              {(rank === 0 || hover === s.key) && (
                <>
                  <circle cx={x(cols - 1)} cy={y(s.total)} r={4} fill={color} stroke="var(--color-paper)" strokeWidth={2} />
                  <text
                    x={x(cols - 1) + 10}
                    y={y(s.total) + 4}
                    className="fill-[var(--color-ink)]"
                    fontSize={13}
                    fontWeight={700}
                  >
                    {s.name.length > 16 ? s.name.slice(0, 15) + '…' : s.name}
                  </text>
                </>
              )}
            </g>
          ))}
      </svg>

      {/* legend */}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--color-line)] pt-4">
        {shown.map((s, rank) => (
          <button
            key={s.key}
            type="button"
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
            className="flex items-center gap-2 text-left transition-opacity"
            style={{ opacity: hover && hover !== s.key ? 0.4 : 1 }}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorFor(rank, s.key) === 'var(--color-line-2)' ? 'var(--color-muted)' : colorFor(rank, s.key) }} />
            <span className="text-sm font-semibold text-[var(--color-ink)]">{s.name}</span>
            <span className="tabular font-mono text-xs text-[var(--color-faint)]">{s.total}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
