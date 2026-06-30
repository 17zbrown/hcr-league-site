import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const num = (v) => (v === null || v === undefined || v === "" ? null : (Number.isNaN(Number(v)) ? null : Number(v)));
const normName = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

// normalize whatever the model returns for a result's drivers into [{name,country,custId}]
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
    if (!SUPA_URL || !SUPA_ANON) return json({ error: "Supabase env vars are not set on the server." }, 500);
    if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY is not set on the server. Add it in your host's environment variables and redeploy." }, 500);

    const { pdf, eventId, seasonId, token, autoAddDrivers = true } = (await req.json()) || {};
    if (!token) return json({ error: "Not signed in." }, 401);
    if (!pdf || !eventId || !seasonId) return json({ error: "Missing pdf, eventId, or seasonId." }, 400);

    const sb = createClient(SUPA_URL, SUPA_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: ures, error: uerr } = await sb.auth.getUser(token);
    const email = ures?.user?.email;
    if (uerr || !email) return json({ error: "Invalid session — sign in again." }, 401);
    const { data: adminRow } = await sb.from("admin_emails").select("email").eq("email", email).maybeSingle();
    if (!adminRow) return json({ error: "This account is not an authorized admin." }, 403);

    const [{ data: classes }, { data: entries }, { data: season }, { data: event }, { data: allDrivers }] = await Promise.all([
      sb.from("classes").select("id,name").order("sort"),
      sb.from("entries").select("id,number,class_id,car").eq("season_id", seasonId),
      sb.from("seasons").select("points_table").eq("id", seasonId).maybeSingle(),
      sb.from("events").select("id,points_mult").eq("id", eventId).maybeSingle(),
      sb.from("drivers").select("id,name,iracing_custid"),
    ]);
    const classIds = (classes || []).map((c) => c.id);
    if (classIds.length === 0) return json({ error: "No classes defined yet." }, 400);
    const pointsTable = Array.isArray(season?.points_table) ? season.points_table : [];
    const pointsMult = Number(event?.points_mult) || 1;

    // driver lookups (mutated as we create new ones)
    const byCust = {}; const byName = {};
    (allDrivers || []).forEach((d) => { if (d.iracing_custid) byCust[String(d.iracing_custid)] = d.id; byName[normName(d.name)] = d.id; });

    const sys =
      "You extract motorsport race results from a results PDF and return STRICT JSON only — no prose, no markdown fences. " +
      'Return {"results":[...]}. Each item: ' +
      '{"pos": number|null (overall finish), "cls_pos": number|null (position within its class), ' +
      '"class": one of [' + classIds.map((c) => `"${c}"`).join(",") + '] (map the sheet\'s class to the closest id, else null), ' +
      '"number": string (car number, digits only, strip "#"), ' +
      '"drivers": array of {"name": string (full driver name), "country": string (flag emoji if a nationality flag is shown, else a country code, else ""), "cust_id": string (iRacing customer/cust id if shown, else "")}, ' +
      '"car": string, "grid": number|null, "laps": number|null, "best_lap": string like "1:35.421" or "", ' +
      '"inc": number|null (incidents if present), "total_time": string, "gap": string, "status": string ("Running","DNF","DNS",...)}. ' +
      "List EVERY classified entry, and include EVERY driver that shares a car (endurance line-ups have multiple). Use the class ids EXACTLY. Unknown fields: null or empty. Output JSON only.";

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

    const entryByKey = {};
    (entries || []).forEach((e) => { entryByKey[`${e.class_id}#${String(e.number)}`] = e; });
    const { data: existing } = await sb.from("results").select("id,class_id,number").eq("event_id", eventId);
    const existById = {};
    (existing || []).forEach((r) => { existById[`${r.class_id}#${String(r.number)}`] = r.id; });

    // resolve a driver to an id, creating them if missing (when autoAddDrivers)
    async function resolveDriver(d) {
      if (d.custId && byCust[d.custId]) return byCust[d.custId];
      const nk = normName(d.name);
      if (nk && byName[nk]) return byName[nk];
      if (!autoAddDrivers) return null;
      const insert = { name: d.name, country: d.country || "", iracing_custid: d.custId ? d.custId : null };
      const { data: created, error } = await sb.from("drivers").insert(insert).select("id").single();
      if (error || !created) return null;
      if (d.custId) byCust[d.custId] = created.id;
      if (nk) byName[nk] = created.id;
      return created.id;
    }

    let inserted = 0, updated = 0, noCar = 0, skipped = 0, createdDrivers = 0, linkedDrivers = 0;
    const startDriverCount = Object.keys(byName).length;

    for (const it of items) {
      const cls = it.class && classIds.includes(it.class) ? it.class : null;
      const number = it.number != null ? String(it.number).replace(/[^0-9A-Za-z]/g, "") : "";
      if (!cls || !number) { skipped++; continue; }
      const key = `${cls}#${number}`;
      const entry = entryByKey[key] || null;
      if (!entry) noCar++;

      const dObjs = driverObjs(it.drivers);
      const driverIds = [];
      if (autoAddDrivers || entry) {
        for (const d of dObjs) {
          const id = await resolveDriver(d);
          if (id) driverIds.push(id);
        }
      }
      // attach line-up to the matched car (so points credit these people)
      if (entry && driverIds.length) {
        const links = driverIds.map((did) => ({ entry_id: entry.id, driver_id: did }));
        const { error: lerr } = await sb.from("entry_drivers").upsert(links, { onConflict: "entry_id,driver_id", ignoreDuplicates: true });
        if (!lerr) linkedDrivers += driverIds.length;
      }

      const cp = num(it.cls_pos);
      let points = 0;
      if (cp && cp >= 1 && cp <= pointsTable.length) points = Number(pointsTable[cp - 1]) || 0;
      points = Math.round(points * pointsMult);

      const payload = {
        event_id: eventId, entry_id: entry ? entry.id : null, class_id: cls, number,
        drivers_text: dObjs.map((d) => d.name).join(" / "), pos: num(it.pos), cls_pos: cp, grid: num(it.grid),
        inc: num(it.inc), laps: num(it.laps), total_time: it.total_time || "", gap: it.gap || "",
        best_lap: it.best_lap || "", status: it.status || "", points, adjust: 0,
      };
      const existingId = existById[key];
      const q = existingId ? sb.from("results").update(payload).eq("id", existingId) : sb.from("results").insert(payload);
      const { error } = await q;
      if (error) return json({ error: "Write error: " + error.message }, 500);
      existingId ? updated++ : inserted++;
    }

    createdDrivers = Object.keys(byName).length - startDriverCount;
    await sb.from("events").update({ status: "complete" }).eq("id", eventId);

    return json({ ok: true, total: items.length, inserted, updated, noCar, skipped, createdDrivers, linkedDrivers });
  } catch (e) {
    return json({ error: "Unexpected error: " + (e?.message || String(e)) }, 500);
  }
}
