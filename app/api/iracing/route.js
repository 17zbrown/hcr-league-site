import { iracingAuth, iracingData } from "@/lib/iracing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/* Exploratory iRacing endpoint. Authenticates with server-side credentials, then
   either proxies a /data/* request or fetches a weather-forecast URL.

   Setup (server env vars, NO NEXT_PUBLIC_ prefix):
     IRACING_EMAIL, IRACING_PASSWORD, IRACING_PROBE_KEY

   Usage:
     /api/iracing?key=KEY                                          -> your member info (proves auth)
     /api/iracing?key=KEY&path=/data/league/get&league_id=1        -> league info
     /api/iracing?key=KEY&path=/data/league/cust_league_sessions&mine=1  -> your upcoming league sessions
     /api/iracing?key=KEY&url=<weather forecast url>               -> the hour-by-hour session forecast
*/
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const EMAIL = process.env.IRACING_EMAIL;
  const PASSWORD = process.env.IRACING_PASSWORD;
  const PROBE = process.env.IRACING_PROBE_KEY;

  if (!PROBE) return json({ error: "Set IRACING_PROBE_KEY in the server environment to use this endpoint." }, 500);
  if ((searchParams.get("key") || "") !== PROBE) return json({ error: "Forbidden — missing or incorrect ?key." }, 403);

  // Branch 1: fetch a weather-forecast URL directly (these are public iRacing/S3 files).
  const directUrl = searchParams.get("url");
  if (directUrl) {
    let host = "";
    try { host = new URL(directUrl).host; } catch { return json({ error: "Invalid url" }, 400); }
    const allowed = /(^|\.)iracing\.com$/.test(host) || /amazonaws\.com$/.test(host) || /(^|\.)cloudfront\.net$/.test(host);
    if (!allowed) return json({ error: "url host not allowed (must be an iRacing / AWS forecast URL)" }, 400);
    try {
      const r = await fetch(directUrl, { headers: { "user-agent": "hcr-league/1.0" } });
      if (!r.ok) return json({ error: `forecast url returned HTTP ${r.status}` }, 502);
      const data = await r.json().catch(() => null);
      return json({ ok: true, url: directUrl, count: Array.isArray(data) ? data.length : undefined, data });
    } catch (e) {
      return json({ error: "Could not fetch forecast url (" + (e?.message || "network error") + ")" }, 502);
    }
  }

  // Branch 2: proxy a /data/* request (requires credentials).
  if (!EMAIL || !PASSWORD) return json({ error: "Set IRACING_EMAIL and IRACING_PASSWORD in the server environment." }, 500);
  const path = searchParams.get("path") || "/data/member/info";
  if (!path.startsWith("/data/")) return json({ error: "path must start with /data/" }, 400);

  const params = {};
  for (const [k, v] of searchParams.entries()) if (!["key", "path", "url"].includes(k)) params[k] = v;

  const auth = await iracingAuth(EMAIL, PASSWORD);
  if (!auth.ok) return json({ ok: false, step: "auth", status: auth.status, verificationRequired: auth.verificationRequired || false, error: auth.reason }, 502);

  const data = await iracingData(auth.cookie, path, params);
  return json({ ok: true, path, params, data });
}
