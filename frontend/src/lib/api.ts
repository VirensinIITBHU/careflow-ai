export const BASE: string = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '')

export type Tier = 'immediate' | 'urgent' | 'undetermined' | 'standard'
export type Role = 'intake' | 'reviewer' | 'admin'
export interface User { username: string; role: Role }

export interface Span { source_id: string; start: number; end: number; quote: string; page?: number | null; t_start_ms?: number | null; t_end_ms?: number | null }
export interface Flag {
  flag_id: string; kind: 'safety' | 'safety_context' | 'integrity' | 'quality'; code: string; tier: Tier; title: string
  rationale: string; evidence: Span[]; origin: 'rule' | 'model' | 'integrity'; policy_version?: string | null
  resolved: boolean; resolution?: { action: string; reason: string; by: string; at?: string } | null
}
export interface Segment { start: number; end: number; c0: number; c1: number; conf: number; no_speech: number }
export interface Prompt { c0: number; c1: number; question: string }
export interface Source {
  source_id: string; kind: 'text' | 'audio' | 'report'; filename?: string | null; stored_name?: string | null
  language?: string | null; language_status?: string | null; text?: string | null; text_en?: string | null
  confidence?: number | null; segments?: Segment[] | null; pages?: number[][] | null; warnings: string[]
  label?: string | null; prompts?: Prompt[] | null; pretranscribed?: boolean
}
export interface Symptom {
  name: string; status: 'current' | 'past' | 'resolved' | 'uncertain'; negated: boolean; onset?: string | null
  duration?: string | null; course: string; severity_as_reported?: string | null; evidence: Span[]; needs_verification: boolean
}
export interface Fact { field: string; value: string; evidence: Span[] }
export interface FollowUp { question: string; reason: string; question_local?: string | null }
export interface Stage { name: string; status: 'running' | 'done' | 'failed' | 'skipped'; ms: number; note?: string | null }
export interface Question {
  id: string; key: string; kind: 'redflag' | 'gap' | 'opener' | 'model'; origin: 'rules' | 'policy' | 'model'
  slot?: string | null; target?: string | null; text_en: string; text_local?: string | null; lang: string; reason: string; priority: number
}
export interface InterviewRecord { question: Question; status: 'answered' | 'skipped' | 'suggested'; source_id?: string | null; start?: number | null; end?: number | null }
export interface AuditEvent { seq: number; timestamp: string; actor: string; role: string; action: string; details: Record<string, unknown> }
export interface Case {
  case_id: string; status: string; created_at: string; updated_at?: string; stages: Stage[]; rejection_message?: string
  sources?: Source[]; symptoms?: Symptom[]; facts?: Fact[]; flags?: Flag[]; followups?: FollowUp[]; uncertainties?: string[]
  extraction_failed?: boolean; system_tier?: Tier; effective_tier?: Tier; tier_override?: { tier: Tier; reason: string; by: string; at: string } | null
  ai_draft_note?: string | null; note_revisions?: { at: string; by: string; text: string }[]; reviewer_username?: string | null
  open_flags?: number; patient_ref?: string | null; detected_languages?: string[]; audit_events?: AuditEvent[]
  final_note?: string | null; reviewer_note?: string | null; reject_code?: string | null
  consulted_at?: string | null; consulted_by?: string | null; consultation_note?: string | null
  archived_at?: string | null; archived_by?: string | null; reviewed_at?: string | null; processed_at?: string | null
  referral?: { to?: string | null; urgency?: string | null; follow_up_in?: string | null; by: string; at: string } | null
  interview?: InterviewRecord[]; interview_session_id?: string | null; language_hint?: string | null
}
export interface QueueRow {
  case_id: string; status: string; effective_tier: Tier | null; system_tier: Tier | null; created_at: string
  languages: string[]; open_flags: number; needs_attention: number; reviewer: string | null
  consulted_at: string | null; consulted_by: string | null; consultation_note: string | null
  archived_at: string | null; archived_by: string | null; patient_ref: string | null; source_kinds: string[]
  override: { tier: Tier; reason: string; by: string } | null; stage: string | null; top_flags: string[]; symptoms: string[]; warning_signs: string[]; via_interview: boolean
}
export interface Turn {
  turn_id: string; kind: 'statement' | 'answer'; question?: Question | null; text?: string | null; modality: 'typed' | 'voice'
  filename?: string | null; language?: string | null; confidence?: number | null; warnings: string[]; stt_ms?: number | null; at: string
}
export interface Session {
  session_id: string; created_by: string; created_at: string; status: 'active' | 'submitted' | 'discarded'
  language_hint?: string | null; patient_ref?: string | null; turns: Turn[]; skipped: string[]
  attachments: { source_id: string; filename: string }[]; case_id?: string | null
}
export interface LiveSymptom { id: string; name: string; status: 'present' | 'denied'; quote: string; warning: boolean; origin: 'rules' | 'model' }
export interface Suggestions {
  questions: Question[]; symptoms: LiveSymptom[]; warning_signs: { code: string; title: string; quote: string }[]
  completeness: { filled: number; total: number; pct: number; missing: string[] }; language: 'en' | 'hinglish' | 'hi'
  model: { status: 'ok' | 'off' | 'error' | 'pending'; ms: number; cached?: boolean; blocked?: number; error?: string }; ms: number
  phase?: 'rules' | 'model'; seq?: number
}

export class ApiError extends Error { constructor(public status: number, m: string) { super(m) } }

let token = ''
try { token = sessionStorage.getItem('cf_token') || '' } catch { /* storage blocked */ }
let on401 = () => {}
export const setOn401 = (f: () => void) => { on401 = f }
export const setToken = (t: string) => {
  token = t
  try { t ? sessionStorage.setItem('cf_token', t) : sessionStorage.removeItem('cf_token') } catch { /* storage blocked */ }
}
export const getToken = () => token

export async function api<T = any>(path: string, o: { method?: string; json?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = token ? { Authorization: 'Bearer ' + token } : {}
  let body: BodyInit | undefined
  if (o.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.json) } else if (o.form) body = o.form
  let r: Response
  try { r = await fetch(BASE + path, { method: o.method ?? 'GET', headers, body, signal: o.signal }) }
  catch (e) { if ((e as Error).name === 'AbortError') throw e; throw new ApiError(0, 'Cannot reach the server. It may be waking up; try again in a moment.') }
  if (!r.ok) {
    let m = r.statusText
    try { const d = await r.json(); m = typeof d.detail === 'string' ? d.detail : Array.isArray(d.detail) ? d.detail.map((x: any) => x.msg).join('; ') : m } catch { /* keep statusText */ }
    if (r.status === 401 && path !== '/auth/login') { setToken(''); on401() }
    throw new ApiError(r.status, m || `Request failed (${r.status})`)
  }
  return r.json()
}

export async function fetchBlob(path: string): Promise<Blob> {
  let r: Response
  try { r = await fetch(BASE + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} }) }
  catch { throw new ApiError(0, 'Cannot reach the server.') }
  if (!r.ok) { if (r.status === 401) { setToken(''); on401() } throw new ApiError(r.status, r.status === 404 ? 'The original file is not available.' : r.statusText) }
  return r.blob()
}

export const msg = (e: unknown) => e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.'

/** Server-sent events with the session token (EventSource cannot send headers). */
export function events(path: string, handlers: Record<string, (data: any) => void>, onError?: () => void): () => void {
  const sep = path.includes('?') ? '&' : '?'
  const es = new EventSource(`${BASE}${path}${sep}token=${encodeURIComponent(token)}`)
  for (const [name, fn] of Object.entries(handlers)) es.addEventListener(name, (ev) => { try { fn(JSON.parse((ev as MessageEvent).data)) } catch { /* ignore */ } })
  es.addEventListener('done', () => es.close())
  es.onerror = () => onError?.()
  return () => es.close()
}

export const wsUrl = (path: string) => `${BASE.replace(/^http/, 'ws')}${path}?token=${encodeURIComponent(token)}`
