import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

// Signs into the admin account server-side (credentials never reach the browser)
// and hands back a session so /admin can edit. Reaching /admin = getting admin,
// so keep the URL private.
export async function POST() {
  if (!URL || !ANON) return json({ error: "Supabase env vars are not set on the server." }, 500);
  if (!EMAIL || !PASSWORD) return json({ error: "ADMIN_EMAIL / ADMIN_PASSWORD are not set on the server. Add them in your host's environment variables and redeploy." }, 500);
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error || !data?.session) return json({ error: error?.message || "Admin sign-in failed — check ADMIN_EMAIL / ADMIN_PASSWORD." }, 401);
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
}
