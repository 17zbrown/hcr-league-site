import { supabase } from './supabase'

/**
 * Is a Discord automation switched on?
 *
 * The site invokes a couple of these directly rather than waiting for the schedule
 * — draining the announcement queue the moment results are saved, for instance, so
 * the post lands in seconds instead of within five minutes. Those direct calls have
 * to honour the same switch the cron helper reads, or turning something off in the
 * panel would stop the scheduled run and quietly leave the app still firing it.
 *
 * Fails CLOSED: an unreadable answer is treated as "off". That is the safe direction
 * here specifically because nothing is lost by it — everything the site triggers
 * this way is queued in the database first, so the worst case is the announcement
 * goes out on the next scheduled drain instead of immediately.
 */
export async function automationEnabled(key: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('discord_automations')
      .select('enabled')
      .eq('key', key)
      .maybeSingle()
    if (error) return false
    return data?.enabled === true
  } catch {
    return false
  }
}

/**
 * Invoke an edge function, but only if its automation is switched on. Never throws
 * and never reports: callers use this for fire-and-forget nudges where the queue,
 * not this call, is what guarantees the work happens.
 */
export async function invokeIfEnabled(key: string): Promise<void> {
  if (!(await automationEnabled(key))) return
  try {
    await supabase.functions.invoke(key)
  } catch {
    /* the schedule will pick it up */
  }
}
