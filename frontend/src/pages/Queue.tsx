import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Archive, ArchiveRestore, AudioLines, CheckCheck, ClipboardList, FileText, Flag, Inbox, MessagesSquare, RefreshCw, Search, Type, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Card, Empty, Input, Kbd, Skeleton, Tabs, TierBadge, useDialog, useToast } from '../components/ui'
import { api, events, msg } from '../lib/api'
import type { QueueRow, Tier } from '../lib/api'
import { ago, langName, STAGE_LABEL, TIER_META, TIER_RANK, TIERS } from '../lib/format'

type TabId = 'needs_review' | 'in_review' | 'processing' | 'approved' | 'consulted' | 'rejected' | 'archived'
const TABS: { id: TabId; label: string }[] = [
  { id: 'needs_review', label: 'To review' }, { id: 'in_review', label: 'In review' }, { id: 'processing', label: 'Processing' },
  { id: 'approved', label: 'Approved' }, { id: 'consulted', label: 'Consulted' }, { id: 'rejected', label: 'Rejected' }, { id: 'archived', label: 'Archived' },
]
const inTab = (r: QueueRow, k: TabId) => k === 'archived' ? !!r.archived_at
  : k === 'approved' ? r.status === 'approved' && !r.consulted_at && !r.archived_at
  : k === 'consulted' ? r.status === 'approved' && !!r.consulted_at && !r.archived_at
  : !r.archived_at && r.status === k

const SourceIcon = ({ k }: { k: string }) => k === 'audio' ? <AudioLines className="h-3.5 w-3.5" /> : k === 'report' ? <FileText className="h-3.5 w-3.5" /> : <Type className="h-3.5 w-3.5" />

export function useLiveQueue() {
  const qc = useQueryClient()
  useEffect(() => events('/queue/events', { changed: () => { qc.invalidateQueries({ queryKey: ['queue'] }); qc.invalidateQueries({ queryKey: ['metrics'] }) } }), [qc])
}

export default function Queue() {
  const nav = useNavigate(), toast = useToast(), ask = useDialog(), qc = useQueryClient()
  const [tab, setTab] = useState<TabId>('needs_review'), [tier, setTier] = useState<Tier | 'all'>('all'), [q, setQ] = useState(''), [cursor, setCursor] = useState(0)
  const search = useRef<HTMLInputElement>(null)
  const rows = useQuery({ queryKey: ['queue'], queryFn: () => api<QueueRow[]>('/cases'), refetchInterval: 30000 })
  useLiveQueue()

  const all = rows.data ?? []
  const shown = useMemo(() => all.filter(r => inTab(r, tab) && (tier === 'all' || r.effective_tier === tier)
    && (!q || JSON.stringify([r.case_id, r.patient_ref, r.top_flags, r.symptoms, r.languages]).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => ['needs_review', 'in_review'].includes(tab)
      ? (TIER_RANK[a.effective_tier ?? ''] ?? 4) - (TIER_RANK[b.effective_tier ?? ''] ?? 4) || a.created_at.localeCompare(b.created_at)
      : b.created_at.localeCompare(a.created_at)), [all, tab, tier, q])
  const open = all.filter(r => !r.archived_at && ['needs_review', 'in_review'].includes(r.status))
  const unclaimedImm = all.filter(r => r.status === 'needs_review' && r.effective_tier === 'immediate').length

  useEffect(() => setCursor(0), [tab, tier, q])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,dialog')) return
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(shown.length - 1, c + 1)) }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
      if (e.key === 'Enter' && shown[cursor]) nav(`/case/${shown[cursor].case_id}`)
      if (e.key === '/') { e.preventDefault(); search.current?.focus() }
    }
    addEventListener('keydown', h); return () => removeEventListener('keydown', h)
  }, [shown, cursor, nav])

  const act = async (r: QueueRow, action: 'consulted' | 'archive' | 'restore') => {
    let json: unknown
    if (action === 'consulted') {
      const note = await ask({ title: 'Mark as consulted', body: 'Optionally record what happened at the consultation. This is stored separately from the approved note.', confirm: 'Mark consulted', input: { label: 'Consultation note (optional)', placeholder: 'Follow-up findings…' } })
      if (note === null) return
      json = { note }
    }
    if (action === 'archive' && !(await ask({ title: 'Archive this case?', body: 'Archiving is reversible; restore it from the Archived tab.', confirm: 'Archive' }))) return
    try { await api(`/cases/${r.case_id}/${action}`, { method: 'POST', json }); qc.invalidateQueries({ queryKey: ['queue'] }); toast(action === 'consulted' ? 'Marked consulted' : action === 'archive' ? 'Archived' : 'Restored') }
    catch (e) { toast(msg(e), 'err') }
  }

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-8">
      <div className="flex flex-wrap items-end gap-4">
        <div><p className="label">Review queue</p><h1 className="mt-1 font-display text-[32px] font-semibold tracking-tight">Cases to review</h1>
          <p className="text-sm text-mute">Sorted by priority, then by waiting time.</p></div>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-mute"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-std" />Live</span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {TIERS.map(t => {
          const n = open.filter(r => r.effective_tier === t).length
          return (
            <button key={t} onClick={() => { setTab('needs_review'); setTier(tier === t ? 'all' : t) }}
              className={clsx('card relative overflow-hidden p-4 text-left transition hover:shadow-pop', tier === t && 'ring-2 ring-brand/40')}>
              <span className={clsx('absolute inset-y-0 left-0 w-1', TIER_META[t].bar)} />
              <div className="text-[12.5px] font-medium text-mute">{TIER_META[t].short}</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{rows.isLoading ? '–' : n}</div>
              <div className="text-xs text-mute">open</div>
            </button>)
        })}
        <div className={clsx('card col-span-2 p-4 lg:col-span-1', unclaimedImm ? 'border-imm/40 bg-immsoft' : '')}>
          <div className="text-[12.5px] font-medium text-mute">Unclaimed immediate</div>
          <div className={clsx('mt-1 text-3xl font-semibold tabular-nums', unclaimedImm && 'text-imm')}>{rows.isLoading ? '–' : unclaimedImm}</div>
          <div className="text-xs text-mute">{unclaimedImm ? 'not yet picked up' : 'none waiting'}</div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={setTab} items={TABS.map(t => ({ ...t, count: all.filter(r => inTab(r, t.id)).length }))} />
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-mute" />
          <Input ref={search} value={q} onChange={e => setQ(e.target.value)} placeholder="Search symptoms, flags, IDs" className="pl-8" aria-label="Search cases" />
          <span className="absolute right-2 top-2"><Kbd>/</Kbd></span>
        </div>
        <Button variant="secondary" size="md" onClick={() => rows.refetch()} aria-label="Refresh" icon={<RefreshCw className={clsx('h-4 w-4', rows.isFetching && 'animate-spin')} />} />
      </div>
      {tier !== 'all' && <div className="mt-3 text-sm">Showing <TierBadge tier={tier} size="sm" /> only · <button className="text-brand underline-offset-2 hover:underline" onClick={() => setTier('all')}>clear</button></div>}

      <Card className="mt-4 overflow-hidden">
        {rows.isLoading ? <div className="space-y-2 p-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>
          : rows.error ? <Empty icon={<Inbox className="h-5 w-5" />} title="Could not load the queue">{msg(rows.error)}</Empty>
          : !shown.length ? <Empty icon={<ClipboardList className="h-5 w-5" />} title={q || tier !== 'all' ? 'No matching cases' : 'Nothing here'}>
            {tab === 'needs_review' ? 'New cases show up here when intake sends them.' : 'Nothing in this list yet.'}</Empty>
          : <ul className="divide-y divide-line">{shown.map((r, i) => (
            <li key={r.case_id} onMouseEnter={() => setCursor(i)}
              className={clsx('group relative flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition sm:flex-nowrap', i === cursor ? 'bg-sunken/70' : 'hover:bg-sunken/40')}
              onClick={() => nav(`/case/${r.case_id}`)}>
              <span className={clsx('absolute inset-y-0 left-0 w-1', r.effective_tier ? TIER_META[r.effective_tier].bar : 'bg-line')} />
              <div className="w-[150px] shrink-0"><TierBadge tier={r.status === 'processing' ? null : r.effective_tier} size="sm" />
                {r.override && <div className="mt-1 text-[11px] text-mute">System: {TIER_META[r.system_tier!]?.short} · overridden</div>}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] font-medium">{r.case_id}</span>
                  {r.patient_ref && <span className="text-xs text-mute">{r.patient_ref}</span>}
                  <span className="flex items-center gap-1 text-mute">{r.source_kinds.map((k, j) => <SourceIcon key={j} k={k} />)}</span>
                  {r.via_interview && <Badge tone="brand" title="Collected with the live interview copilot"><MessagesSquare className="h-3 w-3" />Interview</Badge>}
                  {r.languages.slice(0, 2).map(l => <Badge key={l} tone="outline">{langName(l)}</Badge>)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px]">
                  {r.status === 'processing' ? <span className="text-mute">{STAGE_LABEL[r.stage ?? ''] ?? 'Queued'}…</span> : <>
                    {r.warning_signs.slice(0, 2).map(f => <span key={f} className="inline-flex items-center gap-1 font-medium text-imm"><Flag className="h-3 w-3" />{f.replace(' mentioned', '')}</span>)}
                    {r.symptoms.length > 0 && <span className="truncate text-mute">{r.warning_signs.length ? '· ' : ''}{r.symptoms.join(', ')}</span>}
                    {!r.warning_signs.length && !r.symptoms.length && <span className="text-mute">No symptoms extracted</span>}</>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs text-mute">
                {r.open_flags > 0 && <Badge tone="urg" title="Unresolved flags (warning signs, context, integrity and quality)">{r.open_flags} to resolve</Badge>}
                {r.reviewer && <span className="flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{r.reviewer}</span>}
                {r.consulted_at && <Badge tone="std"><CheckCheck className="h-3 w-3" />Consulted</Badge>}
                <span className="w-16 text-right tabular-nums">{ago(r.created_at)}</span>
              </div>
              <div className="flex shrink-0 gap-1" onClick={e => e.stopPropagation()}>
                {r.archived_at ? <Button size="sm" variant="secondary" onClick={() => act(r, 'restore')} icon={<ArchiveRestore className="h-3.5 w-3.5" />}>Restore</Button> : <>
                  {r.status === 'approved' && !r.consulted_at && <Button size="sm" variant="secondary" onClick={() => act(r, 'consulted')} icon={<MessagesSquare className="h-3.5 w-3.5" />}>Consulted</Button>}
                  {['approved', 'rejected'].includes(r.status) && <Button size="sm" variant="quiet" aria-label="Archive" onClick={() => act(r, 'archive')} icon={<Archive className="h-3.5 w-3.5" />} />}</>}
              </div>
            </li>))}</ul>}
      </Card>
      <p className="mt-3 text-xs text-mute"><Kbd>j</Kbd>/<Kbd>k</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>/</Kbd> search. </p>
    </div>
  )
}
