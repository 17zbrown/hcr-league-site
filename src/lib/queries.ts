import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type {
  NewsArticle,
  AppNotification,
  Champion,
  Driver,
  Entry,
  LeagueClass,
  LeagueSettings,
  Protest,
  ProtestAttachment,
  ProtestMessage,
  RaceEvent,
  RaceResult,
  Season,
  Team,
} from './types'

/** League-wide settings row (single row, id = 1). */
export function useLeagueSettings() {
  return useQuery({
    queryKey: ['league_settings'],
    queryFn: async (): Promise<LeagueSettings | null> => {
      const { data, error } = await supabase.from('league_settings').select('*').limit(1).single()
      if (error) throw error
      return data
    },
  })
}

export function useClasses() {
  return useQuery({
    queryKey: ['classes'],
    queryFn: async (): Promise<LeagueClass[]> => {
      const { data, error } = await supabase.from('classes').select('*').order('sort')
      if (error) throw error
      return data ?? []
    },
    staleTime: 1000 * 60 * 60,
  })
}

export function useCurrentSeason() {
  return useQuery({
    queryKey: ['season', 'current'],
    queryFn: async (): Promise<Season | null> => {
      const { data, error } = await supabase
        .from('seasons')
        .select('*')
        .eq('is_current', true)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/** All events for the current season, joined to their track, ordered by round. */
export function useEvents(seasonId?: string) {
  return useQuery({
    enabled: !!seasonId,
    queryKey: ['events', seasonId],
    queryFn: async (): Promise<RaceEvent[]> => {
      const { data, error } = await supabase
        .from('events')
        .select('*, track:tracks(*)')
        .eq('season_id', seasonId!)
        .order('round')
      if (error) throw error
      return (data ?? []) as RaceEvent[]
    },
  })
}

/** Single event with its track (for the race detail page). */
export function useEvent(id?: string) {
  return useQuery({
    enabled: !!id,
    queryKey: ['event', id],
    queryFn: async (): Promise<RaceEvent | null> => {
      const { data, error } = await supabase
        .from('events')
        .select('*, track:tracks(*)')
        .eq('id', id!)
        .maybeSingle()
      if (error) throw error
      return data as RaceEvent | null
    },
  })
}

export function useSessions(eventId?: string) {
  return useQuery({
    enabled: !!eventId,
    queryKey: ['sessions', eventId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sessions').select('*').eq('event_id', eventId!).order('sort')
      if (error) throw error
      return (data ?? []) as import('./types').RaceSession[]
    },
  })
}

export function useWeather(eventId?: string) {
  return useQuery({
    enabled: !!eventId,
    queryKey: ['weather', eventId],
    queryFn: async () => {
      const { data, error } = await supabase.from('weather').select('*').eq('event_id', eventId!).order('sort')
      if (error) throw error
      return (data ?? []) as import('./types').WeatherRow[]
    },
  })
}

/** Class winners (cls_pos = 1) from completed events at a given track. */
export function useTrackWinners(trackId?: string) {
  return useQuery({
    enabled: !!trackId,
    queryKey: ['track-winners', trackId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('results')
        .select('*, event:events!inner(id, round, name, date, status, track_id)')
        .eq('event.track_id', trackId!)
        .eq('event.status', 'complete')
        .eq('cls_pos', 1)
      if (error) throw error
      return (data ?? []) as (RaceResult & {
        event?: { id: string; round: number; name: string | null; date: string; status: string }
      })[]
    },
  })
}

/** Live real-world weather at the track (Open-Meteo — free, no key). */
export function useLiveWeather(lat?: number | null, lon?: number | null) {
  return useQuery({
    enabled: lat != null && lon != null,
    queryKey: ['live-weather', lat, lon],
    staleTime: 1000 * 60 * 15,
    retry: 1,
    queryFn: async () => {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`
      const res = await fetch(url)
      if (!res.ok) throw new Error('weather unavailable')
      return (await res.json()) as {
        current?: {
          temperature_2m: number
          apparent_temperature: number
          relative_humidity_2m: number
          precipitation: number
          weather_code: number
          wind_speed_10m: number
        }
      }
    },
  })
}

interface OMHourly {
  utc_offset_seconds?: number
  hourly?: {
    time: string[]
    temperature_2m: number[]
    weather_code: number[]
    wind_speed_10m: number[]
    relative_humidity_2m: number[]
    precipitation?: number[]
    precipitation_probability?: number[]
  }
}

/**
 * Real-world hourly weather for a race's date at the track. Uses Open-Meteo's
 * forecast endpoint for upcoming dates (≤16 days out) and the historical
 * archive for past dates.
 */
export function useRaceForecast(opts: {
  lat?: number | null
  lon?: number | null
  dateStr?: string
  past?: boolean
  tooFar?: boolean
}) {
  const { lat, lon, dateStr, past, tooFar } = opts
  return useQuery({
    enabled: lat != null && lon != null && !!dateStr && !tooFar,
    queryKey: ['race-forecast', lat, lon, dateStr, past],
    staleTime: 1000 * 60 * 30,
    retry: 1,
    queryFn: async (): Promise<OMHourly> => {
      const base = past ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast'
      const hourly = past
        ? 'temperature_2m,precipitation,weather_code,wind_speed_10m,relative_humidity_2m'
        : 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m,relative_humidity_2m'
      const url =
        `${base}?latitude=${lat}&longitude=${lon}&start_date=${dateStr}&end_date=${dateStr}` +
        `&hourly=${hourly}&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`
      const res = await fetch(url)
      if (!res.ok) throw new Error('forecast unavailable')
      return (await res.json()) as OMHourly
    },
  })
}

export function useResults(eventId?: string) {
  return useQuery({
    enabled: !!eventId,
    queryKey: ['results', eventId],
    queryFn: async (): Promise<RaceResult[]> => {
      const { data, error } = await supabase
        .from('results')
        .select('*')
        .eq('event_id', eventId!)
        .order('pos', { nullsFirst: false })
      if (error) throw error
      return (data ?? []) as RaceResult[]
    },
  })
}

/** Every result row for a season (via inner join on events). Used for standings. */
/** Minimal result columns across ALL seasons, for career license computation. */
export function useLicenseResults() {
  return useQuery({
    queryKey: ['results', 'license'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('results')
        .select('drivers_text, event_id, class_id, cls_pos, quali_pos, grid, inc, laps, best_lap, status')
      if (error) throw error
      return data ?? []
    },
  })
}

/** Published news articles, pinned first then newest. */
export function useNews(limit = 50) {
  return useQuery({
    queryKey: ['news', limit],
    queryFn: async (): Promise<NewsArticle[]> => {
      const { data, error } = await supabase
        .from('news')
        .select('*, media:news_media(*)')
        .eq('is_published', true)
        .order('pinned', { ascending: false })
        .order('published_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      // PostgREST won't order an embedded relation independently of the parent, so
      // the gallery order is applied here rather than being left to insert order.
      return (data ?? []).map((a) => ({
        ...a,
        media: [...((a as NewsArticle).media ?? [])].sort((x, y) => x.sort - y.sort),
      })) as NewsArticle[]
    },
  })
}

export function useSeasonResults(seasonId?: string) {
  return useQuery({
    enabled: !!seasonId,
    queryKey: ['results', 'season', seasonId],
    queryFn: async (): Promise<RaceResult[]> => {
      const { data, error } = await supabase
        .from('results')
        .select('*, event:events!inner(season_id)')
        .eq('event.season_id', seasonId!)
      if (error) throw error
      return (data ?? []) as RaceResult[]
    },
  })
}

/** Season results joined to their event + track (for driver/team profiles). */
export function useSeasonResultsFull(seasonId?: string) {
  return useQuery({
    enabled: !!seasonId,
    queryKey: ['results', 'full', seasonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('results')
        .select('*, event:events!inner(id, season_id, round, name, date, track:tracks(name))')
        .eq('event.season_id', seasonId!)
      if (error) throw error
      return (data ?? []) as (RaceResult & {
        event?: { id: string; round: number; name: string | null; date: string; track?: { name: string } | null }
      })[]
    },
  })
}

export function useTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: async (): Promise<Team[]> => {
      const { data, error } = await supabase.from('teams').select('*').order('class_id').order('number')
      if (error) throw error
      return (data ?? []) as Team[]
    },
  })
}

/**
 * The season's grid: every car, its number, class, model and crew.
 *
 * Read this rather than teams.number/teams.car when you need to know what somebody
 * runs. A team record can only describe a driver who has a team, and a good number of
 * the grid — guests, fill-ins and anyone who declined to name one — do not.
 */
export function useEntries(seasonId?: string) {
  return useQuery({
    enabled: !!seasonId,
    queryKey: ['entries', seasonId],
    queryFn: async (): Promise<Entry[]> => {
      const { data, error } = await supabase
        .from('entries')
        .select('*, team:teams(*), drivers:entry_drivers(driver:drivers(*))')
        .eq('season_id', seasonId!)
        .order('class_id')
        .order('number')
      if (error) throw error
      return (data ?? []) as Entry[]
    },
  })
}

/**
 * The signed-in member's own change requests (RLS returns only theirs, or everything
 * for race control). Drives the "waiting on race control" list in both portals.
 */
export function useMyChangeRequests() {
  return useQuery({
    queryKey: ['change-requests', 'mine'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('change_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(25)
      if (error) throw error
      return data ?? []
    },
  })
}

/** Every open request, for the race control queue. */
export function usePendingChangeRequests() {
  return useQuery({
    queryKey: ['change-requests', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('change_requests')
        .select('*, driver:drivers(name), team:teams(name), entry:entries(number, class_id, car)')
        .eq('status', 'pending')
        .order('created_at')
      if (error) throw error
      return data ?? []
    },
  })
}

/** Penalties and suspensions for a season. Public — sanctions are on the record. */
export function usePenalties(seasonId?: string) {
  return useQuery({
    enabled: !!seasonId,
    queryKey: ['penalties', seasonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('penalties')
        .select('*, driver:drivers(id, name), event:events(round, name)')
        .eq('season_id', seasonId!)
        .order('issued_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as PenaltyRow[]
    },
  })
}

export interface PenaltyRow {
  id: string
  kind: string
  value: number | null
  reason: string
  notes: string | null
  status: 'active' | 'served' | 'rescinded'
  issued_at: string
  rescind_reason: string | null
  driver?: { id: string; name: string } | null
  event?: { round: number; name: string | null } | null
}

/**
 * Every car number in use this season, mapped to who holds it.
 *
 * Fetched once and checked in memory rather than asking the server per keystroke:
 * entries are public, the set is tiny, and a sign-up form that stutters while it
 * waits on a round-trip is worse than one that answers instantly. The server still
 * has the final say — number_holder() runs again on submit, so a number claimed by
 * somebody else in the meantime is caught there rather than trusted from here.
 *
 * Keys are the number exactly as stored: '04' and '4' are different numbers in
 * iRacing, and lowercasing/trimming matches how the database compares them.
 */
export function useTakenNumbers(seasonId?: string) {
  return useQuery({
    enabled: !!seasonId,
    queryKey: ['taken-numbers', seasonId],
    // Short, not zero: someone else claiming a number mid-form is rare, and a stale
    // "free" answer is corrected on submit anyway.
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entries')
        .select('id, number, class_id, team:teams(name), drivers:entry_drivers(driver:drivers(id, name))')
        .eq('season_id', seasonId!)
      if (error) throw error
      const map = new Map<string, { holder: string; entryId: string; driverIds: string[] }>()
      for (const e of (data ?? []) as unknown as {
        id: string; number: string; class_id: string
        team?: { name: string } | null
        drivers?: { driver?: { id: string; name: string } | null }[]
      }[]) {
        const names = (e.drivers ?? []).map((d) => d.driver?.name).filter(Boolean) as string[]
        map.set(e.number.trim().toLowerCase(), {
          holder: names.join(' / ') || e.team?.name || `a ${e.class_id} entry`,
          entryId: e.id,
          driverIds: (e.drivers ?? []).map((d) => d.driver?.id).filter(Boolean) as string[],
        })
      }
      return map
    },
  })
}

export function useDrivers() {
  return useQuery({
    queryKey: ['drivers'],
    queryFn: async (): Promise<Driver[]> => {
      const { data, error } = await supabase
        .from('drivers')
        .select('*, team:teams(*)')
        .order('name')
      if (error) throw error
      return (data ?? []) as Driver[]
    },
  })
}

export function useMembers() {
  return useQuery({
    queryKey: ['members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at')
      if (error) throw error
      return data ?? []
    },
  })
}

/** Season registrations (admin + team managers via RLS). */
export function useRegistrations(seasonId?: string) {
  return useQuery({
    enabled: !!seasonId,
    queryKey: ['registrations', seasonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('season_registrations')
        .select('*, driver:drivers(id, name, team_id)')
        .eq('season_id', seasonId!)
        .order('created_at')
      if (error) throw error
      return data ?? []
    },
  })
}

/**
 * The signed-in member's OWN registration for a season, if they have one.
 *
 * Separate from useRegistrations, which is the commissioner's list and is gated by
 * RLS to staff. This one is scoped to the caller by user_id, so a member can see
 * the state of the thing they submitted — which they could not before, and which is
 * why the portal used to tell somebody who had just entered that they had not.
 *
 * Entering the season writes season_registrations. Being placed on the grid writes
 * entries. Those are two different facts and there is a real, human-length gap
 * between them, so anything reporting "are you in?" has to read both.
 */
export function useMyRegistration(seasonId?: string, userId?: string) {
  return useQuery({
    enabled: !!seasonId && !!userId,
    queryKey: ['my-registration', seasonId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('season_registrations')
        .select('id, status, created_at, preferred_class, preferred_car, preferred_number')
        .eq('season_id', seasonId!)
        .eq('user_id', userId!)
        .maybeSingle()
      if (error) throw error
      return data ?? null
    },
  })
}

export function useChampions() {
  return useQuery({
    queryKey: ['champions'],
    queryFn: async (): Promise<Champion[]> => {
      const { data, error } = await supabase.from('champions').select('*').order('sort')
      if (error) throw error
      return (data ?? []) as Champion[]
    },
  })
}

// ---------------- Protests & notifications ----------------

/** Protests visible to the caller (RLS: own for members, all for race control). */
export function useProtests(opts?: { mine?: boolean; userId?: string }) {
  return useQuery({
    queryKey: ['protests', opts?.mine ? `mine:${opts?.userId ?? ''}` : 'all'],
    queryFn: async () => {
      let q = supabase
        .from('protests')
        .select('*, event:events(id, round, name, track:tracks(name)), filer:profiles!protests_filed_by_fkey(id, display_name)')
        .order('created_at', { ascending: false })
      if (opts?.mine && opts.userId) q = q.eq('filed_by', opts.userId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as Protest[]
    },
  })
}

export function useProtest(id?: string) {
  return useQuery({
    enabled: !!id,
    queryKey: ['protest', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('protests')
        .select('*, event:events(id, round, name, track:tracks(name)), filer:profiles!protests_filed_by_fkey(id, display_name)')
        .eq('id', id!)
        .maybeSingle()
      if (error) throw error
      return data as unknown as Protest | null
    },
  })
}

export function useProtestThread(protestId?: string) {
  return useQuery({
    enabled: !!protestId,
    queryKey: ['protest-thread', protestId],
    queryFn: async () => {
      const [msgs, atts] = await Promise.all([
        supabase.from('protest_messages').select('*').eq('protest_id', protestId!).order('created_at'),
        supabase.from('protest_attachments').select('*').eq('protest_id', protestId!).order('created_at'),
      ])
      if (msgs.error) throw msgs.error
      if (atts.error) throw atts.error

      // Resolve author names via the safe public view (RLS hides other profiles).
      const rows = (msgs.data ?? []) as unknown as ProtestMessage[]
      const ids = Array.from(new Set(rows.map((m) => m.author_id)))
      let authors: Record<string, { display_name: string | null; role: string }> = {}
      if (ids.length) {
        const { data: people } = await supabase.from('public_profiles').select('id, display_name, role').in('id', ids)
        authors = Object.fromEntries((people ?? []).map((p) => [p.id, { display_name: p.display_name, role: p.role }]))
      }
      return {
        messages: rows.map((m) => ({ ...m, author: (authors[m.author_id] ?? null) as ProtestMessage['author'] })),
        attachments: (atts.data ?? []) as unknown as ProtestAttachment[],
      }
    },
  })
}

export function useNotifications(userId?: string) {
  return useQuery({
    enabled: !!userId,
    queryKey: ['notifications', userId],
    refetchInterval: 60_000,
    queryFn: async (): Promise<AppNotification[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return (data ?? []) as AppNotification[]
    },
  })
}
