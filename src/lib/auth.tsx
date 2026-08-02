import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from './types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** 'member' | 'race_control' | 'admin' — drives which portal a user can reach. */
  role: 'member' | 'race_control' | 'admin'
  isAdmin: boolean
  /** Race control OR admin (admins can do everything race control can). */
  isRaceControl: boolean
  isManager: boolean
  signIn: (email: string, password: string) => Promise<void>
  signInWithDiscord: () => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsConfirm: boolean }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) {
    console.error('profile fetch', error)
    return null
  }
  return data as Profile | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user) setProfile(await fetchProfile(data.session.user.id))
      setLoading(false)
    })

    // NB: this callback runs while supabase-js holds its internal auth lock, so
    // calling back into the client from inside it (functions.invoke, .from(),
    // anything that reads the session) deadlocks — the sign-in never settles.
    // That is exactly what broke Discord OAuth: the redirect returned fine, then
    // the app hung here. Keep the callback synchronous and defer the real work
    // to a microtask, once the lock has been released.
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      const user = next?.user
      if (!user) {
        setProfile(null)
        return
      }
      const viaDiscord = (user.identities ?? []).some((i) => i.provider === 'discord')
      setTimeout(async () => {
        if (!active) return
        // On a fresh Discord sign-in, resolve portal access from server roles
        // before we read the profile. No-op unless the integration is configured.
        if (event === 'SIGNED_IN' && viaDiscord) {
          try {
            await supabase.functions.invoke('discord-role-sync')
          } catch {
            /* non-fatal — fall back to whatever role is already stored */
          }
        }
        const p = await fetchProfile(user.id)
        if (active) setProfile(p)
      }, 0)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  /** Discord OAuth — roles are read from your Discord server on sign-in. */
  const signInWithDiscord = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/portal`,
        scopes: 'identify guilds guilds.members.read',
      },
    })
    if (error) throw error
  }

  const signUp = async (email: string, password: string, displayName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    })
    if (error) throw error
    // If email confirmation is on, there is a user but no session yet.
    return { needsConfirm: !data.session }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }

  const refreshProfile = async () => {
    if (session?.user) setProfile(await fetchProfile(session.user.id))
  }

  const role = (profile?.role ?? 'member') as 'member' | 'race_control' | 'admin'
  const isAdmin = role === 'admin' || !!profile?.is_admin

  const value: AuthState = {
    session,
    profile,
    loading,
    role,
    isAdmin,
    isRaceControl: isAdmin || role === 'race_control',
    isManager: !!profile?.is_team_manager,
    signIn,
    signInWithDiscord,
    signUp,
    signOut,
    refreshProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
