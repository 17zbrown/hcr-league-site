import { LICENSE_COLOR, type License, type LicenseInfo } from '../lib/license'

/** Small tinted chip showing a driver's license tier. */
export function LicenseBadge({ tier, size = 'sm', title }: { tier: License; size?: 'sm' | 'xs'; title?: string }) {
  const color = LICENSE_COLOR[tier]
  const pad = size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-mono font-bold uppercase tracking-wider ${pad}`}
      style={{ background: `${color}1f`, color }}
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
        <span className="font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">License</span>
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
    </div>
  )
}
