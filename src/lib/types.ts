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
  /**
   * Derived from the team's season entry, not authored. Null when the team fields
   * no car this season — previously these were hand-maintained and drifted badly
   * enough that team pages advertised cars their drivers had never raced.
   */
  number: string | null
  car: string | null
  class_id: ClassId
  sort: number
  points_adjust: number
}

/**
 * A car on the grid: one number, in one class, for one season. This — not the team
 * record — is what says who runs what. Numbers are unique per class, not league-wide,
 * so GTD #5 and LMP2 #5 are two different cars.
 */
export interface Entry {
  id: string
  season_id: string
  number: string
  class_id: ClassId
  car: string | null
  team_id: string | null
  /** 'withdrawn' means the crew is gone; the row survives so past results stay linked. */
  status?: 'active' | 'pending' | 'withdrawn'
  // joined
  team?: Team
  /**
   * A crew link. `withdrawn_at` is non-null once that driver stopped racing this
   * season — the link is kept rather than deleted so the car's history reads true,
   * so anything asking "who races this?" must skip the withdrawn ones.
   */
  drivers?: { withdrawn_at?: string | null; driver: Driver }[]
}

export interface Driver {
  id: string
  name: string
  country: string | null
  bio: string | null
  team_id: string | null
  irating: number | null
  license_override: string | null
  /**
   * Steward correction to a season total. Nullable on purpose: zero and "nobody has
   * adjusted this" score identically but mean different things, and only one of them
   * should survive somebody clearing the field.
   */
  points_adjust: number | null
  iracing_custid: string | null
  /**
   * The auth account this driver is bound to. Written by sign-up and by the Discord
   * linker — never edited by hand, because a wrong value hands one person's portal
   * and entry to somebody else.
   */
  user_id?: string | null
  /** Discord snowflake. The attendance bot can only reach a driver through this. */
  discord_user_id?: string | null
  /** Tier the Discord sync last granted a role for. Derived downstream, never authored. */
  license_current?: string | null
  created_at?: string | null
  /** Self-reported: an admin said they added this driver to the iRacing league. */
  iracing_league_marked_at?: string | null
  /**
   * Verified by a league-roster sync. Stays null until iRacing API access exists —
   * nothing a human clicks can set it, which is what keeps it meaningful.
   */
  iracing_league_confirmed_at?: string | null
  // joined
  team?: Team
}

/** How sure we are that a driver is actually in the iRacing league. */
export type IracingLeagueState = 'confirmed' | 'raced' | 'marked' | 'pending' | 'no-custid'

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
  /** Guest/fill-in entry: scores the Fill-In Cup, never the main championship. */
  fill_in: boolean
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

export type UserRole = 'member' | 'race_control' | 'admin'

export interface Profile {
  id: string
  email: string | null
  display_name: string | null
  role: UserRole
  discord_user_id: string | null
  discord_username: string | null
  avatar_url: string | null
  is_admin: boolean
  is_team_manager: boolean
  managed_team_id: string | null
  driver_id: string | null
  created_at: string
}

export type ProtestStatus = 'open' | 'under_review' | 'resolved' | 'dismissed'

export interface Protest {
  id: string
  season_id: string | null
  event_id: string | null
  filed_by: string
  against_driver_id: string | null
  against_text: string | null
  incident_lap: string | null
  category: string | null
  summary: string
  status: ProtestStatus
  verdict: string | null
  penalty: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
  updated_at: string
  // joined
  event?: { id: string; round: number; name: string | null; track?: { name: string } | null } | null
  filer?: { id: string; display_name: string | null } | null
}

export interface ProtestMessage {
  id: string
  protest_id: string
  author_id: string
  body: string
  is_staff: boolean
  created_at: string
  author?: { display_name: string | null; role: UserRole } | null
}

export interface ProtestAttachment {
  id: string
  protest_id: string
  message_id: string | null
  kind: 'image' | 'link'
  url: string
  storage_path: string | null
  title: string | null
  created_at: string
}

export interface AppNotification {
  id: string
  user_id: string
  kind: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

/**
 * One attachment on a news article.
 *
 * `image` and `video` are files in the news-media bucket and carry a storage_path so
 * they can be deleted; `embed` is somebody else's player (YouTube, Twitch,
 * Streamable, Medal) and hosts nothing, so its storage_path is null.
 */
export interface NewsMedia {
  id: string
  news_id: string
  kind: 'image' | 'video' | 'embed'
  url: string
  storage_path: string | null
  caption: string | null
  sort: number
}

export interface NewsArticle {
  id: string
  slug: string
  /** 'manual' | 'auto-results' | 'auto-preview' */
  source?: string
  title: string
  dek: string | null
  body_md: string
  category: string
  event_id: string | null
  cover_url: string | null
  /** Photos, uploaded video and embedded clips, in display order. */
  media?: NewsMedia[]
  author: string
  is_published: boolean
  pinned: boolean
  published_at: string
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
  preferred_car: string | null
  /** First and fallback number choices — league-wide pool, first come first served. */
  preferred_number: string | null
  preferred_number_alt: string | null
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
