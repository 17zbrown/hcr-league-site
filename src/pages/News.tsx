import type { ReactNode } from 'react'
import { inline } from '../lib/richtext'
import { Link } from 'react-router-dom'
import { useNews } from '../lib/queries'
import { parseClipUrl } from '../lib/evidence'
import type { NewsArticle, NewsMedia } from '../lib/types'
import { fmtDateLong } from '../lib/format'
import { LoadError, Section, Skeleton } from '../components/ui'
import { Reveal } from '../components/motion'

/**
 * The slice of Markdown the newsroom actually writes: `## headings`, `**bold**` and
 * `- bullets`. Nothing else — no links, no numbered lists, no quotes, checked against
 * every stored article.
 *
 * Deliberately not a Markdown library. The composers emit exactly these three
 * constructs, and parsing them is thirty lines against a dependency that would ship a
 * whole CommonMark engine to render three tags. It builds React nodes rather than
 * HTML, so an article can never inject markup however it is written.
 *
 * Before this existed the body was printed verbatim, so every race report and
 * auto-preview showed its own `##` and `**` to the reader.
 */

function ArticleBody({ body }: { body: string }) {
  const nodes: ReactNode[] = []
  let para: string[] = []
  let bullets: string[] = []

  const flushPara = (k: string) => {
    if (!para.length) return
    // Single newlines inside a paragraph are soft wraps, the way Markdown reads them.
    nodes.push(<p key={k}>{inline(para.join(' '), k)}</p>)
    para = []
  }
  const flushList = (k: string) => {
    if (!bullets.length) return
    nodes.push(
      <ul key={k} className="ml-5 list-disc space-y-1.5">
        {bullets.map((b, j) => <li key={j}>{inline(b, `${k}-${j}`)}</li>)}
      </ul>,
    )
    bullets = []
  }

  body.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    const bullet = line.match(/^[-*]\s+(.*)$/)

    if (!line) { flushList(`l${i}`); flushPara(`p${i}`); return }
    if (heading) {
      flushList(`l${i}`); flushPara(`p${i}`)
      nodes.push(
        <h3 key={`h${i}`} className="!mt-8 font-display text-xl tracking-tight text-[var(--color-ink)]">
          {inline(heading[1], `h${i}`)}
        </h3>,
      )
      return
    }
    if (bullet) { flushPara(`p${i}`); bullets.push(bullet[1]); return }
    flushList(`l${i}`); para.push(line)
  })
  flushList('l-end')
  flushPara('p-end')

  if (!nodes.length) return null
  return (
    <div className="mt-6 max-w-prose space-y-4 font-body leading-relaxed text-[var(--color-ink-2)]">
      {nodes}
    </div>
  )
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
export function ArticleCard({ article }: { article: NewsArticle }) {
  const feature = article.pinned
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
            <span className="rounded-full bg-[var(--color-brand)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
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
          <Link to={`/news/${article.slug}`} className="underline-offset-4 hover:underline">
            {article.title}
          </Link>
        </h2>
        {article.dek && (
          <p className="mt-4 max-w-2xl font-body text-lg leading-relaxed text-[var(--color-ink-2)]">
            {article.dek}
          </p>
        )}
        <ArticleBody body={article.body_md} />
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
