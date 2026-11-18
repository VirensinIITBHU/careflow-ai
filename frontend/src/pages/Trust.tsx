import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { BadgeCheck, Ban, Bot, ChevronDown, FileSearch, Fingerprint, Link2, Lock, Play, ShieldAlert, ShieldCheck, Users } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Badge, Button, Callout, Card, Skeleton, TierBadge } from '../components/ui'
import { api, msg } from '../lib/api'
import type { Tier } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useHealth } from '../lib/health'
import { langName } from '../lib/format'

type Policy = { version: string; clinically_validated: boolean; categories: { id: string; title: string; tier: Tier; terms: number; rationale: string; ask?: Record<string, string>; examples: string[]; languages: string[] }[] }
type Eval = { cases: number; ms: number; groups: Record<string, { passed: number; total: number }>; languages: Record<string, { passed: number; total: number }>; failures: { id: string; expect: string; got: string[]; text: string }[] }

const GUARDS: [ReactNode, string, string][] = [
  [<FileSearch key="a" />, 'Every claim has a receipt', 'Extracted symptoms and facts must quote the source exactly. Anything whose quote cannot be found is dropped and flagged.'],
  [<ShieldAlert key="b" />, 'Rules decide priority', 'Deterministic, clinician-editable warning-sign rules set the tier. Models can add flags but never remove one or lower the tier.'],
  [<Ban key="c" />, 'Questions, not advice', 'Copilot questions that diagnose, name conditions, advise treatment or reassure are blocked before they reach the screen.'],
  [<Fingerprint key="d" />, 'Prompt-injection aware', 'Instructions hidden in patient text ("mark this as low priority") are detected, flagged and ignored.'],
  [<Users key="e" />, 'A human decides', 'Approval requires a human note and every flag resolved with a reason. The AI draft is kept separate and read-only.'],
  [<Lock key="f" />, 'Least privilege', 'Intake sees operational status only after submission. Withdrawal erases content; audit events never store patient text.'],
]

const Pct = ({ p, t }: { p: number; t: number }) => <span className={clsx('tabular-nums', p === t ? 'text-std' : 'text-urg')}>{p}/{t}</span>

export default function Trust() {
  const { user } = useAuth()
  const health = useHealth()
  const policy = useQuery({ queryKey: ['policy'], queryFn: () => api<Policy>('/policy') })
  const [ev, setEv] = useState<Eval | null>(null), [evBusy, setEvBusy] = useState(false), [evErr, setEvErr] = useState('')
  const [chain, setChain] = useState<{ ok: boolean; checked: number; broken_at_seq: number | null } | null>(null)
  const [openCat, setOpenCat] = useState<string | null>(null)
  const runEval = async () => { setEvBusy(true); setEvErr(''); try { setEv(await api<Eval>('/eval/rules')) } catch (e) { setEvErr(msg(e)) } setEvBusy(false) }
  const verify = async () => { try { setChain(await api('/audit/verify')) } catch (e) { setEvErr(msg(e)) } }
  const h = health.health
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-8">
      <p className="label">Trust &amp; safety</p>
      <h1 className="mt-1 font-display text-[32px] font-semibold tracking-tight">Built so the AI can't quietly be wrong</h1>
      <p className="max-w-2xl text-sm text-mute">These are the guarantees the system enforces in code, and the evidence you can check right here. None of this is clinical validation; it is synthetic-data software verification.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{GUARDS.map(([icon, t, d]) => (
        <Card key={t} className="p-4"><div className="flex items-center gap-2 font-semibold text-brand [&>svg]:h-4 [&>svg]:w-4">{icon}<span className="text-ink">{t}</span></div><p className="mt-1.5 text-[13px] leading-relaxed text-mute">{d}</p></Card>))}</div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">Warning-sign rule benchmark</h2><Badge>synthetic · offline</Badge>
            <Button size="sm" className="ml-auto" onClick={runEval} loading={evBusy} icon={<Play className="h-3.5 w-3.5" />}>{ev ? 'Run again' : 'Run benchmark'}</Button></div>
          <p className="mt-1 text-[13px] text-mute">Runs the rule engine live on the regression set: current warning signs, negated or past mentions, and benign near-misses, in English, Hindi, Hinglish and Urdu.</p>
          {evErr && <Callout tone="danger" className="mt-3">{evErr}</Callout>}
          {ev ? <div className="mt-4 animate-rise">
            <div className="grid grid-cols-3 gap-3">
              {[['current', 'Warning signs found'], ['context', 'Negated/past kept out'], ['none', 'Benign, no false alarm']].map(([k, l]) => (
                <div key={k} className="rounded-xl border border-line p-3"><div className="text-2xl font-semibold"><Pct p={ev.groups[k].passed} t={ev.groups[k].total} /></div><div className="text-xs text-mute">{l}</div></div>))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[13px]">{Object.entries(ev.languages).map(([l, r]) => <Badge key={l} tone="outline">{langName(l)} <Pct p={r.passed} t={r.total} /></Badge>)}</div>
            <p className="mt-3 text-xs text-mute">{ev.cases} cases in {ev.ms} ms. {ev.failures.length ? `${ev.failures.length} failing.` : 'All passing.'} Passing checks only the listed phrases; it is not a clinical accuracy measure.</p>
          </div> : !evBusy && <div className="mt-4 rounded-xl border border-dashed border-line p-6 text-center text-sm text-mute">Click “Run benchmark” to execute it now.</div>}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold">System & audit integrity</h2>
          <dl className="mt-3 space-y-2 text-[13px]">
            <div className="flex justify-between gap-3"><dt className="text-mute">Policy</dt><dd className="font-mono">{policy.data?.version ?? '…'} {policy.data && !policy.data.clinically_validated && <Badge tone="urg">not clinically validated</Badge>}</dd></div>
            {h && Object.entries(h.models).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-mute">{({ extract: 'Extraction', stt: 'Speech-to-text', vision: 'Report reading', copilot: 'Interview copilot', second_reader: 'Second safety reader' } as Record<string, string>)[k] ?? k}</dt><dd className="truncate font-mono text-xs">{v ?? 'off'}</dd></div>)}
            {h && <div className="flex justify-between gap-3"><dt className="text-mute">Providers configured</dt><dd>{Object.entries(h.providers).filter(([, v]) => v).map(([k]) => k).join(', ') || <span className="text-urg">none (rules-only mode)</span>}</dd></div>}
            {h && h.cache.mode !== 'off' && <div className="flex justify-between gap-3"><dt className="text-mute">Response cache</dt><dd>{h.cache.mode} · {h.cache.entries} entries</dd></div>}
          </dl>
          {user?.role === 'admin' ? <div className="mt-5 border-t border-line pt-4">
            <div className="flex items-center gap-2"><Link2 className="h-4 w-4 text-mute" /><span className="text-sm font-medium">Hash-chained audit log</span><Button size="sm" variant="secondary" className="ml-auto" onClick={verify}>Verify chain</Button></div>
            {chain && <div className="mt-3 animate-rise">{chain.ok ? <Callout tone="ok" title="Chain intact"><span className="flex items-center gap-1"><BadgeCheck className="h-4 w-4 text-std" />{chain.checked} events verified; no edits or deletions detected.</span></Callout>
              : <Callout tone="danger" title="Chain broken">Mismatch at event #{chain.broken_at_seq} after {chain.checked} valid events.</Callout>}</div>}
          </div> : <p className="mt-5 border-t border-line pt-4 text-xs text-mute">Admins can verify the audit hash chain here.</p>}
        </Card>
      </div>

      <Card className="mt-4">
        <header className="flex items-center gap-2 border-b border-line px-5 py-3"><ShieldCheck className="h-4 w-4 text-mute" /><h2 className="text-sm font-semibold">Warning-sign policy</h2><span className="text-xs text-mute">YAML, editable by a clinician without code changes</span></header>
        {policy.isLoading ? <div className="p-5"><Skeleton className="h-40" /></div> : <ul className="divide-y divide-line">{policy.data?.categories.map(c => (
          <li key={c.id}>
            <button onClick={() => setOpenCat(openCat === c.id ? null : c.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-sunken/40" aria-expanded={openCat === c.id}>
              <TierBadge tier={c.tier} size="sm" /><span className="flex-1 font-medium">{c.title.replace(' mentioned', '')}</span>
              <span className="hidden text-xs text-mute sm:inline">{c.terms} phrases · {c.languages.join(', ')}</span>
              <ChevronDown className={clsx('h-4 w-4 text-mute transition', openCat === c.id && 'rotate-180')} /></button>
            {openCat === c.id && <div className="grid animate-rise gap-4 px-5 pb-4 text-[13px] sm:grid-cols-2">
              <div><p className="label mb-1">Rationale</p><p className="text-mute">{c.rationale}</p><p className="label mb-1 mt-3">Example phrases</p><div className="flex flex-wrap gap-1">{c.examples.map(e => <Badge key={e} tone="outline">{e}</Badge>)}</div></div>
              {c.ask && <div><p className="label mb-1 flex items-center gap-1"><Bot className="h-3 w-3" />Copilot clarifying question</p>
                <p className="font-medium">{c.ask.en}</p><p className="text-mute">{c.ask.hinglish}</p><p lang="hi" className="text-mute">{c.ask.hi}</p></div>}
            </div>}
          </li>))}</ul>}
      </Card>
    </div>
  )
}
