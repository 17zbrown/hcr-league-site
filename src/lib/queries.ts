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
