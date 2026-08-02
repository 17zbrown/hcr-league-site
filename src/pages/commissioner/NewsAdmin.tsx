import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { NewsArticle } from '../../lib/types'
import { dateKey } from '../../lib/format'
import { LoadError, Skeleton } from '../../components/ui'

const CATEGORIES = ['Race Report', 'Preview', 'Announcement', 'Feature']

/**
 * The live `news` table carries a `source` column ('manual' | 'auto-results' |
 * 'auto-preview') that the shared NewsArticle type predates. Extend locally so
 * this panel stays tsc-clean without touching lib/types.
 */
type NewsRow = NewsArticle & { source?: string | null }

/** Map raw Postgres errors to commissioner-friendly copy. */
function friendlyDbError(error: { code?: string; message: string }): string {
  return error.code === '23505'
    ? 'That slug is already in use — tweak it and save again.'
    : error.message
}

/** "Round 2: Chaos at Sebring!" → "round-2-chaos-at-sebring" */
function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function NewsAdmin() {
  const qc = useQueryClient()
  const { data: articles, isLoading, isError, refetch } = useQuery({
    queryKey: ['news', 'admin'],
    queryFn: async (): Promise<NewsRow[]> => {
      const { data, error } = await supabase
        .from('news')
        .select('*')
        .order('published_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as NewsRow[]
    },
  })

  // 'new' opens a blank editor; a row opens it prefilled. Keyed below so
  // switching articles remounts the form instead of leaking stale fields.
  const [editing, setEditing] = useState<NewsRow | 'new' | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['news'] })
    qc.invalidateQueries({ queryKey: ['news', 'admin'] })
  }

  if (isLoading) return <Skeleton className="h-96 w-full" />

  const list = articles ?? []
  const drafts = list.filter((a) => !a.is_published).length

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-3xl">Newsroom</h2>
        <button
          onClick={() => setEditing(editing === 'new' ? null : 'new')}
          className="hcr-btn hcr-btn-primary"
        >
          {editing === 'new' ? 'Close Editor' : '+ New Article'}
        </button>
      </div>
      <p className="mb-6 text-sm text-[var(--color-muted)]">
        Write, publish, pin, and retire league stories. Stories tagged{' '}
        <span className="font-bold">AUTO</span> were drafted by race control automation —
        review and publish them like anything else.
        {drafts > 0 && <> {drafts} draft{drafts === 1 ? '' : 's'} waiting.</>}
      </p>

      {editing !== null && (
        <ArticleEditor
          key={editing === 'new' ? 'new' : editing.id}
          article={editing === 'new' ? null : editing}
          onSaved={() => {
            invalidate()
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {isError ? (
        <LoadError what="the newsroom" onRetry={() => refetch()} />
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-10 text-center">
          <p className="mx-auto max-w-md text-sm text-[var(--color-muted)]">
            No stories yet. Hit <b>New Article</b> to write the first one — race reports
            drafted by automation will also land here for review.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((a) => (
            <ArticleRow
              key={a.id}
              article={a}
              isEditing={editing !== null && editing !== 'new' && editing.id === a.id}
              onEdit={() => setEditing(a)}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SourceBadge({ source }: { source?: string | null }) {
  if (source && source.startsWith('auto')) {
    return (
      <span
        title={source}
        className="rounded-full bg-[var(--color-brand)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-black"
      >
        Auto
      </span>
    )
  }
  return (
    <span className="rounded-full border border-[var(--color-line-2)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
      Manual
    </span>
  )
}

function ArticleRow({
  article,
  isEditing,
  onEdit,
  onChanged,
}: {
  article: NewsRow
  /** True while this article is open in the inline editor — mutations are locked. */
  isEditing: boolean
  onEdit: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const update = async (patch: Record<string, unknown>) => {
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('news').update(patch).eq('id', article.id)
    setBusy(false)
    if (error) {
      setErr(friendlyDbError(error))
      return
    }
    onChanged()
  }

  const togglePublish = () =>
    update(
      article.is_published
        ? { is_published: false }
        : // Publishing bumps the date so the story tops the public feed instead
          // of being buried under everything written while it sat in drafts.
          { is_published: true, published_at: new Date().toISOString() },
    )

  const togglePin = () => update({ pinned: !article.pinned })

  const remove = async () => {
    if (!confirm(`Delete "${article.title}"? This can't be undone.`)) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('news').delete().eq('id', article.id)
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    onChanged()
  }

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="hcr-chip">{article.category}</span>
            <SourceBadge source={article.source} />
            {article.pinned && (
              <span className="rounded-full bg-[var(--color-deep)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                Pinned
              </span>
            )}
            {!article.is_published && (
              <span className="rounded-full border border-dashed border-[var(--color-ink)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink)]">
                Draft
              </span>
            )}
            <span className="tabular text-xs text-[var(--color-muted)]">
              {dateKey(article.published_at)}
            </span>
          </div>
          <div className="mt-2 font-semibold leading-snug">{article.title}</div>
          {article.dek && (
            <p className="mt-1 line-clamp-2 text-sm text-[var(--color-muted)]">{article.dek}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={togglePublish}
            disabled={busy || isEditing}
            className="hcr-btn hcr-btn-ghost !py-2 !text-xs"
          >
            {article.is_published ? 'Unpublish' : 'Publish'}
          </button>
          <button
            onClick={togglePin}
            disabled={busy || isEditing}
            className="hcr-btn hcr-btn-ghost !py-2 !text-xs"
          >
            {article.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button onClick={onEdit} disabled={busy} className="hcr-btn hcr-btn-dark !py-2 !text-xs">
            Edit
          </button>
          <button
            onClick={remove}
            disabled={busy || isEditing}
            className="hcr-btn hcr-btn-ghost !py-2 !text-xs !text-[var(--color-red)]"
          >
            Delete
          </button>
        </div>
      </div>
      {err && <p className="mt-2 text-xs text-[var(--color-red)]">{err}</p>}
    </div>
  )
}

function ArticleEditor({
  article,
  onSaved,
  onCancel,
}: {
  article: NewsRow | null
  onSaved: () => void
  onCancel: () => void
}) {
  const isNew = article === null
  const [title, setTitle] = useState(article?.title ?? '')
  const [slug, setSlug] = useState(article?.slug ?? '')
  // Once the commissioner types a slug by hand, stop shadowing it from the title.
  const [slugTouched, setSlugTouched] = useState(!isNew)
  const [category, setCategory] = useState(article?.category ?? 'Race Report')
  const [dek, setDek] = useState(article?.dek ?? '')
  const [body, setBody] = useState(article?.body_md ?? '')
  const [pinned, setPinned] = useState(article?.pinned ?? false)
  const [published, setPublished] = useState(article?.is_published ?? true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const onTitle = (v: string) => {
    setTitle(v)
    if (isNew && !slugTouched) setSlug(kebab(v))
  }

  const save = async () => {
    const cleanTitle = title.trim()
    // Normalize hand-typed slugs too — the DB doesn't care, but URLs do.
    const cleanSlug = kebab(slug) || kebab(cleanTitle)
    if (!cleanTitle) {
      setErr('Give the story a title before saving.')
      return
    }
    if (!cleanSlug) {
      setErr('Slug came out empty — type one, or use letters/numbers in the title.')
      return
    }
    setBusy(true)
    setErr(null)
    const payload: Record<string, unknown> = {
      title: cleanTitle,
      slug: cleanSlug,
      category,
      dek: dek.trim() || null,
      body_md: body,
      pinned,
      is_published: published,
    }
    // Draft → live in the editor gets a fresh date, same as the row toggle.
    // (New published rows get published_at from the DB default.)
    if (article && published && !article.is_published) {
      payload.published_at = new Date().toISOString()
    }
    // `.select()` on the update returns the touched rows, so a vanished row
    // (deleted in another tab) reads as an empty array instead of a silent no-op.
    const res = article
      ? await supabase.from('news').update(payload).eq('id', article.id).select()
      : await supabase.from('news').insert(payload)
    setBusy(false)
    if (res.error) {
      setErr(friendlyDbError(res.error))
      return
    }
    if (article && (res.data ?? []).length === 0) {
      setErr('This story no longer exists — it may have been deleted.')
      return
    }
    onSaved()
  }

  return (
    <div className="mb-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl">{isNew ? 'New Article' : 'Edit Article'}</h3>
        {!isNew && <SourceBadge source={article.source} />}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
            Title
          </span>
          <input
            className="hcr-input"
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder="Round 2: Chaos at Sebring"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
            Slug
          </span>
          <input
            className="hcr-input font-mono !text-sm"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              setSlugTouched(true)
            }}
            placeholder="round-2-chaos-at-sebring"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
            Category
          </span>
          <select className="hcr-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
            Dek — one-line standfirst under the headline
          </span>
          <textarea
            className="hcr-textarea !min-h-20"
            value={dek}
            onChange={(e) => setDek(e.target.value)}
            placeholder="Optional. A sentence setting up the story."
          />
        </label>

        <label className="block md:col-span-2">
          <span className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
            Body — paragraphs separated by blank lines
          </span>
          <textarea
            className="hcr-textarea !min-h-72 font-mono !text-sm"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={'The green flag dropped at...\n\nSecond paragraph...'}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="h-5 w-5 accent-[var(--color-blue)]"
          />
          Published
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="h-5 w-5 accent-[var(--color-blue)]"
          />
          Pinned to the top of the feed
        </label>
        <div className="ml-auto flex gap-2">
          <button onClick={onCancel} disabled={busy} className="hcr-btn hcr-btn-ghost">
            Cancel
          </button>
          <button onClick={save} disabled={busy} className="hcr-btn hcr-btn-primary">
            {busy ? 'Saving…' : isNew ? 'Create Article' : 'Save Changes'}
          </button>
        </div>
      </div>
      {err && (
        <p className="mt-3 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
          {err}
        </p>
      )}
    </div>
  )
}
