import crypto from "crypto";

/* Minimal iRacing /data API client for server-side use.
   Auth uses the account email + password (password is hashed before sending,
   never stored or logged here). Credentials come from server env vars set by
   the site owner — they never reach the browser. */

const BASE = "https://members-ng.iracing.com";

/* iRacing expects base64( sha256( password + lowercased-email ) ) */
function encodePassword(email, password) {
  return crypto.createHash("sha256").update(password + email.toLowerCase()).digest("base64");
}

export async function iracingAuth(email, password) {
  let res;
  try {
    res = await fetch(`${BASE}/auth`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "hcr-league/1.0" },
      body: JSON.stringify({ email, password: encodePassword(email, password) }),
    });
  } catch (e) {
    return { ok: false, status: 0, reason: "Could not reach iRacing (" + (e?.message || "network error") + ")" };
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }

  if (res.status === 429) return { ok: false, status: 429, reason: "iRacing rate-limited this login — wait and retry." };
  if (!res.ok) return { ok: false, status: res.status, reason: body?.message || `iRacing auth returned HTTP ${res.status}` };
  if (body && (body.authcode === 0 || body.authcode === "0")) {
    return {
      ok: false, status: 401,
      verificationRequired: !!body.verificationRequired,
      reason: body.verificationRequired
        ? "iRacing requires CAPTCHA/verification for this login (common from server IPs)."
        : (body.message || "iRacing authentication failed — check email/password."),
    };
  }
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) return { ok: false, status: 401, reason: "iRacing did not return a session cookie." };
  return { ok: true, cookie };
}

/* GET a /data endpoint. Most iRacing endpoints return { link } pointing at an
   S3 object with the real payload, so we follow that automatically. */
export async function iracingData(cookie, path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, { headers: { cookie, "user-agent": "hcr-league/1.0" } });
  } catch (e) {
    return { error: "Could not reach iRacing data (" + (e?.message || "network error") + ")" };
  }
  if (res.status === 401) return { error: "Unauthorized — session expired or login blocked." };
  if (res.status === 429) return { error: "Rate-limited by iRacing." };
  if (!res.ok) return { error: `iRacing data returned HTTP ${res.status}` };
  const j = await res.json().catch(() => null);
  if (j && j.link) {
    try {
      const r2 = await fetch(j.link);
      if (!r2.ok) return { error: `iRacing data link returned HTTP ${r2.status}` };
      return await r2.json().catch(() => null);
    } catch (e) {
      return { error: "Could not follow iRacing data link (" + (e?.message || "network error") + ")" };
    }
  }
  return j;
}
