import clsx from 'clsx'
import { AudioLines, Eye, FileText, Languages, Pause, Play, Type } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { Badge, Button, Callout, Spinner } from '../../components/ui'
import { fetchBlob, msg } from '../../lib/api'
import type { Case, Source, Span } from '../../lib/api'
import { clock, langName } from '../../lib/format'

export type Focus = { span: Span; seek?: boolean; n: number } | null

const MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac', mpeg: 'audio/mpeg', mpga: 'audio/mpeg' }
const css = (v: string) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(v).trim().split(' ').join(',')})`

export const sourceIcon = (s: Source) => s.kind === 'audio' ? <AudioLines className="h-3.5 w-3.5" /> : s.kind === 'report' ? <FileText className="h-3.5 w-3.5" /> : <Type className="h-3.5 w-3.5" />
export const sourceTitle = (s: Source, i: number) => s.label ?? (s.kind === 'text' ? 'Typed statement' : s.kind === 'audio' ? `Voice ${s.filename ? '· ' + s.filename : i + 1}` : `Report ${s.filename ? '· ' + s.filename : ''}`)

function useBlobUrl(caseId: string, s: Source, enabled: boolean) {
  const [url, setUrl] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!enabled || url || !s.stored_name) return
    let gone = false, made = ''
    setBusy(true)
    const ext = (s.stored_name ?? '').split('.').pop()!.toLowerCase()
    fetchBlob(`/cases/${caseId}/sources/${s.source_id}/file`)
      .then(b => { if (!gone) { made = URL.createObjectURL(MIME[ext] ? new Blob([b], { type: MIME[ext] }) : b); setUrl(made) } })
      .catch(e => !gone && setErr(msg(e))).finally(() => !gone && setBusy(false))
    return () => { gone = true; if (made) URL.revokeObjectURL(made) }
  }, [caseId, s.source_id, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return { url, err, busy }
}

/** Text with evidence highlights and interview questions shown inline at the offsets they answer. */
function Marked({ s, spans, flagged, focus, onPick, timeMs }: { s: Source; spans: Span[]; flagged: Set<string>; focus: Focus; onPick: (sp: Span) => void; timeMs?: number }) {
  const text = s.text ?? ''
  const nodes = useMemo(() => {
    const ok = spans.filter(x => x.source_id === s.source_id && text.slice(x.start, x.end) === x.quote).sort((a, b) => a.start - b.start || b.end - a.end)
    const marks: Span[] = []
    for (const sp of ok) if (!marks.length || sp.start >= marks[marks.length - 1].end) marks.push(sp)
    const inserts = (s.prompts ?? []).map(p => ({ at: p.c0, q: p.question })).sort((a, b) => a.at - b.at)
    const points = new Set<number>([0, text.length, ...marks.flatMap(m => [m.start, m.end]), ...inserts.map(i => i.at)])
    const cuts = [...points].filter(p => p >= 0 && p <= text.length).sort((a, b) => a - b)
    const out: ReactNode[] = []
    for (let i = 0; i < cuts.length; i++) {
      const at = cuts[i]
      for (const ins of inserts.filter(x => x.at === at)) out.push(
        <span key={`q${at}-${ins.q}`} contentEditable={false} className={clsx('mb-1 flex items-center gap-1.5 text-[12px] font-medium text-brand', at > 0 && 'mt-3')}>
          <span className="rounded bg-brandsoft px-1.5 py-0.5">Q</span>{ins.q}</span>)
      if (i === cuts.length - 1) break
      const end = cuts[i + 1], chunk = text.slice(at, end)
      const m = marks.find(x => x.start <= at && x.end >= end)
      if (m) {
        const key = `${m.start}:${m.end}`
        const active = focus && focus.span.source_id === s.source_id && focus.span.start === m.start && focus.span.end === m.end
        out.push(<mark key={`m${at}`} data-span={key} tabIndex={0} role="button" onClick={() => onPick(m)} onKeyDown={e => e.key === 'Enter' && onPick(m)}
          className={clsx('ev', active && 'active', flagged.has(key) && 'flag')}>{chunk}</mark>)
      } else out.push(<span key={`t${at}`}>{chunk}</span>)
    }
    return out
  }, [text, spans, s, focus, flagged, onPick])
  void timeMs
  return <div className="whitespace-pre-wrap break-words text-[15px] leading-[1.75]">{nodes}</div>
}

function AudioPlayer({ url, focus, sourceId, onTime }: { url: string; focus: Focus; sourceId: string; onTime: (ms: number) => void }) {
  const el = useRef<HTMLDivElement>(null), ws = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying] = useState(false), [t, setT] = useState(0), [dur, setDur] = useState(0), [ready, setReady] = useState(false)
  useEffect(() => {
    if (!el.current) return
    const w = WaveSurfer.create({ container: el.current, url, height: 56, barWidth: 2, barGap: 2, barRadius: 2, cursorWidth: 2,
      waveColor: css('--line'), progressColor: css('--brand'), cursorColor: css('--ink'), normalize: true })
    ws.current = w
    w.on('ready', () => { setReady(true); setDur(w.getDuration() * 1000) })
    w.on('timeupdate', s => { setT(s * 1000); onTime(s * 1000) })
    w.on('play', () => setPlaying(true)); w.on('pause', () => setPlaying(false)); w.on('finish', () => setPlaying(false))
    return () => { w.destroy(); ws.current = null }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const w = ws.current
    if (!w || !focus?.seek || focus.span.source_id !== sourceId || focus.span.t_start_ms == null) return
    const go = () => { w.setTime(focus.span.t_start_ms! / 1000); w.play() }
    if (ready) go(); else w.once('ready', go)
  }, [focus, ready, sourceId])
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-sunken/50 p-2.5">
      <button aria-label={playing ? 'Pause' : 'Play'} onClick={() => ws.current?.playPause()} disabled={!ready}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-bg disabled:opacity-40">{playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}</button>
      <div ref={el} className="min-w-0 flex-1">{!ready && <div className="skeleton h-14" />}</div>
      <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-mute">{clock(t)} / {clock(dur)}</span>
    </div>
  )
}

function SourceBody({ caseId, s, spans, flagged, focus, onPick }: { caseId: string; s: Source; spans: Span[]; flagged: Set<string>; focus: Focus; onPick: (sp: Span, seek?: boolean) => void }) {
  const [showOriginal, setShowOriginal] = useState(s.kind === 'audio'), [showEn, setShowEn] = useState(false), [page, setPage] = useState(1)
  const [nowMs, setNowMs] = useState(0)
  const file = useBlobUrl(caseId, s, showOriginal && !!s.stored_name)
  const ext = (s.stored_name ?? '').split('.').pop()?.toLowerCase()
  useEffect(() => { if (focus?.span.source_id === s.source_id && focus.span.page) { setShowOriginal(true); setPage(focus.span.page) } }, [focus, s.source_id])
  const seg = s.segments?.find(g => nowMs / 1000 >= g.start && nowMs / 1000 < g.end)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="outline"><Languages className="h-3 w-3" />{langName(s.language)}{s.language_status && s.language_status !== 'tested' ? ` · ${s.language_status}` : ''}</Badge>
        {s.confidence != null && <Badge tone={s.confidence < 0.6 ? 'urg' : 'outline'}>ASR confidence {Math.round(s.confidence * 100)}%</Badge>}
        {s.pretranscribed && <Badge tone="brand">Transcribed live during interview</Badge>}
        <div className="ml-auto flex gap-1">
          {s.text_en && <Button size="sm" variant={showEn ? 'primary' : 'secondary'} onClick={() => setShowEn(!showEn)} icon={<Languages className="h-3.5 w-3.5" />}>English copy</Button>}
          {s.stored_name && s.kind === 'report' && <Button size="sm" variant="secondary" onClick={() => setShowOriginal(!showOriginal)} icon={<Eye className="h-3.5 w-3.5" />}>{showOriginal ? 'Hide' : 'View'} original</Button>}
        </div>
      </div>
      {s.warnings.map(w => <Callout key={w} tone="warn">{w}</Callout>)}
      {showOriginal && s.stored_name && (file.busy ? <div className="flex items-center gap-2 text-sm text-mute"><Spinner />Loading original…</div>
        : file.err ? <Callout tone="danger">{file.err}</Callout>
        : file.url && (s.kind === 'audio' ? <AudioPlayer url={file.url} focus={focus} sourceId={s.source_id} onTime={setNowMs} />
          : ext === 'pdf' ? <div><div className="mb-2 flex items-center gap-2 text-xs text-mute">Page <input type="number" min={1} value={page} onChange={e => setPage(Math.max(1, Number(e.target.value) || 1))} className="input h-7 w-16" /></div>
            <iframe key={page} title="Original PDF" src={`${file.url}#page=${page}`} className="h-[480px] w-full rounded-lg border border-line bg-white" /></div>
          : <img src={file.url} alt={`Original report ${s.filename ?? ''}`} className="max-h-[520px] w-full rounded-lg border border-line bg-white object-contain" />))}
      {s.text ? (
        <div className={clsx('rounded-xl border border-line bg-panel p-4', seg && 'ring-1 ring-brand/20')}>
          {s.kind === 'audio' && s.segments?.length ? (
            <div className="space-y-1">
              {s.prompts?.length ? <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-brand"><span className="rounded bg-brandsoft px-1.5 py-0.5">Q</span>{s.prompts[0].question}</div> : null}
              {s.segments.map((g, i) => {
                const sub: Source = { ...s, prompts: null, text: s.text!.slice(g.c0, g.c1) }
                const local = spans.filter(x => x.source_id === s.source_id && x.start >= g.c0 && x.end <= g.c1).map(x => ({ ...x, start: x.start - g.c0, end: x.end - g.c0 }))
                const shift = (sp: Span) => onPick({ ...sp, start: sp.start + g.c0, end: sp.end + g.c0 }, true)
                const shiftedFocus = focus && focus.span.source_id === s.source_id ? { ...focus, span: { ...focus.span, start: focus.span.start - g.c0, end: focus.span.end - g.c0 } } : null
                const flaggedLocal = new Set([...flagged].map(k => k.split(':').map(Number)).filter(([a, b]) => a >= g.c0 && b <= g.c1).map(([a, b]) => `${a - g.c0}:${b - g.c0}`))
                return (
                  <div key={i} className={clsx('flex gap-3 rounded-lg px-2 py-1 transition', seg === g && 'bg-brandsoft/70', g.conf < 0.55 && 'border-l-2 border-urg')}>
                    <button onClick={() => onPick({ source_id: s.source_id, start: g.c0, end: g.c1, quote: s.text!.slice(g.c0, g.c1), t_start_ms: g.start * 1000 }, true)}
                      className="mt-1 w-11 shrink-0 text-left font-mono text-[11.5px] text-mute hover:text-brand" title="Play from here">{clock(g.start * 1000)}</button>
                    <div className="min-w-0 flex-1"><Marked s={sub} spans={local} flagged={flaggedLocal} focus={shiftedFocus} onPick={shift} /></div>
                  </div>)
              })}
            </div>
          ) : <Marked s={s} spans={spans} flagged={flagged} focus={focus} onPick={sp => onPick(sp, true)} />}
        </div>
      ) : <Callout tone="warn" title="No readable text for this source">Open the original and read it directly.</Callout>}
      {showEn && s.text_en && <div className="rounded-xl border border-dashed border-und/40 bg-undsoft/40 p-4">
        <p className="label mb-1.5 text-und">Machine translation · reading aid only, not authoritative</p><p className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{s.text_en}</p></div>}
    </div>
  )
}

export default function SourcePane({ c, focus, onPick }: { c: Case; focus: Focus; onPick: (sp: Span, seek?: boolean) => void }) {
  const sources = c.sources ?? []
  const [active, setActive] = useState(sources[0]?.source_id)
  const pane = useRef<HTMLDivElement>(null)
  useEffect(() => { if (focus && sources.some(s => s.source_id === focus.span.source_id)) setActive(focus.span.source_id) }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focus) return
    const t = setTimeout(() => pane.current?.querySelector('mark.ev.active')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60)
    return () => clearTimeout(t)
  }, [focus, active])
  const spans = useMemo(() => [...(c.symptoms ?? []), ...(c.facts ?? []), ...(c.flags ?? [])].flatMap(x => x.evidence ?? []), [c])
  const flagged = useMemo(() => new Set((c.flags ?? []).filter(f => f.kind === 'safety').flatMap(f => f.evidence.map(e => `${e.start}:${e.end}`))), [c])
  const s = sources.find(x => x.source_id === active) ?? sources[0]
  return (
    <div ref={pane} className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 pt-3">
        <h2 className="pb-3 text-sm font-semibold">Original sources</h2>
        <span className="pb-3 text-xs text-mute">primary evidence</span>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 scroll-thin">
        {sources.map((x, i) => <button key={x.source_id} onClick={() => setActive(x.source_id)}
          className={clsx('inline-flex max-w-[240px] items-center gap-1.5 truncate rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition',
            x.source_id === s?.source_id ? 'bg-ink text-bg' : 'text-mute hover:bg-sunken hover:text-ink')}>{sourceIcon(x)}<span className="truncate">{sourceTitle(x, i)}</span></button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 scroll-thin">
        {s ? <SourceBody key={s.source_id} caseId={c.case_id} s={s} spans={spans} flagged={flagged} focus={focus} onPick={onPick} /> : <p className="text-sm text-mute">No sources.</p>}
      </div>
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-mute"><mark className="ev">Highlighted</mark> text supports an extracted item; <mark className="ev flag">underlined</mark> text triggered a warning-sign rule. Click to focus.</p>
    </div>
  )
}
