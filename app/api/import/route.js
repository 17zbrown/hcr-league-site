import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const num = (v) => (v === null || v === undefined || v === "" ? null : (Number.isNaN(Number(v)) ? null : Number(v)));
const normName = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

function driverObjs(d) {
  if (Array.isArray(d)) {
    return d.map((x) => (typeof x === "string"
      ? { name: x.trim(), country: "", custId: "" }
      : { name: String(x?.name || "").trim(), country: String(x?.country || "").trim(), custId: String(x?.cust_id || x?.custId || "").trim() }
    )).filter((x) => x.name);
  }
  if (typeof d === "string") return d.split("/").map((n) => ({ name: n.trim(), country: "", custId: "" })).filter((x) => x.name);
  return [];
}

export async function POST(req) {
  try {
    if (!URL || !ANON) return json({ error: "Supabase env vars are not set on the server." }, 500);
    if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY is not set on the server. Add it in your host's environment variables and redeploy." }, 500);

    const { pdf, eventId, seasonId, token, autoAddDrivers = true } = (await req.json()) || {};
    if (!token) return json({ error: "Not signed in." }, 401);
    if (!pdf || !eventId || !seasonId) return json({ error: "Missing pdf, eventId, or seasonId." }, 400);

    const sb = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });

    const { data: ures, error: uerr } = await sb.auth.getUser(token);
    const email = ures?.user?.email;
    if (uerr || !email) return json({ error: "Invalid session — sign in again." }, 401);
    const { data: adminRow } = await sb.from("admin_emails").select("email").eq("email", email).maybeSingle();
    if (!adminRow) return json({ error: "This account is not an authorized admin." }, 403);

    const [{ data: classes }, { data: teams }, { data: season }, { data: event }, { data: allDrivers }] = await Promise.all([
      sb.from("classes").select("id,name").order("sort"),
      sb.from("teams").select("id,name,number,class_id,car"),
      sb.from("seasons").select("points_table").eq("id", seasonId).maybeSingle(),
      sb.from("events").select("id,points_mult").eq("id", eventId).maybeSingle(),
      sb.from("drivers").select("id,name,iracing_custid,team_id"),
    ]);
    const classIds = (classes || []).map((c) => c.id);
    if (classIds.length === 0) return json({ error: "No classes defined yet." }, 400);
    const pointsTable = Array.isArray(season?.points_table) ? season.points_table : [];
    const pointsMult = Number(event?.points_mult) || 1;

    const teamByKey = {};
    (teams || []).forEach((t) => { if (t.number != null && t.class_id) teamByKey[`${t.class_id}#${String(t.number)}`] = t; });
    const byCust = {}; const byName = {};
    (allDrivers || []).forEach((d) => { if (d.iracing_custid) byCust[String(d.iracing_custid)] = d; byName[normName(d.name)] = d; });

    const sys =
      "You extract motorsport race results from a results PDF and return STRICT JSON only — no prose, no markdown fences. " +
      'Return {"results":[...]}. Each item: ' +
      '{"pos": number|null (overall finish), "cls_pos": number|null (position within its class), ' +
      '"class": one of [' + classIds.map((c) => `"${c}"`).join(",") + '] (map the sheet\'s class to the closest id, else null), ' +
      '"number": string (car number, digits only, strip "#"), ' +
      '"drivers": array of {"name": string, "country": string (flag emoji if shown, else code, else ""), "cust_id": string (iRacing id if shown, else "")}, ' +
      '"car": string, "grid": number|null, "laps": number|null, "best_lap": string like "1:35.421" or "", ' +
      '"inc": number|null, "total_time": string, "gap": string, "status": string ("Running","DNF","DNS",...)}. ' +
      "List EVERY classified entry and EVERY driver sharing a car. Use the class ids EXACTLY. Unknown fields: null or empty. Output JSON only.";

    const aresp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 8192, system: sys,
        messages: [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } },
          { type: "text", text: "Extract every classified entry and its full driver line-up from this race results sheet as JSON per the schema." },
        ] }],
      }),
    });
    if (!aresp.ok) { const t = await aresp.text(); return json({ error: "Claude API error (" + aresp.status + "): " + t.slice(0, 300) }, 502); }
    const adata = await aresp.json();
    const text = (adata.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    let parsed;
    try { parsed = JSON.parse(text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim()); }
    catch { return json({ error: "Couldn't read results from that PDF. Model returned: " + text.slice(0, 200) }, 422); }
    const items = Array.isArray(parsed?.results) ? parsed.results : [];
    if (items.length === 0) return json({ error: "No results found in that PDF." }, 422);

    const { data: existing } = await sb.from("results").select("id,class_id,number").eq("event_id", eventId);
    const existById = {};
    (existing || []).forEach((r) => { existById[`${r.class_id}#${String(r.number)}`] = r.id; });

    // resolve (or create) a team for a number+class
    async function resolveTeam(cls, number, car) {
      const key = `${cls}#${number}`;
      if (teamByKey[key]) return teamByKey[key];
      if (!autoAddDrivers) return null;
      const { data: created, error } = await sb.from("teams").insert({ name: `#${number} ${cls}`, number: String(number), class_id: cls, car: car || "" }).select("id,name,number,class_id,car").single();
      if (error || !created) return null;
      teamByKey[key] = created;
      return created;
    }
    // resolve (or create) a driver, assigning them to the team
    async function resolveDriver(dobj, teamId) {
      let found = (dobj.custId && byCust[dobj.custId]) || byName[normName(dobj.name)] || null;
      if (found) {
        if (teamId && found.team_id !== teamId) { await sb.from("drivers").update({ team_id: teamId }).eq("id", found.id); found.team_id = teamId; }
        return found;
      }
      if (!autoAddDrivers) return null;
      const ins = { name: dobj.name, country: dobj.country || "", iracing_custid: dobj.custId ? dobj.custId : null, team_id: teamId || null };
      const { data: created, error } = await sb.from("drivers").insert(ins).select("id,name,iracing_custid,team_id").single();
      if (error || !created) return null;
      if (dobj.custId) byCust[dobj.custId] = created;
      byName[normName(dobj.name)] = created;
      return created;
    }

    let inserted = 0, updated = 0, noTeam = 0, skipped = 0, createdDrivers = 0;
    const startDrivers = Object.keys(byName).length;

    for (const it of items) {
      const cls = it.class && classIds.includes(it.class) ? it.class : null;
      const number = it.number != null ? String(it.number).replace(/[^0-9A-Za-z]/g, "") : "";
      if (!cls || !number) { skipped++; continue; }
      const team = await resolveTeam(cls, number, it.car);
      if (!team) noTeam++;

      if (team) {
        for (const dobj of driverObjs(it.drivers)) await resolveDriver(dobj, team.id);
      }

      const cp = num(it.cls_pos);
      let points = 0;
      if (cp && cp >= 1 && cp <= pointsTable.length) points = Number(pointsTable[cp - 1]) || 0;
      points = Math.round(points * pointsMult);

      const payload = {
        event_id: eventId, team_id: team ? team.id : null, class_id: cls, number,
        drivers_text: driverObjs(it.drivers).map((x) => x.name).join(" / "),
        pos: num(it.pos), cls_pos: cp, grid: num(it.grid), inc: num(it.inc), laps: num(it.laps),
        total_time: it.total_time || "", gap: it.gap || "", best_lap: it.best_lap || "", status: it.status || "",
        points, adjust: 0,
      };
      const existingId = existById[`${cls}#${number}`];
      const q = existingId ? sb.from("results").update(payload).eq("id", existingId) : sb.from("results").insert(payload);
      const { error } = await q;
      if (error) return json({ error: "Write error: " + error.message }, 500);
      existingId ? updated++ : inserted++;
    }

    createdDrivers = Object.keys(byName).length - startDrivers;
    await sb.from("events").update({ status: "complete" }).eq("id", eventId);

    return json({ ok: true, total: items.length, inserted, updated, noCar: noTeam, skipped, createdDrivers });
  } catch (e) {
    return json({ error: "Unexpected error: " + (e?.message || String(e)) }, 500);
  }
}
