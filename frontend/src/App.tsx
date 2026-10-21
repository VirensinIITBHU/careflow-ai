import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api, fetchBlob, ApiError, Case, Flag, Source, Span, Tier, hasToken, setOn401, setToken } from './api'

type User = { username: string; role: 'intake' | 'reviewer' | 'admin' }
const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString() : '')
const useHash = () => { const [h, setH] = useState(location.hash || '#/'); useEffect(() => { const f = () => setH(location.hash || '#/'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, []); return h }
const TIER: Record<string, string> = { immediate: '▲▲ Immediate', urgent: '▲ Urgent', undetermined: '? Undetermined', standard: '○ Standard: no automated warning found' }
const TierBadge = ({ t, label }: { t?: Tier | null; label?: string }) => t ? <span className={'chip t-' + t} title="Standard means no automated warning sign was found. It does not mean the patient is safe.">{label ? label + ': ' : ''}{TIER[t]}</span> : <span className="chip">Processing</span>
const Err = ({ e }: { e: string }) => e ? <div className="err" role="alert">{e}</div> : null
const msg = (e: unknown) => e instanceof ApiError ? e.message : 'Something went wrong.'
const STAGE: Record<string, string> = { transcribe: 'Transcribing audio', ocr: 'Reading report', extract: 'Extracting details', safety_rules: 'Checking warning rules', safety_second_reader: 'Second safety reader', integrity: 'Integrity checks', translate_source: 'Translating reading copy', followups: 'Preparing follow-up questions', translate_questions: 'Translating questions' }

function usePoll(active: boolean, fn: () => void, ms = 3000) { useEffect(() => { if (!active) return; const i = setInterval(fn, ms); return () => clearInterval(i) }, [active, fn, ms]) }

export default function App() {
  const [user, setUser] = useState<User | null>(null), [ready, setReady] = useState(!hasToken()), hash = useHash()
  const out = useCallback(() => { setToken(''); setUser(null) }, [])
  useEffect(() => { setOn401(out); if (hasToken()) api('/auth/me').then(setUser).catch(() => {}).finally(() => setReady(true)) }, [out])
  const logout = async () => { try { await api('/auth/logout', { method: 'POST' }) } catch { /* session may be gone */ } out() }
  if (!ready) return <p style={{ padding: '2rem' }}>Loading…</p>
  const staff = user && user.role !== 'intake'
  return <>
    <div className="demo" role="note">Demo with synthetic data only. Not for clinical use. It does not diagnose, treat or decide.</div>
    {!user ? <SignIn onDone={setUser} /> : <>
      <header className="nav"><b>CareFlow AI</b>
        {user.role !== 'reviewer' && <a href="#/">New case</a>}{staff && <a href="#/queue">Review queue</a>}{user.role === 'admin' && <a href="#/audit">Audit</a>}
        <span className="mt">{user.username} ({user.role})</span><button className="sec" onClick={logout}>Sign out</button></header>
      <main>{hash.startsWith('#/case/') && staff ? <Workspace id={hash.slice(7)} user={user} />
        : hash === '#/audit' && user.role === 'admin' ? <Audit />
        : staff && (hash === '#/queue' || user.role === 'reviewer') ? <Queue />
        : user.role === 'reviewer' ? <Queue /> : <Intake />}</main></>}
  </>
}

function SignIn({ onDone }: { onDone: (u: User) => void }) {
  const [u, setU] = useState(''), [p, setP] = useState(''), [e, setE] = useState(''), [b, setB] = useState(false)
  const go = async (ev: React.FormEvent) => { ev.preventDefault(); setB(true); setE(''); try { const r = await api('/auth/login', { method: 'POST', json: { username: u, password: p } }); setToken(r.token); onDone({ username: r.username, role: r.role }) } catch (x) { setE(msg(x)) } setB(false) }
  return <main style={{ maxWidth: 420 }}><h1>Sign in</h1><form className="card" onSubmit={go}>
    <label htmlFor="u">Username</label><input id="u" value={u} onChange={x => setU(x.target.value)} autoComplete="username" required />
    <label htmlFor="p">Password</label><input id="p" type="password" value={p} onChange={x => setP(x.target.value)} autoComplete="current-password" required />
    <Err e={e} /><p><button disabled={b}>{b ? 'Signing in…' : 'Sign in'}</button></p></form>
    <div className="note"><b>Demo-only helper.</b> These are demo accounts, not real identity verification. Default demo password: <code>careflow-demo</code> (your backend may differ).
      <div className="row" style={{ marginTop: '.4rem' }}>{['intake1', 'reviewer1', 'reviewer2', 'admin1'].map(n => <button key={n} type="button" className="sec" onClick={() => { setU(n); setP('careflow-demo') }}>{n}</button>)}</div></div></main>
}

const AUDIO = ['wav', 'mp3', 'm4a', 'ogg', 'webm', 'flac', 'mp4', 'mpeg', 'mpga'], REPORT = ['pdf', 'png', 'jpg', 'jpeg', 'webp']
const fileErr = (f: File | null, ok: string[], mb: number, l: string) => !f ? '' : !ok.includes(f.name.split('.').pop()!.toLowerCase()) ? `${l}: unsupported type. Allowed: ${ok.join(', ')}` : f.size > mb << 20 ? `${l}: larger than ${mb} MB` : ''

function Intake() {
  const [cases, setCases] = useState<Case[]>([]), [e, setE] = useState(''), [busy, setBusy] = useState(false)
  const [consent, setConsent] = useState(false), [text, setText] = useState(''), [audio, setAudio] = useState<File[]>([]), [report, setReport] = useState<File | null>(null), [lang, setLang] = useState(''), [ref, setRef] = useState('')
  const [recording, setRecording] = useState(false), [stopping, setStopping] = useState(false), [recordSeconds, setRecordSeconds] = useState(0), [micError, setMicError] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const recordStarted = useRef(0), discardOnStop = useRef(false)
  const [audioUrls, setAudioUrls] = useState<string[]>([])
  const [wd, setWd] = useState('')
  useEffect(() => {
    const urls = audio.map(file => URL.createObjectURL(file)); setAudioUrls(urls)
    return () => urls.forEach(URL.revokeObjectURL)
  }, [audio])
  useEffect(() => () => { discardOnStop.current = true; stream.current?.getTracks().forEach(t => t.stop()); if (recorder.current?.state === 'recording') recorder.current.stop() }, [])
  useEffect(() => {
    if (!recording) return
    const tick = () => setRecordSeconds(Math.floor((Date.now() - recordStarted.current) / 1000))
    const timer = setInterval(tick, 500); return () => clearInterval(timer)
  }, [recording])
  const startRecording = async () => {
    if (recording || stopping) return
    setMicError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setMicError('Microphone recording is not supported in this browser. Please upload an audio file.'); return }
    try {
      const live = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = live
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
      const mimeType = types.find(type => MediaRecorder.isTypeSupported(type))
      const rec = new MediaRecorder(live, mimeType ? { mimeType } : undefined)
      const chunks: Blob[] = []
      discardOnStop.current = false; recorder.current = rec
      rec.ondataavailable = ev => { if (ev.data.size > 0) chunks.push(ev.data) }
      rec.onerror = () => { discardOnStop.current = true; setMicError('Recording failed. Please try again or upload an audio file.'); setRecording(false); setStopping(true) }
      rec.onstop = () => {
        const type = rec.mimeType || chunks[0]?.type || 'audio/webm'
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'
        const blob = new Blob(chunks, { type })
        if (!discardOnStop.current) {
          if (blob.size) setAudio(files => [...files, new File([blob], `recording-${Date.now()}.${ext}`, { type })])
          else setMicError('No audio data was captured. Check Firefox microphone permission and input device, then try again.')
        }
        stream.current?.getTracks().forEach(t => t.stop()); stream.current = null
        if (recorder.current === rec) recorder.current = null
        setRecording(false); setStopping(false)
      }
      setMicError(''); setRecordSeconds(0); recordStarted.current = Date.now(); setRecording(true); setStopping(false); rec.start()
    } catch (err) {
      stream.current?.getTracks().forEach(t => t.stop()); stream.current = null
      setMicError(err instanceof DOMException && err.name === 'NotAllowedError' ? 'Microphone access was denied. Allow microphone access in your browser settings, or upload an audio file.' : 'Could not start the microphone. Check that it is connected and try again.')
    }
  }
  const stopRecording = () => { if (recorder.current?.state === 'recording') { setStopping(true); recorder.current.stop() } }
  const load = useCallback(() => api('/cases/mine').then(setCases).catch(x => setE(msg(x))), [])
  useEffect(() => { load() }, [load])
  usePoll(cases.some(c => c.status === 'processing'), load)
  const problems = [!consent && 'Consent is required.', (recording || stopping) && 'Wait for the recording to finish before submitting.', !text.trim() && !audio.length && !report && 'Add text, audio or a report.', text.length > 12000 && 'Text is over 12,000 characters.',
    ...audio.map(f => fileErr(f, AUDIO, 24, 'Audio')), fileErr(report, REPORT, 10, 'Report'), ref && !/^[A-Za-z0-9._/-]{1,40}$/.test(ref.trim()) && 'Reference: letters, digits . _ / - only, up to 40 characters.'].filter(Boolean) as string[]
  const submit = async (ev: React.FormEvent) => { ev.preventDefault(); if (problems.length) return; setBusy(true); setE('')
    const f = new FormData(); f.append('consent', 'true'); if (text.trim()) f.append('text', text.trim()); audio.forEach(file => f.append('audio', file)); if (report) f.append('report', report); if (lang.trim()) f.append('language_hint', lang.trim()); if (ref.trim()) f.append('patient_ref', ref.trim())
    try { await api('/cases', { method: 'POST', form: f }); setText(''); setAudio([]); setReport(null); setConsent(false); setRef(''); load() } catch (x) { setE(msg(x)) } setBusy(false) }
  const withdraw = async (id: string) => { try { await api('/cases/' + id, { method: 'DELETE' }); setWd(''); load() } catch (x) { setE(msg(x)); setWd(''); load() } }
  return <div className="grid two"><form className="card" onSubmit={submit}><h1>New case</h1>
    <label><input type="checkbox" checked={consent} onChange={x => setConsent(x.target.checked)} /> The patient has agreed to this information being processed for human review.</label>
    <p className="hint">Consent must be recorded before anything is submitted. Use synthetic data only.</p>
    <label htmlFor="t">Typed text <span className="hint">(max 12,000 characters, {text.length} used)</span></label><textarea id="t" value={text} onChange={x => setText(x.target.value)} />
    <label htmlFor="a">Audio <span className="hint">(max 24 MB)</span></label>
    <div className="row mic-controls">
      {stopping ? <button type="button" disabled>Finishing recording…</button> : recording ? <button type="button" className="danger" onClick={stopRecording}>■ Stop recording · {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, '0')}</button> : <button type="button" onClick={startRecording}>● Record audio</button>}
      {recording && !stopping && <span className="hint" role="status">Recording… speak clearly, then stop to review.</span>}
    </div>
    <Err e={micError} />
    <label htmlFor="a-upload" className="hint">Or add one or more audio files (recordings and uploads are combined into this case)</label><input id="a-upload" type="file" multiple accept={AUDIO.map(x => '.' + x).join()} onChange={x => { if (x.target.files?.length) setAudio(files => [...files, ...Array.from(x.target.files!)]) }} />
    {audio.map((file, i) => <div className="audio-review" key={`${file.name}-${i}`}><div className="row"><b>{file.name}</b><span className="hint">{(file.size / (1024 * 1024)).toFixed(1)} MB · review before submitting</span><button type="button" className="sec" onClick={() => setAudio(files => files.filter((_, index) => index !== i))}>Remove</button></div><audio controls src={audioUrls[i]} aria-label={`Review audio ${i + 1}`} /></div>)}
    <label htmlFor="r">Report <span className="hint">(pdf or image, max 10 MB)</span></label><input id="r" type="file" accept={REPORT.map(x => '.' + x).join()} onChange={x => setReport(x.target.files?.[0] ?? null)} />
    {report && <button type="button" className="sec" onClick={() => setReport(null)}>Remove {report.name}</button>}
    <label htmlFor="l">Language hint <span className="hint">(optional, e.g. hi)</span></label><input id="l" maxLength={30} value={lang} onChange={x => setLang(x.target.value)} />
    <label htmlFor="pr">Patient reference <span className="hint">(optional, no names)</span></label><input id="pr" maxLength={40} value={ref} onChange={x => setRef(x.target.value)} />
    {problems.length > 0 && (consent || text || audio.length > 0 || report) && <ul className="hint">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
    <Err e={e} /><p><button disabled={busy || problems.length > 0}>{busy ? 'Submitting…' : 'Submit for review'}</button></p></form>
    <section className="card"><h2>My cases</h2><p className="hint">Status only. Clinical details are visible to reviewers, not intake.</p>
      {!cases.length && <p>No cases yet. Submit one using the form.</p>}
      <ul className="plain">{cases.map(c => <li key={c.case_id}><b>{c.case_id}</b> <span className="chip">{c.status.replace('_', ' ')}</span> <span className="mt">{fmt(c.created_at)}</span>
        <div className="mt">{c.stages.map(s => `${STAGE[s.name] ?? s.name}: ${s.status}`).join(' → ') || 'Waiting to start'}</div>
        {c.rejection_message && <div className="note">{c.rejection_message}</div>}
        {!['approved', 'rejected'].includes(c.status) && (wd === c.case_id
          ? <div className="note">Withdrawing erases this case's content and uploaded files. A record that the case existed and was withdrawn stays in the audit trail. <div className="row"><button className="danger" onClick={() => withdraw(c.case_id)}>Withdraw case</button><button className="sec" onClick={() => setWd('')}>Keep case</button></div></div>
          : <button className="sec" onClick={() => setWd(c.case_id)}>Withdraw…</button>)}
        {['approved', 'rejected'].includes(c.status) && <div className="hint">Reviewed. To withdraw, contact an administrator.</div>}</li>)}</ul></section></div>
}

const TIER_RANK: Record<string, number> = { immediate: 0, urgent: 1, undetermined: 2, standard: 3 }
const QUEUE_TABS: [string, string][] = [['needs_review', 'To review'], ['in_review', 'In review'], ['approved', 'Approved'], ['consulted', 'Consulted'], ['archived', 'Archived'], ['rejected', 'Rejected'], ['processing', 'Processing'], ['all', 'All']]

function Queue() {
  const [rows, setRows] = useState<any[] | null>(null), [st, setSt] = useState<any>(null), [e, setE] = useState(''), [q, setQ] = useState(''), [tab, setTab] = useState('needs_review'), [ft, setFt] = useState('all')
  const [consultationDraft, setConsultationDraft] = useState<Record<string, string>>({})
  const load = useCallback(() => { api('/cases').then(setRows).catch(x => setE(msg(x))); api('/cases/stats').then(setSt).catch(() => {}) }, [])
  useEffect(() => { load() }, [load])
  usePoll(!!rows?.some(r => r.status === 'processing'), load, 5000)
  const inTab = (r: any, k: string) => k === 'all' || k === 'archived' ? (k === 'all' || !!r.archived_at)
    : k === 'approved' ? r.status === 'approved' && !r.consulted_at && !r.archived_at
    : k === 'consulted' ? r.status === 'approved' && !!r.consulted_at && !r.archived_at
    : !r.archived_at && r.status === k
  const shown = (rows ?? []).filter(r => inTab(r, tab) && (ft === 'all' || r.effective_tier === ft)
    && (!q || JSON.stringify([r.case_id, r.patient_ref, r.top_flags, r.symptoms]).toLowerCase().includes(q.toLowerCase()))).sort((a, b) => ['needs_review', 'in_review'].includes(tab)
      ? ((TIER_RANK[a.effective_tier] ?? 4) - (TIER_RANK[b.effective_tier] ?? 4)) || String(a.created_at).localeCompare(String(b.created_at)) // open work: most urgent first, then oldest
      : String(b.created_at).localeCompare(String(a.created_at))) // finished work: newest first
  const count = (k: string) => (rows ?? []).filter(r => inTab(r, k)).length
  const caseAction = async (caseId: string, action: 'consulted' | 'archive' | 'restore') => {
    setE('')
    try {
      await api(`/cases/${caseId}/${action}`, { method: 'POST', ...(action === 'consulted' ? { json: { note: consultationDraft[caseId] ?? '' } } : {}) })
      setConsultationDraft(notes => ({ ...notes, [caseId]: '' })); load()
    }
    catch (x) { setE(msg(x)) }
  }
  return <><h1>Review queue</h1>
    {st && <div className="row" style={{ marginBottom: '1rem' }}>{(['immediate', 'urgent', 'undetermined', 'standard'] as Tier[]).map(t => <span key={t} className={'chip t-' + t}>{TIER[t].split(':')[0]}: {st.open_by_tier[t]} open</span>)}<span className="chip">Unclaimed immediate: {st.unclaimed_immediate}</span><span className="chip">Processing: {st.processing}</span></div>}
    <div className="tabs" role="tablist" aria-label="Case queues">{QUEUE_TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label} ({count(k)})</button>)}</div>
    <div className="row"><input aria-label="Search loaded cases" placeholder="Search loaded cases" value={q} onChange={x => setQ(x.target.value)} />
      <select aria-label="Filter loaded cases by tier" value={ft} onChange={x => setFt(x.target.value)}><option value="all">All tiers</option>{Object.keys(TIER).map(t => <option key={t} value={t}>{t}</option>)}</select>
      <button className="sec" onClick={load}>Refresh</button><span className="hint">Filters apply to the loaded list only.</span></div><Err e={e} />
    {rows && !shown.length && <p>No cases in this queue{q || ft !== 'all' ? ' match your filters' : ''}.</p>}
    <div className="queue-table-wrap"><table className="queue-table"><colgroup><col className="col-priority" /><col className="col-case" /><col className="col-status" /><col className="col-symptoms" /><col className="col-language" /><col className="col-submitted" /><col className="col-actions" /></colgroup><thead><tr><th>Priority</th><th>Case</th><th>Status</th><th>Warnings / symptoms</th><th>Language</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>
      {shown.map(r => <tr key={r.case_id} className={tab === 'all' && ['approved', 'rejected'].includes(r.status) ? 'done' : ''}>
        <td><TierBadge t={r.effective_tier} />{r.override && <div className="mt">System: {r.system_tier}, overridden</div>}</td>
        <td><a className="case-link" href={'#/case/' + r.case_id}>{r.case_id}</a>{r.patient_ref && <div className="mt">Ref {r.patient_ref}</div>}</td>
        <td><span className="chip">{r.status.replace('_', ' ')}</span>{r.consulted_at && <div className="chip t-standard" title={`Marked by ${r.consulted_by ?? 'staff'} on ${fmt(r.consulted_at)}`}>✓ Consulted</div>}{r.archived_at && <div className="chip">Archived</div>}<div className="mt">{r.reviewer ? 'With ' + r.reviewer : r.status === 'needs_review' ? 'Unassigned' : ''} {r.status === 'processing' && r.stage ? '(' + (STAGE[r.stage] ?? r.stage) + ')' : ''}</div>{r.consultation_note && <details className="consultation-preview"><summary>Consultation note</summary><div>{r.consultation_note}</div></details>}</td>
        <td>{r.open_flags} open flag(s){r.top_flags.map((f: string) => <div key={f}>⚑ {f}</div>)}<div className="mt">{r.symptoms.join(', ')}</div></td>
        <td>{r.languages.join(', ')}</td><td>{fmt(r.created_at)}</td><td><div className="queue-actions">
          {r.archived_at ? <button className="sec" onClick={() => caseAction(r.case_id, 'restore')}>Restore case</button> : <>
            {r.status === 'approved' && !r.consulted_at && <details className="consultation-editor"><summary>Add consultation note <span>(optional)</span></summary><textarea aria-label={`Consultation note for ${r.case_id}`} rows={3} maxLength={4000} placeholder="Follow-up findings or differences from the AI draft" value={consultationDraft[r.case_id] ?? ''} onChange={x => setConsultationDraft(notes => ({ ...notes, [r.case_id]: x.target.value }))} /></details>}
            <div className="queue-action-buttons">{r.status === 'approved' && !r.consulted_at && <button onClick={() => caseAction(r.case_id, 'consulted')}>✓ Mark consulted</button>}
              {['approved', 'rejected'].includes(r.status) && <button className="sec" title="Archive case" onClick={() => confirm('Archive this reviewed case? You can restore it from Archived.') && caseAction(r.case_id, 'archive')}>Archive</button>}</div>
          </>}
        </div></td></tr>)}</tbody></table></div></>
}

type Jump = { source_id: string; page?: number | null; t?: number | null; n: number }
const JumpCtx = createContext<(s: Span) => void>(() => {})

function Highlighted({ s, spans }: { s: Source; spans: Span[] }) {
  const jump = useContext(JumpCtx)
  const t = s.text ?? '', ok = spans.filter(x => x.source_id === s.source_id && t.slice(x.start, x.end) === x.quote).sort((a, b) => a.start - b.start)
  const parts: any[] = []; let i = 0
  ok.forEach((x, k) => { if (x.start < i) return; parts.push(t.slice(i, x.start), <mark key={k} role="button" tabIndex={0} title="Click to verify in the original file" onClick={() => jump(x)} onKeyDown={(ev: React.KeyboardEvent) => ev.key === 'Enter' && jump(x)}>{t.slice(x.start, x.end)}</mark>); i = x.end })
  parts.push(t.slice(i)); return <div className="src">{parts}</div>
}
const Evidence = ({ ev }: { ev?: Span[] }) => { const jump = useContext(JumpCtx); return <>{(ev ?? []).map((x, i) => <blockquote key={i}>“{x.quote}” <span className="mt">{x.page ? `page ${x.page} ` : ''}{x.t_start_ms != null ? `audio ${(x.t_start_ms / 1000).toFixed(1)}s–${((x.t_end_ms ?? 0) / 1000).toFixed(1)}s` : ''}</span><button type="button" className="sec" onClick={() => jump(x)}>Verify in source</button></blockquote>)}</> }

const MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', wav: 'audio/wav', mp3: 'audio/mpeg', mpeg: 'audio/mpeg', mpga: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac' }
function SourceViewer({ caseId, s, jump }: { caseId: string; s: Source; jump: Jump | null }) {
  const [open, setOpen] = useState(false), [url, setUrl] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [page, setPage] = useState(1)
  const ext = (s.filename ?? '').split('.').pop()!.toLowerCase(), type = MIME[ext] ?? '', isPdf = ext === 'pdf', isAudio = s.kind === 'audio'
  const box = useRef<HTMLDivElement>(null), au = useRef<HTMLAudioElement>(null), pend = useRef<number | null>(null)
  useEffect(() => { if (!open || url) return; setBusy(true); setErr('')
    fetchBlob(`/cases/${caseId}/sources/${s.source_id}/file`).then(b => setUrl(URL.createObjectURL(type ? new Blob([b], { type }) : b))).catch(x => setErr(msg(x))).finally(() => setBusy(false)) }, [open]) // eslint-disable-line
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  useEffect(() => { if (!jump || jump.source_id !== s.source_id) return
    setOpen(true); if (jump.page) setPage(jump.page); box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    if (jump.t != null) { pend.current = jump.t / 1000; const a = au.current; if (a && a.readyState > 0) { a.currentTime = pend.current; pend.current = null; a.play().catch(() => {}) } } }, [jump]) // eslint-disable-line
  return <div ref={box} style={{ margin: '.5rem 0' }}>
    <button type="button" className="sec" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide original' : 'View original ' + (isAudio ? 'audio' : isPdf ? 'PDF' : 'image')}</button>
    {open && <div style={{ marginTop: '.5rem' }}>{busy && <p>Loading original…</p>}<Err e={err} />
      {url && (isAudio ? <audio ref={au} src={url} controls style={{ width: '100%' }} onLoadedMetadata={() => { const a = au.current; if (a && pend.current != null) { a.currentTime = pend.current; pend.current = null; a.play().catch(() => {}) } }} />
        : isPdf ? <><div className="row"><span className="mt">Page</span><input type="number" min={1} aria-label="PDF page" value={page} onChange={x => setPage(Math.max(1, Number(x.target.value) || 1))} style={{ width: '5rem' }} /></div>
          <iframe key={page} title={'Original ' + (s.filename ?? 'PDF')} src={`${url}#page=${page}`} style={{ width: '100%', height: '30rem', border: '1px solid var(--line)' }} /></>
        : <img src={url} alt={'Original uploaded report ' + (s.filename ?? '')} style={{ maxWidth: '100%', border: '1px solid var(--line)' }} />)}
      {url && <p><a href={url} target="_blank" rel="noreferrer">Open in a new tab</a> <span className="hint">(for zoom)</span></p>}</div>}</div>
}

function Workspace({ id, user }: { id: string; user: User }) {
  const [c, setC] = useState<Case | null>(null), [e, setE] = useState(''), [note, setNote] = useState(''), [ov, setOv] = useState({ tier: 'urgent', reason: '' }), [rej, setRej] = useState({ reason: '', code: 'other' }), [ref, setRef] = useState({ to: '', urg: '', fu: '' })
  const load = useCallback(() => api('/cases/' + id).then(setC).catch(x => setE(msg(x))), [id])
  const [jump, setJump] = useState<Jump | null>(null)
  useEffect(() => { load() }, [load])
  useEffect(() => { if (c) setNote(n => n || c.note_revisions?.at(-1)?.text || c.ai_draft_note || '') }, [c?.case_id])
  usePoll(c?.status === 'processing', load)
  if (!c) return <><Err e={e} /><p>Loading case…</p></>
  const act = async (path: string, method = 'POST', json?: unknown) => { setE(''); try { setC(await api(`/cases/${id}${path}`, { method, json })) } catch (x) { setE(msg(x) + (x instanceof ApiError && x.status === 409 ? ' The case was refreshed.' : '')); if (x instanceof ApiError && x.status === 409) load() } }
  const mine = c.status === 'in_review' && (c.reviewer_username === user.username || user.role === 'admin')
  const open = (c.flags ?? []).filter(f => !f.resolved), blockers = [c.extraction_failed && 'Processing failed, so this case cannot be approved. Read the sources, then reject or resubmit.', open.length > 0 && `${open.length} flag(s) are unresolved. Acknowledge or dismiss each with a reason.`].filter(Boolean) as string[]
  const spans = [...(c.symptoms ?? []), ...(c.facts ?? []), ...(c.flags ?? [])].flatMap((x: any) => x.evidence ?? [])
  const FlagList = ({ list }: { list: Flag[] }) => <ul className="plain">{list.map(f => <FlagItem key={f.flag_id} f={f} canAct={mine} onResolve={(a, r) => act(`/flags/${f.flag_id}/resolve`, 'POST', { action: a, reason: r })} />)}{!list.length && <li className="mt">None.</li>}</ul>
  return <JumpCtx.Provider value={(x: Span) => setJump({ source_id: x.source_id, page: x.page, t: x.t_start_ms, n: Date.now() })}>
    <p><a href="#/queue">← Queue</a></p><h1>{c.case_id}</h1>
    <div className="card"><div className="row"><TierBadge t={c.effective_tier} label="Effective" />{c.tier_override && <TierBadge t={c.system_tier} label="System" />}<span className="chip">{c.status.replace('_', ' ')}</span><span className="mt">{c.patient_ref && 'Ref ' + c.patient_ref + ' · '}{(c.detected_languages ?? []).join(', ')} · {fmt(c.created_at)} · {c.reviewer_username ? 'With ' + c.reviewer_username : 'Unassigned'}</span></div>
      {c.tier_override && <p className="note">Reviewer override by {c.tier_override.by}: {c.tier_override.reason}. The automated tier above is unchanged.</p>}
      {c.extraction_failed && <p className="err">Processing failed. Details may be missing; read the sources directly.</p>}
      {c.system_tier === 'undetermined' && <p className="note">No readable text or processing incomplete: manual review needed. The absence of warnings here is not a safety finding.</p>}
      <Err e={e} />
      <div className="row">{c.status === 'needs_review' && <button onClick={() => act('/review/start')}>Start review</button>}{mine && <button className="sec" onClick={() => act('/review/release')}>Release to queue</button>}
        {c.status === 'processing' && <span>Processing… this page updates automatically.</span>}</div></div>
    <div className="grid two"><div>
      <section className="card"><h2>Sources (original text is primary)</h2>{(c.sources ?? []).map(s => <div key={s.source_id}><h3>{s.kind}{s.filename ? ': ' + s.filename : ''} <span className="chip">{s.language ?? 'language unknown'} · {s.language_status ?? 'status unknown'}</span></h3>
        {s.kind !== 'text' && <SourceViewer caseId={c.case_id} s={s} jump={jump} />}{s.warnings.map(w => <div key={w} className="note">{w}</div>)}{s.text ? <Highlighted s={s} spans={spans} /> : <p className="mt">No readable text for this source.</p>}
        {s.text_en && <><h3>Machine-translated reading copy (not authoritative)</h3><div className="src">{s.text_en}</div></>}</div>)}</section>
      <section className="card"><h2>Symptoms (AI-extracted, unverified)</h2><ul className="plain">{(c.symptoms ?? []).map((s, i) => <li key={i}><b>{s.name}</b> {s.negated && <span className="chip">Negated: patient denies</span>} <span className="chip">{s.status}</span> {s.needs_verification && <span className="chip t-undetermined">Needs verification</span>}
        <div className="mt">{[s.onset && 'onset ' + s.onset, s.duration, s.course !== 'unknown' && s.course, s.severity_as_reported].filter(Boolean).join(' · ')}</div><Evidence ev={s.evidence} /></li>)}{!(c.symptoms ?? []).length && <li className="mt">None extracted.</li>}</ul>
        <h3>Facts</h3><ul className="plain">{(c.facts ?? []).map((f, i) => <li key={i}>{f.field}: {f.value}<Evidence ev={f.evidence} /></li>)}</ul>
        {(c.uncertainties ?? []).length > 0 && <><h3>Uncertainties</h3><ul>{c.uncertainties!.map(u => <li key={u}>{u}</li>)}</ul></>}</section>
      <section className="card"><h2>Follow-up questions to verify</h2><ul className="plain">{(c.followups ?? []).map((f, i) => <li key={i}>{f.question}<div className="mt">{f.reason}{f.question_local && ' · Machine translation: ' + f.question_local}</div></li>)}</ul></section></div>
    <div>
      <section className="card"><h2>Warning flags</h2><FlagList list={(c.flags ?? []).filter(f => f.kind === 'safety')} /><h3>Context, integrity and quality flags</h3><FlagList list={(c.flags ?? []).filter(f => f.kind !== 'safety')} />
        <p className="hint">Rules are not clinically validated and can miss things.</p></section>
      <section className="card"><h2>AI draft note (read-only)</h2><div className="src" style={{ background: 'var(--gray)' }}>{c.ai_draft_note ?? 'No draft.'}</div>
        <h2 style={{ marginTop: '1rem' }}>Human note</h2><textarea aria-label="Human note" value={note} onChange={x => setNote(x.target.value)} disabled={!mine} />
        <button disabled={!mine || !note.trim()} onClick={() => act('/note', 'PUT', { text: note })}>Save note revision</button>
        <ul className="plain">{(c.note_revisions ?? []).slice().reverse().map((r, i) => <li key={i} className="mt">{fmt(r.at)} by {r.by}: {r.text.slice(0, 80)}{r.text.length > 80 && '…'}</li>)}</ul>
        {c.final_note && <p className="note"><b>Approved note:</b> {c.final_note}</p>}{c.consultation_note && <p className="note"><b>Consultation note</b> {c.consulted_by && `· ${c.consulted_by}`} {c.consulted_at && `· ${fmt(c.consulted_at)}`}<br />{c.consultation_note}</p>}{c.reviewer_note && <p className="note"><b>Rejected:</b> {c.reviewer_note}</p>}</section>
      {mine && <section className="card"><h2>Review actions</h2>
        <h3>Override priority</h3><div className="row"><select aria-label="Override tier" value={ov.tier} onChange={x => setOv({ ...ov, tier: x.target.value })}>{Object.keys(TIER).map(t => <option key={t}>{t}</option>)}</select><input aria-label="Override reason" placeholder="Reason (3+ chars)" value={ov.reason} onChange={x => setOv({ ...ov, reason: x.target.value })} />
          <button className="sec" disabled={ov.reason.trim().length < 3} onClick={() => confirm('Override priority? The system tier stays visible.') && act('/priority', 'POST', ov)}>Apply override</button></div>
        <h3>Approve</h3>{blockers.map(b => <div key={b} className="note">{b}</div>)}
        <div className="row"><input aria-label="Referral to" placeholder="Referral to (optional)" value={ref.to} onChange={x => setRef({ ...ref, to: x.target.value })} /><select aria-label="Referral urgency" value={ref.urg} onChange={x => setRef({ ...ref, urg: x.target.value })}><option value="">Urgency (not set)</option>{['routine', 'soon', 'urgent', 'emergency'].map(u => <option key={u}>{u}</option>)}</select><input aria-label="Follow up in" placeholder="Follow up in (optional)" value={ref.fu} onChange={x => setRef({ ...ref, fu: x.target.value })} /></div>
        <p><button disabled={!note.trim()} onClick={() => confirm('Approve this case with the human note shown? This is a human decision.') && act('/approve', 'POST', { text: note, referral_to: ref.to || null, referral_urgency: ref.urg || null, follow_up_in: ref.fu || null })}>Approve</button> <span className="hint">The server enforces the checks above.</span></p><Err e={e} />
        </section>}
      {(mine || c.status === 'needs_review') && <section className="card"><h2>Reject case</h2><Err e={e} /><div className="row"><select aria-label="Rejection code" value={rej.code} onChange={x => setRej({ ...rej, code: x.target.value })}>{['unclear_audio', 'illegible_report', 'insufficient_information', 'needs_redescription', 'other'].map(k => <option key={k}>{k}</option>)}</select>
        <input aria-label="Rejection reason" placeholder="Reason (3+ chars)" value={rej.reason} onChange={x => setRej({ ...rej, reason: x.target.value })} /><button className="danger" disabled={rej.reason.trim().length < 3} onClick={() => confirm('Reject this case?') && act('/reject', 'POST', rej)}>Reject</button></div><p className="hint">Intake staff see only fixed guidance for the code, never your reason.</p></section>}
      <section className="card"><h2>Audit timeline</h2><ul className="plain">{(c.audit_events ?? []).map((a: any) => <li key={a.seq} className="mt">{fmt(a.ts)} · {a.actor} · {a.action}</li>)}</ul></section></div></div></JumpCtx.Provider>
}

function FlagItem({ f, canAct, onResolve }: { f: Flag; canAct: boolean; onResolve: (a: string, r: string) => void }) {
  const [a, setA] = useState('acknowledged'), [r, setR] = useState('')
  return <li><span className={'chip ' + (f.kind === 'safety' ? 't-' + f.tier : '')}>{f.kind === 'safety' ? TIER[f.tier]?.split(':')[0] : f.kind}</span> <b>{f.title}</b> {f.resolved ? <span className="chip t-standard">Resolved: {f.resolution?.action}</span> : <span className="chip t-urgent">Open</span>}
    <div>{f.rationale}</div><Evidence ev={f.evidence} />{f.resolution && <div className="mt">{f.resolution.by}: {f.resolution.reason}</div>}
    {canAct && !f.resolved && <div className="row"><select aria-label="Resolution action" value={a} onChange={x => setA(x.target.value)}><option>acknowledged</option><option>dismissed</option></select><input aria-label="Resolution reason" placeholder="Reason (3+ chars)" value={r} onChange={x => setR(x.target.value)} /><button className="sec" disabled={r.trim().length < 3} onClick={() => onResolve(a, r)}>Resolve</button></div>}</li>
}

function Audit() {
  const [rows, setRows] = useState<any[]>([]), [cid, setCid] = useState(''), [actor, setActor] = useState(''), [v, setV] = useState<any>(null), [e, setE] = useState('')
  const load = useCallback(() => { const p = new URLSearchParams(); if (cid.trim()) p.set('case_id', cid.trim()); if (actor.trim()) p.set('actor', actor.trim()); api('/audit?' + p).then(setRows).catch(x => setE(msg(x))) }, [cid, actor])
  useEffect(() => { load() }, []) // eslint-disable-line
  return <><h1>Audit log</h1><div className="row"><input aria-label="Case ID" placeholder="Case ID" value={cid} onChange={x => setCid(x.target.value)} /><input aria-label="Actor" placeholder="Actor" value={actor} onChange={x => setActor(x.target.value)} /><button onClick={load}>Apply filters</button>
    <button className="sec" onClick={() => api('/audit/verify').then(setV).catch(x => setE(msg(x)))}>Verify chain</button></div><Err e={e} />
    {v && (v.ok ? <div className="note" role="status">Chain verified: {v.checked} events checked, no breaks found.</div> : <div className="err" role="alert"><b>VERIFICATION FAILED.</b> The audit chain is broken at sequence {v.broken_at_seq}.</div>)}
    <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Time</th><th>Actor</th><th>Role</th><th>Action</th><th>Case</th><th>Details</th></tr></thead><tbody>{rows.map(r => <tr key={r.seq}><td>{fmt(r.ts)}</td><td>{r.actor}</td><td>{r.role}</td><td>{r.action}</td><td>{r.case_id}</td><td className="mt">{JSON.stringify(r.details)}</td></tr>)}</tbody></table></div>{!rows.length && <p>No events match.</p>}</>
}
