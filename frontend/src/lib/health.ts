import { useEffect, useState } from 'react'
import { BASE } from './api'

export type Health = {
  status: string; version: string; uptime_s: number; providers: Record<string, boolean>
  models: Record<string, string | null>; cache: { mode: string; entries: number }; policy_version: string
}
type State = { phase: 'checking' | 'waking' | 'up' | 'down'; health?: Health; waitedS: number }

let shared: State = { phase: 'checking', waitedS: 0 }
const subs = new Set<(s: State) => void>()
let started = false

function set(s: State) { shared = s; subs.forEach(f => f(s)) }

/** Hosted free tiers (e.g. Render) sleep when idle; the first request can take ~30-60 s. Poll /health and expose
 * a 'waking' phase so the UI can explain the delay instead of looking broken. */
async function loop() {
  const t0 = Date.now()
  for (let i = 0; i < 40; i++) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000)
    try {
      const r = await fetch(`${BASE}/health`, { signal: ctl.signal })
      clearTimeout(timer)
      if (r.ok) { set({ phase: 'up', health: await r.json(), waitedS: Math.round((Date.now() - t0) / 1000) }); return }
    } catch { clearTimeout(timer) }
    set({ phase: Date.now() - t0 > 90000 ? 'down' : 'waking', waitedS: Math.round((Date.now() - t0) / 1000) })
    await new Promise(r => setTimeout(r, 2500))
  }
  set({ phase: 'down', waitedS: Math.round((Date.now() - t0) / 1000) })
}

export function useHealth() {
  const [s, setS] = useState(shared)
  useEffect(() => {
    subs.add(setS)
    if (!started) { started = true; loop() }
    const slow = setTimeout(() => { if (shared.phase === 'checking') set({ ...shared, phase: 'waking' }) }, 1500)
    return () => { subs.delete(setS); clearTimeout(slow) }
  }, [])
  return s
}
