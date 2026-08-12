import { Link } from 'react-router-dom'
import { useNews } from '../lib/queries'
import { parseClipUrl } from '../lib/evidence'
import type { NewsArticle, NewsMedia } from '../lib/types'
import { fmtDateLong } from '../lib/format'
import { LoadError, Section, Skeleton } from '../components/ui'
import { Reveal } from '../components/motion'

/** Plain paragraphs from the stored body — split on blank lines, no markdown lib. */
function paragraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

/**
 * Attachments on a story.
 *
 * Video is `preload="metadata"` and never autoplays: a news feed can hold several
 * stories, and pulling 50MB per clip on page load to play none of them is the kind
 * of thing that makes a site feel broken on a phone. The browser fetches a poster
 * frame, and the bytes only follow a deliberate press of play.
 */
function MediaStrip({ media }: { media: NewsMedia[] }) {
  if (!media.length) return null
  // A lone attachment gets the full width; a set becomes a two-up gallery.
  const solo = media.length === 1
  return (
    <div className={`mt-6 grid gap-3 ${solo ? '' : 'sm:grid-cols-2'}`}>
      {media.map((m) => (
        <figure key={m.id} className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-mist)]">
          {m.kind === 'image' ? (
            <img
              src={m.url}
              alt={m.caption ?? ''}
              loading="lazy"
              className="block max-h-[70vh] w-full object-contain"
            />
          ) : m.kind === 'video' ? (
            <video
              src={m.url}
              controls
              playsInline
              preload="metadata"
              className="block max-h-[70vh] w-full bg-black"
            />
          ) : (
            <div className="relative aspect-video">
              <iframe
                src={parseClipUrl(m.url).embedUrl ?? undefined}
                title={m.caption ?? 'Clip'}
                loading="lazy"
                allowFullScreen
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
          )}
          {m.caption && (
            <figcaption className="px-3 py-2 text-xs text-[var(--color-muted)]">{m.caption}</figcaption>
          )}
        </figure>
      ))}
    </div>
  )
}

/** One story. Pinned articles render as the black feature panel. */
function ArticleCard({ article }: { article: NewsArticle }) {
  const feature = article.pinned
  const paras = paragraphs(article.body_md)
  return (
    <article
      // The anchor every Discord news ping now points at. Without an id on the
      // article, a ping about round 5 dropped the reader at the top of the feed —
      // sometimes on a different story entirely.
      id={article.slug}
      className={
        feature
          ? 'on-navy relative overflow-hidden rounded-2xl bg-[var(--color-deep)] shadow-card'
          : 'overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]'
      }
    >
      {feature && <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden />}
      <div className="relative p-6 md:p-10">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="hcr-chip">{article.category}</span>
          {feature && (
            <span className="rounded-full bg-[var(--color-brand)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-black">
              Pinned
            </span>
          )}
          <span className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
            {fmtDateLong(article.published_at)}
            <span aria-hidden> · </span>
            By {article.author}
          </span>
        </div>
        <h2 className={`mt-5 max-w-3xl ${feature ? 'text-4xl md:text-6xl' : 'text-3xl md:text-5xl'}`}>
          {article.title}
        </h2>
        {article.dek && (
          <p className="mt-4 max-w-2xl font-body text-lg leading-relaxed text-[var(--color-ink-2)]">
            {article.dek}
          </p>
        )}
        {paras.length > 0 && (
          <div className="mt-6 max-w-prose space-y-4 font-body leading-relaxed text-[var(--color-ink-2)]">
            {paras.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}
        <MediaStrip media={article.media ?? []} />
      </div>
      {article.event_id && (
        <Link
          to={`/schedule/${article.event_id}`}
          className="relative flex min-h-11 items-center justify-between border-t border-[var(--color-line)] px-6 py-4 font-alt text-xs font-bold uppercase tracking-wider text-[var(--color-ink)] transition-colors hover:bg-[var(--color-cloud)] md:px-10"
        >
          Race details
          <span aria-hidden>&rarr;</span>
        </Link>
      )}
    </article>
  )
}

/**
 * League news feed — pinned stories first (the hook pre-sorts), then newest.
 *
 * ONE NAME: "News", at /news. The feed used to answer to five of them — Reports in
 * the nav, "News & Reports" here, "Paddock notes" above it, "Paddock news" on the
 * homepage, "Story" in search — while everything outside the app (the #news channel,
 * its topic, every Discord embed link) only ever said news. /reports still resolves,
 * as a redirect, so the old links keep working.
 */
export default function News() {
  const { data: articles, isLoading, isError, refetch } = useNews()
  const list = articles ?? []

  return (
    <Section
      eyebrow={
        list.length > 0
          ? `${list.length} ${list.length === 1 ? 'story' : 'stories'}`
          : 'League news'
      }
      title="News"
      titleTag="h1"
    >
      {isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : isError ? (
        <LoadError what="the news feed" onRetry={() => refetch()} />
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-12 text-center">
          <p className="mx-auto max-w-md text-[var(--color-muted)]">
            League news lands here as it's published. Check back once the next round is
            in the books.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {list.map((a, i) => (
            <Reveal key={a.id} delay={Math.min(i * 0.05, 0.3)}>
              <ArticleCard article={a} />
            </Reveal>
          ))}
        </div>
      )}
    </Section>
  )
}
