// Domain types mirroring the HCR Supabase schema (public schema).
// Hand-maintained; kept lean to what the UI consumes.

export type ClassId = 'GTP' | 'LMP2' | 'GTD'

export interface LeagueClass {
  id: ClassId
  name: string
  color: string
  sort: number
}

export interface LeagueSettings {
  id: number
  name: string
  tagline: string | null
  timezone: string | null
  discord_url: string | null
  broadcast_url: string | null
  rulebook_url: string | null
  current_season_id: string | null
}

export interface Season {
  id: string
  name: string
  year: number
  is_current: boolean
  points_table: number[]
  quali_table: number[]
  drop_weeks: number
  points_system: string | null
}

export interface Track {
  id: string
  name: string
  location: string | null
  length_km: number | null
  config: string | null
  corners: number | null
  lat: number | null
  lon: number | null
}

export type EventStatus = 'complete' | 'next' | 'upcoming'

export interface RaceEvent {
  id: string
  season_id: string
  round: number
  track_id: string
  date: string
  duration_min: number | null
  duration_h: number | null
  status: EventStatus | string
  sim_start_hour: number | null
  time_mult: number | null
  points_mult: number | null
  min_drivers: number | null
  max_drivers: number | null
  notes: string | null
  broadcast_url: string | null
  name: string | null
  report: string | null
  // joined
  track?: Track
}

export interface RaceSession {
  id: string
  event_id: string
  type: string
  start: string
  dur_min: number | null
  sort: number
}

export interface Team {
  id: string
  name: string
  number: string
  car: string | null
  class_id: ClassId
  sort: number
  points_adjust: number
}

export interface Driver {
  id: string
  name: string
  country: string | null
  bio: string | null
  team_id: string | null
  irating: number | null
  license_override: string | null
  points_adjust: number
  iracing_custid: string | null
  // joined
  team?: Team
}

export interface RaceResult {
  id: string
  event_id: string
  entry_id: string | null
  team_id: string | null
  class_id: ClassId
  number: string
  drivers_text: string | null
  car: string | null
  pos: number | null
  cls_pos: number | null
  grid: number | null
  inc: number | null
  laps: number | null
  total_time: string | null
  gap: string | null
  intvl: string | null
  best_lap: string | null
  best_on: number | null
  status: string | null
  points: number | null
  adjust: number | null
  adjust_note: string | null
  quali_pos: number | null
  quali_points: number | null
}

export interface WeatherRow {
  id: string
  event_id: string
  at_hour: number | null
  air_f: number | null
  sky: string | null
  precip: number | null
  wind_mph: number | null
  humidity: number | null
  clouds: number | null
  sort: number
}

export interface Champion {
  id: string
  season_name: string
  year: number
  class_id: ClassId
  kind: string
  label: string
  sort: number
}

export interface Profile {
  id: string
  email: string | null
  display_name: string | null
  is_admin: boolean
  is_team_manager: boolean
  managed_team_id: string | null
  driver_id: string | null
  created_at: string
}

export interface SeasonRegistration {
  id: string
  season_id: string
  user_id: string
  driver_id: string | null
  display_name: string | null
  iracing_name: string | null
  iracing_custid: string | null
  fia_category: string | null
  preferred_class: string | null
  notes: string | null
  status: string
  created_at: string
}

// Computed standings row (driver or team) — derived client-side from results.
export interface StandingRow {
  key: string
  name: string
  number?: string
  car?: string | null
  classId: ClassId
  points: number
  starts: number
  wins: number
  podiums: number
  poles: number
  bestFinish: number | null
}
