import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  AlertOctagon, ArrowRight, Bot, CheckCircle2, ChevronRight, CircleSlash, FileText, Keyboard, Languages, ListChecks, Loader2,
  Mic, MicOff, Paperclip, Send, ShieldAlert, Sparkles, Square, Trash2, Undo2, Wifi, WifiOff, X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Callout, Card, Empty, Field, Input, Ring, Select, Skeleton, Spinner, useDialog, useToast } from '../../components/ui'
import { api, events, msg } from '../../lib/api'
import type { Case, Question, Session, Suggestions, Turn } from '../../lib/api'
import { ago, langName, secs, STAGE_LABEL, STATUS_LABEL } from '../../lib/format'
import { useCopilot } from './useCopilot'
import { useRecorder } from './useRecorder'

type SessionResp = { session: Session; suggestions: Suggestions | null; turn?: Turn }

const ORIGIN: Record<Question['origin'], { label: string; tone: 'imm' | 'brand' | 'und' }> = {
  policy: { label: 'Warning sign', tone: 'imm' }, rules: { label: 'Missing info', tone: 'brand' }, model: { label: 'Suggested', tone: 'und' },
}

export default function Interview() {
  const { sessionId } = useParams()
  return sessionId ? <LiveInterview key={sessionId} sessionId={sessionId} /> : <StartScreen />
}

/* ---------------------------------------------------------------- start */

function StartScreen() {
  const nav = useNavigate()
  const [consent, setConsent] = useState(false), [lang, setLang] = useState(''), [ref, setRef] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const start = async () => {
    setBusy(true); setErr('')
    try {
      const r = await api<SessionResp>('/intake/sessions', { method: 'POST', json: { consent: true, language_hint: lang || null, patient_ref: ref || null } })
      nav(`/interview/${r.session.session_id}`)
    } catch (e) { setErr(msg(e)); setBusy(false) }
  }
  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 sm:p-8 lg:grid-cols-[1.2fr_1fr]">
      <div>
        <p className="label">Intake</p>
        <h1 className="mt-1 font-display text-[34px] font-semibold leading-tight tracking-tight">New interview</h1>
        <p className="mt-2 max-w-xl text-[15px] text-mute">Type or record what the patient says. You'll get suggested questions as you go, in the patient's language.</p>
        <Card className="mt-6 p-5">
          <ol className="space-y-5">
            <li className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-bg">1</span>
              <div className="flex-1">
                <p className="font-medium">Record consent</p>
                <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-sunken/50 p-3 text-sm">
                  <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" />
                  <span>The patient agreed that their words, voice and reports are processed to prepare a summary for a clinician, and knows they can withdraw. <span className="text-mute">(Demo: synthetic data only.)</span></span>
                </label>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-bg">2</span>
              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                <Field label="Patient's language" hint="Auto-detects English, Hindi and Hinglish." htmlFor="lang">
                  <Select id="lang" value={lang} onChange={e => setLang(e.target.value)}>
                    <option value="">Detect automatically</option><option value="en">English</option><option value="hi">Hindi (Devanagari)</option><option value="hinglish">Hinglish (romanized)</option>
                  </Select></Field>
                <Field label="Reference (optional)" hint="Never enter names. Letters, numbers, . _ / -" htmlFor="ref">
                  <Input id="ref" value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. OPD-2231" maxLength={40} /></Field>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-bg">3</span>
              <div className="flex-1">
                {err && <Callout tone="danger" className="mb-3">{err}</Callout>}
                <Button size="lg" disabled={!consent} loading={busy} onClick={start} icon={<ArrowRight className="h-4 w-4" />}>Start interview</Button>
                {!consent && <p className="mt-2 text-xs text-mute">Consent is required before anything is recorded.</p>}
              </div>
            </li>
          </ol>
        </Card>
      </div>
      <MySubmissions />
    </div>
  )
}

function MySubmissions() {
  const q = useQuery({ queryKey: ['mine'], queryFn: () => api<Case[]>('/cases/mine'), refetchInterval: d => (d.state.data?.some(c => c.status === 'processing') ? 3000 : 15000) })
  return (
    <Card className="self-start">
      <header className="flex items-center border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">My submissions</h2><span className="ml-auto text-xs text-mute">Status only</span></header>
      <div className="max-h-[540px] overflow-y-auto scroll-thin">
        {q.isLoading ? <div className="space-y-2 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12" />)}</div>
          : !q.data?.length ? <Empty title="Nothing submitted yet">Cases you send for review appear here with their processing status.</Empty>
          : <ul className="divide-y divide-line">{q.data.slice(0, 12).map(c => (
            <li key={c.case_id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className={clsx('h-2 w-2 shrink-0 rounded-full', c.status === 'processing' ? 'animate-pulse bg-urg' : c.status === 'rejected' ? 'bg-imm' : 'bg-std')} />
              <div className="min-w-0 flex-1"><div className="font-mono text-[12.5px]">{c.case_id}</div><div className="text-xs text-mute">{ago(c.created_at)}</div>
                {c.rejection_message && <div className="mt-1 text-xs text-imm">{c.rejection_message}</div>}</div>
              <Badge tone={c.status === 'processing' ? 'urg' : c.status === 'rejected' ? 'imm' : 'neutral'}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
            </li>))}</ul>}
      </div>
      <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-mute">Intake accounts never see clinical content after submission.</p>
    </Card>
  )
}

/* ---------------------------------------------------------------- live */

function LiveInterview({ sessionId }: { sessionId: string }) {
  const nav = useNavigate(), toast = useToast(), ask = useDialog(), qc = useQueryClient()
  const [data, setData] = useState<SessionResp | null>(null), [err, setErr] = useState('')
  const [draft, setDraft] = useState(''), [answering, setAnswering] = useState<Question | null>(null)
  const [sending, setSending] = useState(false), [submitting, setSubmitting] = useState(false), [submitted, setSubmitted] = useState<Case | null>(null)
  const box = useRef<HTMLTextAreaElement>(null), thread = useRef<HTMLDivElement>(null), fileRef = useRef<HTMLInputElement>(null)
  const rec = useRecorder()
  const cop = useCopilot(data?.session.status === 'active' ? sessionId : undefined, data?.suggestions ?? null)

  useEffect(() => { api<SessionResp>(`/intake/sessions/${sessionId}`).then(setData).catch(e => setErr(msg(e))) }, [sessionId])
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' }) }, [data?.session.turns.length])

  const s = data?.session, view = cop.view
  const top = view?.questions[0], rest = view?.questions.slice(1, 5) ?? []

  const update = (r: SessionResp) => { setData(r); cop.refresh(r.suggestions) }
  const pick = (q: Question) => { setAnswering(q); box.current?.focus() }

  const sendText = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    const form = new FormData(); form.append('text', text)
    if (answering) form.append('question', JSON.stringify(answering))
    try {
      const r = await api<SessionResp>(`/intake/sessions/${sessionId}/turns`, { method: 'POST', form })
      setDraft(''); setAnswering(null); cop.onDraft(''); update(r)
      if (answering?.origin === 'model') cop.dropModelQuestion(answering.key)
    } catch (e) { toast(msg(e), 'err') }
    setSending(false)
  }

  const record = async (q?: Question | null) => {
    if (rec.state === 'recording') {
      const target = answering
      const out = await rec.stop()
      if (!out) return
      if (out.seconds < 0.6) { toast('Recording too short; nothing was sent.', 'err'); return }
      if (out.peak < 0.01) { rec.setError('No sound was detected in that recording. Check the microphone, or type the answer.'); return }
      setSending(true)
      const form = new FormData(); form.append('audio', out.file)
      if (target) form.append('question', JSON.stringify(target))
      try {
        const r = await api<SessionResp>(`/intake/sessions/${sessionId}/turns`, { method: 'POST', form })
        setAnswering(null); update(r)
        if (target?.origin === 'model') cop.dropModelQuestion(target.key)
        if (!r.turn?.text) toast('Saved the recording. Live transcription was unavailable; it will be retried after submission.', 'err')
      } catch (e) { toast(msg(e), 'err') }
      setSending(false)
    } else {
      if (q !== undefined) setAnswering(q)
      await rec.start()
    }
  }

  const skip = async (q: Question) => {
    try {
      update(await api<SessionResp>(`/intake/sessions/${sessionId}/skip`, { method: 'POST', json: { key: q.key } }))
      if (q.origin === 'model') cop.dropModelQuestion(q.key)
      if (answering?.key === q.key) setAnswering(null)
    } catch (e) { toast(msg(e), 'err') }
  }

  const removeTurn = async (t: Turn) => {
    try { update(await api<SessionResp>(`/intake/sessions/${sessionId}/turns/${t.turn_id}`, { method: 'DELETE' })) } catch (e) { toast(msg(e), 'err') }
  }

  const attach = async (f: File) => {
    const form = new FormData(); form.append('report', f)
    try { update(await api<SessionResp>(`/intake/sessions/${sessionId}/attachments`, { method: 'POST', form })); toast('Report added.') } catch (e) { toast(msg(e), 'err') }
  }

  const submit = async () => {
    if (draft.trim()) { toast('Send or clear the text in the composer first.', 'err'); return }
    const pct = view?.completeness.pct ?? 0
    if (pct < 50 && !(await ask({ title: 'Submit with gaps?', body: `The brief is ${pct}% complete. You can still submit; missing details will be listed for the clinician.`, confirm: 'Submit anyway' }))) return
    setSubmitting(true)
    try {
      const c = await api<Case>(`/intake/sessions/${sessionId}/submit`, { method: 'POST' })
      setSubmitted(c); qc.invalidateQueries({ queryKey: ['mine'] })
    } catch (e) { toast(msg(e), 'err') }
    setSubmitting(false)
  }

  const discard = async () => {
    if (!(await ask({ title: 'Discard this interview?', body: 'Everything entered, including recordings, is erased. This cannot be undone.', confirm: 'Discard', tone: 'danger' }))) return
    try { await api(`/intake/sessions/${sessionId}`, { method: 'DELETE' }); nav('/interview') } catch (e) { toast(msg(e), 'err') }
  }

  // Keyboard: Ctrl/Cmd+Enter sends, Alt+R records, Alt+1..4 answers an alternative, Esc clears the target question.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); record(answering ?? top ?? null) }
      if (e.altKey && /^[1-5]$/.test(e.key)) { const q = view?.questions[Number(e.key) - 1]; if (q) { e.preventDefault(); pick(q) } }
      if (e.key === 'Escape' && answering) setAnswering(null)
    }
    addEventListener('keydown', h); return () => removeEventListener('keydown', h)
  })

  if (err) return <div className="p-8"><Callout tone="danger" title="Could not open this interview">{err}</Callout><Button className="mt-4" variant="secondary" onClick={() => nav('/interview')}>Back</Button></div>
  if (!s) return <div className="grid h-[60vh] place-items-center"><Spinner className="h-6 w-6" /></div>
  if (submitted) return <SubmittedView c={submitted} />
  if (s.status !== 'active') return (
    <div className="mx-auto max-w-lg p-8"><Callout tone="info" title={`This interview was ${s.status}.`}>{s.case_id && <>It became case <code className="font-mono">{s.case_id}</code>.</>}</Callout>
      <Button className="mt-4" onClick={() => nav('/interview')}>Start a new interview</Button></div>)

  const warnings = view?.warning_signs ?? []
  return (
    <div className="flex min-h-[calc(100vh-1px)] flex-col xl:h-screen">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel px-4 py-2.5 sm:px-6">
        <div><div className="label">Live interview</div><div className="font-mono text-[13px]">{s.session_id}{s.patient_ref && <span className="text-mute"> · {s.patient_ref}</span>}</div></div>
        <Badge tone="outline" className="ml-2"><Languages className="h-3 w-3" />{langName(view?.language)}</Badge>
        <ConnBadge conn={cop.conn} rtt={cop.rtt} />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="quiet" size="sm" onClick={discard} icon={<Trash2 className="h-3.5 w-3.5" />}>Discard</Button>
          <Button size="sm" onClick={submit} loading={submitting} icon={<Send className="h-3.5 w-3.5" />}>Send for review</Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* conversation */}
        <div className="flex min-h-[60vh] min-w-0 flex-col xl:min-h-0">
          <div ref={thread} className="flex-1 space-y-4 overflow-y-auto px-4 py-6 scroll-thin sm:px-8">
            {!s.turns.length && <div className="mx-auto max-w-md pt-10 text-center"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brandsoft text-brand"><Mic className="h-5 w-5" /></div>
              <p className="font-medium">Nothing recorded yet</p>
              <p className="mt-1 text-sm text-mute">Start with the question on the right. Type or record what the patient says.</p></div>}
            {s.turns.map(t => <TurnBubble key={t.turn_id} t={t} onRemove={() => removeTurn(t)} />)}
          </div>

          {/* composer */}
          <div className="border-t border-line bg-panel px-4 py-3 sm:px-8">
            {answering && <div className="mb-2 flex items-start gap-2 rounded-lg bg-brandsoft px-3 py-2 text-sm">
              <CornerTag /><div className="min-w-0 flex-1"><span className="text-xs font-semibold uppercase tracking-wider text-brand">Answering</span>
                <div className="truncate">{answering.text_local ?? answering.text_en}</div></div>
              <button aria-label="Clear question" onClick={() => setAnswering(null)} className="rounded p-1 text-mute hover:bg-panel"><X className="h-4 w-4" /></button></div>}
            {rec.state !== 'idle' ? (
              <div className="flex items-center gap-3 rounded-xl border border-imm/40 bg-immsoft/50 px-3 py-2.5">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-imm" />
                <div className="flex h-8 flex-1 items-center gap-[3px]" aria-hidden>{rec.levels.map((l, i) => <span key={i} className="w-1 rounded-full bg-imm/70 transition-[height]" style={{ height: `${Math.max(8, l * 100)}%` }} />)}</div>
                <span className="font-mono text-sm tabular-nums">{Math.floor(rec.seconds / 60)}:{String(rec.seconds % 60).padStart(2, '0')}</span>
                <Button variant="quiet" size="sm" onClick={rec.cancel}>Cancel</Button>
                <Button variant="danger" size="sm" onClick={() => record()} loading={rec.state === 'stopping'} icon={<Square className="h-3.5 w-3.5" />}>Stop &amp; send</Button>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-panel shadow-card transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
                <textarea ref={box} value={draft} rows={2} aria-label="Patient's words"
                  className="block max-h-48 min-h-[56px] w-full resize-none rounded-t-xl bg-transparent px-4 pt-3 text-[15px] leading-relaxed text-ink placeholder:text-mute/70 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder={answering ? 'Type the answer…' : 'Type what the patient says…'}
                  onChange={e => { setDraft(e.target.value); cop.onDraft(e.target.value) }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText() } }} />
                <div className="flex flex-wrap items-center gap-2 px-2 pb-2 pt-1">
                  <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={s.attachments.length >= 3}
                    title="Attach a lab report or prescription (PDF or image, up to 10 MB)" icon={<Paperclip className="h-4 w-4" />}>Add report</Button>
                  <input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = '' }} />
                  {s.attachments.map(a => (
                    <span key={a.source_id} title="Read after you send the case for review" className="inline-flex max-w-[200px] items-center gap-1.5 rounded-md border border-line bg-sunken px-2 py-1 text-xs">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-mute" /><span className="truncate">{a.filename}</span></span>))}
                  <span className="ml-auto hidden text-[11.5px] text-mute md:inline">Enter to send</span>
                  <Button variant="secondary" size="sm" aria-label="Record" title="Record (Alt+R)" onClick={() => record()} disabled={sending} className="h-9 w-9 px-0"><Mic className="h-4 w-4" /></Button>
                  <Button size="sm" onClick={sendText} disabled={!draft.trim()} loading={sending} className="h-9" icon={<Send className="h-3.5 w-3.5" />}>Send</Button>
                </div>
              </div>
            )}
            {rec.error && <div className="mt-2 flex items-center gap-2 text-sm text-imm"><MicOff className="h-4 w-4" />{rec.error}</div>}
          </div>
        </div>

        {/* copilot rail */}
        <aside className="space-y-4 overflow-y-auto border-t border-line bg-sunken/40 p-4 scroll-thin xl:border-l xl:border-t-0">
          {warnings.length > 0 && (
            <div className="animate-rise rounded-xl border border-imm/40 bg-immsoft p-3.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-imm"><AlertOctagon className="h-4 w-4" />Warning sign mentioned</div>
              <ul className="mt-1.5 space-y-0.5 text-sm">{warnings.map(w => <li key={w.code}>{w.title.replace(' mentioned', '')} <span className="text-mute">· “{w.quote}”</span></li>)}</ul>
              <p className="mt-2 text-[12.5px] text-mute">Ask about this first. The case will go to the top of the review queue. If the patient looks unwell now, call a clinician.</p>
            </div>)}

          <div>
            <div className="mb-2 flex items-center gap-2"><h2 className="text-sm font-semibold">Ask next</h2>
              <ModelStatus info={cop.modelInfo} thinking={cop.thinking} /></div>
            {!view ? <Skeleton className="h-36" /> : !top ? (
              <Card className="p-4"><div className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-std" />All covered. Send the case for review when you're done.</div></Card>
            ) : (
              <QuestionCard q={top} primary onAnswer={() => pick(top)} onRecord={() => record(top)} onSkip={() => skip(top)} active={answering?.key === top.key} index={1} />
            )}
          </div>

          <LiveBrief v={view} />

          {rest.length > 0 && <div>
            <p className="label mb-2">Other questions</p>
            <div className="space-y-2">{rest.map((q, i) => <QuestionCard key={q.key} q={q} onAnswer={() => pick(q)} onRecord={() => record(q)} onSkip={() => skip(q)} active={answering?.key === q.key} index={i + 2} />)}</div>
          </div>}

          <p className="px-1 text-[11.5px] text-mute">Suggested questions only. Not medical advice.</p>
        </aside>
      </div>
    </div>
  )
}

const CornerTag = () => <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-brand" />

function ConnBadge({ conn, rtt }: { conn: string; rtt: number | null }) {
  if (conn === 'live') return <Badge tone="std" title="Live WebSocket connection"><Wifi className="h-3 w-3" />Connected</Badge>
  if (conn === 'http') return <Badge tone="urg" title="WebSocket unavailable; using HTTP"><WifiOff className="h-3 w-3" />Slow connection</Badge>
  return <Badge><Loader2 className="h-3 w-3 animate-spin" />Connecting</Badge>
}

function ModelStatus({ info, thinking }: { info: Suggestions['model'] | null; thinking: boolean }) {
  if (thinking) return <span className="ml-auto flex items-center gap-1 text-[11.5px] text-und"><Bot className="h-3.5 w-3.5 animate-pulse" />Finding more questions…</span>
  if (!info || info.status === 'off') return <span className="ml-auto text-[11.5px] text-mute" title="No model key is set on the server.">Basic questions only</span>
  if (info.status === 'error') return <span className="ml-auto text-[11.5px] text-urg" title={info.error}>Extra suggestions unavailable</span>
  if (info.status === 'ok') return null
  return null
}

function QuestionCard({ q, primary, onAnswer, onRecord, onSkip, active, index }: { q: Question; primary?: boolean; onAnswer: () => void; onRecord: () => void; onSkip: () => void; active?: boolean; index: number }) {
  const o = ORIGIN[q.origin]
  const local = q.text_local && q.text_local !== q.text_en
  return (
    <div className={clsx('group animate-rise rounded-xl border bg-panel transition', primary ? 'p-4 shadow-pop' : 'p-3 hover:shadow-card',
      q.kind === 'redflag' ? 'border-imm/50' : active ? 'border-brand ring-2 ring-brand/20' : 'border-line')}>
      <div className="flex items-center gap-1.5">
        <Badge tone={o.tone}>{q.kind === 'redflag' && <ShieldAlert className="h-3 w-3" />}{q.origin === 'model' && <Bot className="h-3 w-3" />}{o.label}</Badge>
        {q.slot && q.kind === 'gap' && <span className="text-[11px] text-mute">{q.slot}</span>}
      </div>
      <button onClick={onAnswer} className="mt-2 block w-full text-left">
        <p lang={q.lang === 'hi' ? 'hi' : undefined} className={clsx('font-medium leading-snug', primary ? 'text-[19px]' : 'text-[14.5px]')}>{local ? q.text_local : q.text_en}</p>
        {local && <p className={clsx('mt-1 text-mute', primary ? 'text-sm' : 'text-[12.5px]')}>{q.text_en}</p>}
      </button>
      {primary && q.reason && <p className="mt-2 text-[12.5px] text-mute">{q.reason}</p>}
      <div className={clsx('mt-3 flex gap-1.5', !primary && 'opacity-80 group-hover:opacity-100')}>
        <Button size="sm" variant={primary ? 'primary' : 'secondary'} onClick={onAnswer} icon={<Keyboard className="h-3.5 w-3.5" />}>Answer</Button>
        <Button size="sm" variant="secondary" onClick={onRecord} icon={<Mic className="h-3.5 w-3.5" />}>Record</Button>
        <Button size="sm" variant="quiet" className="ml-auto" onClick={onSkip} icon={<CircleSlash className="h-3.5 w-3.5" />}>Skip</Button>
      </div>
    </div>
  )
}

function LiveBrief({ v }: { v: Suggestions | null }) {
  if (!v) return null
  const present = v.symptoms.filter(s => s.status === 'present'), denied = v.symptoms.filter(s => s.status === 'denied')
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Ring pct={v.completeness.pct}>{v.completeness.pct}%</Ring>
        <div><div className="flex items-center gap-1.5 text-sm font-semibold"><ListChecks className="h-4 w-4 text-mute" />Checklist</div>
          <div className="text-xs text-mute">{v.completeness.filled} of {v.completeness.total} covered</div></div>
      </div>
      {present.length + denied.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">
        {present.map(s => <span key={s.id} title={`“${s.quote}”${s.origin === 'model' ? ' · found by AI' : ''}`} className={clsx('animate-rise rounded-full border px-2 py-0.5 text-xs font-medium',
          s.warning ? 'border-imm/40 bg-immsoft text-imm' : 'border-brand/25 bg-brandsoft text-brand')}>{s.origin === 'model' && <Sparkles className="mr-0.5 inline h-3 w-3" />}{s.name}</span>)}
        {denied.map(s => <span key={s.id} title={`Denied, past or resolved: “${s.quote}”`} className="rounded-full border border-line px-2 py-0.5 text-xs text-mute line-through decoration-mute/60">{s.name}</span>)}
      </div>}
      {v.completeness.missing.length > 0 && <div className="mt-3"><p className="label mb-1">Not asked yet</p>
        <ul className="space-y-0.5 text-[13px] text-mute">{v.completeness.missing.slice(0, 6).map(m => <li key={m} className="flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-mute" />{m}</li>)}</ul></div>}
    </Card>
  )
}

function TurnBubble({ t, onRemove }: { t: Turn; onRemove: () => void }) {
  return (
    <div className="group flex animate-rise flex-col items-start gap-1.5">
      {t.question && <div className="flex max-w-[85%] items-start gap-2 rounded-xl rounded-bl-sm border border-line bg-panel px-3 py-2 text-[13.5px] shadow-card">
        <Badge tone={ORIGIN[t.question.origin].tone}>{t.question.origin === 'model' ? <Bot className="h-3 w-3" /> : t.question.kind === 'redflag' ? <ShieldAlert className="h-3 w-3" /> : null}Asked</Badge>
        <span>{t.question.text_local ?? t.question.text_en}</span></div>}
      <div className={clsx('relative max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed', t.question ? 'ml-6 rounded-tl-sm bg-brandsoft' : 'bg-brandsoft')}>
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-brand">
          {t.modality === 'voice' ? <Mic className="h-3 w-3" /> : <Keyboard className="h-3 w-3" />}Patient
        </div>
        {t.text ? <p className="whitespace-pre-wrap">{t.text}</p> : <p className="italic text-mute">Recording saved. Text will appear after review processing.</p>}
        {t.warnings.map(w => <p key={w} className="mt-1 text-xs text-urg">{w}</p>)}
        <button onClick={onRemove} aria-label="Remove this turn" title="Undo" className="absolute -right-9 top-1 rounded-lg p-1.5 text-mute opacity-0 transition hover:bg-sunken hover:text-ink group-hover:opacity-100 focus:opacity-100"><Undo2 className="h-4 w-4" /></button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- submitted */

function SubmittedView({ c }: { c: Case }) {
  const nav = useNavigate()
  const [cur, setCur] = useState<Case>(c)
  useEffect(() => events(`/cases/${c.case_id}/events`, { progress: d => setCur(x => ({ ...x, ...d })) }), [c.case_id])
  const done = cur.status !== 'processing'
  const stages = cur.stages ?? []
  return (
    <div className="mx-auto max-w-xl p-6 pt-14 text-center">
      <div className={clsx('mx-auto grid h-14 w-14 place-items-center rounded-full', done ? 'bg-stdsoft text-std' : 'bg-brandsoft text-brand')}>
        {done ? <CheckCircle2 className="h-7 w-7" /> : <Loader2 className="h-7 w-7 animate-spin" />}</div>
      <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">{done ? 'Sent for review' : 'Processing…'}</h1>
      <p className="mt-2 text-mute">Case <code className="font-mono text-ink">{cur.case_id}</code> {done ? 'is in the review queue.' : 'is being processed. You can start the next interview now.'}</p>
      <Card className="mt-6 p-4 text-left">
        <ul className="space-y-2">{stages.length ? stages.map((st, i) => (
          <li key={i} className="flex items-center gap-2.5 text-sm">
            {st.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : st.status === 'failed' ? <X className="h-4 w-4 text-imm" /> : <CheckCircle2 className="h-4 w-4 text-std" />}
            <span className="flex-1">{STAGE_LABEL[st.name] ?? st.name}</span><span className="font-mono text-xs text-mute">{st.ms ? secs(st.ms) : ''}</span>
          </li>)) : <li className="flex items-center gap-2 text-sm text-mute"><Spinner />Queued…</li>}</ul>
      </Card>
      <p className="mt-3 text-xs text-mute">For privacy, intake accounts see processing status only, not the clinical summary.</p>
      <Button className="mt-6" size="lg" onClick={() => nav('/interview')} icon={<ArrowRight className="h-4 w-4" />}>Start next interview</Button>
    </div>
  )
}
