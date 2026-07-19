import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ACCEPTED_IMAGE, MAX_IMAGE_BYTES, parseClipUrl } from '../lib/evidence'

export interface PendingEvidence {
  kind: 'image' | 'link'
  url: string
  storage_path?: string
  title?: string
}

/**
 * Drag-and-drop evidence collector: screenshots upload to Supabase Storage,
 * clip URLs (YouTube / Twitch / Streamable / Medal) are stored as embeddable links.
 */
export function EvidenceBox({
  items,
  onChange,
  disabled,
}: {
  items: PendingEvidence[]
  onChange: (next: PendingEvidence[]) => void
  disabled?: boolean
}) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = async (files: FileList | File[]) => {
    setErr(null)
    const list = Array.from(files)
    const bad = list.find((f) => !ACCEPTED_IMAGE.includes(f.type) || f.size > MAX_IMAGE_BYTES)
    if (bad) {
      setErr(
        !ACCEPTED_IMAGE.includes(bad.type)
          ? `${bad.name} isn't an image. Upload a screenshot, or paste a clip link below.`
          : `${bad.name} is over 5MB. Compress it or paste a clip link instead.`,
      )
      return
    }
    setBusy(true)
    const added: PendingEvidence[] = []
    for (const f of list) {
      const path = `${crypto.randomUUID()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error } = await supabase.storage.from('protest-evidence').upload(path, f, { upsert: false })
      if (error) {
        setErr(error.message)
        break
      }
      const { data } = supabase.storage.from('protest-evidence').getPublicUrl(path)
      added.push({ kind: 'image', url: data.publicUrl, storage_path: path, title: f.name })
    }
    setBusy(false)
    if (added.length) onChange([...items, ...added])
  }

  const addLink = () => {
    const v = link.trim()
    if (!v) return
    const info = parseClipUrl(v)
    onChange([...items, { kind: 'link', url: v, title: info.label }])
    setLink('')
    setErr(null)
  }

  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i))

  return (
    <div className="space-y-3">
      {/* dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (!disabled && e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
        }}
        className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
          over ? 'border-[var(--color-brand)] bg-[var(--color-cloud)]' : 'border-[var(--color-line-2)] bg-[var(--color-paper)]'
        }`}
      >
        <p className="font-semibold">Drag screenshots here</p>
        <p className="mt-1 text-sm text-[var(--color-muted)]">PNG, JPG, WEBP or GIF · up to 5MB each</p>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          className="hcr-btn hcr-btn-ghost mt-3 !py-2 !text-xs"
        >
          {busy ? 'Uploading…' : 'Choose files'}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_IMAGE.join(',')}
          className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      {/* clip link */}
      <div className="flex flex-wrap gap-2">
        <input
          className="hcr-input min-w-0 flex-1"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }}
          placeholder="Paste a clip link — YouTube, Twitch, Streamable, Medal"
          disabled={disabled}
          aria-label="Clip link"
        />
        <button type="button" onClick={addLink} disabled={disabled || !link.trim()} className="hcr-btn hcr-btn-dark !text-xs">
          Add clip
        </button>
      </div>

      {err && <p className="text-sm text-[var(--color-red)]">{err}</p>}

      {/* staged evidence */}
      {items.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-2.5">
              {it.kind === 'image' ? (
                <img src={it.url} alt="" className="h-12 w-16 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-[var(--color-mist)] font-mono text-[10px] uppercase text-[var(--color-ink-2)]">
                  Clip
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{it.title ?? it.url}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove evidence"
                className="rounded-lg px-2 py-1 text-sm text-[var(--color-muted)] hover:text-[var(--color-red)]"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
