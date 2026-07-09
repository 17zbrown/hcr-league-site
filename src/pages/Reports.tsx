import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useCurrentSeason, useEvents } from '../lib/queries'
import { fmtDateLong } from '../lib/format'
import { Section } from '../components/ui'
import { Reveal } from '../components/motion'

/** Editorial feed of per-race reports (written by the commissioner on each event). */
export default function Reports() {
  const { data: season } = useCurrentSeason()
  const { data: events } = useEvents(season?.id)

  const reports = useMemo(
    () =>
      (events ?? [])
        .filter((e) => (e.report ?? '').trim().length > 0)
        .sort((a, b) => b.round - a.round),
    [events],
  )

  return (
    <Section eyebrow={`${season?.name ?? 'Season'} · Paddock notes`} title="Race Reports" titleTag="h1">
      {reports.length === 0 ? (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-12 text-center">
          <p className="mx-auto max-w-md text-[var(--color-muted)]">
            Race reports land here after each round. Check back once the next race is in the books.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {reports.map((e, i) => (
            <Reveal key={e.id} delay={Math.min(i * 0.05, 0.3)}>
              <article className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 md:p-8">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
                  <span className="tabular font-semibold text-[var(--color-blue)]">Round {e.round}</span>
                  <span aria-hidden>·</span>
                  <span>{e.track?.name}</span>
                  <span aria-hidden>·</span>
                  <span className="tabular">{fmtDateLong(e.date)}</span>
                </div>
                <h2 className="mt-2 text-3xl md:text-4xl">
                  <Link to={`/schedule/${e.id}`} className="transition-colors hover:text-[var(--color-blue)]">
                    {e.name ?? e.track?.name}
                  </Link>
                </h2>
                <div className="mt-4 max-w-3xl whitespace-pre-line leading-relaxed text-[var(--color-ink-2)]">
                  {e.report}
                </div>
                <div className="mt-5 flex flex-wrap gap-4 text-sm font-semibold">
                  <Link to={`/schedule/${e.id}`} className="text-[var(--color-ink-2)] hover:text-[var(--color-blue)]">
                    Race details →
                  </Link>
                  <Link to="/results" className="text-[var(--color-ink-2)] hover:text-[var(--color-blue)]">
                    Full results →
                  </Link>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      )}
    </Section>
  )
}
