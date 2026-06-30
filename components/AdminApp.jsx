"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import {
  Lock, Settings, Eye, LogOut, Plus, Trash2, Loader2, ChevronRight, Search,
  Upload, FileText, AlertTriangle, CheckCircle2, Gauge,
} from "lucide-react";


/* ----------------------------- small inputs ------------------------------ */
const TextInput = (p) => <input className="aes-input" {...p} />;
const NumInput = (p) => <input type="number" className="aes-input" {...p} />;
const Field = ({ label, children }) => (<label className="aes-field"><span>{label}</span>{children}</label>);
const lapSec = (t) => { if (!t) return null; const m = String(t).trim().match(/^(\d+):(\d+(?:\.\d+)?)$/); if (m) return +m[1] * 60 + parseFloat(m[2]); const n = parseFloat(t); return isNaN(n) ? null : n; };
const pointsForPos = (table, pos) => (pos >= 1 && pos <= (table || []).length ? Number(table[pos - 1]) || 0 : 0);

/* --------------------------- load everything ----------------------------- */
async function loadAdminData(sb, seasonId) {
  const { data: settings } = await sb.from("league_settings").select("*").eq("id", 1).maybeSingle();
  const { data: seasons } = await sb.from("seasons").select("*").order("year", { ascending: false });
  const slist = seasons || [];
  let sid = seasonId;
  if (!sid) sid = settings?.current_season_id || slist.find((s) => s.is_current)?.id || slist[0]?.id || "";

  const [classes, teams, tracks, drivers, entries, entryDrivers, events, sessions, weather, results] = await Promise.all([
    sb.from("classes").select("*").order("sort"),
    sb.from("teams").select("*").order("name"),
    sb.from("tracks").select("*").order("name"),
    sb.from("drivers").select("*").order("name"),
    sb.from("entries").select("*").eq("season_id", sid),
    sb.from("entry_drivers").select("*"),
    sb.from("events").select("*").eq("season_id", sid).order("round"),
    sb.from("sessions").select("*").order("sort"),
    sb.from("weather").select("*").order("sort"),
    sb.from("results").select("*"),
  ].map((p) => p.then((r) => r.data || [])));

  const lineupByEntry = {};
  entryDrivers.forEach((ed) => { (lineupByEntry[ed.entry_id] = lineupByEntry[ed.entry_id] || []).push(ed.driver_id); });
  const driverById = Object.fromEntries(drivers.map((d) => [d.id, d]));
  const entryById = Object.fromEntries(entries.map((e) => [e.id, e]));

  const byEvent = (arr) => { const m = {}; arr.forEach((r) => (m[r.event_id] = m[r.event_id] || []).push(r)); return m; };
  const sBy = byEvent(sessions), wBy = byEvent(weather), rBy = byEvent(results);

  const shapedEvents = events.map((ev) => ({
    id: ev.id, round: ev.round, track_id: ev.track_id, date: ev.date || "",
    status: ev.status || "upcoming", durationH: ev.duration_h ?? "", simStartHour: ev.sim_start_hour ?? "",
    timeMult: ev.time_mult ?? 1, pointsMult: ev.points_mult ?? 1, minDrivers: ev.min_drivers ?? "",
    maxDrivers: ev.max_drivers ?? "", notes: ev.notes || "",
    sessions: (sBy[ev.id] || []).map((s) => ({ id: s.id, type: s.type || "", start: s.start || "", durMin: s.dur_min ?? "", sort: s.sort ?? 0 })),
    weather: (wBy[ev.id] || []).map((w) => ({ id: w.id, atHour: w.at_hour ?? "", air: w.air_f ?? "", sky: w.sky || "", precip: w.precip ?? "", wind: w.wind_mph ?? "", humidity: w.humidity ?? "", sort: w.sort ?? 0 })),
    results: (rBy[ev.id] || []).map((r) => {
      const e = r.entry_id ? entryById[r.entry_id] : null;
      const names = e ? (lineupByEntry[e.id] || []).map((id) => driverById[id]?.name).filter(Boolean).join(" / ") : "";
      return { id: r.id, entry_id: r.entry_id, cls: r.class_id || (e && e.class_id) || "", num: r.number ?? (e ? e.number : ""), drivers: names || r.drivers_text || "", car: (e && e.car) || "", pos: r.pos ?? "", clsPos: r.cls_pos ?? "", grid: r.grid ?? "", laps: r.laps ?? "", best: r.best_lap || "", inc: r.inc ?? "", status: r.status || "", points: r.points ?? "", adjust: r.adjust ?? "" };
    }).sort((a, b) => (+a.pos || 999) - (+b.pos || 999)),
  }));

  // drivers in this season (person + their first entry here)
  const firstEntryOf = {};
  entries.forEach((e) => { (lineupByEntry[e.id] || []).forEach((did) => { if (!firstEntryOf[did]) firstEntryOf[did] = e; }); });
  const seasonDrivers = drivers.filter((d) => firstEntryOf[d.id]).map((d) => {
    const e = firstEntryOf[d.id];
    return { id: d.id, name: d.name, country: d.country || "", custId: d.iracing_custid || "", entryId: e.id, num: e.number ?? "", cls: e.class_id || "", car: e.car || "", teamId: e.team_id || null };
  });
  // season points per driver (from results of their entries)
  const ptsByDriver = {};
  shapedEvents.forEach((ev) => ev.results.forEach((r) => {
    if (!r.entry_id) return;
    (lineupByEntry[r.entry_id] || []).forEach((did) => { ptsByDriver[did] = (ptsByDriver[did] || 0) + (Number(r.points) || 0) + (Number(r.adjust) || 0); });
  }));
  seasonDrivers.forEach((d) => { d.pts = ptsByDriver[d.id] || 0; });

  const trackById = Object.fromEntries(tracks.map((t) => [t.id, t]));
  shapedEvents.forEach((ev) => { ev.track = trackById[ev.track_id]?.name || "New event"; });

  return {
    settings: settings || { id: 1 }, seasons: slist, seasonId: sid,
    classes, teams, tracks, drivers, entries, lineupByEntry,
    events: shapedEvents, seasonDrivers,
  };
}

/* ------------------------------ PDF import ------------------------------- */
function ImportDrop({ supabase, eventId, seasonId, autoAdd, onDone }) {
  const [stage, setStage] = useState("idle"); // idle | parsing | done | err
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState("");
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setStage("err"); setMsg("That doesn't look like a PDF."); return; }
    if (file.size > 8 * 1024 * 1024) { setStage("err"); setMsg("That PDF is over 8 MB — export a smaller sheet."); return; }
    setStage("parsing"); setMsg("");
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(new Error("read failed")); r.readAsDataURL(file); });
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const resp = await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pdf: b64, eventId, seasonId, token, autoAddDrivers: autoAdd }) });
      const out = await resp.json();
      if (!resp.ok || out.error) { setStage("err"); setMsg(out.error || "Import failed."); return; }
      const bits = [];
      if (out.inserted) bits.push(out.inserted + " added");
      if (out.updated) bits.push(out.updated + " updated");
      if (out.createdDrivers) bits.push(out.createdDrivers + " new driver" + (out.createdDrivers === 1 ? "" : "s"));
      if (out.noCar) bits.push(out.noCar + " unmatched");
      setStage("done"); setMsg("Imported " + out.total + " cars" + (bits.length ? " · " + bits.join(", ") : "") + ".");
      if (onDone) onDone();
    } catch (e) { setStage("err"); setMsg("Import failed: " + (e?.message || String(e))); }
  };

  return (
    <div className="aes-edit-sub">
      <div className="aes-edit-sub-head"><b>Import results from PDF</b>
        {(stage === "done" || stage === "err") && <button className="aes-btn ghost xs" onClick={() => { setStage("idle"); setMsg(""); }}><Upload size={12} /> Again</button>}
      </div>
      {stage === "parsing" ? (
        <div className="aes-drop"><Loader2 size={24} className="aes-spin" /><div className="aes-drop-title">Deciphering results…</div><div className="aes-drop-sub">Reading the classification and assigning points</div></div>
      ) : stage === "done" ? (
        <div className="aes-import-done"><CheckCircle2 size={15} /> {msg} Standings updated.</div>
      ) : (
        <>
          <div className={"aes-drop" + (over ? " over" : "")} onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); handleFile(e.dataTransfer.files?.[0]); }}>
            <FileText size={26} />
            <div className="aes-drop-title">Drop the race-control results PDF here</div>
            <div className="aes-drop-sub">or click to choose — I read the classification, match each car, and assign points</div>
            <input ref={inputRef} type="file" accept="application/pdf" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
          </div>
          {stage === "err" && <div className="aes-import-err"><AlertTriangle size={14} /> {msg}</div>}
        </>
      )}
    </div>
  );
}

/* ---------------------------- results editor ----------------------------- */
function ResultsBlock({ supabase, d, ev, reload }) {
  const rows = ev.results;
  const seasonEntries = d.entries;
  const classes = d.classes;
  const [msg, setMsg] = useState("");
  const entryLabel = (e) => `#${e.number} ${e.class_id}${e.car ? " — " + e.car : ""}`;

  const num = (v) => (v === "" || v == null ? null : Number(v));
  const saveRow = async (r) => {
    if (!r.cls || r.num === "" || r.num == null) { setMsg("Pick a car first."); return; }
    const payload = { event_id: ev.id, entry_id: r.entry_id || null, class_id: r.cls, number: String(r.num), pos: num(r.pos), cls_pos: num(r.clsPos), grid: num(r.grid), laps: num(r.laps), best_lap: r.best || "", inc: num(r.inc), status: r.status || "", points: num(r.points) || 0, adjust: num(r.adjust) || 0 };
    const q = r.id ? supabase.from("results").update(payload).eq("id", r.id) : supabase.from("results").insert(payload);
    const { error } = await q; if (error) setMsg("Save error: " + error.message); else { setMsg(""); reload(); }
  };
  const addRow = async () => {
    const { error } = await supabase.from("results").insert({ event_id: ev.id, class_id: classes[0]?.id || "GTP", number: "0", pos: rows.length + 1, status: "Running", points: 0, adjust: 0 });
    if (error) setMsg("Add error: " + error.message); else reload();
  };
  const delRow = async (r) => { if (r.id) { await supabase.from("results").delete().eq("id", r.id); reload(); } };
  const pickEntry = async (r, entryId) => {
    const e = seasonEntries.find((x) => x.id === entryId);
    await supabase.from("results").update({ entry_id: entryId || null, class_id: e?.class_id || r.cls, number: e ? String(e.number) : r.num }).eq("id", r.id);
    reload();
  };
  const setCell = async (r, patch) => { await supabase.from("results").update(patch).eq("id", r.id); };

  const autofill = async () => {
    const table = d.seasons.find((s) => s.id === d.seasonId)?.points_table || [];
    const mult = Number(ev.pointsMult || 1);
    const order = rows.map((r) => ({ r, pos: +r.pos || 999 })).sort((a, b) => a.pos - b.pos);
    const seen = {};
    for (const { r } of order) {
      seen[r.cls] = (seen[r.cls] || 0) + 1;
      const pts = Math.round(pointsForPos(table, seen[r.cls]) * mult);
      await supabase.from("results").update({ cls_pos: seen[r.cls], points: pts }).eq("id", r.id);
    }
    setMsg("Points auto-filled."); reload();
  };
  const apply = async () => { await supabase.from("events").update({ status: "complete" }).eq("id", ev.id); setMsg("Applied — round marked Final, standings updated."); reload(); };

  return (
    <div className="aes-edit-sub">
      <div className="aes-edit-sub-head"><b>Results &amp; points</b><button className="aes-btn ghost xs" onClick={addRow}><Plus size={12} /> Add car</button></div>
      {msg && <div className="aes-import-note" style={{ color: "var(--signal)" }}>{msg}</div>}
      {rows.length === 0 ? (
        <div className="aes-import-note">No results yet. Drop a PDF above, or add cars by hand.</div>
      ) : (
        <>
          <div className="aes-res-scroll"><div className="aes-res-grid">
            <div className="aes-res-head"><span>Car</span><span>Pos</span><span>Cls</span><span>Grid</span><span>Laps</span><span>Best lap</span><span>Inc</span><span>Status</span><span>Pts</span><span>Adj</span><span /></div>
            {rows.map((r) => (
              <div key={r.id} className="aes-res-row" style={{ gridTemplateColumns: "1.6fr 56px 60px 56px 60px 96px 50px 96px 64px 56px 32px" }}>
                <select className="aes-input" value={r.entry_id || ""} onChange={(e) => pickEntry(r, e.target.value)}>
                  <option value="">{r.num ? `#${r.num} ${r.cls}` : "— pick car —"}</option>
                  {seasonEntries.map((e) => <option key={e.id} value={e.id}>{entryLabel(e)}</option>)}
                </select>
                <NumInput defaultValue={r.pos} onBlur={(e) => setCell(r, { pos: num(e.target.value) })} />
                <NumInput defaultValue={r.clsPos} onBlur={(e) => setCell(r, { cls_pos: num(e.target.value) })} />
                <NumInput defaultValue={r.grid} onBlur={(e) => setCell(r, { grid: num(e.target.value) })} />
                <NumInput defaultValue={r.laps} onBlur={(e) => setCell(r, { laps: num(e.target.value) })} />
                <TextInput defaultValue={r.best} onBlur={(e) => setCell(r, { best_lap: e.target.value })} placeholder="1:35.4" />
                <NumInput defaultValue={r.inc} onBlur={(e) => setCell(r, { inc: num(e.target.value) })} />
                <TextInput defaultValue={r.status} onBlur={(e) => setCell(r, { status: e.target.value })} placeholder="Running" />
                <NumInput defaultValue={r.points} onBlur={(e) => setCell(r, { points: num(e.target.value) || 0 })} />
                <NumInput defaultValue={r.adjust} title="Stewards' adjustment (± points)" onBlur={(e) => setCell(r, { adjust: num(e.target.value) || 0 })} />
                <button className="aes-icon-btn danger" onClick={() => delRow(r)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div></div>
          <div className="aes-import-actions">
            <button className="aes-btn ghost sm" onClick={autofill}><Gauge size={14} /> Auto-fill points</button>
            <button className="aes-btn primary sm" onClick={apply}><CheckCircle2 size={14} /> Apply to standings</button>
          </div>
          <div className="aes-points-hint">Pick each car from the dropdown (number + class come from it, points credit its whole line-up). “Auto-fill points” scores by class position from your points table; “Apply” marks the round Final. Edits save when you click away from a field.</div>
        </>
      )}
    </div>
  );
}

/* ------------------------------ event card ------------------------------- */
function EventCard({ supabase, d, ev, reload, autoAdd }) {
  const [open, setOpen] = useState(false);
  const patchEvent = async (patch) => { await supabase.from("events").update(patch).eq("id", ev.id); reload(); };
  const setField = async (col, val) => { await supabase.from("events").update({ [col]: val }).eq("id", ev.id); };

  const addSession = async () => { await supabase.from("sessions").insert({ event_id: ev.id, type: "Practice", dur_min: 60, sort: ev.sessions.length }); reload(); };
  const delSession = async (s) => { await supabase.from("sessions").delete().eq("id", s.id); reload(); };
  const setSession = async (s, patch) => { await supabase.from("sessions").update(patch).eq("id", s.id); };
  const addWx = async () => { await supabase.from("weather").insert({ event_id: ev.id, at_hour: 0, air_f: 68, sky: "Clear", precip: 0, wind_mph: 6, humidity: 55, sort: ev.weather.length }); reload(); };
  const delWx = async (w) => { await supabase.from("weather").delete().eq("id", w.id); reload(); };
  const setWx = async (w, patch) => { await supabase.from("weather").update(patch).eq("id", w.id); };
  const num = (v) => (v === "" ? null : Number(v));

  const StatusChip = ({ s }) => <span className={"aes-chip " + s}>{s === "complete" ? "Final" : s === "next" ? "Next" : "Scheduled"}</span>;

  return (
    <div className="aes-edit-card">
      <div className="aes-edit-card-head" onClick={() => setOpen(!open)}>
        <span className="mono aes-edit-round">R{ev.round}</span>
        <span className="aes-edit-track">{ev.track}</span>
        <StatusChip s={ev.status} />
        <span className="aes-edit-spacer" />
        <button className="aes-icon-btn danger" onClick={async (e) => { e.stopPropagation(); if (confirm("Delete this round and its results?")) { await supabase.from("results").delete().eq("event_id", ev.id); await supabase.from("sessions").delete().eq("event_id", ev.id); await supabase.from("weather").delete().eq("event_id", ev.id); await supabase.from("events").delete().eq("id", ev.id); reload(); } }}><Trash2 size={15} /></button>
        <ChevronRight size={18} className={"aes-edit-chev" + (open ? " open" : "")} />
      </div>
      {open && (
        <div className="aes-edit-card-body">
          <div className="aes-edit-grid">
            <Field label="Round #"><NumInput defaultValue={ev.round} onBlur={(e) => setField("round", num(e.target.value))} /></Field>
            <Field label="Track">
              <select className="aes-input" value={ev.track_id || ""} onChange={(e) => patchEvent({ track_id: e.target.value })}>
                <option value="">— pick a track —</option>
                {d.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Duration (hours)"><NumInput step="0.5" defaultValue={ev.durationH} onBlur={(e) => setField("duration_h", num(e.target.value))} /></Field>
            <Field label="Race date/time"><TextInput type="datetime-local" defaultValue={(ev.date || "").slice(0, 16)} onBlur={(e) => setField("date", e.target.value ? e.target.value + ":00" : null)} /></Field>
            <Field label="Status">
              <select className="aes-input" value={ev.status} onChange={(e) => patchEvent({ status: e.target.value })}>
                <option value="upcoming">Scheduled</option><option value="next">Next Up</option><option value="complete">Final</option>
              </select>
            </Field>
            <Field label="Sim start hour (0–24)"><NumInput step="0.5" defaultValue={ev.simStartHour} onBlur={(e) => setField("sim_start_hour", num(e.target.value))} /></Field>
            <Field label="Time multiplier"><NumInput step="0.5" defaultValue={ev.timeMult} onBlur={(e) => setField("time_mult", num(e.target.value))} /></Field>
            <Field label="Min drivers"><NumInput defaultValue={ev.minDrivers} onBlur={(e) => setField("min_drivers", num(e.target.value))} /></Field>
            <Field label="Max drivers"><NumInput defaultValue={ev.maxDrivers} onBlur={(e) => setField("max_drivers", num(e.target.value))} /></Field>
            <Field label="Points multiplier"><NumInput step="0.5" defaultValue={ev.pointsMult} onBlur={(e) => setField("points_mult", num(e.target.value))} /></Field>
          </div>
          <Field label="Race control notes"><textarea className="aes-input" rows={2} defaultValue={ev.notes} onBlur={(e) => setField("notes", e.target.value)} /></Field>

          <div className="aes-edit-sub">
            <div className="aes-edit-sub-head"><b>Sessions</b><button className="aes-btn ghost xs" onClick={addSession}><Plus size={12} /> Add</button></div>
            {ev.sessions.map((s) => (
              <div key={s.id} className="aes-edit-srow">
                <select className="aes-input" defaultValue={s.type} onChange={(e) => setSession(s, { type: e.target.value })}>
                  <option>Practice</option><option>Qualifying</option><option>Warmup</option><option>Race</option>
                </select>
                <TextInput type="datetime-local" defaultValue={(s.start || "").slice(0, 16)} onBlur={(e) => setSession(s, { start: e.target.value ? e.target.value + ":00" : null })} />
                <NumInput defaultValue={s.durMin} onBlur={(e) => setSession(s, { dur_min: num(e.target.value) })} placeholder="min" />
                <button className="aes-icon-btn danger" onClick={() => delSession(s)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>

          <div className="aes-edit-sub">
            <div className="aes-edit-sub-head"><b>Weather points</b><button className="aes-btn ghost xs" onClick={addWx}><Plus size={12} /> Add</button></div>
            <div className="aes-wx-edit-head"><span>Race hour</span><span>Air °F</span><span>Sky</span><span>Rain %</span><span>Wind</span><span>Humidity</span><span /></div>
            {ev.weather.map((w) => (
              <div key={w.id} className="aes-edit-wrow">
                <NumInput defaultValue={w.atHour} onBlur={(e) => setWx(w, { at_hour: num(e.target.value) })} />
                <NumInput defaultValue={w.air} onBlur={(e) => setWx(w, { air_f: num(e.target.value) })} />
                <select className="aes-input" defaultValue={w.sky} onChange={(e) => setWx(w, { sky: e.target.value })}>
                  <option>Clear</option><option>Partly Cloudy</option><option>Cloudy</option><option>Light Rain</option><option>Rain</option>
                </select>
                <NumInput defaultValue={w.precip} onBlur={(e) => setWx(w, { precip: num(e.target.value) })} />
                <NumInput defaultValue={w.wind} onBlur={(e) => setWx(w, { wind_mph: num(e.target.value) })} />
                <NumInput defaultValue={w.humidity} onBlur={(e) => setWx(w, { humidity: num(e.target.value) })} />
                <button className="aes-icon-btn danger" onClick={() => delWx(w)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>

          <ImportDrop supabase={supabase} eventId={ev.id} seasonId={d.seasonId} autoAdd={autoAdd} onDone={reload} />
          <ResultsBlock supabase={supabase} d={d} ev={ev} reload={reload} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------ admin tabs ------------------------------- */
function DriversTab({ supabase, d, reload }) {
  const [q, setQ] = useState(""); const [cls, setCls] = useState("ALL"); const [msg, setMsg] = useState("");
  const teamName = (id) => d.teams.find((t) => t.id === id)?.name || "";
  const setDriver = async (row, patch) => { await supabase.from("drivers").update(patch).eq("id", row.id); };
  const setEntry = async (row, patch) => { if (row.entryId) await supabase.from("entries").update(patch).eq("id", row.entryId); };
  const addDriver = async () => {
    const { data: dr, error } = await supabase.from("drivers").insert({ name: "New Driver", country: "" }).select("id").single();
    if (error) { setMsg(error.message); return; }
    const { data: en } = await supabase.from("entries").insert({ season_id: d.seasonId, number: "0", class_id: d.classes[0]?.id || "GTP", car: "" }).select("id").single();
    if (en) await supabase.from("entry_drivers").insert({ entry_id: en.id, driver_id: dr.id });
    reload();
  };
  const delDriver = async (row) => { if (confirm("Remove this driver from the season?")) { if (row.entryId) await supabase.from("entry_drivers").delete().eq("entry_id", row.entryId).eq("driver_id", row.id); reload(); } };

  const dq = q.trim().toLowerCase();
  const shown = d.seasonDrivers.filter((x) => (cls === "ALL" || x.cls === cls) && (!dq || [x.name, x.num, x.car, x.cls, teamName(x.teamId)].some((v) => String(v ?? "").toLowerCase().includes(dq))));
  return (
    <>
      <div className="aes-admin-addbar">
        <button className="aes-btn primary sm" onClick={addDriver}><Plus size={14} /> Add driver</button>
        <div className="aes-filter"><Search size={14} /><input className="aes-filter-input" placeholder="Filter by name, number, car or team…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="aes-input aes-filter-cls" value={cls} onChange={(e) => setCls(e.target.value)}><option value="ALL">All classes</option>{d.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      {msg && <div className="aes-import-err">{msg}</div>}
      <div className="aes-edit-list">
        <div className="aes-edit-row driver head"><span>#</span><span>Driver name</span><span>Flag</span><span>Team</span><span>Class</span><span>Car</span><span>Pts</span><span /></div>
        {shown.map((x) => (
          <div key={x.id} className="aes-edit-row driver">
            <NumInput defaultValue={x.num} onBlur={(e) => setEntry(x, { number: e.target.value })} placeholder="#" />
            <TextInput defaultValue={x.name} onBlur={(e) => setDriver(x, { name: e.target.value })} placeholder="Driver name" />
            <TextInput defaultValue={x.country} onBlur={(e) => setDriver(x, { country: e.target.value })} placeholder="🏳️" />
            <select className="aes-input" defaultValue={x.teamId || ""} onChange={(e) => setEntry(x, { team_id: e.target.value || null })}><option value="">— No team —</option>{d.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <select className="aes-input" defaultValue={x.cls} onChange={(e) => setEntry(x, { class_id: e.target.value })}>{d.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <TextInput defaultValue={x.car} onBlur={(e) => setEntry(x, { car: e.target.value })} placeholder="Car" />
            <span className="aes-edit-total mono">{x.pts}</span>
            <div className="aes-edit-actions"><button className="aes-icon-btn danger" onClick={() => delDriver(x)}><Trash2 size={15} /></button></div>
          </div>
        ))}
        {shown.length === 0 && <div className="aes-filter-empty">No drivers match.</div>}
      </div>
      <p className="aes-hint">Drivers are shared people — number, class, team &amp; car here belong to their car this season (co-drivers share one car). Points total automatically from results.</p>
    </>
  );
}

function TeamsTab({ supabase, d, reload }) {
  const [q, setQ] = useState("");
  const setTeam = async (t, patch) => { await supabase.from("teams").update(patch).eq("id", t.id); };
  const addTeam = async () => { await supabase.from("teams").insert({ name: "New Team" }); reload(); };
  const delTeam = async (t) => { if (confirm("Delete this team?")) { await supabase.from("teams").delete().eq("id", t.id); reload(); } };
  const tq = q.trim().toLowerCase();
  const shown = d.teams.filter((t) => !tq || String(t.name || "").toLowerCase().includes(tq));
  return (
    <>
      <div className="aes-admin-addbar">
        <button className="aes-btn primary sm" onClick={addTeam}><Plus size={14} /> Add team</button>
        <div className="aes-filter"><Search size={14} /><input className="aes-filter-input" placeholder="Filter teams…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="aes-edit-list">
        <div className="aes-edit-row team head"><span>Team name</span><span>Drivers</span><span /></div>
        {shown.map((t) => {
          const count = d.seasonDrivers.filter((x) => x.teamId === t.id).length;
          return (
            <div key={t.id} className="aes-edit-row team">
              <TextInput defaultValue={t.name} onBlur={(e) => setTeam(t, { name: e.target.value })} placeholder="Team name" />
              <span className="aes-edit-meta mono">{count} driver{count !== 1 ? "s" : ""}</span>
              <div className="aes-edit-actions"><button className="aes-icon-btn danger" onClick={() => delTeam(t)}><Trash2 size={15} /></button></div>
            </div>
          );
        })}
        {shown.length === 0 && <div className="aes-filter-empty">No teams match.</div>}
      </div>
    </>
  );
}

function LeagueTab({ supabase, d, reload }) {
  const s = d.settings;
  const season = d.seasons.find((x) => x.id === d.seasonId);
  const setS = async (patch) => { await supabase.from("league_settings").upsert({ id: 1, ...patch }); reload(); };
  const setSeason = async (patch) => { if (season) { await supabase.from("seasons").update(patch).eq("id", season.id); reload(); } };
  const addSeason = async () => { await supabase.from("seasons").insert({ name: "New Season", year: new Date().getFullYear(), is_current: false, points_table: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] }); reload(); };
  const addTrack = async () => { await supabase.from("tracks").insert({ name: "New Circuit", location: "" }); reload(); };
  const setTrack = async (t, patch) => { await supabase.from("tracks").update(patch).eq("id", t.id); };
  const delTrack = async (t) => { if (confirm("Delete this track from the catalog?")) { await supabase.from("tracks").delete().eq("id", t.id); reload(); } };

  return (
    <div className="aes-edit-card" style={{ padding: 18 }}>
      <div className="aes-edit-grid">
        <Field label="League name"><TextInput defaultValue={s.name || ""} onBlur={(e) => setS({ name: e.target.value })} /></Field>
        <Field label="Tagline"><TextInput defaultValue={s.tagline || ""} onBlur={(e) => setS({ tagline: e.target.value })} /></Field>
        <Field label="Timezone label"><TextInput defaultValue={s.timezone || ""} onBlur={(e) => setS({ timezone: e.target.value })} /></Field>
        <Field label="Discord link"><TextInput defaultValue={s.discord_url || ""} onBlur={(e) => setS({ discord_url: e.target.value })} /></Field>
        <Field label="Broadcast link"><TextInput defaultValue={s.broadcast_url || ""} onBlur={(e) => setS({ broadcast_url: e.target.value })} /></Field>
        <Field label="Rulebook link"><TextInput defaultValue={s.rulebook_url || ""} onBlur={(e) => setS({ rulebook_url: e.target.value })} /></Field>
        <Field label="Current season">
          <select className="aes-input" value={s.current_season_id || ""} onChange={(e) => setS({ current_season_id: e.target.value })}>
            {d.seasons.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
      </div>

      {season && (
        <div className="aes-points-edit">
          <span className="aes-field-label">{season.name} — championship points by finishing position</span>
          <input className="aes-input mono" defaultValue={(season.points_table || []).join(", ")} onBlur={(e) => setSeason({ points_table: e.target.value.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n)) })} />
          <span className="aes-points-hint">P1 first, comma-separated. Used when a results PDF is imported and by Auto-fill points — each class scores independently, and the round's points multiplier is applied on top.</span>
        </div>
      )}

      <div className="aes-edit-sub" style={{ marginTop: 16 }}>
        <div className="aes-edit-sub-head"><b>Seasons</b><button className="aes-btn ghost xs" onClick={addSeason}><Plus size={12} /> Add season</button></div>
        {d.seasons.map((x) => (
          <div key={x.id} className="aes-edit-srow" style={{ gridTemplateColumns: "1.4fr 90px 110px 36px" }}>
            <TextInput defaultValue={x.name} onBlur={(e) => supabase.from("seasons").update({ name: e.target.value }).eq("id", x.id)} />
            <NumInput defaultValue={x.year} onBlur={(e) => supabase.from("seasons").update({ year: Number(e.target.value) }).eq("id", x.id)} />
            <label className="aes-mini-check"><input type="checkbox" defaultChecked={x.is_current} onChange={(e) => supabase.from("seasons").update({ is_current: e.target.checked }).eq("id", x.id)} /> current</label>
            <button className="aes-icon-btn danger" onClick={async () => { if (confirm("Delete season " + x.name + "?")) { await supabase.from("seasons").delete().eq("id", x.id); reload(); } }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      <div className="aes-edit-sub">
        <div className="aes-edit-sub-head"><b>Track catalog</b><button className="aes-btn ghost xs" onClick={addTrack}><Plus size={12} /> Add track</button></div>
        {d.tracks.map((t) => (
          <div key={t.id} className="aes-edit-srow" style={{ gridTemplateColumns: "1.3fr 1.3fr 36px" }}>
            <TextInput defaultValue={t.name} onBlur={(e) => setTrack(t, { name: e.target.value })} placeholder="Track name" />
            <TextInput defaultValue={t.location} onBlur={(e) => setTrack(t, { location: e.target.value })} placeholder="Location" />
            <button className="aes-icon-btn danger" onClick={() => delTrack(t)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------- shell ----------------------------------- */
function Shell({ supabase, session }) {
  const [tab, setTab] = useState("events");
  const [editSeason, setEditSeason] = useState("");
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoAdd, setAutoAdd] = useState(true);

  const reload = useCallback(async () => {
    const next = await loadAdminData(supabase, editSeason || undefined);
    setD(next); if (!editSeason) setEditSeason(next.seasonId); setLoading(false);
  }, [supabase, editSeason]);
  useEffect(() => { reload(); }, [reload]);

  const addEvent = async () => {
    const round = (d?.events.length || 0) + 1;
    await supabase.from("events").insert({ season_id: d.seasonId, round, status: "upcoming", duration_h: 6, sim_start_hour: 12, time_mult: 1, points_mult: 1 });
    reload();
  };

  if (loading || !d) return <div className="aes-admin"><div className="aes-empty"><Loader2 size={16} className="aes-spin" /> Loading…</div></div>;

  return (
    <div className="aes-admin">
      <div className="aes-admin-top">
        <div className="aes-admin-title"><Settings size={18} /> Race Control <span className="aes-admin-mode">ADMIN</span></div>
        <div className="aes-admin-actions">
          <select className="aes-input aes-season-pick" value={editSeason} onChange={(e) => { setEditSeason(e.target.value); setLoading(true); }}>
            {d.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? " · current" : ""}</option>)}
          </select>
          <a className="aes-btn ghost sm" href="/"><Eye size={14} /> View site</a>
          <button className="aes-btn ghost sm" onClick={() => supabase.auth.signOut()}><LogOut size={14} /> Sign out</button>
        </div>
      </div>

      <div className="aes-admin-tabs">
        {[["events", "Events"], ["drivers", "Drivers"], ["teams", "Teams"], ["league", "League"]].map(([id, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      <div className="aes-admin-body">
        {tab === "events" && (
          <>
            <div className="aes-admin-addbar">
              <button className="aes-btn primary sm" onClick={addEvent}><Plus size={14} /> Add event</button>
              <label className="aes-mini-check"><input type="checkbox" checked={autoAdd} onChange={(e) => setAutoAdd(e.target.checked)} /> auto-add new drivers on PDF import</label>
            </div>
            {d.events.length === 0 && <div className="aes-empty">No rounds yet. Click “Add event”, open it, and pick a track.</div>}
            {d.events.map((ev) => <EventCard key={ev.id} supabase={supabase} d={d} ev={ev} reload={reload} autoAdd={autoAdd} />)}
          </>
        )}
        {tab === "drivers" && <DriversTab supabase={supabase} d={d} reload={reload} />}
        {tab === "teams" && <TeamsTab supabase={supabase} d={d} reload={reload} />}
        {tab === "league" && <LeagueTab supabase={supabase} d={d} reload={reload} />}
      </div>
    </div>
  );
}

/* -------------------------------- root ----------------------------------- */
export default function AdminApp() {
  const supabase = getSupabase();
  const [session, setSession] = useState(undefined); // undefined = connecting
  const [authMsg, setAuthMsg] = useState("");

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) { if (active) setSession(data.session); return; }
      try {
        const r = await fetch("/api/admin-session", { method: "POST" });
        const out = await r.json();
        if (!r.ok || out.error) { if (active) { setAuthMsg(out.error || "Admin not configured."); setSession(null); } return; }
        const { data: sd, error } = await supabase.auth.setSession({ access_token: out.access_token, refresh_token: out.refresh_token });
        if (active) { if (error) { setAuthMsg(error.message); setSession(null); } else setSession(sd.session); }
      } catch (e) { if (active) { setAuthMsg(String(e?.message || e)); setSession(null); } }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (active) setSession(s); });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [supabase]);

  return (
    <div className="aes">
      <Styles />
      {!supabase ? (
        <div className="aes-gate-wrap"><div className="aes-gate"><p>Database not configured — set the Supabase env vars first.</p></div></div>
      ) : session === undefined ? (
        <div className="aes-gate-wrap"><div className="aes-gate"><Loader2 size={20} className="aes-spin" style={{ color: "var(--signal)" }} /><p style={{ marginTop: 12 }}>Opening Race Control…</p></div></div>
      ) : !session ? (
        <div className="aes-gate-wrap"><div className="aes-gate"><Lock size={22} style={{ color: "var(--signal)" }} /><h2>Admin unavailable</h2><p>{authMsg || "Couldn't connect to the admin account. Set ADMIN_EMAIL and ADMIN_PASSWORD in your host's environment variables and redeploy."}</p></div></div>
      ) : (
        <Shell supabase={supabase} session={session} />
      )}
    </div>
  );
}

/* -------------------------------- styles --------------------------------- */
function Styles() {
  return <style>{CSS}</style>;
}
const CSS = `
.aes{ --carbon:#0B0E14; --graphite:#141A24; --panel:#10151F; --steel:#1A2230; --line:#27313F;
  --chalk:#E8ECF2; --mist:#8A95A5; --mist2:#5A6677; --signal:#F5EE30; --amber:#FFB627; --green:#5BD6A0; --accent2:#37C2F0;
  --disp:'Saira Condensed',sans-serif; --body:'Saira',sans-serif; --mono:'JetBrains Mono',monospace;
  background:var(--carbon); color:var(--chalk); font-family:var(--body); min-height:100vh; }
.aes *{ box-sizing:border-box; }
.mono{ font-family:var(--mono); }
.aes-btn{ display:inline-flex; align-items:center; gap:6px; border-radius:8px; font-family:var(--body); font-weight:600;
  font-size:13px; padding:9px 14px; cursor:pointer; border:1px solid var(--line); background:var(--graphite); color:var(--chalk); }
.aes-btn.sm{ padding:7px 11px; font-size:12.5px; } .aes-btn.xs{ padding:5px 9px; font-size:11.5px; }
.aes-btn.ghost{ background:none; } .aes-btn.ghost:hover{ border-color:var(--signal); color:var(--chalk); }
.aes-btn.primary{ background:var(--signal); color:#141200; border-color:var(--signal); }
.aes-btn.primary:hover{ filter:brightness(1.05); } .aes-btn:disabled{ opacity:.6; cursor:default; }
.aes-spin{ animation:aes-spin .9s linear infinite; } @keyframes aes-spin{ to{ transform:rotate(360deg); } }
.aes-input{ width:100%; background:var(--carbon); border:1px solid var(--line); color:var(--chalk);
  border-radius:8px; padding:9px 11px; font-family:var(--body); font-size:14px; }
.aes-input:focus{ border-color:var(--accent2); outline:none; }
.aes-input.lg{ font-size:22px; text-align:center; letter-spacing:.4em; padding:13px; font-family:var(--mono); margin-bottom:6px; }
.aes-input.err{ border-color:var(--signal); }
textarea.aes-input{ resize:vertical; font-family:var(--body); }
.aes-field{ display:flex; flex-direction:column; gap:5px; }
.aes-field>span{ font-family:var(--mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--mist); }
.aes-mini-check{ display:flex; align-items:center; gap:6px; font-size:12px; color:var(--mist); white-space:nowrap; }
.aes-mini-check input{ accent-color:var(--signal); }

.aes-gate-wrap{ min-height:100vh; display:grid; place-items:center; padding:20px; }
.aes-gate{ width:100%; max-width:360px; background:var(--graphite); border:1px solid var(--line); border-radius:16px; padding:30px 26px; text-align:center; }
.aes-gate h2{ font-size:22px; font-weight:700; margin:14px 0 6px; }
.aes-gate p{ color:var(--mist); font-size:13.5px; margin:0 0 18px; }
.aes-err-msg{ color:var(--signal); font-size:12.5px; margin:8px 0; }

.aes-admin{ max-width:1080px; margin:0 auto; padding:0 24px 60px; }
.aes-admin-top{ position:sticky; top:0; z-index:30; display:flex; align-items:center; gap:14px; flex-wrap:wrap;
  padding:16px 0; background:var(--carbon); border-bottom:1px solid var(--line); margin-bottom:18px; }
.aes-admin-title{ display:flex; align-items:center; gap:9px; font-family:var(--disp); font-weight:700; font-size:20px; }
.aes-admin-title svg{ color:var(--signal); }
.aes-admin-mode{ font-family:var(--mono); font-size:9px; letter-spacing:.2em; background:var(--signal); color:#141200; padding:2px 6px; border-radius:4px; }
.aes-admin-actions{ display:flex; gap:8px; flex-wrap:wrap; margin-left:auto; align-items:center; }
.aes-season-pick{ width:auto; min-width:150px; padding:7px 10px; font-size:12.5px; }
.aes-admin-tabs{ display:flex; gap:4px; margin-bottom:20px; flex-wrap:wrap; }
.aes-admin-tabs button{ background:var(--graphite); border:1px solid var(--line); color:var(--mist); font-weight:600; font-size:13px; padding:9px 16px; border-radius:8px; cursor:pointer; }
.aes-admin-tabs button.on{ background:var(--steel); color:var(--chalk); border-color:var(--mist2); }
.aes-admin-addbar{ margin-bottom:14px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.aes-admin-body{ display:flex; flex-direction:column; gap:12px; }
.aes-hint{ color:var(--mist2); font-size:12.5px; margin:8px 0 0; }
.aes-empty{ text-align:center; color:var(--mist); font-size:14px; padding:40px 20px; border:1px dashed var(--line); border-radius:12px; display:flex; gap:8px; align-items:center; justify-content:center; }

.aes-filter{ display:flex; align-items:center; gap:7px; background:var(--graphite); border:1px solid var(--line); border-radius:8px; padding:0 10px; flex:1; min-width:200px; }
.aes-filter>svg{ color:var(--mist); flex:none; }
.aes-filter-input{ background:none; border:none; color:var(--chalk); font-family:var(--body); font-size:13.5px; padding:8px 0; flex:1; outline:none; min-width:60px; }
.aes-filter-input::placeholder{ color:var(--mist2); }
.aes-filter-cls{ width:auto; min-width:130px; padding:8px 10px; font-size:13px; flex:none; }
.aes-filter-empty{ color:var(--mist); font-size:13px; padding:18px 8px; text-align:center; }

.aes-edit-card{ background:var(--graphite); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
.aes-edit-card-head{ display:flex; align-items:center; gap:12px; padding:14px 16px; cursor:pointer; }
.aes-edit-card-head:hover{ background:rgba(255,255,255,.02); }
.aes-edit-round{ font-family:var(--disp); font-weight:700; font-size:17px; color:var(--mist); }
.aes-edit-track{ font-weight:600; font-size:15px; }
.aes-edit-spacer{ flex:1; }
.aes-edit-chev{ color:var(--mist2); transition:transform .2s; } .aes-edit-chev.open{ transform:rotate(90deg); }
.aes-edit-card-body{ padding:4px 16px 18px; display:flex; flex-direction:column; gap:16px; border-top:1px solid var(--line); }
.aes-edit-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:13px; margin-top:14px; }
.aes-edit-sub{ background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:13px; }
.aes-edit-sub-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:11px; font-size:13px; }
.aes-edit-srow{ display:grid; grid-template-columns:130px 1fr 90px 36px; gap:8px; margin-bottom:8px; align-items:center; }
.aes-edit-wrow{ display:grid; grid-template-columns:repeat(2,1fr) 1.5fr repeat(3,1fr) 36px; gap:6px; margin-bottom:7px; align-items:center; }
.aes-wx-edit-head{ display:grid; grid-template-columns:repeat(2,1fr) 1.5fr repeat(3,1fr) 36px; gap:6px; font-size:11px; color:var(--mist); font-weight:600; margin-bottom:7px; padding:0 2px; }
.aes-chip{ font-family:var(--mono); font-size:10px; letter-spacing:.05em; padding:3px 8px; border-radius:5px; border:1px solid var(--line); color:var(--mist); }
.aes-chip.complete{ color:var(--green); border-color:var(--green); } .aes-chip.next{ color:var(--signal); border-color:var(--signal); }

.aes-edit-list{ display:flex; flex-direction:column; gap:8px; }
.aes-edit-row{ display:grid; gap:8px; align-items:center; background:var(--graphite); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
.aes-edit-row.driver{ grid-template-columns:50px 1.3fr 90px 1fr 90px 1.25fr 56px auto; }
.aes-edit-row.team{ grid-template-columns:1fr auto auto; }
.aes-edit-row.head{ background:none; border:none; padding:2px 12px 0; align-items:end; }
.aes-edit-row.head span{ font-family:var(--mono); font-size:9.5px; letter-spacing:.07em; text-transform:uppercase; color:var(--mist2); }
.aes-edit-actions{ display:flex; gap:6px; justify-content:flex-end; }
.aes-edit-total{ text-align:center; font-weight:700; color:var(--amber); }
.aes-edit-meta{ color:var(--mist); font-size:12.5px; }
.aes-icon-btn{ display:grid; place-items:center; background:var(--steel); border:1px solid var(--line); border-radius:7px; width:34px; height:34px; color:var(--mist); cursor:pointer; }
.aes-icon-btn:hover{ color:var(--chalk); } .aes-icon-btn.danger:hover{ color:var(--signal); border-color:var(--signal); }

.aes-drop{ border:1.5px dashed var(--line); border-radius:12px; padding:22px 18px; text-align:center; cursor:pointer; color:var(--mist); background:var(--carbon); }
.aes-drop:hover,.aes-drop.over{ border-color:var(--signal); color:var(--chalk); background:rgba(245,238,48,.05); }
.aes-drop>svg{ color:var(--signal); }
.aes-drop-title{ font-weight:600; color:var(--chalk); margin-top:8px; font-size:14px; }
.aes-drop-sub{ font-size:12px; margin-top:3px; color:var(--mist); }
.aes-import-err{ display:flex; align-items:center; gap:6px; color:var(--signal); font-size:12.5px; margin-top:9px; }
.aes-import-note{ font-size:12px; color:var(--mist); margin:4px 0 10px; line-height:1.45; }
.aes-import-actions{ display:flex; gap:8px; margin-top:10px; }
.aes-import-done{ display:flex; align-items:center; gap:8px; color:var(--green); font-size:13px; font-weight:600; }
.aes-res-scroll{ overflow-x:auto; border:1px solid var(--line); border-radius:9px; margin-top:4px; }
.aes-res-grid{ min-width:900px; }
.aes-res-head,.aes-res-row{ display:grid; grid-template-columns:1.6fr 56px 60px 56px 60px 96px 50px 96px 64px 56px 32px; gap:6px; align-items:center; padding:6px 8px; }
.aes-res-head{ position:sticky; top:0; background:var(--graphite); font-family:var(--mono); font-size:9px; letter-spacing:.05em; text-transform:uppercase; color:var(--mist); border-bottom:1px solid var(--line); }
.aes-res-row{ border-bottom:1px solid var(--steel); } .aes-res-row:last-child{ border-bottom:none; }
.aes-res-grid .aes-input{ padding:6px 7px; font-size:12.5px; }
.aes-res-grid .aes-icon-btn{ justify-self:center; width:30px; height:30px; }
.aes-points-edit{ margin-top:14px; display:flex; flex-direction:column; gap:6px; }
.aes-field-label{ font-family:var(--mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--mist); }
.aes-points-hint{ font-size:11.5px; color:var(--mist2); line-height:1.45; }
@media (max-width:820px){
  .aes-edit-row.driver{ grid-template-columns:1fr 1fr; }
  .aes-edit-srow,.aes-edit-wrow,.aes-wx-edit-head{ grid-template-columns:1fr 1fr; }
  .aes-wx-edit-head,.aes-edit-row.head{ display:none; }
}
`;
