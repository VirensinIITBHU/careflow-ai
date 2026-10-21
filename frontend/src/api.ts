const BASE: string = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'
export type Tier = 'immediate' | 'urgent' | 'undetermined' | 'standard'
export interface Span { source_id: string; start: number; end: number; quote: string; page?: number | null; t_start_ms?: number | null; t_end_ms?: number | null }
export interface Flag { flag_id: string; kind: string; code: string; tier: string; title: string; rationale: string; evidence: Span[]; resolved: boolean; resolution?: { action: string; reason: string; by: string } | null }
export interface Source { source_id: string; stored_name?: string | null; kind: string; filename?: string; language?: string; language_status?: string; text?: string; text_en?: string; warnings: string[] }
export interface Case {
  case_id: string; status: string; created_at: string; stages: { name: string; status: string; ms: number; note?: string }[]
  rejection_message?: string; sources?: Source[]; symptoms?: any[]; facts?: any[]; flags?: Flag[]; followups?: any[]; uncertainties?: string[]
  extraction_failed?: boolean; system_tier?: Tier; effective_tier?: Tier; tier_override?: { tier: Tier; reason: string; by: string } | null
  ai_draft_note?: string; note_revisions?: { at: string; by: string; text: string }[]; reviewer_username?: string | null
  open_flags?: number; patient_ref?: string | null; detected_languages?: string[]; audit_events?: any[]; final_note?: string | null; reviewer_note?: string | null
  consulted_at?: string | null; consulted_by?: string | null; archived_at?: string | null; archived_by?: string | null
  consultation_note?: string | null
}
export class ApiError extends Error { constructor(public status: number, m: string) { super(m) } }
let token = sessionStorage.getItem('cf_token') || ''
let on401 = () => {}
export const setOn401 = (f: () => void) => { on401 = f }
export const setToken = (t: string) => { token = t; t ? sessionStorage.setItem('cf_token', t) : sessionStorage.removeItem('cf_token') }
export const hasToken = () => !!token
export async function api<T = any>(path: string, o: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = token ? { Authorization: 'Bearer ' + token } : {}
  let body: BodyInit | undefined
  if (o.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.json) } else if (o.form) body = o.form // no manual multipart boundary
  let r: Response
  try { r = await fetch(BASE + path, { method: o.method ?? 'GET', headers, body }) } catch { throw new ApiError(0, 'Cannot reach the server. Check that the backend is running.') }
  if (!r.ok) {
    let m = r.statusText
    try { const d = await r.json(); m = typeof d.detail === 'string' ? d.detail : Array.isArray(d.detail) ? d.detail.map((x: any) => x.msg).join('; ') : m } catch { /* keep statusText */ }
    if (r.status === 401 && path !== '/auth/login') { setToken(''); on401() }
    throw new ApiError(r.status, m)
  }
  return r.json()
}

export async function fetchBlob(path: string): Promise<Blob> {
  let r: Response
  try { r = await fetch(BASE + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} }) } catch { throw new ApiError(0, 'Cannot reach the server. Check that the backend is running.') }
  if (!r.ok) { if (r.status === 401) { setToken(''); on401() } throw new ApiError(r.status, r.status === 404 ? 'The original file is not available.' : r.statusText) }
  return r.blob()
}
