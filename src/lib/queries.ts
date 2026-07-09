import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type {
  Champion,
  Driver,
  LeagueClass,
  LeagueSettings,
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
        .select('drivers_text, cls_pos, quali_pos, grid, inc, laps, status')
      if (error) throw error
      return data ?? []
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

/** Free-agent drivers: not on a team. Used by the team-manager market. */
export function useFreeAgents() {
  return useQuery({
    queryKey: ['free-agents'],
    queryFn: async (): Promise<Driver[]> => {
      const { data, error } = await supabase
        .from('drivers')
        .select('*')
        .is('team_id', null)
        .order('name')
      if (error) throw error
      return (data ?? []) as Driver[]
    },
  })
}

/** All member profiles (admin only via RLS). */
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
