import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function isConfigured() {
  return Boolean(URL && ANON);
}

/**
 * Fetch the current season from Supabase and shape it into the denormalized
 * `data` object the league components expect:
 *   { league, classes, teams, drivers, events:[{..results:[{..lapChart}]}] }
 * Results carry number + class so the existing num+class point matching works,
 * and every co-driver on an entry inherits that entry's number/class/car.
 */
export async function fetchLeagueData() {
  if (!isConfigured()) return null;
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });

  const { data: settings } = await sb.from("league_settings").select("*").eq("id", 1).maybeSingle();

  let season = null;
  if (settings?.current_season_id) {
    const r = await sb.from("seasons").select("*").eq("id", settings.current_season_id).maybeSingle();
    season = r.data;
  }
  if (!season) {
    const r = await sb.from("seasons").select("*").eq("is_current", true).limit(1);
    season = r.data?.[0] || null;
  }
  if (!season) {
    const r = await sb.from("seasons").select("*").order("created_at", { ascending: false }).limit(1);
    season = r.data?.[0] || null;
  }
  if (!season) return null;
  const sid = season.id;

  const [classes, teams, tracks, entries, entryDrivers, drivers, events, sessions, weather, results, laps] = await Promise.all([
    sb.from("classes").select("*").order("sort"),
    sb.from("teams").select("*"),
    sb.from("tracks").select("*"),
    sb.from("entries").select("*").eq("season_id", sid),
    sb.from("entry_drivers").select("*"),
    sb.from("drivers").select("*"),
    sb.from("events").select("*").eq("season_id", sid).order("round"),
    sb.from("sessions").select("*").order("sort"),
    sb.from("weather").select("*").order("sort"),
    sb.from("results").select("*"),
    sb.from("laps").select("*").order("lap"),
  ]).then((rs) => rs.map((r) => r.data || []));

  const trackById = Object.fromEntries(tracks.map((t) => [t.id, t]));
  const driverById = Object.fromEntries(drivers.map((d) => [d.id, d]));
  const entryById = Object.fromEntries(entries.map((e) => [e.id, e]));

  // lineup: entry -> [driver, ...]
  const lineupByEntry = {};
  entryDrivers.forEach((ed) => {
    (lineupByEntry[ed.entry_id] = lineupByEntry[ed.entry_id] || []).push(ed.driver_id);
  });
  const entryDriverNames = (entryId) =>
    (lineupByEntry[entryId] || []).map((id) => driverById[id]?.name).filter(Boolean).join(" / ");

  // drivers shaped for the components: each person carries their entry's number/class/car/team
  const driverFirstEntry = {};
  entries.forEach((e) => {
    (lineupByEntry[e.id] || []).forEach((did) => { if (!driverFirstEntry[did]) driverFirstEntry[did] = e; });
  });
  const shapedDrivers = drivers
    .filter((d) => driverFirstEntry[d.id])
    .map((d) => {
      const e = driverFirstEntry[d.id];
      return { id: d.id, name: d.name, country: d.country || "", car: e.car || "", num: e.number, cls: e.class_id, teamId: e.team_id || null, custId: d.iracing_custid || "" };
    });

  // group child rows by event/result
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
        const e = r.entry_id ? entryById[r.entry_id] : null;
        const driversText = (e && entryDriverNames(e.id)) || r.drivers_text || "";
        return {
          pos: r.pos, clsPos: r.cls_pos, cls: r.class_id || (e && e.class_id) || "",
          num: r.number != null ? r.number : (e ? e.number : ""),
          drivers: driversText, nat: "", car: (e && e.car) || "",
          grid: r.grid, inc: r.inc, laps: r.laps, time: r.total_time || "", gap: r.gap || "",
          best: r.best_lap || "", status: r.status || "",
          points: Number(r.points) || 0, adjust: Number(r.adjust) || 0,
          lapChart: (lapsByResult[r.id] || []).sort((a, b) => a.lap - b.lap),
        };
      })
      .sort((a, b) => (a.pos || 999) - (b.pos || 999));

    // winners per class = class P1
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

  return {
    league: {
      name: settings?.name || "HCR League",
      season: season.name,
      tagline: settings?.tagline || "",
      timezone: settings?.timezone || "ET",
      pointsTable: season.points_table || [],
      links: { discord: settings?.discord_url || "", broadcast: settings?.broadcast_url || "", rulebook: settings?.rulebook_url || "" },
    },
    classes: classes.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    drivers: shapedDrivers,
    events: shapedEvents,
  };
}
