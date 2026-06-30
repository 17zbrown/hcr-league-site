import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function isConfigured() {
  return Boolean(URL && ANON);
}

function lapSec(t) {
  if (!t) return null;
  const s = String(t).trim();
  const m = s.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (m) return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/**
 * Team-centric model: teams own a car (number + model + class), drivers belong
 * to teams, events belong to a season, results link to a team. Standings are
 * derived per season from results; track records span every season.
 * @param {string} [seasonId] which season to show; defaults to current.
 */
export async function fetchLeagueData(seasonId) {
  if (!isConfigured()) return null;
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });

  const { data: settings } = await sb.from("league_settings").select("*").eq("id", 1).maybeSingle();
  const { data: allSeasons } = await sb.from("seasons").select("*").order("year", { ascending: false });
  const seasons = allSeasons || [];

  let season = null;
  if (seasonId) season = seasons.find((s) => s.id === seasonId) || null;
  if (!season && settings?.current_season_id) season = seasons.find((s) => s.id === settings.current_season_id) || null;
  if (!season) season = seasons.find((s) => s.is_current) || null;
  if (!season) season = seasons[0] || null;
  if (!season) return null;
  const sid = season.id;

  const [classes, teams, tracks, drivers, events, sessions, weather, results, laps, allEvents] =
    await Promise.all([
      sb.from("classes").select("*").order("sort"),
      sb.from("teams").select("*"),
      sb.from("tracks").select("*"),
      sb.from("drivers").select("*"),
      sb.from("events").select("*").eq("season_id", sid).order("round"),
      sb.from("sessions").select("*").order("sort"),
      sb.from("weather").select("*").order("sort"),
      sb.from("results").select("*"),
      sb.from("laps").select("*").order("lap"),
      sb.from("events").select("id,round,track_id,season_id"),
    ]).then((rs) => rs.map((r) => r.data || []));

  const trackById = Object.fromEntries(tracks.map((t) => [t.id, t]));
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const seasonById = Object.fromEntries(seasons.map((s) => [s.id, s]));

  const teamByKey = {};
  teams.forEach((t) => { if (t.number != null && t.class_id) teamByKey[`${t.class_id}#${t.number}`] = t; });
  const teamOf = (r) => (r.team_id ? teamById[r.team_id] : teamByKey[`${r.class_id}#${r.number}`]) || null;

  const driversByTeam = {};
  drivers.forEach((d) => { if (d.team_id) (driversByTeam[d.team_id] = driversByTeam[d.team_id] || []).push(d); });
  const teamDriverNames = (teamId) => (driversByTeam[teamId] || []).map((d) => d.name).filter(Boolean).join(" / ");

  // every driver who's on a team that fields a numbered car
  const shapedDrivers = drivers
    .filter((d) => { const t = d.team_id && teamById[d.team_id]; return t && t.number != null && t.class_id; })
    .map((d) => {
      const t = teamById[d.team_id];
      return { id: d.id, name: d.name, country: d.country || "", car: t.car || "", num: t.number, cls: t.class_id, teamId: t.id, custId: d.iracing_custid || "" };
    });

  const byEvent = (arr) => { const m = {}; arr.forEach((r) => (m[r.event_id] = m[r.event_id] || []).push(r)); return m; };
  const sessByEvent = byEvent(sessions);
  const wxByEvent = byEvent(weather);
  const resByEvent = byEvent(results);
  const lapsByResult = {};
  laps.forEach((l) => (lapsByResult[l.result_id] = lapsByResult[l.result_id] || []).push({ lap: l.lap, time: l.time, sec: Number(l.sec) }));

  const shapedEvents = events.map((ev) => {
    const track = trackById[ev.track_id];
    const evResults = (resByEvent[ev.id] || [])
      .map((r) => {
        const t = teamOf(r);
        const driversText = (t && teamDriverNames(t.id)) || r.drivers_text || "";
        return {
          pos: r.pos, clsPos: r.cls_pos, cls: r.class_id || (t && t.class_id) || "",
          num: r.number != null ? r.number : (t ? t.number : ""),
          drivers: driversText, nat: "", car: (t && t.car) || "",
          grid: r.grid, inc: r.inc, laps: r.laps, time: r.total_time || "", gap: r.gap || "",
          best: r.best_lap || "", status: r.status || "",
          points: (Number(r.points) || 0) + (Number(r.quali_points) || 0), adjust: Number(r.adjust) || 0,
          lapChart: (lapsByResult[r.id] || []).sort((a, b) => a.lap - b.lap),
        };
      })
      .sort((a, b) => (a.pos || 999) - (b.pos || 999));

    const winners = {};
    classes.forEach((c) => {
      const top = evResults.filter((r) => r.cls === c.id).sort((a, b) => (a.clsPos || 99) - (b.clsPos || 99))[0];
      if (top) winners[c.id] = ("#" + top.num + " " + top.drivers).trim();
    });

    return {
      id: ev.id, round: ev.round,
      track: track?.name || "TBA", location: track?.location || "",
      durationH: Number(ev.duration_h) || 0,
      date: ev.date, status: ev.status || "upcoming",
      simStartHour: Number(ev.sim_start_hour) || 0, timeMult: Number(ev.time_mult) || 1,
      pointsMult: Number(ev.points_mult) || 1,
      minDrivers: ev.min_drivers, maxDrivers: ev.max_drivers, notes: ev.notes || "",
      sessions: (sessByEvent[ev.id] || []).map((s) => ({ type: s.type, start: s.start, durMin: s.dur_min })),
      weather: (wxByEvent[ev.id] || []).map((w) => ({ atHour: Number(w.at_hour), air: Number(w.air_f), sky: w.sky, precip: w.precip, wind: Number(w.wind_mph), humidity: w.humidity })),
      winners, results: evResults,
    };
  });

  // ALL-TIME track records (across every season)
  const evMeta = Object.fromEntries(allEvents.map((e) => [e.id, e]));
  const recByTrack = {};
  results.forEach((r) => {
    const sec = lapSec(r.best_lap);
    const ev = evMeta[r.event_id];
    if (sec == null || !ev) return;
    const track = trackById[ev.track_id];
    if (!track) return;
    const t = teamOf(r);
    const cls = r.class_id || (t && t.class_id);
    if (!cls) return;
    const drivers_text = (t && teamDriverNames(t.id)) || r.drivers_text || "";
    const driverIds = t ? (driversByTeam[t.id] || []).map((d) => d.id) : [];
    const tr = recByTrack[track.id] || (recByTrack[track.id] = { track: track.name, location: track.location || "", perClass: {} });
    const cur = tr.perClass[cls];
    if (!cur || sec < cur.sec) {
      tr.perClass[cls] = {
        sec, time: r.best_lap, num: r.number != null ? r.number : (t ? t.number : ""),
        drivers: drivers_text, car: (t && t.car) || "", driverIds,
        season: seasonById[ev.season_id]?.name || "", round: ev.round,
      };
    }
  });

  return {
    league: {
      name: settings?.name || "HCR League",
      season: season.name,
      tagline: settings?.tagline || "",
      timezone: settings?.timezone || "ET",
      pointsTable: season.points_table || [],
      pointsSystem: season.points_system || "",
      links: { discord: settings?.discord_url || "", broadcast: settings?.broadcast_url || "", rulebook: settings?.rulebook_url || "" },
    },
    classes: classes.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    teams: teams.map((t) => ({ id: t.id, name: t.name, number: t.number, car: t.car, cls: t.class_id })),
    drivers: shapedDrivers,
    events: shapedEvents,
    seasons: seasons.map((s) => ({ id: s.id, name: s.name, year: s.year, is_current: s.is_current })),
    seasonId: sid,
    records: Object.values(recByTrack),
  };
}
