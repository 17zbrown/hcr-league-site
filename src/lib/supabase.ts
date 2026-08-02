import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !key) {
  // Fail loud in dev so a missing .env is obvious.
  console.error(
    'Missing Supabase env vars. Copy .env.example to .env and fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.',
  )
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // OAuth returns to the site with a ?code= in the URL; this is what exchanges
    // it for a session. It defaults to true, but Discord sign-in depends on it,
    // so it is stated rather than assumed.
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})
