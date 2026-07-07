import { Link } from 'react-router-dom'
import { useLeagueSettings } from '../lib/queries'
import { Section } from '../components/ui'

const LADDER = [
  { cat: 'Bronze', classes: 'GTD', desc: 'Entry FIA category. Runs in the GTD class.' },
  { cat: 'Silver', classes: 'GTD · LMP2', desc: 'Eligible for GTD and LMP2.' },
  { cat: 'Gold', classes: 'LMP2 · GTP', desc: 'Eligible for LMP2 and the top GTP class.' },
  { cat: 'Platinum', classes: 'GTP', desc: 'Top-tier category. Runs in GTP.' },
]

export default function SignUp() {
  const { data: settings } = useLeagueSettings()

  return (
    <>
      <section className="border-b border-[var(--color-line)]">
        <div className="container-hcr grid gap-8 py-16 md:grid-cols-[1.2fr_0.8fr] md:py-20">
          <div>
            <div className="eyebrow mb-4">Season registration</div>
            <h1 className="text-6xl md:text-7xl">Join the grid</h1>
            <p className="mt-6 max-w-lg text-lg text-[var(--color-muted)]">
              Registration for the season is handled through the league. Your FIA license
              category determines which classes you're eligible to race — from Bronze in GTD
              up to Platinum in GTP.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {settings?.discord_url && (
                <a
                  href={settings.discord_url}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-[var(--color-brand)] px-6 py-3 font-display text-xl uppercase tracking-wide text-black transition-transform hover:-translate-y-0.5"
                >
                  Register on Discord
                </a>
              )}
              <Link
                to="/schedule"
                className="border border-[var(--color-line-2)] px-6 py-3 font-display text-xl uppercase tracking-wide hover:border-[var(--color-brand)]"
              >
                See the Calendar
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Section eyebrow="Eligibility" title="The license ladder" className="scroll-mt-20">
        <div className="grid gap-3 md:grid-cols-4">
          {LADDER.map((l, i) => (
            <div key={l.cat} className="border border-[var(--color-line)] bg-[var(--color-ink-2)] p-5">
              <div className="tabular text-sm text-[var(--color-muted)]">0{i + 1}</div>
              <div className="mt-2 font-display text-3xl">{l.cat}</div>
              <div className="mt-1 font-mono text-xs uppercase tracking-wider text-[var(--color-brand)]">
                {l.classes}
              </div>
              <p className="mt-3 text-sm text-[var(--color-muted)]">{l.desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-[var(--color-muted-2)]">
          A full in-site registration form is on the way — for now the fastest way in is the
          Discord.
        </p>
      </Section>
    </>
  )
}
