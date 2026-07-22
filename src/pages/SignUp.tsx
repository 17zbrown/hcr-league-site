import { Link } from 'react-router-dom'
import { useLeagueSettings } from '../lib/queries'
import { useAuth } from '../lib/auth'
import { Section } from '../components/ui'
import { Reveal } from '../components/motion'

const LADDER = [
  { cat: 'Bronze', classes: 'GTD', desc: 'Entry FIA category. Runs in the GTD class.' },
  { cat: 'Silver', classes: 'GTD · LMP2', desc: 'Eligible for GTD and LMP2.' },
  { cat: 'Gold', classes: 'LMP2 · GTP', desc: 'Eligible for LMP2 and the top GTP class.' },
  { cat: 'Platinum', classes: 'GTP', desc: 'Top-tier category. Runs in GTP.' },
]

export default function SignUp() {
  const { data: settings } = useLeagueSettings()
  const { session } = useAuth()

  return (
    <>
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(55% 55% at 82% -10%, rgba(242,225,20,0.16), transparent 62%)' }}
        />
        <div className="container-hcr relative py-16 md:py-24">
          <Reveal>
            <div className="mb-5 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Season registration</div>
            <h1 className="max-w-3xl text-6xl md:text-8xl">Join the grid</h1>
            <p className="mt-7 max-w-lg text-lg text-[var(--color-muted)]">
              Create a member account, then enter the season from your account page. Every driver
              starts on a Bronze license and earns upgrades from race results — pace, safety and
              finishing position — climbing from GTD up to GTP. Team managers sign drivers from the
              free-agent pool.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                to={session ? '/account' : '/login'}
                className="shadow-glow rounded-xl bg-[var(--color-brand)] px-7 py-3.5 font-alt text-sm font-bold uppercase tracking-wide text-black transition-transform hover:-translate-y-1"
              >
                {session ? 'Enter the Season' : 'Create Account & Enter'}
              </Link>
              {settings?.discord_url && (
                <a
                  href={settings.discord_url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-[var(--color-line-2)] px-7 py-3.5 font-alt text-sm font-bold uppercase tracking-wide text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink)]"
                >
                  Join the Discord
                </a>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      <div className="bg-[var(--color-mist)]">
        <Section eyebrow="Eligibility" title="The license ladder">
          <div className="grid gap-px overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 md:grid-cols-4">
            {LADDER.map((l, i) => (
              <Reveal key={l.cat} delay={i * 0.08} y={0} className="h-full bg-[var(--color-paper)]">
                <div className="flex h-full flex-col p-6">
                  <div className="tabular text-sm text-[var(--color-faint)]">0{i + 1}</div>
                  <div className="mt-2 font-display text-3xl">{l.cat}</div>
                  <div className="mt-1 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-blue)]">{l.classes}</div>
                  <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-sm text-[var(--color-muted)]">{l.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mt-6 text-sm text-[var(--color-faint)]">
            You must be signed in as a member to enter. The commissioner confirms grid slots and
            can grant team-manager access.
          </p>
        </Section>
      </div>
    </>
  )
}
