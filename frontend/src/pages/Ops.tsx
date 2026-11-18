import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Activity, Bot, Clock, Gauge, Languages, MessagesSquare, Timer, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, Empty, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { langName, secs, STAGE_LABEL, TIER_META, TIERS } from '../lib/format'
import { useLiveQueue } from './Queue'

type Metrics = {
  totals: Record<string, number>; open_by_tier: Record<string, number>; oldest_open_minutes: number
  minutes_to_decision: { median: number | null; count: number }; seconds_to_ready: { median: number | null; count: number }
  stage_ms: Record<string, { median: number; count: number }>; cases_per_day: { day: string; count: number }[]
  top_warning_signs: { title: string; count: number }[]; languages: { language: string; count: number }[]
  interview: { cases: number; share: number; sessions: Record<string, number>; avg_answered: number; by_origin: Record<string, Record<string, number>> }
}

const Kpi = ({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; tone?: string }) => (
  <Card className="p-4">
    <div className="flex items-center gap-2 text-[12.5px] font-medium text-mute"><span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>{label}</div>
    <div className={clsx('mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums', tone)}>{value}</div>
    {sub && <div className="mt-1.5 text-xs text-mute">{sub}</div>}
  </Card>
)

function Bars({ rows, max, tone = 'bg-brand', fmt = (n: number) => String(n) }: { rows: { label: ReactNode; value: number; tone?: string }[]; max?: number; tone?: string; fmt?: (n: number) => string }) {
  const m = max ?? Math.max(1, ...rows.map(r => r.value))
  return <ul className="space-y-2">{rows.map((r, i) => (
    <li key={i} className="grid grid-cols-[minmax(0,150px)_1fr_56px] items-center gap-3 text-[13px]">
      <span className="truncate text-mute">{r.label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-sunken"><span className={clsx('block h-full rounded-full transition-[width] duration-500', r.tone ?? tone)} style={{ width: `${Math.max(r.value ? 3 : 0, (r.value / m) * 100)}%` }} /></span>
      <span className="text-right font-medium tabular-nums">{fmt(r.value)}</span>
    </li>))}</ul>
}

export default function Ops() {
  const q = useQuery({ queryKey: ['metrics'], queryFn: () => api<Metrics>('/metrics'), refetchInterval: 30000 })
  useLiveQueue()
  const m = q.data
  const openTotal = m ? Object.values(m.open_by_tier).reduce((a, b) => a + b, 0) : 0
  const maxDay = m ? Math.max(1, ...m.cases_per_day.map(d => d.count)) : 1
  const origins = m?.interview.by_origin ?? {}
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-8">
      <p className="label">Operations</p>
      <h1 className="mt-1 font-display text-[32px] font-semibold tracking-tight">Operations</h1>
      <p className="text-sm text-mute">Demo data.</p>
      {q.isLoading ? <div className="mt-6 grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-28" />)}</div> : !m ? <Empty title="No metrics yet" /> : <>
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi icon={<Activity />} label="Open cases" value={openTotal} sub={<>{m.open_by_tier.immediate} immediate · {m.open_by_tier.urgent} urgent</>} tone={m.open_by_tier.immediate ? 'text-imm' : undefined} />
          <Kpi icon={<Zap />} label="Time to process" value={m.seconds_to_ready.median != null ? secs(m.seconds_to_ready.median * 1000) : '–'} sub={`median of ${m.seconds_to_ready.count} cases`} />
          <Kpi icon={<Timer />} label="Time to decision" value={m.minutes_to_decision.median != null ? `${Math.round(m.minutes_to_decision.median)} min` : '–'} sub={`median of ${m.minutes_to_decision.count} decided`} />
          <Kpi icon={<Clock />} label="Oldest open case" value={`${Math.round(m.oldest_open_minutes)} min`} sub="waiting for review" tone={m.oldest_open_minutes > 60 ? 'text-urg' : undefined} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold">Open queue by automated priority</h2>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-sunken">{TIERS.map(t => m.open_by_tier[t] ? <span key={t} className={TIER_META[t].bar} style={{ width: `${(m.open_by_tier[t] / Math.max(1, openTotal)) * 100}%` }} title={`${TIER_META[t].short}: ${m.open_by_tier[t]}`} /> : null)}</div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">{TIERS.map(t => <span key={t} className="flex items-center gap-1.5"><span className={clsx('h-2 w-2 rounded-full', TIER_META[t].dot)} />{TIER_META[t].short}<b className="tabular-nums">{m.open_by_tier[t]}</b></span>)}</div>
            <h2 className="mt-7 text-sm font-semibold">Cases submitted, last 7 days</h2>
            <div className="mt-3 flex h-36 items-end gap-2">{m.cases_per_day.map(d => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="text-xs font-medium tabular-nums">{d.count || ''}</span>
                <div className="w-full rounded-t-md bg-brand/80 transition-[height] duration-500" style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count ? 4 : 1 }} />
                <span className="text-[11px] text-mute">{new Date(d.day + 'T00:00').toLocaleDateString(undefined, { weekday: 'short' })}</span>
              </div>))}</div>
          </Card>
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><MessagesSquare className="h-4 w-4 text-brand" />Interviews</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div><div className="text-2xl font-semibold tabular-nums">{m.interview.share}%</div><div className="text-xs text-mute">of cases came from an interview</div></div>
              <div><div className="text-2xl font-semibold tabular-nums">{m.interview.avg_answered}</div><div className="text-xs text-mute">questions answered per case</div></div>
            </div>
            <p className="label mb-2 mt-5">Answered questions, by type</p>
            <Bars rows={[['policy', 'Warning sign', 'bg-imm'], ['rules', 'Missing info', 'bg-brand'], ['model', 'Suggested', 'bg-und']].map(([k, l, t]) => ({ label: l, value: origins[k]?.answered ?? 0, tone: t }))} />
          </Card>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="p-5"><h2 className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4 text-mute" />Processing time per step (median)</h2>
            <div className="mt-4">{Object.keys(m.stage_ms).length ? <Bars rows={Object.entries(m.stage_ms).map(([k, v]) => ({ label: STAGE_LABEL[k] ?? k, value: v.median }))} fmt={n => secs(n)} /> : <p className="text-sm text-mute">No timings yet.</p>}</div></Card>
          <Card className="p-5"><h2 className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-mute" />Common warning signs</h2>
            <div className="mt-4">{m.top_warning_signs.length ? <Bars tone="bg-imm" rows={m.top_warning_signs.map(w => ({ label: w.title.replace(' mentioned', ''), value: w.count }))} /> : <p className="text-sm text-mute">None.</p>}</div></Card>
          <Card className="p-5"><h2 className="flex items-center gap-2 text-sm font-semibold"><Languages className="h-4 w-4 text-mute" />Languages</h2>
            <div className="mt-4"><Bars tone="bg-und" rows={m.languages.map(l => ({ label: langName(l.language), value: l.count }))} /></div></Card>
        </div>
      </>}
    </div>
  )
}
