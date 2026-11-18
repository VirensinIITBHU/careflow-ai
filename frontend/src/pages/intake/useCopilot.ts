import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, wsUrl } from '../../lib/api'
import type { Question, Suggestions } from '../../lib/api'

type Conn = 'connecting' | 'live' | 'http'

/**
 * Live interview copilot.
 * - Rules phase: sent ~120 ms after each keystroke; the server answers in milliseconds.
 * - Model phase: sent after a ~700 ms pause; the server streams model-enriched questions when ready.
 * Model questions are kept between rule updates so the list does not flicker while the worker types.
 * Falls back to plain HTTP if the WebSocket cannot connect (some proxies block upgrades).
 */
export function useCopilot(sessionId: string | undefined, initial: Suggestions | null) {
  const [rules, setRules] = useState<Suggestions | null>(initial)
  const [modelQs, setModelQs] = useState<Question[]>([])
  const [modelInfo, setModelInfo] = useState<Suggestions['model'] | null>(initial?.model ?? null)
  const [modelSymptoms, setModelSymptoms] = useState<Suggestions['symptoms']>([])
  const [conn, setConn] = useState<Conn>('connecting')
  const [rtt, setRtt] = useState<number | null>(null)
  const [thinking, setThinking] = useState(false)
  const ws = useRef<WebSocket | null>(null)
  const seq = useRef(0)
  const sentAt = useRef<Record<number, number>>({})
  const tRules = useRef<number>(), tModel = useRef<number>()
  const draftRef = useRef('')

  useEffect(() => { if (initial) setRules(initial) }, [initial])

  const apply = useCallback((p: Suggestions) => {
    if (p.seq != null && p.seq < seq.current && p.phase === 'model') return
    if (p.phase === 'model') {
      setModelQs(p.questions.filter(q => q.origin === 'model'))
      setModelSymptoms(p.symptoms.filter(s => s.origin === 'model'))
      setModelInfo(p.model)
      setThinking(false)
    } else {
      setRules(p)
      if (p.seq != null && sentAt.current[p.seq]) setRtt(Math.round(performance.now() - sentAt.current[p.seq]))
    }
  }, [])

  useEffect(() => {
    if (!sessionId) return
    let closed = false, ping: number | undefined
    const sock = new WebSocket(wsUrl(`/intake/sessions/${sessionId}/live`))
    ws.current = sock
    const fail = window.setTimeout(() => { if (sock.readyState !== WebSocket.OPEN) { sock.close(); setConn('http') } }, 4000)
    sock.onopen = () => {
      clearTimeout(fail); setConn('live')
      ping = window.setInterval(() => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify({ type: 'ping', t: Date.now() })), 20000)
      send(draftRef.current, true)
    }
    sock.onmessage = ev => {
      try { const d = JSON.parse(ev.data); if (d.type === 'suggest') apply(d) } catch { /* ignore */ }
    }
    sock.onclose = () => { clearTimeout(fail); clearInterval(ping); if (!closed) setConn('http') }
    sock.onerror = () => { /* onclose handles it */ }
    return () => { closed = true; clearInterval(ping); clearTimeout(fail); sock.close(); ws.current = null }
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((text: string, model: boolean) => {
    if (!sessionId) return
    const n = ++seq.current
    sentAt.current[n] = performance.now()
    if (model) setThinking(true)
    const sock = ws.current
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: 'draft', seq: n, text, model }))
    } else if (model) {
      api<Suggestions>(`/intake/sessions/${sessionId}/suggest`, { method: 'POST', json: { draft: text, model: true } })
        .then(p => { apply({ ...p, phase: 'rules', seq: n }); apply({ ...p, phase: 'model', seq: n }) })
        .catch(() => setThinking(false))
    } else {
      api<Suggestions>(`/intake/sessions/${sessionId}/suggest`, { method: 'POST', json: { draft: text, model: false } })
        .then(p => apply({ ...p, phase: 'rules', seq: n })).catch(() => {})
    }
  }, [sessionId, apply])

  /** Call on every keystroke with the current composer text. */
  const onDraft = useCallback((text: string) => {
    draftRef.current = text
    clearTimeout(tRules.current); clearTimeout(tModel.current)
    tRules.current = window.setTimeout(() => send(text, false), conn === 'live' ? 120 : 400)
    tModel.current = window.setTimeout(() => send(text, true), 750)
  }, [send, conn])

  /** Call after the session changed on the server (turn added, skip, etc.). */
  const refresh = useCallback((fresh?: Suggestions | null) => {
    if (fresh) setRules(fresh)
    send(draftRef.current, true)
  }, [send])

  const view = useMemo(() => {
    if (!rules) return null
    const keys = new Set(rules.questions.map(q => q.key))
    const qs = [...rules.questions, ...modelQs.filter(q => !keys.has(q.key))].sort((a, b) => a.priority - b.priority)
    const names = new Set(rules.symptoms.map(s => s.name))
    return { ...rules, questions: qs, symptoms: [...rules.symptoms, ...modelSymptoms.filter(s => !names.has(s.name))] }
  }, [rules, modelQs, modelSymptoms])

  const dropModelQuestion = (key: string) => setModelQs(q => q.filter(x => x.key !== key))
  return { view, modelInfo, conn, rtt, thinking, onDraft, refresh, dropModelQuestion }
}
