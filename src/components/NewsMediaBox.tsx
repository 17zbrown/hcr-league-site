import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseClipUrl } from '../lib/evidence'
import {
  ACCEPTED_ALL, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES,
  isVideo, prettyBytes, rejectReason, storageKey,
} from '../lib/newsMedia'
import type { NewsMedia } from '../lib/types'

/**
 * Photo / video attachments for a news article.
 *
 * Uploads go straight to the news-media bucket from the browser, so a 50MB video
 * never passes through an edge function with a request timeout. The row in
 * news_media is written by the caller when the article saves — this component only
 * hands back the list, which is what lets an upload be undone before saving without
 * leaving a database row pointing at nothing.
 *
 * ORDER MATTERS AND IS EXPLICIT. `sort` is assigned from array position on save
 * rather than by created_at, because the obvious thing an editor wants is to drag a
 * photo to the front and have the article lead with it.
 */
export function NewsMediaBox({
  newsId,
  items,
  onChange,
  disabled,
}: {
  /** The article these attach to — used as the storage folder, so deleting an
   *  article's files later is one prefix rather than a scavenger hunt. */
  newsId: string
  items: NewsMedia[]
  onChange: (next: NewsMedia[]) => void
  disabled?: boolean
}) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  /** Storage paths uploaded during THIS editing session — the only files this
   *  component may delete, because they exist nowhere else yet. */
  const sessionUploads = useRef<Set<string>>(new Set())

  const addFiles = async (files: FileList | File[]) => {
    setErr(null)
    const list = Array.from(files)
    // Check everything BEFORE uploading anything: a rejected third file should not
    // leave the first two half-attached.
    for (const f of list) {
      const why = rejectReason(f)
      if (why) { setErr(why); return }
    }

    setBusy(true)
    const added: NewsMedia[] = []
    for (const [i, f] of list.entries()) {
      setProgress(`Uploading ${f.name} (${prettyBytes(f.size)})${list.length > 1 ? ` — ${i + 1} of ${list.length}` : ''}…`)
      const path = storageKey(newsId, f)
      const { error } = await supabase.storage.from('news-media').upload(path, f, {
        upsert: false,
        contentType: f.type,
        cacheControl: '31536000', // a year: the URL carries a uuid, so it never changes meaning
      })
      if (error) {
        setErr(
          /exceeded|too large|413/i.test(error.message)
            ? `${f.name} was refused as too large. Photos cap at ${prettyBytes(MAX_IMAGE_BYTES)}, video at ${prettyBytes(MAX_VIDEO_BYTES)}.`
            : `${f.name} didn't upload — ${error.message}`,
        )
        break
      }
      const { data } = supabase.storage.from('news-media').getPublicUrl(path)
      sessionUploads.current.add(path)
      added.push({
        id: crypto.randomUUID(),
        news_id: newsId,
        kind: isVideo(f.type) ? 'video' : 'image',
        url: data.publicUrl,
        storage_path: path,
        caption: null,
        sort: items.length + added.length,
      })
    }
    setBusy(false)
    setProgress(null)
    if (added.length) onChange([...items, ...added])
  }

  const addLink = () => {
    const v = link.trim()
    if (!v) return
    const info = parseClipUrl(v)
    if (!info.embedUrl) {
      setErr(`That link isn't a YouTube, Twitch, Streamable or Medal clip, so it can't be embedded. Paste one of those, or upload the file itself.`)
      return
    }
    onChange([...items, {
      id: crypto.randomUUID(),
      news_id: newsId,
      kind: 'embed',
      url: v,
      storage_path: null,
      caption: info.label,
      sort: items.length,
    }])
    setLink('')
    setErr(null)
  }

  /**
   * Removing an attachment. WHO deletes the file depends on whether it was ever
   * saved, and getting this wrong breaks a live article:
   *
   *   uploaded in this session, then removed — never reached the database, so the
   *     file is an orphan the moment it leaves the list. Delete it here and now.
   *   already saved, then removed — the article on the site still points at it
   *     until the editor is saved. Deleting now and then cancelling would leave a
   *     published story showing a broken image. So only the list changes here; the
   *     save path deletes the file once the removal is actually committed.
   */
  const remove = async (i: number) => {
    const item = items[i]
    onChange(items.filter((_, idx) => idx !== i))
    if (item.storage_path && sessionUploads.current.has(item.storage_path)) {
      sessionUploads.current.delete(item.storage_path)
      const { error } = await supabase.storage.from('news-media').remove([item.storage_path])
      if (error) setErr(`Removed from the article, but the file is still in storage — ${error.message}`)
    }
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next.map((m, idx) => ({ ...m, sort: idx })))
  }

  const setCaption = (i: number, caption: string) =>
    onChange(items.map((m, idx) => (idx === i ? { ...m, caption } : m)))

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (!disabled && e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
        }}
        className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
          over ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/8' : 'border-[var(--color-line-2)]'
        }`}
      >
        <p className="text-sm text-[var(--color-muted)]">
          Drop photos or a video here, or{' '}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy}
            className="font-semibold text-[var(--color-blue)] underline underline-offset-2"
          >
            choose files
          </button>
        </p>
        <p className="mt-1.5 text-xs text-[var(--color-faint)]">
          Photos to {prettyBytes(MAX_IMAGE_BYTES)} · video to {prettyBytes(MAX_VIDEO_BYTES)} (about a
          minute of 1080p). Longer than that, put it on YouTube and paste the link below.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_ALL.join(',')}
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      <div className="flex gap-2">
        <input
          className="hcr-input !py-2 flex-1"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }}
          placeholder="…or paste a YouTube / Twitch / Streamable clip link"
          disabled={disabled || busy}
        />
        <button type="button" onClick={addLink} disabled={disabled || busy || !link.trim()} className="hcr-btn hcr-btn-dark !py-2 !text-xs">
          Add link
        </button>
      </div>

      {progress && <p className="text-xs text-[var(--color-muted)]">{progress}</p>}
      {err && <p className="rounded-lg bg-[var(--color-red)]/10 px-3 py-2 text-xs text-[var(--color-red)]">{err}</p>}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((m, i) => (
            <li key={m.id} className="flex items-start gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-2.5">
              <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-[var(--color-mist)]">
                {m.kind === 'image' ? (
                  <img src={m.url} alt="" className="h-full w-full object-cover" />
                ) : m.kind === 'video' ? (
                  // preload=metadata: a poster frame without pulling 50MB into the editor
                  <video src={m.url} className="h-full w-full object-cover" preload="metadata" muted />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-[var(--color-muted)]">
                    LINK
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                  {m.kind}
                </div>
                <input
                  className="hcr-input !py-1.5 !text-xs w-full"
                  value={m.caption ?? ''}
                  onChange={(e) => setCaption(i, e.target.value)}
                  placeholder="Caption (optional)"
                />
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <div className="flex gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move up"
                    className="hcr-btn hcr-btn-ghost !px-2 !py-1 !text-xs">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} title="Move down"
                    className="hcr-btn hcr-btn-ghost !px-2 !py-1 !text-xs">↓</button>
                </div>
                <button type="button" onClick={() => remove(i)} className="hcr-btn hcr-btn-ghost !px-2 !py-1 !text-xs">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
