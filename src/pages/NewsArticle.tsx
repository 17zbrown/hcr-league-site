import { Link, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useNews } from '../lib/queries'
import { LoadError, Section, Skeleton } from '../components/ui'
import { ArticleCard } from './News'

/**
 * One story at its own address.
 *
 * The feed used to be the only address news had — every share, search hit and
 * social unfurl pointed at the top of /news, and the pinned-first sort meant the
 * story on top was often not the story shared. A real route gives each article a
 * link that survives being pasted into Discord, a title of its own, and OG meta
 * the edge function can answer for crawlers.
 *
 * Reuses the feed's query (one cache, one shape) and the same ArticleCard, so an
 * article cannot render differently here than it does in the feed. The old
 * /news#<slug> anchors still work — ScrollToTop handles them — so nothing already
 * posted to Discord breaks.
 */
export default function NewsArticle() {
  const { slug } = useParams()
  const { data: articles, isLoading, isError, refetch } = useNews()
  const article = (articles ?? []).find((a) => a.slug === slug)

  useEffect(() => {
    if (article) document.title = `${article.title} — HCR League`
  }, [article])

  return (
    <Section eyebrow="League news" title="News" titleTag="h1">
      <div className="mx-auto max-w-4xl">
        <Link to="/news" className="mb-6 inline-block font-body text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)]">
          ← All news
        </Link>
        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : isError ? (
          <LoadError what="this story" onRetry={() => void refetch()} />
        ) : !article ? (
          <p className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-10 text-center text-[var(--color-muted)]">
            That story doesn't exist — it may have been unpublished.{' '}
            <Link to="/news" className="font-semibold text-[var(--color-blue)]">Browse the news feed →</Link>
          </p>
        ) : (
          <ArticleCard article={article} />
        )}
      </div>
    </Section>
  )
}
