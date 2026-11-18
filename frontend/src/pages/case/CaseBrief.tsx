import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ArrowLeft, Bot, Check, CheckCircle2, ChevronDown, CircleSlash, ClipboardCheck, Copy, Flag as FlagIcon, Hand, HelpCircle,
  History, ListChecks, Lock, MessagesSquare, NotebookPen, ShieldAlert, ShieldCheck, Undo2, UserRound, XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Button, Callout, Card, Empty, Field, Input, Select, Skeleton, Tabs, Textarea, TierBadge, useDialog, useToast } from '../../components/ui'
import { api, ApiError, events, msg } from '../../lib/api'
import type { Case, Flag, Span, Symptom, Tier } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { ago, human, langName, REJECT_LABEL, secs, STAGE_LABEL, STATUS_LABEL, TIER_META, TIERS, when } from '../../lib/format'
import SourcePane from './SourcePane'
import type { Focus } from './SourcePane'

type TabId = 'brief' | 'flags' | 'interview' | 'note' | 'activity'

export default function CaseBrief() {
  const { caseId = '' } = useParams()
  const { user } = useAuth()
  const qc = useQueryClient(), toast = useToast()
  const q = useQuery({ queryKey: ['case', caseId], queryFn: () => api<Case>(`/cases/${caseId}`) })
  const [focus, setFocus] = useState<Focus>(null)
  const [tab, setTab] = useState<TabId>('brief')
  const c = q.data

  useEffect(() => {
    if (c?.status !== 'processing') return
    return events(`/cases/${caseId}/events`, { done: () => qc.invalidateQueries({ queryKey: ['case', caseId] }), progress: d => qc.setQueryData<Case>(['case', caseId], x => x ? { ...x, ...d } : x) })
  }, [c?.status, caseId, qc])

  const pick = useCallback((span: Span, seek = true) => setFocus({ span, seek, n: Date.now() }), [])
  const set = (x: Case) => { qc.setQueryData(['case', caseId], x); qc.invalidateQueries({ queryKey: ['queue'] }) }
  const act = async (path: string, method = 'POST', json?: unknown, ok?: string) => {
    try { set(await api<Case>(`/cases/${caseId}${path}`, { method, json })); if (ok) toast(ok); return true }
    catch (e) { toast(msg(e), 'err'); if (e instanceof ApiError && e.status === 409) q.refetch(); return false }
  }

  if (q.isLoading) return <div className="space-y-4 p-8"><Skeleton className="h-16" /><div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-[60vh]" /><Skeleton className="h-[60vh]" /></div></div>
  if (q.error || !c) return <div className="p-8"><Callout tone="danger" title="Could not open this case">{msg(q.error)}</Callout></div>

  const mine = c.status === 'in_review' && (c.reviewer_username === user?.username || user?.role === 'admin')
  const flags = c.flags ?? []
  const safety = flags.filter(f => f.kind === 'safety'), other = flags.filter(f => f.kind !== 'safety')
  const openFlags = flags.filter(f => !f.resolved).length

  return (
    <div className="flex min-h-screen flex-col xl:h-screen">
      <Header c={c} mine={mine} act={act} />
      {c.status === 'processing' ? <Processing c={c} /> : (
        <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="min-h-[50vh] border-b border-line bg-panel xl:min-h-0 xl:border-b-0 xl:border-r"><SourcePane c={c} focus={focus} onPick={pick} /></div>
          <div className="flex min-h-0 flex-col">
            <div className="border-b border-line px-4 py-2.5">
              <Tabs value={tab} onChange={setTab} items={[
                { id: 'brief', label: <><ListChecks className="h-3.5 w-3.5" />Brief</> },
                { id: 'flags', label: <><FlagIcon className="h-3.5 w-3.5" />Flags</>, count: openFlags },
                ...(c.interview?.length ? [{ id: 'interview' as const, label: <><MessagesSquare className="h-3.5 w-3.5" />Interview</>, count: c.interview.filter(r => r.status === 'answered').length }] : []),
                { id: 'note', label: <><NotebookPen className="h-3.5 w-3.5" />Note &amp; decision</> },
                { id: 'activity', label: <><History className="h-3.5 w-3.5" />Activity</> },
              ]} />
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 scroll-thin">
              {tab === 'brief' && <Brief c={c} pick={pick} focus={focus} />}
              {tab === 'flags' && <><FlagList title="Warning signs" list={safety} mine={mine} act={act} pick={pick} empty="No warning-sign rule matched." />
                <FlagList title="Context, integrity and quality" list={other} mine={mine} act={act} pick={pick} empty="None." /></>}
              {tab === 'interview' && <InterviewRecord c={c} pick={pick} />}
              {tab === 'note' && <NoteAndDecision c={c} mine={mine} act={act} goFlags={() => setTab('flags')} />}
              {tab === 'activity' && <Activity c={c} />}
            </div>
            {tab !== 'note' && mine && <DecisionBar c={c} onOpen={() => setTab('note')} />}
          </div>
        </div>)}
    </div>
  )
}

type Act = (path: string, method?: string, json?: unknown, ok?: string) => Promise<boolean>

/* ---------------------------------------------------------------- header + why */

function Header({ c, mine, act }: { c: Case; mine: boolean; act: Act }) {
  const [why, setWhy] = useState(false)
  return (
    <div className="border-b border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link to="/queue" className="rounded-lg p-1.5 text-mute hover:bg-sunken hover:text-ink" aria-label="Back to queue"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <div className="flex items-center gap-2"><h1 className="font-mono text-[15px] font-semibold">{c.case_id}</h1>
            <Badge>{STATUS_LABEL[c.status] ?? c.status}</Badge>{c.archived_at && <Badge>Archived</Badge>}{c.consulted_at && <Badge tone="std">Consulted</Badge>}</div>
          <div className="text-xs text-mute">{c.patient_ref && `${c.patient_ref} · `}{(c.detected_languages ?? []).map(langName).join(', ') || 'language unknown'} · submitted {ago(c.created_at)}{c.interview?.length ? ' · via live interview' : ''}</div>
        </div>
        <button onClick={() => setWhy(!why)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-sunken" aria-expanded={why}>
          <TierBadge tier={c.status === 'processing' ? null : c.effective_tier} size="lg" />
          <span className="flex items-center gap-0.5 text-xs font-medium text-mute">Why?<ChevronDown className={clsx('h-3.5 w-3.5 transition', why && 'rotate-180')} /></span>
        </button>
        {c.tier_override && <span className="text-xs text-mute">System said <TierBadge tier={c.system_tier} size="sm" /></span>}
        <div className="ml-auto flex items-center gap-2">
          {c.reviewer_username && <span className="flex items-center gap-1 text-xs text-mute"><UserRound className="h-3.5 w-3.5" />{c.reviewer_username}</span>}
          {c.status === 'needs_review' && <Button onClick={() => act('/review/start', 'POST', undefined, 'You are reviewing this case')} icon={<Hand className="h-4 w-4" />}>Start review</Button>}
          {mine && <Button variant="secondary" onClick={() => act('/review/release', 'POST', undefined, 'Released to the queue')} icon={<Undo2 className="h-4 w-4" />}>Release</Button>}
          {c.status === 'in_review' && !mine && <Badge tone="urg"><Lock className="h-3 w-3" />Claimed by {c.reviewer_username}</Badge>}
        </div>
      </div>
      {why && <WhyTier c={c} mine={mine} act={act} />}
    </div>
  )
}

function WhyTier({ c, mine, act }: { c: Case; mine: boolean; act: Act }) {
  const [tier, setTier] = useState<Tier>('urgent'), [reason, setReason] = useState('')
  const safety = (c.flags ?? []).filter(f => f.kind === 'safety').sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier))
  const textSources = (c.sources ?? []).filter(s => s.text).length
  const policy = safety[0]?.policy_version?.split('+')[0]
  return (
    <div className="animate-rise border-t border-line bg-sunken/40 px-4 py-4 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="label mb-2">How the automated tier was set</p>
          {c.system_tier === 'undetermined' ? (
            <Callout tone="info" title="Undetermined: the system could not assess this case">{c.extraction_failed ? 'Processing failed for at least one step. ' : ''}{!textSources ? 'No source produced readable text. ' : ''}Read the sources directly. Missing warnings here are not a safety finding.</Callout>
          ) : !safety.length ? (
            <Callout tone="ok" title="No warning-sign rule matched">Rules screened {textSources} readable source{textSources === 1 ? '' : 's'}. This does not mean the patient is safe; rules are not clinically validated and can miss unusual wording.</Callout>
          ) : (
            <ol className="space-y-2">{safety.map(f => (
              <li key={f.flag_id} className="flex items-start gap-3 rounded-lg border border-line bg-panel p-3">
                <TierBadge tier={f.tier} size="sm" />
                <div className="min-w-0 flex-1 text-sm"><div className="font-medium">{f.title}</div>
                  <div className="text-mute">Matched “{f.evidence[0]?.quote}” · {f.origin === 'rule' ? 'keyword rule' : f.policy_version?.includes('second-reader') ? 'added by the second safety reader' : 'found by the extraction cross-check'}</div></div>
                {f.resolved && <Badge tone="std"><Check className="h-3 w-3" />{f.resolution?.action}</Badge>}
              </li>))}</ol>
          )}
          <p className="mt-2 text-xs text-mute">The highest matched tier wins. Models may add flags but can never remove one or lower the tier.{policy && ` Policy ${policy}.`}</p>
        </div>
        <div>
          <p className="label mb-2">Reviewer override</p>
          {c.tier_override ? <Callout tone="warn" title={`Overridden to ${TIER_META[c.tier_override.tier].short} by ${c.tier_override.by}`}>{c.tier_override.reason}. The system tier stays visible.</Callout>
            : mine ? <div className="space-y-2">
              <div className="flex gap-2"><Select value={tier} onChange={e => setTier(e.target.value as Tier)} aria-label="Override tier" className="w-44">{TIERS.map(t => <option key={t} value={t}>{TIER_META[t].short}</option>)}</Select>
                <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Override reason" /></div>
              <Button size="sm" variant="secondary" disabled={reason.trim().length < 3} onClick={() => act('/priority', 'POST', { tier, reason }, 'Priority overridden')}>Apply override</Button>
            </div> : <p className="text-sm text-mute">Start the review to override priority.</p>}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- brief */

const Evidence = ({ ev, pick, focus }: { ev: Span[]; pick: (s: Span, seek?: boolean) => void; focus: Focus }) => (
  <span className="flex flex-wrap gap-1">{ev.map((x, i) => {
    const active = focus?.span.source_id === x.source_id && focus.span.start === x.start
    return <button key={i} onClick={() => pick(x, true)} onMouseEnter={() => pick(x, false)}
      className={clsx('max-w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[12.5px] transition', active ? 'border-urg/50 bg-hl/60' : 'border-line bg-sunken/60 text-mute hover:border-urg/40 hover:bg-hl/30 hover:text-ink')}>
      “{x.quote}”{x.t_start_ms != null && <span className="ml-1 font-mono text-[11px]">{(x.t_start_ms / 1000).toFixed(1)}s</span>}{x.page ? <span className="ml-1 text-[11px]">p.{x.page}</span> : null}</button>
  })}</span>
)

const statusTone = (s: Symptom) => s.negated ? 'outline' : s.status === 'current' ? 'brand' : s.status === 'uncertain' ? 'und' : 'neutral'

function Brief({ c, pick, focus }: { c: Case; pick: (s: Span, seek?: boolean) => void; focus: Focus }) {
  const symptoms = c.symptoms ?? []
  const current = symptoms.filter(s => !s.negated && ['current', 'uncertain'].includes(s.status))
  const pastOrDenied = symptoms.filter(s => s.negated || ['past', 'resolved'].includes(s.status))
  const open = (c.flags ?? []).filter(f => f.kind === 'safety' && !f.resolved)
  const p = (s: Span) => pick(s, false)
  return (
    <>
      {c.extraction_failed && <Callout tone="danger" title="Structured extraction failed">No AI summary is available for part of this case. Warning-sign rules still ran on the raw text. Read the sources directly.</Callout>}
      {open.length > 0 && <div className="rounded-xl border border-imm/40 bg-immsoft/70 p-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-imm"><ShieldAlert className="h-4 w-4" />{open.length} warning sign{open.length > 1 ? 's' : ''} to check</div>
        <div className="mt-2 flex flex-wrap gap-2">{open.map(f => <button key={f.flag_id} onClick={() => f.evidence[0] && pick(f.evidence[0])} className="rounded-lg border border-imm/30 bg-panel px-2.5 py-1 text-[13px] hover:shadow-card">{f.title.replace(' mentioned', '')} · <span className="text-mute">“{f.evidence[0]?.quote}”</span></button>)}</div>
      </div>}

      <Card>
        <header className="flex items-center gap-2 border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">Reported symptoms</h2><Badge tone="und"><Bot className="h-3 w-3" />AI-extracted · verify</Badge></header>
        {!current.length ? <p className="p-4 text-sm text-mute">No current symptoms extracted.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wider text-mute"><th className="px-4 py-2 font-medium">Symptom</th><th className="px-2 py-2 font-medium">Onset</th><th className="px-2 py-2 font-medium">Severity / course</th><th className="px-4 py-2 font-medium">Evidence</th></tr></thead>
            <tbody className="divide-y divide-line">{current.map((s, i) => (
              <tr key={i} className="align-top transition hover:bg-sunken/40" onMouseEnter={() => s.evidence[0] && p(s.evidence[0])}>
                <td className="px-4 py-2.5"><div className="font-medium">{s.name}</div><div className="mt-0.5 flex gap-1"><Badge tone={statusTone(s)}>{s.status}</Badge>{s.needs_verification && <Badge tone="und">verify</Badge>}</div></td>
                <td className="px-2 py-2.5 text-mute">{s.onset ?? s.duration ?? <span className="text-mute/60">not stated</span>}{s.onset && s.duration && <div className="text-xs">for {s.duration}</div>}</td>
                <td className="px-2 py-2.5 text-mute">{s.severity_as_reported ?? <span className="text-mute/60">not stated</span>}{s.course !== 'unknown' && <div className="text-xs">{s.course}</div>}</td>
                <td className="max-w-[220px] px-4 py-2.5"><Evidence ev={s.evidence} pick={pick} focus={focus} /></td>
              </tr>))}</tbody>
          </table>)}
        {pastOrDenied.length > 0 && <div className="border-t border-line px-4 py-3">
          <p className="label mb-2">Denied, past or resolved</p>
          <ul className="space-y-1.5 text-sm">{pastOrDenied.map((s, i) => <li key={i} className="flex flex-wrap items-center gap-2"><span className={clsx(s.negated && 'line-through decoration-mute/60')}>{s.name}</span>
            <Badge tone="outline">{s.negated ? 'denied' : s.status}</Badge><Evidence ev={s.evidence} pick={pick} focus={focus} /></li>)}</ul></div>}
      </Card>

      {(c.facts ?? []).length > 0 && <Card>
        <header className="border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">Other details</h2></header>
        <dl className="divide-y divide-line text-sm">{c.facts!.map((f, i) => <div key={i} className="grid grid-cols-[140px_1fr] gap-3 px-4 py-2.5" onMouseEnter={() => f.evidence[0] && p(f.evidence[0])}>
          <dt className="text-mute">{human(f.field)}</dt><dd><div>{f.value}</div><div className="mt-1"><Evidence ev={f.evidence} pick={pick} focus={focus} /></div></dd></div>)}</dl>
      </Card>}

      {(c.uncertainties ?? []).length > 0 && <Callout tone="warn" title="Uncertainties noted by the extractor"><ul className="list-disc pl-4">{c.uncertainties!.map(u => <li key={u}>{u}</li>)}</ul></Callout>}

      {(c.followups ?? []).length > 0 && <Card>
        <header className="flex items-center gap-2 border-b border-line px-4 py-3"><HelpCircle className="h-4 w-4 text-mute" /><h2 className="text-sm font-semibold">Still to clarify with the patient</h2></header>
        <ul className="divide-y divide-line text-sm">{c.followups!.map((f, i) => <li key={i} className="px-4 py-2.5"><div>{f.question}</div>
          <div className="text-xs text-mute">{f.reason}{f.question_local && <> · <span lang="hi">{f.question_local}</span> <span className="opacity-70">(machine translation)</span></>}</div></li>)}</ul>
      </Card>}
    </>
  )
}

/* ---------------------------------------------------------------- flags */

function FlagList({ title, list, mine, act, pick, empty }: { title: string; list: Flag[]; mine: boolean; act: Act; pick: (s: Span) => void; empty: string }) {
  const ask = useDialog()
  const resolve = async (f: Flag, action: 'acknowledged' | 'dismissed') => {
    const reason = await ask({ title: action === 'acknowledged' ? 'Acknowledge flag' : 'Dismiss flag', body: <>“{f.title}”. Record why, after checking the source.</>,
      confirm: action === 'acknowledged' ? 'Acknowledge' : 'Dismiss', tone: action === 'dismissed' ? 'danger' : 'primary', input: { label: 'Reason', min: 3, placeholder: action === 'acknowledged' ? 'Confirmed in the audio at 0:12…' : 'Mentioned as a past event…' } })
    if (reason) act(`/flags/${f.flag_id}/resolve`, 'POST', { action, reason }, `Flag ${action}`)
  }
  return (
    <Card>
      <header className="flex items-center gap-2 border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2><span className="text-xs text-mute">{list.filter(f => !f.resolved).length} open</span></header>
      {!list.length ? <p className="p-4 text-sm text-mute">{empty}</p> : <ul className="divide-y divide-line">{list.map(f => (
        <li key={f.flag_id} className={clsx('px-4 py-3', f.resolved && 'opacity-70')}>
          <div className="flex flex-wrap items-center gap-2">
            {f.kind === 'safety' ? <TierBadge tier={f.tier} size="sm" /> : <Badge tone={f.kind === 'integrity' ? 'urg' : 'neutral'}>{f.kind.replace('_', ' ')}</Badge>}
            <span className="font-medium">{f.title}</span>
            <Badge tone={f.origin === 'model' ? 'und' : 'outline'}>{f.origin === 'rule' ? 'Rule' : f.origin === 'model' ? 'AI-added' : 'Integrity check'}</Badge>
            {f.resolved && <Badge tone="std"><CheckCircle2 className="h-3 w-3" />{f.resolution?.action}</Badge>}
          </div>
          <p className="mt-1 text-[13px] text-mute">{f.rationale}</p>
          {f.evidence.length > 0 && <div className="mt-2"><Evidence ev={f.evidence} pick={pick} focus={null} /></div>}
          {f.resolved ? <p className="mt-2 text-xs text-mute">{f.resolution?.by}: {f.resolution?.reason}</p>
            : mine && <div className="mt-2.5 flex gap-2"><Button size="sm" variant="secondary" onClick={() => resolve(f, 'acknowledged')} icon={<Check className="h-3.5 w-3.5" />}>Acknowledge</Button>
              <Button size="sm" variant="quiet" onClick={() => resolve(f, 'dismissed')} icon={<CircleSlash className="h-3.5 w-3.5" />}>Dismiss</Button></div>}
        </li>))}</ul>}
    </Card>
  )
}

/* ---------------------------------------------------------------- interview */

function InterviewRecord({ c, pick }: { c: Case; pick: (s: Span) => void }) {
  const rec = c.interview ?? []
  const answered = rec.filter(r => r.status === 'answered'), skipped = rec.filter(r => r.status === 'skipped'), unasked = rec.filter(r => r.status === 'suggested')
  const srcText = (id?: string | null) => c.sources?.find(s => s.source_id === id)?.text ?? ''
  const origin = (o: string) => o === 'policy' ? <Badge tone="imm"><ShieldAlert className="h-3 w-3" />Policy</Badge> : o === 'model' ? <Badge tone="und"><Bot className="h-3 w-3" />AI</Badge> : <Badge tone="brand">Rules</Badge>
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {[['Answered', answered.length, 'text-std'], ['Skipped', skipped.length, 'text-urg'], ['Suggested, not asked', unasked.length, 'text-mute']].map(([l, n, cls]) =>
          <Card key={l as string} className="p-3"><div className={clsx('text-2xl font-semibold tabular-nums', cls as string)}>{n}</div><div className="text-xs text-mute">{l}</div></Card>)}
      </div>
      <Card>
        <header className="border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">Questions asked during the live interview</h2></header>
        <ul className="divide-y divide-line">{answered.map((r, i) => {
          const ans = srcText(r.source_id).slice(r.start ?? 0, r.end ?? 0)
          return <li key={i} className="px-4 py-3">
            <div className="flex items-start gap-2">{origin(r.question.origin)}<div className="min-w-0 flex-1"><div className="font-medium">{r.question.text_en}</div>
              {r.question.text_local && r.question.text_local !== r.question.text_en && <div lang="hi" className="text-[13px] text-mute">{r.question.text_local}</div>}</div></div>
            {r.source_id && <button onClick={() => pick({ source_id: r.source_id!, start: r.start ?? 0, end: r.end ?? 0, quote: ans })}
              className="ml-[52px] mt-1.5 block rounded-lg bg-brandsoft px-3 py-1.5 text-left text-sm hover:ring-1 hover:ring-brand/40">{ans || <i className="text-mute">voice answer</i>}</button>}
          </li>
        })}</ul>
      </Card>
      {(skipped.length > 0 || unasked.length > 0) && <Card>
        <header className="border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">Not answered</h2><p className="text-xs text-mute">Consider asking these at the consultation.</p></header>
        <ul className="divide-y divide-line text-sm">{[...skipped, ...unasked].map((r, i) => <li key={i} className="flex items-center gap-2 px-4 py-2.5">{origin(r.question.origin)}<span className="flex-1">{r.question.text_en}</span>
          <Badge tone={r.status === 'skipped' ? 'urg' : 'outline'}>{r.status === 'skipped' ? 'skipped' : 'not asked'}</Badge></li>)}</ul>
      </Card>}
    </>
  )
}

/* ---------------------------------------------------------------- note + decision */

function blockersFor(c: Case) {
  const open = (c.flags ?? []).filter(f => !f.resolved).length
  return [c.extraction_failed && 'Processing failed, so this case cannot be approved. Read the sources, then reject or resubmit.',
    open > 0 && `${open} flag${open > 1 ? 's are' : ' is'} unresolved. Acknowledge or dismiss each with a reason.`].filter(Boolean) as string[]
}

function DecisionBar({ c, onOpen }: { c: Case; onOpen: () => void }) {
  const b = blockersFor(c)
  return (
    <div className="flex items-center gap-3 border-t border-line bg-panel px-4 py-3">
      {b.length ? <span className="flex items-center gap-1.5 text-sm text-urg"><Lock className="h-4 w-4" />{b.length} blocker{b.length > 1 ? 's' : ''} before approval</span>
        : <span className="flex items-center gap-1.5 text-sm text-std"><ShieldCheck className="h-4 w-4" />Ready for your decision</span>}
      <Button className="ml-auto" onClick={onOpen} icon={<ClipboardCheck className="h-4 w-4" />}>Write note &amp; decide</Button>
    </div>
  )
}

function NoteAndDecision({ c, mine, act, goFlags }: { c: Case; mine: boolean; act: Act; goFlags: () => void }) {
  const ask = useDialog()
  const [note, setNote] = useState(() => c.note_revisions?.at(-1)?.text ?? '')
  const [ref, setRef] = useState({ to: '', urg: '', fu: '' })
  const [rej, setRej] = useState({ code: 'insufficient_information', reason: '' })
  const blockers = blockersFor(c)
  const saved = c.note_revisions?.at(-1)?.text ?? ''
  const decided = ['approved', 'rejected'].includes(c.status)
  const approve = async () => {
    if (await ask({ title: 'Approve this case?', body: 'You confirm the human note reflects your own review of the sources. This is a human decision; the AI did not make it.', confirm: 'Approve' }))
      act('/approve', 'POST', { text: note, referral_to: ref.to || null, referral_urgency: ref.urg || null, follow_up_in: ref.fu || null }, 'Case approved')
  }
  const reject = async () => {
    if (await ask({ title: 'Reject this case?', body: 'Intake staff see only fixed guidance for the selected code, never your reason.', confirm: 'Reject', tone: 'danger' }))
      act('/reject', 'POST', rej, 'Case rejected')
  }
  return (
    <>
      <div className="grid gap-4 2xl:grid-cols-2">
        <Card>
          <header className="flex items-center gap-2 border-b border-line px-4 py-3"><Bot className="h-4 w-4 text-und" /><h2 className="text-sm font-semibold">AI draft</h2><Badge>read-only</Badge>
            {mine && c.ai_draft_note && <Button size="sm" variant="quiet" className="ml-auto" onClick={() => setNote(c.ai_draft_note!)} icon={<Copy className="h-3.5 w-3.5" />}>Use as start</Button>}</header>
          <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap p-4 font-sans text-[13px] leading-relaxed text-mute scroll-thin">{c.ai_draft_note ?? 'No draft.'}</pre>
        </Card>
        <Card>
          <header className="flex items-center gap-2 border-b border-line px-4 py-3"><NotebookPen className="h-4 w-4 text-brand" /><h2 className="text-sm font-semibold">Your note</h2>
            {saved && note === saved && <span className="ml-auto text-xs text-mute">saved</span>}</header>
          <div className="p-4">
            <Textarea value={note} onChange={e => setNote(e.target.value)} disabled={!mine} className="min-h-[220px]" placeholder={mine ? 'Write the note in your own words, after checking the sources.' : 'Start the review to write a note.'} aria-label="Human note" />
            {mine && <Button size="sm" variant="secondary" className="mt-2" disabled={!note.trim() || note === saved} onClick={() => act('/note', 'PUT', { text: note }, 'Note revision saved')}>Save revision</Button>}
            {(c.note_revisions ?? []).length > 0 && <details className="mt-3 text-xs text-mute"><summary className="cursor-pointer">{c.note_revisions!.length} revision{c.note_revisions!.length > 1 ? 's' : ''}</summary>
              <ul className="mt-1 space-y-1">{c.note_revisions!.slice().reverse().map((r, i) => <li key={i}>{when(r.at)} · {r.by}: {r.text.slice(0, 90)}{r.text.length > 90 && '…'}</li>)}</ul></details>}
          </div>
        </Card>
      </div>

      {c.final_note && <Callout tone="ok" title={`Approved by ${c.reviewer_username} · ${when(c.reviewed_at)}`}><p className="whitespace-pre-wrap text-ink">{c.final_note}</p>
        {c.referral && (c.referral.to || c.referral.urgency) && <p className="mt-1">Referral: {[c.referral.to, c.referral.urgency, c.referral.follow_up_in].filter(Boolean).join(' · ')}</p>}</Callout>}
      {c.consultation_note && <Callout tone="info" title={`Consultation note · ${c.consulted_by} · ${when(c.consulted_at)}`}><p className="whitespace-pre-wrap text-ink">{c.consultation_note}</p></Callout>}
      {c.status === 'rejected' && <Callout tone="danger" title={`Rejected · ${REJECT_LABEL[c.reject_code ?? 'other']}`}>{c.reviewer_note}</Callout>}

      {mine && !decided && <Card className="p-4">
        <h2 className="text-sm font-semibold">Decision</h2>
        {blockers.length > 0 && <div className="mt-3 space-y-2">{blockers.map(b => <Callout key={b} tone="warn">{b}</Callout>)}
          {(c.flags ?? []).some(f => !f.resolved) && <Button size="sm" variant="secondary" onClick={goFlags}>Go to flags</Button>}</div>}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Referral to (optional)"><Input value={ref.to} onChange={e => setRef({ ...ref, to: e.target.value })} placeholder="e.g. General physician" /></Field>
          <Field label="Referral urgency"><Select value={ref.urg} onChange={e => setRef({ ...ref, urg: e.target.value })}><option value="">Not set</option>{['routine', 'soon', 'urgent', 'emergency'].map(u => <option key={u} value={u}>{human(u)}</option>)}</Select></Field>
          <Field label="Follow up in"><Input value={ref.fu} onChange={e => setRef({ ...ref, fu: e.target.value })} placeholder="e.g. 3 days" /></Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={approve} disabled={!note.trim() || blockers.length > 0} icon={<CheckCircle2 className="h-4 w-4" />}>Approve with this note</Button>
          <span className="text-xs text-mute">The server enforces these checks too.</span>
        </div>
      </Card>}

      {(mine || c.status === 'needs_review') && !decided && <Card className="p-4">
        <h2 className="text-sm font-semibold">Reject</h2><p className="text-xs text-mute">For unusable submissions, e.g. unclear audio. Intake sees fixed guidance only.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Select value={rej.code} onChange={e => setRej({ ...rej, code: e.target.value })} className="w-56" aria-label="Rejection reason code">{Object.entries(REJECT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Input value={rej.reason} onChange={e => setRej({ ...rej, reason: e.target.value })} placeholder="Internal reason (required)" className="min-w-[200px] flex-1" aria-label="Rejection reason" />
          <Button variant="danger" disabled={rej.reason.trim().length < 3} onClick={reject} icon={<XCircle className="h-4 w-4" />}>Reject</Button>
        </div>
      </Card>}
      {!mine && !decided && c.status !== 'needs_review' && <Callout tone="info">This case is being reviewed by {c.reviewer_username}.</Callout>}
      {!mine && c.status === 'needs_review' && <Callout tone="info">Start the review (top right) to write a note and decide.</Callout>}
    </>
  )
}

/* ---------------------------------------------------------------- activity + processing */

function Activity({ c }: { c: Case }) {
  const total = useMemo(() => (c.stages ?? []).reduce((a, s) => a + (s.ms || 0), 0), [c.stages])
  const max = Math.max(1, ...(c.stages ?? []).map(s => s.ms || 0))
  return (
    <>
      <Card>
        <header className="flex items-center border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">Processing pipeline</h2><span className="ml-auto text-xs text-mute">{c.processed_at && `ready ${secs(new Date(c.processed_at).getTime() - new Date(c.created_at).getTime())} after submission · `}{secs(total)} compute</span></header>
        <ul className="space-y-1.5 p-4">{(c.stages ?? []).map((s, i) => (
          <li key={i} className="grid grid-cols-[170px_1fr_60px] items-center gap-3 text-[13px]">
            <span className={clsx('truncate', s.status === 'failed' && 'text-imm')}>{STAGE_LABEL[s.name] ?? s.name}</span>
            <span className="h-2 overflow-hidden rounded-full bg-sunken"><span className={clsx('block h-full rounded-full', s.status === 'failed' ? 'bg-imm' : s.status === 'skipped' ? 'bg-line' : 'bg-brand')} style={{ width: `${Math.max(2, (s.ms / max) * 100)}%` }} /></span>
            <span className="text-right font-mono text-xs text-mute">{s.status === 'done' ? secs(s.ms) : s.status}</span>
          </li>))}</ul>
      </Card>
      <Card>
        <header className="border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">Audit trail</h2><p className="text-xs text-mute">Hash-chained. Event details never contain patient text.</p></header>
        <ol className="relative space-y-3 p-4 before:absolute before:bottom-4 before:left-[23px] before:top-4 before:w-px before:bg-line">
          {(c.audit_events ?? []).map(a => <li key={a.seq} className="relative flex gap-3 pl-6 text-[13px]"><span className="absolute left-[4px] top-1.5 h-2 w-2 rounded-full bg-brand ring-4 ring-panel" />
            <div><span className="font-medium">{human(a.action)}</span> <span className="text-mute">by {a.actor} · {when(a.timestamp)}</span></div></li>)}
        </ol>
      </Card>
    </>
  )
}

function Processing({ c }: { c: Case }): ReactNode {
  return (
    <div className="mx-auto w-full max-w-md p-10">
      <Empty icon={<Bot className="h-5 w-5 animate-pulse" />} title="Preparing the evidence-linked brief">This page updates live.</Empty>
      <ul className="space-y-2">{(c.stages ?? []).map((s, i) => <li key={i} className="flex items-center gap-2 text-sm">
        {s.status === 'running' ? <span className="h-2 w-2 animate-pulse rounded-full bg-brand" /> : <Check className="h-4 w-4 text-std" />}{STAGE_LABEL[s.name] ?? s.name}<span className="ml-auto font-mono text-xs text-mute">{s.ms ? secs(s.ms) : ''}</span></li>)}</ul>
    </div>
  )
}
