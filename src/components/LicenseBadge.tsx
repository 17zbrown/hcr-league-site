import { LICENSE_CLASSES, LICENSE_COLOR, LICENSE_ORDER, type License, type LicenseInfo } from '../lib/license'

/** Small tinted chip showing a driver's license tier. */
export function LicenseBadge({ tier, size = 'sm', title }: { tier: License; size?: 'sm' | 'xs'; title?: string }) {
  const color = LICENSE_COLOR[tier]
  const pad = size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-body font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)] ${pad}`}
      style={{ background: `${color}22` }}
      title={title}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {tier}
    </span>
  )
}

/** License badge + progress bar toward the next tier (for the driver profile). */
export function LicenseProgress({ info }: { info: LicenseInfo }) {
  const color = LICENSE_COLOR[info.effective]
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
      <div className="flex items-center justify-between">
        <span className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">License</span>
        <LicenseBadge tier={info.effective} />
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-mist)]">
        <div className="h-full rounded-full" style={{ width: `${Math.round(info.progress * 100)}%`, background: color }} />
      </div>
      <div className="mt-2 font-mono text-xs text-[var(--color-faint)]">
        {info.isOverride ? (
          <>Set by commissioner · earned tier {info.computed}</>
        ) : info.next ? (
          <>{info.credits} credits · {info.toNext} to {info.next}</>
        ) : (
          <>Top tier reached · {info.credits} credits</>
        )}
      </div>

      {/* tier ladder */}
      <div className="mt-4 flex gap-1">
        {LICENSE_ORDER.map((t) => {
          const active = t === info.effective
          const c = LICENSE_COLOR[t]
          return (
            <div
              key={t}
              className="flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-center font-body text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{
                background: active ? `${c}26` : 'var(--color-mist)',
                color: active ? 'var(--color-ink)' : 'var(--color-muted)',
              }}
              title={`${t} — eligible for ${LICENSE_CLASSES[t]}`}
            >
              {active && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />}
              {t.slice(0, 3)}
            </div>
          )
        })}
      </div>

      {/* how credits are earned */}
      <p className="mt-3 text-xs leading-relaxed text-[var(--color-muted)]">
        Licenses are earned automatically from race results — every round adds credits for
        <strong className="text-[var(--color-ink-2)]"> finishing position</strong>,
        <strong className="text-[var(--color-ink-2)]"> pace vs. the class field</strong>,
        <strong className="text-[var(--color-ink-2)]"> qualifying</strong> and
        <strong className="text-[var(--color-ink-2)]"> clean, low-incident racing</strong>.
        Climb from Bronze to Platinum over a couple of seasons of strong, safe pace.
      </p>
    </div>
  )
}
