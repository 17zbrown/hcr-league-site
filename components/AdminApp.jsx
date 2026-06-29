"use client";
import { useState, useEffect, useCallback } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { LogOut, Plus, Trash2, Save, Loader2, RefreshCw } from "lucide-react";

/* ---- table definitions (the simple, flat lists) ------------------------- */
const TABLES = {
  drivers: {
    label: "Drivers", autoId: true, order: "name",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "country", label: "Flag", type: "text", w: 70 },
      { key: "iracing_custid", label: "iRacing ID", type: "text", w: 110 },
      { key: "bio", label: "Bio", type: "textarea" },
    ],
  },
  teams: {
    label: "Teams", autoId: true, order: "name",
    fields: [{ key: "name", label: "Name", type: "text" }],
  },
  tracks: {
    label: "Tracks", autoId: true, order: "name",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "length_km", label: "Length (km)", type: "number", w: 110 },
      { key: "corners", label: "Corners", type: "number", w: 90 },
    ],
  },
  classes: {
    label: "Classes", autoId: false, pk: "id", order: "sort",
    fields: [
      { key: "id", label: "ID", type: "text", w: 90 },
      { key: "name", label: "Name", type: "text" },
      { key: "color", label: "Color", type: "color", w: 70 },
      { key: "sort", label: "Sort", type: "number", w: 70 },
    ],
  },
  seasons: {
    label: "Seasons", autoId: true, order: "year",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "year", label: "Year", type: "number", w: 90 },
      { key: "is_current", label: "Current?", type: "bool", w: 80 },
      { key: "drop_weeks", label: "Drop weeks", type: "number", w: 100 },
    ],
  },
};

const TAB_ORDER = ["settings", "seasons", "classes", "teams", "drivers", "tracks"];

function coerce(field, value) {
  if (value === "" || value === undefined || value === null) {
    return field.type === "number" ? null : (field.type === "bool" ? false : "");
  }
  if (field.type === "number") { const n = Number(value); return Number.isNaN(n) ? null : n; }
  if (field.type === "bool") return Boolean(value);
  return value;
}

/* ---- generic editor for a flat table ------------------------------------ */
function TableEditor({ supabase, name }) {
  const cfg = TABLES[name];
  const pk = cfg.pk || "id";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingIdx, setSavingIdx] = useState(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setMsg("");
    const { data, error } = await supabase.from(name).select("*").order(cfg.order, { ascending: true });
    if (error) setMsg("Load error: " + error.message);
    setRows(data || []);
    setLoading(false);
  }, [supabase, name, cfg.order]);

  useEffect(() => { load(); }, [load]);

  const setCell = (i, key, val) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));

  const addRow = () => {
    const blank = {};
    cfg.fields.forEach((f) => { if (!(cfg.autoId && f.key === pk)) blank[f.key] = f.type === "bool" ? false : ""; });
    setRows((rs) => [...rs, blank]);
  };

  const saveRow = async (i) => {
    setSavingIdx(i); setMsg("");
    const raw = rows[i];
    const payload = {};
    cfg.fields.forEach((f) => { payload[f.key] = coerce(f, raw[f.key]); });
    // keep existing pk for updates; drop empty pk so the DB can generate it
    if (raw[pk] !== undefined && raw[pk] !== "") payload[pk] = raw[pk];
    const { error } = await supabase.from(name).upsert(payload, { onConflict: pk }).select();
    setSavingIdx(null);
    if (error) { setMsg("Save error: " + error.message); return; }
    setMsg("Saved ✓");
    load();
  };

  const delRow = async (i) => {
    const raw = rows[i];
    if (raw[pk] === undefined || raw[pk] === "") { setRows((rs) => rs.filter((_, idx) => idx !== i)); return; }
    const { error } = await supabase.from(name).delete().eq(pk, raw[pk]);
    if (error) { setMsg("Delete error: " + error.message); return; }
    load();
  };

  return (
    <div className="ad-section">
      <div className="ad-sec-head">
        <h2>{cfg.label}</h2>
        <div className="ad-sec-actions">
          {msg && <span className={"ad-msg" + (msg.includes("error") ? " err" : "")}>{msg}</span>}
          <button className="ad-btn ghost" onClick={load} title="Reload"><RefreshCw size={14} /></button>
          <button className="ad-btn" onClick={addRow}><Plus size={14} /> Add</button>
        </div>
      </div>
      {loading ? (
        <div className="ad-loading"><Loader2 size={16} className="spin" /> Loading…</div>
      ) : (
        <div className="ad-rows">
          {rows.length === 0 && <div className="ad-empty">No {cfg.label.toLowerCase()} yet. Click “Add”.</div>}
          {rows.map((r, i) => (
            <div className="ad-row" key={r[pk] || "new-" + i}>
              {cfg.fields.map((f) => (
                <label className="ad-field" key={f.key} style={f.w ? { flex: "0 0 " + f.w + "px" } : null}>
                  <span className="ad-flabel">{f.label}</span>
                  {f.type === "textarea" ? (
                    <textarea className="ad-in" rows={1} value={r[f.key] ?? ""} onChange={(e) => setCell(i, f.key, e.target.value)} />
                  ) : f.type === "bool" ? (
                    <input type="checkbox" className="ad-check" checked={!!r[f.key]} onChange={(e) => setCell(i, f.key, e.target.checked)} />
                  ) : f.type === "color" ? (
                    <input type="color" className="ad-color" value={r[f.key] || "#ffffff"} onChange={(e) => setCell(i, f.key, e.target.value)} />
                  ) : (
                    <input type={f.type === "number" ? "number" : "text"} className="ad-in" value={r[f.key] ?? ""} onChange={(e) => setCell(i, f.key, e.target.value)} />
                  )}
                </label>
              ))}
              <div className="ad-row-actions">
                <button className="ad-btn sm" onClick={() => saveRow(i)} disabled={savingIdx === i}>
                  {savingIdx === i ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
                </button>
                <button className="ad-btn sm danger" onClick={() => delRow(i)}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- league settings (single row) --------------------------------------- */
function SettingsEditor({ supabase }) {
  const [s, setS] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data: row }, { data: ss }] = await Promise.all([
      supabase.from("league_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("seasons").select("id,name").order("year"),
    ]);
    setS(row || { id: 1, name: "HCR League", tagline: "", timezone: "ET", discord_url: "", broadcast_url: "", rulebook_url: "", current_season_id: null });
    setSeasons(ss || []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setMsg("");
    const { error } = await supabase.from("league_settings").upsert({ ...s, id: 1 }).select();
    setSaving(false);
    setMsg(error ? "Save error: " + error.message : "Saved ✓");
  };

  if (!s) return <div className="ad-loading"><Loader2 size={16} className="spin" /> Loading…</div>;
  const set = (k, v) => setS((o) => ({ ...o, [k]: v }));
  const F = [
    ["name", "League name"], ["tagline", "Tagline"], ["timezone", "Timezone label"],
    ["discord_url", "Discord URL"], ["broadcast_url", "Broadcast URL"], ["rulebook_url", "Rulebook URL"],
  ];
  return (
    <div className="ad-section">
      <div className="ad-sec-head"><h2>League settings</h2>
        <div className="ad-sec-actions">
          {msg && <span className={"ad-msg" + (msg.includes("error") ? " err" : "")}>{msg}</span>}
          <button className="ad-btn" onClick={save} disabled={saving}>{saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Save</button>
        </div>
      </div>
      <div className="ad-form">
        {F.map(([k, label]) => (
          <label className="ad-field block" key={k}>
            <span className="ad-flabel">{label}</span>
            <input className="ad-in" value={s[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
        <label className="ad-field block">
          <span className="ad-flabel">Active season</span>
          <select className="ad-in" value={s.current_season_id || ""} onChange={(e) => set("current_season_id", e.target.value || null)}>
            <option value="">— none —</option>
            {seasons.map((se) => <option key={se.id} value={se.id}>{se.name}</option>)}
          </select>
        </label>
      </div>
      <p className="ad-hint">The public site shows the season selected here. Make sure that season is also flagged “Current” in the Seasons tab.</p>
    </div>
  );
}

/* ---- login --------------------------------------------------------------- */
function Login({ supabase, onIn }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) setErr(error.message);
    else onIn();
  };

  return (
    <div className="ad-login">
      <form className="ad-login-card" onSubmit={submit}>
        <div className="ad-login-brand">HCR LEAGUE</div>
        <div className="ad-login-title">Admin sign-in</div>
        <label className="ad-field block"><span className="ad-flabel">Email</span>
          <input className="ad-in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="ad-field block"><span className="ad-flabel">Password</span>
          <input className="ad-in" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
        </label>
        {err && <div className="ad-login-err">{err}</div>}
        <button className="ad-btn full" type="submit" disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : null} Sign in</button>
        <p className="ad-hint center">Admin accounts are created in Supabase. Public sign-ups should be turned off.</p>
      </form>
    </div>
  );
}

/* ---- root ---------------------------------------------------------------- */
export default function AdminApp() {
  const supabase = getSupabase();
  const [session, setSession] = useState(undefined); // undefined = checking
  const [tab, setTab] = useState("settings");

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  if (!supabase) {
    return <div className="ad-wrap"><Styles /><div className="ad-loading">Database not configured — set the Supabase env vars first.</div></div>;
  }
  if (session === undefined) {
    return <div className="ad-wrap"><Styles /><div className="ad-loading"><Loader2 size={16} className="spin" /> Checking session…</div></div>;
  }
  if (!session) {
    return <div className="ad-wrap"><Styles /><Login supabase={supabase} onIn={() => {}} /></div>;
  }

  return (
    <div className="ad-wrap">
      <Styles />
      <header className="ad-top">
        <div className="ad-top-brand">HCR LEAGUE · <span>admin</span></div>
        <div className="ad-top-right">
          <a className="ad-btn ghost" href="/">View site</a>
          <span className="ad-who">{session.user?.email}</span>
          <button className="ad-btn ghost" onClick={() => supabase.auth.signOut()}><LogOut size={14} /> Sign out</button>
        </div>
      </header>
      <nav className="ad-tabs">
        {TAB_ORDER.map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "settings" ? "Settings" : TABLES[t].label}
          </button>
        ))}
      </nav>
      <main className="ad-main">
        {tab === "settings" ? <SettingsEditor supabase={supabase} /> : <TableEditor supabase={supabase} name={tab} />}
        <p className="ad-hint">Events, entries &amp; results editors are coming next. For now those can be edited in the Supabase Table Editor, or just ask Claude.</p>
      </main>
    </div>
  );
}

/* ---- styles -------------------------------------------------------------- */
function Styles() {
  return (
    <style>{`
:root{ --c-bg:#0B0E14; --c-panel:#141A24; --c-panel2:#10151F; --c-line:#27313F; --c-text:#E8ECF2; --c-mist:#8A95A5; --c-sig:#F5EE30; --c-green:#5BD6A0; --c-red:#FF6B6B; }
.ad-wrap{ min-height:100vh; background:var(--c-bg); color:var(--c-text); font-family:'Saira',system-ui,sans-serif; }
.ad-loading,.ad-empty{ display:flex; align-items:center; gap:8px; justify-content:center; padding:40px; color:var(--c-mist); font-size:14px; }
.spin{ animation:adspin 1s linear infinite; } @keyframes adspin{ to{ transform:rotate(360deg); } }
.ad-top{ display:flex; align-items:center; justify-content:space-between; padding:0 20px; height:56px; border-bottom:1px solid var(--c-line); background:rgba(11,14,20,.9); position:sticky; top:0; z-index:5; }
.ad-top-brand{ font-family:'Saira Condensed',sans-serif; font-weight:700; letter-spacing:.04em; }
.ad-top-brand span{ color:var(--c-sig); }
.ad-top-right{ display:flex; align-items:center; gap:12px; }
.ad-who{ font-size:12px; color:var(--c-mist); }
.ad-tabs{ display:flex; gap:4px; padding:10px 16px; border-bottom:1px solid var(--c-line); overflow-x:auto; }
.ad-tabs button{ background:none; border:none; color:var(--c-mist); font-weight:600; font-size:14px; padding:8px 13px; border-radius:7px; cursor:pointer; white-space:nowrap; }
.ad-tabs button:hover{ color:var(--c-text); background:var(--c-panel); }
.ad-tabs button.on{ color:#0B0E14; background:var(--c-sig); }
.ad-main{ max-width:1000px; margin:0 auto; padding:22px 16px 60px; }
.ad-section{ background:var(--c-panel); border:1px solid var(--c-line); border-radius:14px; padding:18px; }
.ad-sec-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; gap:10px; flex-wrap:wrap; }
.ad-sec-head h2{ margin:0; font-family:'Saira Condensed',sans-serif; font-size:20px; }
.ad-sec-actions{ display:flex; align-items:center; gap:8px; }
.ad-msg{ font-size:12px; color:var(--c-green); } .ad-msg.err{ color:var(--c-red); }
.ad-rows,.ad-form{ display:flex; flex-direction:column; gap:10px; }
.ad-row{ display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; padding:11px; background:var(--c-panel2); border:1px solid var(--c-line); border-radius:10px; }
.ad-field{ display:flex; flex-direction:column; gap:4px; flex:1 1 130px; min-width:0; }
.ad-field.block{ flex:1 1 100%; }
.ad-flabel{ font-size:10px; letter-spacing:.06em; text-transform:uppercase; color:var(--c-mist); font-family:'JetBrains Mono',monospace; }
.ad-in{ width:100%; background:var(--c-bg); border:1px solid var(--c-line); color:var(--c-text); border-radius:8px; padding:8px 10px; font-size:14px; font-family:inherit; }
.ad-in:focus{ outline:none; border-color:var(--c-sig); }
textarea.ad-in{ resize:vertical; min-height:36px; }
.ad-check{ width:20px; height:20px; accent-color:var(--c-sig); }
.ad-color{ width:100%; height:36px; background:none; border:1px solid var(--c-line); border-radius:8px; padding:2px; }
.ad-row-actions{ display:flex; gap:6px; }
.ad-btn{ display:inline-flex; align-items:center; gap:6px; background:var(--c-sig); color:#0B0E14; border:none; font-weight:700; font-size:13px; padding:8px 13px; border-radius:8px; cursor:pointer; font-family:inherit; }
.ad-btn:hover{ filter:brightness(1.05); } .ad-btn:disabled{ opacity:.6; cursor:default; }
.ad-btn.ghost{ background:none; border:1px solid var(--c-line); color:var(--c-mist); text-decoration:none; }
.ad-btn.ghost:hover{ border-color:var(--c-sig); color:var(--c-text); filter:none; }
.ad-btn.sm{ padding:8px 9px; }
.ad-btn.danger{ background:none; border:1px solid var(--c-line); color:var(--c-red); }
.ad-btn.danger:hover{ border-color:var(--c-red); filter:none; }
.ad-btn.full{ width:100%; justify-content:center; padding:11px; margin-top:4px; }
.ad-hint{ color:var(--c-mist); font-size:12px; margin-top:14px; line-height:1.5; }
.ad-hint.center{ text-align:center; }
.ad-login{ min-height:100vh; display:grid; place-items:center; padding:20px; }
.ad-login-card{ width:100%; max-width:360px; background:var(--c-panel); border:1px solid var(--c-line); border-radius:16px; padding:26px; display:flex; flex-direction:column; gap:12px; }
.ad-login-brand{ font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.2em; color:var(--c-sig); text-align:center; }
.ad-login-title{ font-family:'Saira Condensed',sans-serif; font-size:22px; font-weight:700; text-align:center; margin-bottom:6px; }
.ad-login-err{ background:rgba(255,107,107,.12); border:1px solid rgba(255,107,107,.4); color:var(--c-red); font-size:13px; padding:8px 10px; border-radius:8px; }
`}</style>
  );
}
