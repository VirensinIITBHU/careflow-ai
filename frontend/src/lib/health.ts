import { useEffect, useState } from 'react'
import { BASE, setOnOk } from './api'

export type Health = {
  status: string; version: string; uptime_s: number; providers: Record<string, boolean>
  models: Record<string, string | null>; cache: { mode: string; entries: number }; policy_version: string
}
type State = { phase: 'checking' | 'waking' | 'up' | 'down'; health?: Health; waitedS: number }

let shared: State = { phase: 'checking', waitedS: 0 }
const subs = new Set<(s: State) => void>()
let started = false

function set(s: State) { shared = s; subs.forEach(f => f(s)) }
const isUp = () => shared.phase === 'up'

/** Hosted free tiers (e.g. Render) sleep when idle and restart on every deploy; the first request can take a minute.
 * Poll /health until it answers, never giving up, and expose a 'waking' phase so the UI explains the delay. Any
 * successful API call also marks the server as up, so the banner can never outlive a working connection. */
async function loop() {
  const t0 = Date.now()
  for (let i = 0; !isUp(); i++) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000)
    try {
      const r = await fetch(`${BASE}/health`, { signal: ctl.signal, cache: 'no-store' })
      clearTimeout(timer)
      if (r.ok) { set({ phase: 'up', health: await r.json(), waitedS: Math.round((Date.now() - t0) / 1000) }); return }
    } catch { clearTimeout(timer) }
    if (isUp()) return
    set({ phase: Date.now() - t0 > 150000 ? 'down' : 'waking', waitedS: Math.round((Date.now() - t0) / 1000) })
    await new Promise(r => setTimeout(r, Math.min(10000, 2500 + i * 500)))
  }
}

setOnOk(() => {
  if (shared.phase !== 'up') {
    set({ ...shared, phase: 'up' })
    fetch(`${BASE}/health`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
      .then(h => { if (h) set({ ...shared, phase: 'up', health: h }) }).catch(() => {})
  }
})

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
