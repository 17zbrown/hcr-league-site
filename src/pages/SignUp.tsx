import { Link } from 'react-router-dom'
import { useLeagueSettings } from '../lib/queries'
import { useAuth } from '../lib/auth'
import { Section } from '../components/ui'
import { Reveal } from '../components/motion'
import { DiscordButton } from '../components/DiscordButton'

/**
 * The iRacing league this site is the front end for.
 *
 * Signing up here does NOT put you in the race session — iRacing keeps its own
 * membership, and a driver who has done everything on this website is still not on
 * the grid until they are in the league there. That step used to be missing from
 * this page entirely, which is the one gap that actually stops somebody racing.
 */
const IRACING_LEAGUE_ID = '14470'

/**
 * The licence ladder, described as what it IS rather than what it sounds like.
 *
 * It used to read "Entry FIA category. Runs in the GTD class." / "Eligible for GTD
 * and LMP2." — which told every new driver that they could not pick GTP. That was
 * never true. src/lib/license.ts says so in its own header ("purely a level
 * show-piece for now — they don't gate car/class eligibility"), the entry form has
 * never checked a licence, and the live grid proves it: every driver in the league
 * currently holds Bronze, and eleven of them are in GTP.
 *
 * Telling a prospective member they are barred from the class they want, on the
 * strength of a rule that does not exist, is the most expensive sentence on the
 * site. So the ladder now describes the class each tier is CALIBRATED around, and
 * the note underneath says plainly that the choice is theirs.
 */
const LADDER = [
  { cat: 'Bronze', classes: 'GTD', desc: 'Where everyone starts. Nothing to earn first — enter and race.' },
  { cat: 'Silver', classes: 'GTD · LMP2', desc: 'Roughly half a season of steady, clean running.' },
  { cat: 'Gold', classes: 'LMP2 · GTP', desc: 'A strong full season — front-running pace, kept clean.' },
  { cat: 'Platinum', classes: 'GTP', desc: 'A season and a bit at the sharp end. Rare, and meant to be.' },
]

const STEPS = [
  {
    n: '01',
    title: 'Sign in with Discord',
    body: 'The same account you use in the server — there is nothing to create and no password to pick. It links your results, your licence and your entry to one profile.',
  },
  {
    n: '02',
    title: 'Enter the season',
    body: 'From your portal. Pick your class and car, and two car numbers — numbers are league-wide and first come, first served, so the second is there for when your first is taken. Have your iRacing name and customer ID to hand.',
  },
  {
    n: '03',
    title: 'Join the league on iRacing',
    body: `Separate from this site, and the step people miss. Race control sends an iRacing league invite once you have entered — accept it from your iRacing account, or find us in the Leagues directory as HCR League, league ID ${IRACING_LEAGUE_ID}. Until you are in the league there, you cannot join the race session.`,
  },
  {
    n: '04',
    title: 'Turn up',
    body: 'Race control confirms your grid slot and your Discord nickname updates itself to your iRacing name and car number. Before each round the server asks who is racing — press a button and you are counted.',
  },
]

export default function SignUp() {
  const { data: settings } = useLeagueSettings()
  const { session } = useAuth()

  return (
    <>
      <section className="container-hcr py-16 md:py-24">
        <Reveal>
          <div className="mb-5 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
            Season registration
          </div>
          <h1 className="max-w-3xl text-6xl md:text-8xl">Join the grid</h1>
          <p className="mt-7 max-w-xl text-lg text-[var(--color-muted)]">
            Three-class endurance racing — GTP, LMP2 and GTD share one track and score three
            separate championships. Four steps from here to the grid, and they take about ten
            minutes between them.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            {/* Signed in, there is a season to enter; signed out, the only step is
                Discord — so offer that directly instead of routing through /login
                to press the same button there. */}
            {session ? (
              <Link to="/portal" className="hcr-btn hcr-btn-primary px-7">
                Enter the Season
              </Link>
            ) : (
              <DiscordButton />
            )}
            {settings?.discord_url && (
              <a
                href={settings.discord_url}
                target="_blank"
                rel="noreferrer"
                className="hcr-btn hcr-btn-ghost px-7"
              >
                Join the Discord
              </a>
            )}
          </div>
        </Reveal>
      </section>

      <Section eyebrow="How it works" title="From here to the grid">
        <ol className="grid gap-px overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.08} y={0} className="h-full bg-[var(--color-paper)]">
              <li className="flex h-full flex-col p-6">
                <div className="tabular text-sm text-[var(--color-faint)]">{s.n}</div>
                <h3 className="mt-2 font-display text-2xl leading-tight">{s.title}</h3>
                <p className="mt-3 text-sm text-[var(--color-muted)]">{s.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </Section>

      <div className="on-navy bg-[var(--color-deep)]">
        <Section eyebrow="Progression" title="The license ladder">
          <p className="mb-8 max-w-2xl text-[var(--color-muted)]">
            Licences are earned from race results — finishing position, pace against the fastest
            car in your class, qualifying and incident count — and they are recognition, not a
            gate. Pick whichever class you want to race when you enter.
          </p>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 md:grid-cols-4">
            {LADDER.map((l, i) => (
              <Reveal key={l.cat} delay={i * 0.08} y={0} className="h-full bg-[var(--color-paper)]">
                <div className="flex h-full flex-col p-6">
                  <div className="tabular text-sm text-[var(--color-faint)]">0{i + 1}</div>
                  <div className="mt-2 font-display text-3xl">{l.cat}</div>
                  <div className="mb-4 mt-3 flex flex-wrap gap-1.5">
                    {l.classes.split(' · ').map((c) => (
                      <span key={c} className="hcr-chip">
                        {c}
                      </span>
                    ))}
                  </div>
                  <p className="mt-auto border-t border-[var(--color-line)] pt-3 text-sm text-[var(--color-muted)]">
                    {l.desc}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mt-6 text-sm text-[var(--color-faint)]">
            You must be signed in as a member to enter, and race control confirms every grid slot.
          </p>
        </Section>
      </div>
    </>
  )
}
