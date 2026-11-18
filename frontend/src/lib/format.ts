import type { Tier } from './api'

export const TIERS: Tier[] = ['immediate', 'urgent', 'undetermined', 'standard']

export const TIER_META: Record<Tier, { label: string; short: string; help: string; cls: string; dot: string; bar: string }> = {
  immediate: { label: 'Immediate', short: 'Immediate', help: 'A warning-sign rule matched. Review first.', cls: 'bg-immsoft text-imm border-imm/30', dot: 'bg-imm', bar: 'bg-imm' },
  urgent: { label: 'Urgent', short: 'Urgent', help: 'A warning-sign rule matched. Review soon.', cls: 'bg-urgsoft text-urg border-urg/30', dot: 'bg-urg', bar: 'bg-urg' },
  undetermined: { label: 'Undetermined', short: 'Undetermined', help: 'The system could not assess this case reliably. Read the sources.', cls: 'bg-undsoft text-und border-und/40 border-dashed', dot: 'bg-und', bar: 'bg-und' },
  standard: { label: 'No warning sign found', short: 'Standard', help: 'No automated warning sign was found. This does not mean the patient is safe.', cls: 'bg-stdsoft text-std border-std/30', dot: 'bg-std', bar: 'bg-std' },
}
export const TIER_RANK: Record<string, number> = { immediate: 0, urgent: 1, undetermined: 2, standard: 3 }

export const STATUS_LABEL: Record<string, string> = {
  processing: 'Processing', needs_review: 'To review', in_review: 'In review', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn',
}

export const STAGE_LABEL: Record<string, string> = {
  transcribe: 'Transcribing audio', ocr: 'Reading report', extract: 'Extracting details', extract_fallback: 'Extracting (fallback model)',
  translate_extracted_fields: 'Normalizing to English', safety_rules: 'Warning-sign rules', safety_second_reader: 'Second safety reader',
  integrity: 'Integrity checks', translate_source: 'Translating reading copy', followups: 'Follow-up questions', translate_questions: 'Translating questions',
}

export const REJECT_LABEL: Record<string, string> = {
  unclear_audio: 'Unclear audio', illegible_report: 'Illegible report', insufficient_information: 'Not enough information',
  needs_redescription: 'Needs re-description', other: 'Other',
}

export const LANG_LABEL: Record<string, string> = { en: 'English', english: 'English', hi: 'Hindi', hindi: 'Hindi', hinglish: 'Hinglish', ur: 'Urdu', urdu: 'Urdu' }
export const langName = (l?: string | null) => (l ? LANG_LABEL[l.toLowerCase()] ?? l : 'Unknown')

export function ago(iso?: string | null): string {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
export const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')
export const secs = (ms?: number | null) => (ms == null ? '' : ms < 1000 ? `${Math.round(ms)} ms` : ms < 90000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`)
export const clock = (ms?: number | null) => { if (ms == null) return ''; const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` }
export const human = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
