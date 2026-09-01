import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useNotifications } from '../lib/queries'

/** Header bell with unread count and a dropdown of recent notifications. */
export default function NotificationBell() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { data: items } = useNotifications(session?.user?.id)

  const unread = (items ?? []).filter((n) => !n.read_at)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  if (!session) return null

  const markAllRead = async () => {
    if (!unread.length) return
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', unread.map((n) => n.id))
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread.length ? `Notifications, ${unread.length} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--color-line-2)] transition-colors hover:border-[var(--color-ink)]"
      >
        {/* bell */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3a6 6 0 00-6 6v3.6L4.5 15.5h15L18 12.6V9a6 6 0 00-6-6zM10 19a2 2 0 004 0"
            stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"
          />
        </svg>
        {unread.length > 0 && (
          <span className="tabular absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-brand)] px-1 text-[10px] font-bold text-black">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>

      {/* A 320px panel anchored right-0 hung ~25px off a 375px phone, so every
          notification lost its tail. Below sm the panel is a fixed full-width sheet
          under the header; from sm up, the anchored dropdown it always was. */}
      {open && (
        <div className="fixed inset-x-3 top-[72px] z-50 overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] shadow-card sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80">
          <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
            <span className="font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">Notifications</span>
            {unread.length > 0 && (
              <button onClick={markAllRead} className="text-xs font-semibold text-[var(--color-blue)]">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(items ?? []).length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-[var(--color-muted)]">Nothing yet.</li>
            )}
            {(items ?? []).map((n) => (
              <li key={n.id} className={`border-b border-[var(--color-line)] last:border-0 ${n.read_at ? '' : 'bg-[var(--color-cloud)]'}`}>
                <Link to={n.link ?? '/portal'} onClick={() => setOpen(false)} className="block px-4 py-3">
                  <div className="flex items-start gap-2">
                    {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-brand)]" />}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{n.title}</div>
                      {n.body && <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">{n.body}</div>}
                      <div className="tabular mt-1 font-mono text-[10px] text-[var(--color-faint)]">
                        {new Date(n.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
