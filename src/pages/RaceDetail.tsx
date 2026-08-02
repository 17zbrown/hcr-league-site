import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useClasses,
  useEvent,
  useLiveWeather,
  useRaceForecast,
  useResults,
  useSessions,
  useTrackWinners,
  useWeather,
} from '../lib/queries'
import { CLASS_ORDER, classColor, dateKey, fmtDateLong, wmo } from '../lib/format'
import { ClassChip, Skeleton } from '../components/ui'
import { FeaturePanel, StatBand, type Stat } from '../components/editorial'
import { DriverName } from '../components/links'
import Countdown from '../components/Countdown'
import { Reveal } from '../components/motion'

/** The editorial micro-label: tiny, letterspaced, muted. */
const MICRO = 'font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]'

function sessionTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function hourLabel(h: number) {
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}${h < 12 ? 'am' : 'pm'}`
}

export default function RaceDetail() {
  const { id } = useParams()
  const { data: event, isLoading } = useEvent(id)
  const { data: classes } = useClasses()
  const { data: sessions } = useSessions(id)
  const { data: simWeather } = useWeather(id)
  const { data: results } = useResults(id)
  const track = event?.track
  const { data: live, isLoading: liveLoading, isError: liveError } = useLiveWeather(track?.lat, track?.lon)
  const { data: trackWinners } = useTrackWinners(track?.id)

  const done = event?.status === 'complete'
  const upcoming = !!event && !done

  // Race-day forecast window, centered on the in-sim start hour.
  // Use the stored calendar day directly — converting through a local Date
  // shifted the forecast a day early for every viewer west of UTC.
  const dateStr = event ? dateKey(event.date) : undefined
  const daysUntil = dateStr
    ? Math.round((new Date(`${dateStr}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
    : 0
  const pastRace = daysUntil < 0
  const tooFar = daysUntil > 15
  const centerHour = event?.sim_start_hour != null ? Math.round(event.sim_start_hour) : 13
  const { data: fc, isLoading: fcLoading, isError: fcError } = useRaceForecast({
    lat: track?.lat, lon: track?.lon, dateStr, past: pastRace, tooFar,
  })

  const forecastHours = useMemo(() => {
    const h = fc?.hourly
    if (!h?.time?.length) return []
    const found = h.time.findIndex((t) => parseInt(t.slice(11, 13), 10) === centerHour)
    const center = found >= 0 ? found : Math.min(13, h.time.length - 1)
    const out: {
      hour: number; temp?: number; code?: number; precipProb?: number; precip?: number; isCenter: boolean
    }[] = []
    for (let i = center - 3; i <= center + 3; i++) {
      if (i < 0 || i >= h.time.length) continue
      out.push({
        hour: parseInt(h.time[i].slice(11, 13), 10),
        temp: h.temperature_2m?.[i],
        code: h.weather_code?.[i],
        precipProb: h.precipitation_probability?.[i],
        precip: h.precipitation?.[i],
        isCenter: i === center,
      })
    }
    return out
  }, [fc, centerHour])

  const winners = useMemo(
    () =>
      (results ?? [])
        .filter((r) => r.cls_pos === 1)
        .sort((a, b) => CLASS_ORDER.indexOf(a.class_id) - CLASS_ORDER.indexOf(b.class_id)),
    [results],
  )

  // Past editions at this venue (exclude the current event), grouped by round.
  const history = useMemo(() => {
    const byEvent = new Map<string, { id: string; round: number; name: string | null; date: string | null; rows: typeof trackWinners }>()
    for (const w of trackWinners ?? []) {
      const ev = w.event
      if (!ev || ev.id === id) continue
      if (!byEvent.has(ev.id)) byEvent.set(ev.id, { id: ev.id, round: ev.round, name: ev.name, date: ev.date ?? null, rows: [] })
      byEvent.get(ev.id)!.rows!.push(w)
    }
    return Array.from(byEvent.values()).sort((a, b) => b.round - a.round)
  }, [trackWinners, id])

  if (isLoading) {
    return <div className="container-hcr py-16"><Skeleton className="h-96 w-full" /></div>
  }
  if (!event) {
    return (
      <div className="container-hcr flex min-h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="text-5xl">Race not found</h1>
        <Link to="/schedule" className="mt-6 text-[var(--color-blue)]">← Full schedule</Link>
      </div>
    )
  }

  // Track facts for the stat band — only real numbers, nulls hidden.
  const trackFacts: Stat[] = []
  if (event.duration_min != null) trackFacts.push({ label: 'Duration (min)', value: event.duration_min })
  if (track?.length_km != null) {
    trackFacts.push({
      label: 'Length (km)',
      value: track.length_km,
      decimals: 2,
      hint: `${(track.length_km * 0.621371).toFixed(2)} mi`,
    })
  }
  if (track?.corners != null) trackFacts.push({ label: 'Corners', value: track.corners })
  if (track?.config) trackFacts.push({ label: 'Layout', value: null, text: track.config })

  return (
    <div className="container-hcr py-12 md:py-16">
      <Link to="/schedule" className="mb-6 inline-block text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)]">
        ← Schedule
      </Link>

      {/* Header — navy feature panel */}
      <FeaturePanel className="p-6 md:p-10">
        <div className="flex flex-wrap items-center gap-3">
          <span className={MICRO}>Round {event.round}</span>
          {done && (
            <span className="rounded-full border border-[var(--color-line-2)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-ink)]">
              Final
            </span>
          )}
          {event.status === 'next' && (
            <span className="rounded-full bg-[var(--color-brand)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-black">
              Next Round
            </span>
          )}
          <div className="ml-auto flex gap-1.5">
            {CLASS_ORDER.map((c) => <ClassChip key={c} classId={c} />)}
          </div>
        </div>
        <h1 className="mt-4 text-5xl md:text-6xl">{event.name ?? track?.name}</h1>
        <div className="mt-3 text-lg text-[var(--color-ink-2)]">
          {track?.name}{track?.location ? ` · ${track.location}` : ''} · {fmtDateLong(event.date)}
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-4">
          {upcoming && <Countdown target={event.date} dark />}
          {event.broadcast_url && (
            <a href={event.broadcast_url} target="_blank" rel="noreferrer" className="hcr-btn hcr-btn-ghost">Watch Broadcast ↗</a>
          )}
          {done && <Link to="/results" className="hcr-btn hcr-btn-primary">Full Results</Link>}
        </div>
      </FeaturePanel>

      {/* Track facts */}
      {trackFacts.length > 0 && (
        <div className="mt-6">
          <StatBand stats={trackFacts} columns={4} />
        </div>
      )}

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {/* Sessions */}
        <Reveal>
          <section>
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-2xl leading-none">Session Schedule</h2>
              <span className="h-px flex-1 bg-[var(--color-line)]" aria-hidden />
            </div>
            {!sessions?.length ? (
              <p className="rounded-2xl bg-[var(--color-cloud)] p-6 text-[var(--color-muted)]">
                Session times land here once the stewards post the running order.
              </p>
            ) : (
              <ol className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
                {sessions.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-4 border-b border-[var(--color-line)] px-5 py-4 last:border-0">
                    <span className="font-display text-2xl text-[var(--color-faint)]">{String(i + 1).padStart(2, '0')}</span>
                    <div className="flex-1">
                      <div className={MICRO}>{s.type}</div>
                      <div className="mt-0.5 font-display text-xl">{sessionTime(s.start)}</div>
                    </div>
                    {s.dur_min != null && <span className="tabular text-sm text-[var(--color-ink-2)]">{s.dur_min} min</span>}
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-xs text-[var(--color-faint)]">Times shown in your local timezone.</p>
          </section>
        </Reveal>

        {/* Weather */}
        <Reveal delay={0.08}>
          <section>
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-2xl leading-none">Weather</h2>
              <span className="h-px flex-1 bg-[var(--color-line)]" aria-hidden />
            </div>

            {/* Live real-world conditions */}
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
              <div className={`${MICRO} mb-3`}>Now at {track?.location ?? track?.name}</div>
              {track?.lat == null ? (
                <p className="text-sm text-[var(--color-muted)]">No coordinates for this track.</p>
              ) : liveLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : liveError || !live?.current ? (
                <p className="text-sm text-[var(--color-muted)]">Live weather unavailable right now.</p>
              ) : (
                <div className="flex items-center gap-5">
                  <div className="text-5xl">{wmo(live.current.weather_code).icon}</div>
                  <div>
                    <div className="font-display text-4xl leading-none">{Math.round(live.current.temperature_2m)}°F</div>
                    <div className="text-sm text-[var(--color-muted)]">{wmo(live.current.weather_code).label}</div>
                  </div>
                  <div className="tabular ml-auto space-y-1 text-right text-sm text-[var(--color-ink-2)]">
                    <div><span className="text-[var(--color-muted)]">Feels </span>{Math.round(live.current.apparent_temperature)}°</div>
                    <div><span className="text-[var(--color-muted)]">Wind </span>{Math.round(live.current.wind_speed_10m)} mph</div>
                    <div><span className="text-[var(--color-muted)]">Humidity </span>{live.current.relative_humidity_2m}%</div>
                  </div>
                </div>
              )}
            </div>

            {/* Real-world race-day forecast, centered on the in-sim start hour */}
            {track?.lat != null && (
              <div className="mt-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
                <div className={`${MICRO} mb-3`}>
                  {pastRace ? 'Conditions on race day' : 'Race-day forecast'} · sim start {hourLabel(centerHour)}
                </div>
                {tooFar ? (
                  <p className="text-sm text-[var(--color-muted)]">Available closer to race day (within ~2 weeks).</p>
                ) : fcLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : fcError || !forecastHours.length ? (
                  <p className="text-sm text-[var(--color-muted)]">Forecast unavailable right now.</p>
                ) : (
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" tabIndex={0} role="region" aria-label="Race day forecast">
                    {forecastHours.map((h) => (
                      <div
                        key={h.hour}
                        className={`min-w-[62px] flex-1 rounded-lg border bg-[var(--color-paper)] p-2 text-center ${
                          h.isCenter ? 'shadow-card border-[var(--color-brand)]' : 'border-[var(--color-line)]'
                        }`}
                      >
                        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">{hourLabel(h.hour)}</div>
                        <div className="my-0.5 text-2xl">{h.code != null ? wmo(h.code).icon : '—'}</div>
                        <div className="font-display text-lg leading-none">
                          {h.temp != null ? `${Math.round(h.temp)}°` : '—'}
                        </div>
                        <div className="tabular mt-1 text-[10px] text-[var(--color-blue)]">
                          {pastRace
                            ? h.precip != null ? `${h.precip.toFixed(1)}mm` : ''
                            : h.precipProb != null ? `${h.precipProb}%` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* In-sim race-day forecast */}
            {!!simWeather?.length && (
              <div className="mt-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-5">
                <div className={`${MICRO} mb-3`}>Sim race-day forecast</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {simWeather.map((w) => (
                    <div key={w.id} className="tabular">
                      {w.air_f != null && <div className="font-display text-2xl">{Math.round(w.air_f)}°F</div>}
                      <div className="text-xs text-[var(--color-muted)]">
                        {w.sky ?? '—'}{w.precip != null ? ` · ${w.precip}% rain` : ''}
                        {w.wind_mph != null ? ` · ${w.wind_mph} mph` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </Reveal>
      </div>

      {/* Winners / history */}
      <Reveal>
        <section className="mt-12">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-2xl leading-none">{done ? 'Race Winners' : 'Winners at this Venue'}</h2>
            <span className="h-px flex-1 bg-[var(--color-line)]" aria-hidden />
          </div>

          {done && winners.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {winners.map((w) => {
                const color = classColor(w.class_id, classes)
                return (
                  <div key={w.id} className="flex flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
                    <div className="flex-1 p-5">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: color, boxShadow: 'inset 0 0 0 1px rgba(20,24,28,0.28)' }}
                          aria-hidden
                        />
                        <span className={MICRO}>{w.class_id}</span>
                        <span className="ml-auto font-display text-3xl leading-none text-[var(--color-line-2)]">P1</span>
                      </div>
                      <div className="mt-3 font-display text-2xl leading-tight"><DriverName text={w.drivers_text} /></div>
                    </div>
                    {/* Tiny mono meta bar — car number and best lap */}
                    <div className="tabular flex items-center justify-between gap-3 border-t border-[var(--color-line)] bg-[var(--color-mist)] px-5 py-2.5 text-xs text-[var(--color-ink-2)]">
                      <span>#{w.number}</span>
                      {w.best_lap && <span>{w.best_lap}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {history.length > 0 ? (
            <div className={`${done && winners.length ? 'mt-6' : ''} space-y-3`}>
              {done && winners.length > 0 && <div className={MICRO}>Previous editions</div>}
              {history.map((h) => (
                <div key={h.id} className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-4">
                  <div className={MICRO}>
                    Round {h.round}{h.name ? ` · ${h.name}` : ''}{h.date ? ` · ${fmtDateLong(h.date)}` : ''}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                    {(h.rows ?? []).sort((a, b) => CLASS_ORDER.indexOf(a.class_id) - CLASS_ORDER.indexOf(b.class_id)).map((w) => (
                      <span key={w.id} className="inline-flex items-center gap-1.5 text-sm">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: classColor(w.class_id, classes), boxShadow: 'inset 0 0 0 1px rgba(20,24,28,0.28)' }}
                          aria-hidden
                        />
                        <span className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-2)]">{w.class_id}</span>
                        <DriverName text={w.drivers_text} className="font-semibold" />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !done && (
              <p className="rounded-2xl bg-[var(--color-cloud)] p-6 text-[var(--color-muted)]">
                First running at this venue — the history books open here.
              </p>
            )
          )}
        </section>
      </Reveal>

      {/* Notes / report */}
      {(event.notes || event.report) && (
        <Reveal>
          <section className="mt-12 rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-6 md:p-8">
            <div className={`${MICRO} mb-3`}>{event.report ? 'Race Report' : 'Notes'}</div>
            <div className="font-body max-w-prose whitespace-pre-line leading-relaxed text-[var(--color-ink-2)]">{event.report ?? event.notes}</div>
          </section>
        </Reveal>
      )}
    </div>
  )
}
