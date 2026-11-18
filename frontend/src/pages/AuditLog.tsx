import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, Search, ShieldX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, Input, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { human, when } from '../lib/format'

type Row = { seq: number; ts: string; actor: string; role: string; action: string; case_id: string | null; details: Record<string, unknown> }

export default function AuditLog() {
  const rows = useQuery({ queryKey: ['audit'], queryFn: () => api<Row[]>('/audit?limit=500') })
  const [chain, setChain] = useState<{ ok: boolean; checked: number; broken_at_seq: number | null } | null>(null)
  const [q, setQ] = useState('')
  const shown = useMemo(() => (rows.data ?? []).filter(r => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())), [rows.data, q])
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-8">
      <p className="label">Admin</p>
      <div className="flex flex-wrap items-end gap-3"><h1 className="mt-1 font-display text-[32px] font-semibold tracking-tight">Audit log</h1>
        <div className="ml-auto flex items-center gap-2">
          {chain && (chain.ok ? <Badge tone="std"><BadgeCheck className="h-3 w-3" />{chain.checked} events verified</Badge> : <Badge tone="imm"><ShieldX className="h-3 w-3" />Broken at #{chain.broken_at_seq}</Badge>)}
          <Button variant="secondary" onClick={async () => setChain(await api('/audit/verify'))}>Verify hash chain</Button></div></div>
      <p className="text-sm text-mute">Append-only. Each event's hash covers the previous one, so editing or deleting history is detectable. No patient text is stored here.</p>
      <div className="relative mt-5 w-full sm:w-80"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-mute" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by actor, action, case" className="pl-8" aria-label="Filter audit events" /></div>
      <Card className="mt-4 overflow-x-auto">
        {rows.isLoading ? <div className="p-4"><Skeleton className="h-64" /></div> : (
          <table className="w-full min-w-[760px] text-[13px]">
            <thead><tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wider text-mute">{['#', 'Time', 'Actor', 'Action', 'Case', 'Details'].map(h => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{shown.map(r => (
              <tr key={r.seq} className="align-top hover:bg-sunken/40">
                <td className="px-4 py-2 font-mono text-xs text-mute">{r.seq}</td><td className="whitespace-nowrap px-4 py-2 text-mute">{when(r.ts)}</td>
                <td className="px-4 py-2">{r.actor} <span className="text-xs text-mute">{r.role}</span></td><td className="px-4 py-2 font-medium">{human(r.action)}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.case_id ? <Link className="text-brand hover:underline" to={`/case/${r.case_id}`}>{r.case_id}</Link> : '–'}</td>
                <td className="max-w-[340px] px-4 py-2 font-mono text-[11.5px] text-mute">{Object.keys(r.details).length ? JSON.stringify(r.details) : ''}</td>
              </tr>))}</tbody>
          </table>)}
      </Card>
    </div>
  )
}
