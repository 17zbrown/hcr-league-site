import type { Achievement } from '../lib/achievements'
import { AnimatedStat } from './editorial'

/* ------------------------------------------------------------------ *
 * Trophy cabinet — a grid of small achievement cards. Earned cards get
 * a brand-yellow medal mark and a hover lift; locked cards sit quiet on
 * mist with the blurb doubling as the hint.
 * ------------------------------------------------------------------ */

function MedalMark() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" className="shrink-0" aria-hidden="true">
      <circle
        cx="12"
        cy="9.5"
        r="6.25"
        fill="var(--color-brand)"
        stroke="var(--color-brand-deep)"
        strokeWidth="1.2"
      />
      <path
        d="M9.2 14.8 7.6 20.6l4.4-2.3 4.4 2.3-1.6-5.8"
        fill="none"
        stroke="var(--color-brand-deep)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="m12 6.4.85 1.72 1.9.28-1.38 1.34.33 1.9L12 10.74l-1.7.9.33-1.9-1.38-1.34 1.9-.28z"
        fill="var(--color-brand-deep)"
      />
    </svg>
  )
}

function LockMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      className="shrink-0 text-[var(--color-faint)]"
      aria-hidden="true"
    >
      <rect x="6.5" y="10.5" width="11" height="8.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9 10.5V8a3 3 0 0 1 6 0v2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="14.75" r="1.1" fill="currentColor" />
    </svg>
  )
}

export function AchievementGallery({ achievements }: { achievements: Achievement[] }) {
  const earned = achievements.filter((a) => a.earned).length

  return (
    <div>
      <p className="font-body text-sm text-[var(--color-muted)]">
        <AnimatedStat
          value={earned}
          className="mr-1 align-baseline font-display text-3xl leading-none text-[var(--color-ink)]"
        />
        of {achievements.length} unlocked
      </p>

      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {achievements.map((a) => (
          <li
            key={a.id}
            className={
              a.earned
                ? 'rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4 transition-transform hover:-translate-y-0.5'
                : 'rounded-2xl border border-[var(--color-line-2)] bg-[var(--color-mist)] p-4'
            }
          >
            <div className="flex items-start gap-3">
              {a.earned ? <MedalMark /> : <LockMark />}
              <div className="min-w-0">
                <div
                  className={`font-body text-sm font-semibold ${
                    a.earned ? 'text-[var(--color-ink)]' : 'text-[var(--color-faint)]'
                  }`}
                >
                  {a.name}
                  <span className="sr-only">{a.earned ? ' — unlocked' : ' — locked'}</span>
                </div>
                <p
                  className={`mt-1 font-body text-xs leading-relaxed ${
                    a.earned ? 'text-[var(--color-muted)]' : 'text-[var(--color-faint)]'
                  }`}
                >
                  {a.blurb}
                </p>
                {a.earned && a.detail && (
                  <p className="tabular mt-1.5 text-[11px] text-[var(--color-brand-deep)]">{a.detail}</p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default AchievementGallery
