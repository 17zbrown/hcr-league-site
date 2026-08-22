import { Link } from 'react-router-dom'
import { AnimatedStat, MeterRow, StatBand } from './editorial'
import { AchievementGallery } from './AchievementGallery'
import { LicenseProgress } from './LicenseBadge'
import { ColumnFilterRow, ColumnFilterToggle, useColumnFilters } from './SearchBox'
import { classColor } from '../lib/format'
import type { DriverReport, RoundForm } from '../lib/driverReport'
import type { LicenseInfo } from '../lib/license'
import type { Driver, LeagueClass, RaceResult } from '../lib/types'

/**
 * ONE REPORT, TWO READERS.
 *
 * This body used to live inside /drivers/:id only, so the member portal showed a
 * six-number band and stopped — a driver could read a stranger's full season on the
 * public page but only a summary of their own. Rather than copy the sections into
 * the portal, where the two would drift apart within a season, both pages now render
 * this.
 *
 * The only thing that differs between them is who is being addressed, and that is
 * what `voice` is for: the portal says "you", the public page says the driver's
 * first name. Everything else — the numbers, the ordering, the filters — is
 * identical by construction rather than by discipline.
 *
 * The page owns its own header above this: the public page leads with a masthead
 * naming the driver, the portal with the member's own car panel.
 */
export function DriverReportBody({
  driver,
  rows,
  report,
  achievements,
  license,
  classes,
  color,
  voice = 'third',
}: {
  driver: Driver
  rows: ReportRow[]
  report: DriverReport
  achievements: Parameters<typeof AchievementGallery>[0]['achievements']
  license: LicenseInfo | null
  classes?: LeagueClass[]
  color: string
  voice?: 'first' | 'third'
}) {
  const who = voice === 'first' ? 'you have' : `${driver.name.split(' ')[0]} has`
  const whose = voice === 'first' ? 'your' : 'their'
  const emptyLabel =
    voice === 'first'
      ? 'No scored results yet this season.'
      : `No scored results yet for ${driver.name}.`

  return (
    <>
      <StatBand
        stats={[
          { label: 'Championship Points', value: report.points },
          { label: 'Starts', value: report.starts },
          { label: 'Wins', value: report.wins },
          { label: 'Podiums', value: report.podiums },
          { label: 'Poles', value: report.poles },
          { label: 'Best Finish', value: report.bestFinish, prefix: 'P' },
        ]}
      />

      {/*
        min-w-0 ON BOTH COLUMNS, and it is load-bearing. A grid item defaults to
        min-width:auto, so it refuses to shrink below its widest content -- and the
        round-by-round table carries min-w-[680px]. That forced this column to 706px
        inside a 375px phone and scrolled the WHOLE page sideways by 331px, rather
        than the table scrolling inside its own overflow-x-auto wrapper as intended.
        Measured on a phone viewport before and after.
      */}
      <div className="mt-10 grid gap-10 lg:grid-cols-[1.55fr_1fr]">
        <div className="min-w-0 space-y-10">
          <section>
            <h2 className="text-3xl">Season form</h2>
            <p className="mt-2 max-w-prose font-body text-[var(--color-muted)]">
              Every round {who} started this season, in order — class finish, places made up on the
              road, and points banked.
            </p>
            <SeasonForm form={report.form} color={color} />
            {report.fillIn && (
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-2xl border border-dashed border-[var(--color-line-2)] bg-[var(--color-paper)] px-5 py-4">
                <span className="font-body text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                  Fill-in duty
                </span>
                <span className="font-body text-sm text-[var(--color-ink-2)]">
                  {report.fillIn.drives} {report.fillIn.drives === 1 ? 'drive' : 'drives'} ·{' '}
                  {report.fillIn.points} Fill-In Cup pts
                  {report.fillIn.bestFinish != null ? ` · best P${report.fillIn.bestFinish}` : ''}
                  {report.fillIn.wins ? ` · ${report.fillIn.wins}W` : ''}
                </span>
                <Link to="/standings/fill-in" className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-muted)] underline-offset-4 hover:underline">
                  Cup table →
                </Link>
              </div>
            )}
          </section>

          <section>
            <h2 className="text-3xl">Race craft</h2>
            <div className="mt-5">
              <StatBand
                columns={4}
                stats={[
                  { label: 'Avg Finish', value: report.avgFinish, decimals: 1, prefix: 'P' },
                  { label: 'Avg Start', value: report.avgStart, decimals: 1, prefix: 'P' },
                  {
                    label: 'Places Gained',
                    value: report.placesGained,
                    prefix: (report.placesGained ?? 0) > 0 ? '+' : '',
                    hint: 'Grid to flag, all season',
                  },
                  { label: 'Laps Completed', value: report.totalLaps },
                ]}
              />
            </div>
          </section>

          <section>
            <h2 className="text-3xl">Pace &amp; discipline</h2>
            <div className="mt-5">
              <StatBand
                columns={4}
                stats={[
                  { label: 'Best Lap', text: report.bestLap, value: null },
                  {
                    label: 'Off Class Best',
                    value: report.avgPaceGap,
                    decimals: 2,
                    suffix: '%',
                    hint: 'Average gap to the quickest in class',
                  },
                  { label: 'Incidents / Race', value: report.incPerRace, decimals: 1 },
                  { label: 'Retirements', value: report.dnfs },
                ]}
              />
            </div>
          </section>

          <section>
            <h2 className="text-3xl">Trophy cabinet</h2>
            <div className="mt-5">
              <AchievementGallery achievements={achievements} />
            </div>
          </section>

          <ResultsTable rows={rows} classes={classes} emptyLabel={emptyLabel} />
        </div>

        <aside className="min-w-0 space-y-6">
          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
            <h3 className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
              Strike rate
            </h3>
            <div className="mt-3 divide-y divide-[var(--color-line)]">
              <MeterRow label="Wins" value={report.winRate} color={color} />
              <MeterRow label="Podiums" value={report.podiumRate} color={color} />
              <MeterRow label="Races finished" value={report.finishRate} color="var(--color-green)" />
              <MeterRow label="Consistency" value={report.consistency} color="var(--color-blue)" />
            </div>
            <p className="mt-4 font-body text-xs leading-relaxed text-[var(--color-faint)]">
              Consistency scores how tightly the finishing positions cluster — a driver who always
              lands in the same window scores higher than one who mixes wins with retirements.
            </p>
          </div>

          {license && <LicenseProgress info={license} />}

          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-6">
            <h3 className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
              At a glance
            </h3>
            <ul className="mt-3 space-y-2 font-body text-sm text-[var(--color-ink-2)]">
              <li>
                Best result <strong className="font-display text-xl">
                  <AnimatedStat value={report.bestFinish} prefix="P" />
                </strong>
                {report.worstFinish != null && report.worstFinish !== report.bestFinish && (
                  <>, worst <strong className="font-display text-xl">P{report.worstFinish}</strong></>
                )}
              </li>
              <li>
                Top fives <strong className="font-display text-xl"><AnimatedStat value={report.top5} /></strong> from{' '}
                <strong className="font-display text-xl"><AnimatedStat value={report.starts} /></strong> starts
              </li>
              {report.incidents != null && (
                <li>
                  <strong className="font-display text-xl"><AnimatedStat value={report.incidents} /></strong> incident
                  points across {whose} season
                </li>
              )}
            </ul>
          </div>

          <Link to={'/compare?a=' + driver.id} className="hcr-btn hcr-btn-ghost w-full">
            Compare with another driver →
          </Link>
        </aside>
      </div>
    </>
  )
}

/**
 * The round chips. `max-w` matters: with `flex-1` alone a single early-season round
 * stretched to the full width of the row for a card holding "P2" and two numbers.
 */
function SeasonForm({ form, color }: { form: RoundForm[]; color: string }) {
  return (
    <ol className="mt-5 flex flex-wrap gap-2.5">
      {form.map((f, i) => {
        const win = f.clsPos === 1
        const pod = f.clsPos != null && f.clsPos <= 3
        return (
          <li
            key={`${f.round}-${i}`}
            title={`${f.label} — ${f.dnf ? 'DNF' : f.clsPos != null ? `P${f.clsPos}` : '—'} · ${f.points} pts`}
            className="group relative min-w-[92px] max-w-[150px] flex-1 rounded-2xl border p-4 transition-transform hover:-translate-y-0.5"
            style={{
              borderColor: win ? color : 'var(--color-line)',
              background: win ? `${color}1a` : 'var(--color-paper)',
            }}
          >
            <span className="sr-only">{f.label}</span>
            <div className="font-body text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
              R{f.round}
            </div>
            <div className="mt-1 font-display text-3xl leading-none">
              {f.dnf ? <span className="text-[var(--color-red)]">DNF</span> : f.clsPos != null ? `P${f.clsPos}` : '—'}
            </div>
            <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px]">
              {f.gained != null && f.gained !== 0 && (
                <span className={f.gained > 0 ? 'text-[var(--color-green)]' : 'text-[var(--color-red)]'}>
                  {f.gained > 0 ? `▲${f.gained}` : `▼${-f.gained}`}
                </span>
              )}
              <span className="text-[var(--color-faint)]">{f.points}</span>
            </div>
            {pod && !win && <span className="absolute right-3 top-3 h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
          </li>
        )
      })}
    </ol>
  )
}

/* ---------------- shared results table (driver page, team page, portal) ---------------- */

export function StatRow({ items }: { items: [string, string | number][] }) {
  return (
    <StatBand
      stats={items.map(([label, value]) => (
        typeof value === 'number'
          ? { label, value }
          : { label, value: null, text: String(value) }
      ))}
    />
  )
}

export type ReportRow = RaceResult & {
  event?: { round: number; name: string | null; date?: string; track?: { name: string } | null } | null
}

export function ResultsTable({
  rows, classes, emptyLabel,
}: { rows: ReportRow[]; classes?: LeagueClass[]; emptyLabel: string }) {
  const cf = useColumnFilters<ReportRow>({
    round: (r) => r.event?.round,
    race: (r) => r.event?.name ?? r.event?.track?.name,
    class: (r) => r.class_id,
    finish: (r) => r.cls_pos,
    grid: (r) => r.grid,
    best: (r) => r.best_lap,
    status: (r) => r.status,
    pts: (r) => (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0),
  })
  const shown = cf.apply(rows)

  if (!rows.length) return <p className="text-[var(--color-muted)]">{emptyLabel}</p>
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-3xl">Round by round</h2>
        <ColumnFilterToggle ctl={cf} className="!py-1 !text-[11px]" />
      </div>
      <div className="relative overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[var(--color-paper)] sm:hidden" aria-hidden />
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Round by round results">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] bg-[var(--color-mist)] text-left font-body text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                <th className="px-4 py-3">Rnd</th>
                <th className="px-4 py-3">Race</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3 text-center">Finish</th>
                <th className="px-4 py-3 text-center">Grid</th>
                <th className="px-4 py-3">Best lap</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Pts</th>
              </tr>
              <ColumnFilterRow
                ctl={cf}
                cells={[
                  { key: 'round', label: 'Round' },
                  { key: 'race', label: 'Race' },
                  { key: 'class', label: 'Class' },
                  { key: 'finish', label: 'Finish' },
                  { key: 'grid', label: 'Grid' },
                  { key: 'best', label: 'Best lap' },
                  { key: 'status', label: 'Status' },
                  { key: 'pts', label: 'Points' },
                ]}
              />
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[var(--color-muted)]">
                    No rounds match these column filters.
                  </td>
                </tr>
              )}
              {shown.map((r) => {
                const rowColor = classColor(r.class_id, classes)
                return (
                  <tr key={r.id} className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-cloud)]">
                    <td className="tabular px-4 py-3.5 text-[var(--color-muted)]">{r.event?.round ?? '—'}</td>
                    <td className="px-4 py-3.5 font-body font-medium">
                      <span className="inline-flex items-center gap-2">
                        {r.event?.name ?? r.event?.track?.name ?? '—'}
                        {r.fill_in && (
                          <span className="rounded border border-[var(--color-line-2)] px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-[var(--color-muted)]" title="Fill-in drive — scores the Fill-In Cup">
                            Fill-In
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1.5 font-body text-[10px] font-semibold uppercase tracking-[0.12em]">
                        <span className="h-2 w-2 rounded-full" style={{ background: rowColor, boxShadow: 'inset 0 0 0 1px rgba(20,24,28,0.28)' }} />
                        {r.class_id}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center font-display text-2xl leading-none">
                      {r.cls_pos ? `P${r.cls_pos}` : '—'}
                    </td>
                    <td className="tabular px-4 py-3.5 text-center">{r.grid ?? '—'}</td>
                    <td className="tabular px-4 py-3.5">{r.best_lap ?? '—'}</td>
                    <td className="px-4 py-3.5 font-body">
                      <span className={r.status === 'DNF' ? 'font-semibold text-[var(--color-red)]' : 'text-[var(--color-muted)]'}>
                        {r.status ?? '—'}
                      </span>
                    </td>
                    <td className="tabular px-4 py-3.5 text-right font-semibold">
                      {(r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
