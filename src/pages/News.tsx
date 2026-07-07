import { Section } from '../components/ui'

export default function News() {
  return (
    <Section eyebrow="Paddock notes · Newsletters" title="News">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-12 text-center">
        <p className="mx-auto max-w-md text-[var(--color-muted)]">
          League newsletters and race reports land here. The commissioner will publish the first
          edition shortly — check back after the next round.
        </p>
      </div>
    </Section>
  )
}
