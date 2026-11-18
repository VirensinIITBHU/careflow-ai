import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, getToken, setOn401, setToken } from './api'
import type { User } from './api'

type AuthState = { user: User | null; ready: boolean; signIn: (u: string, p: string) => Promise<User>; signOut: () => Promise<void> }
const Ctx = createContext<AuthState>(null as unknown as AuthState)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(!getToken())
  const clear = useCallback(() => { setToken(''); setUser(null) }, [])
  useEffect(() => {
    setOn401(clear)
    if (getToken()) api<User>('/auth/me').then(setUser).catch(() => {}).finally(() => setReady(true))
  }, [clear])
  const signIn = async (username: string, password: string) => {
    const r = await api<{ token: string; username: string; role: User['role'] }>('/auth/login', { method: 'POST', json: { username, password } })
    setToken(r.token)
    const u = { username: r.username, role: r.role }
    setUser(u)
    return u
  }
  const signOut = async () => { try { await api('/auth/logout', { method: 'POST' }) } catch { /* session may be gone */ } clear() }
  return <Ctx.Provider value={{ user, ready, signIn, signOut }}>{children}</Ctx.Provider>
}

export const homeFor = (u: User) => (u.role === 'intake' ? '/interview' : '/queue')

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = () => {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('cf_theme', next ? 'dark' : 'light') } catch { /* ignore */ }
    setDark(next)
  }
  return { dark, toggle }
}
