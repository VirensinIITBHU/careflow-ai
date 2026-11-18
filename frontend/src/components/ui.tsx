import clsx from 'clsx'
import { AlertTriangle, Info, Loader2, X } from 'lucide-react'
import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode, TextareaHTMLAttributes, InputHTMLAttributes } from 'react'
import type { Tier } from '../lib/api'
import { TIER_META } from '../lib/format'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) => (
    <button ref={ref} disabled={disabled || loading} className={clsx(
      'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
      size === 'sm' && 'h-8 px-3 text-[13px]', size === 'md' && 'h-9 px-3.5 text-sm', size === 'lg' && 'h-11 px-5 text-[15px]',
      variant === 'primary' && 'bg-ink text-bg hover:bg-ink/90 shadow-sm',
      variant === 'secondary' && 'bg-panel text-ink border border-line hover:bg-sunken',
      variant === 'ghost' && 'text-ink hover:bg-sunken',
      variant === 'quiet' && 'text-mute hover:text-ink hover:bg-sunken',
      variant === 'danger' && 'bg-imm text-white hover:bg-imm/90',
      className)} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}{children}
    </button>
  ))

export const Card = ({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) =>
  <div className={clsx('card', className)} {...rest}>{children}</div>

export const Section = ({ title, action, children, className, icon }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; icon?: ReactNode }) => (
  <section className={clsx('card', className)}>
    <header className="flex items-center gap-2 border-b border-line px-4 py-3">
      {icon && <span className="text-mute">{icon}</span>}
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="ml-auto flex items-center gap-2">{action}</div>
    </header>
    <div className="p-4">{children}</div>
  </section>
)

export const Badge = ({ children, className, tone = 'neutral', title }: { children: ReactNode; className?: string; tone?: 'neutral' | 'brand' | 'imm' | 'urg' | 'und' | 'std' | 'outline'; title?: string }) => (
  <span title={title} className={clsx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium leading-4 whitespace-nowrap',
    tone === 'neutral' && 'border-line bg-sunken text-mute', tone === 'brand' && 'border-brand/25 bg-brandsoft text-brand',
    tone === 'imm' && 'border-imm/30 bg-immsoft text-imm', tone === 'urg' && 'border-urg/30 bg-urgsoft text-urg',
    tone === 'und' && 'border-und/30 bg-undsoft text-und', tone === 'std' && 'border-std/30 bg-stdsoft text-std',
    tone === 'outline' && 'border-line text-mute', className)}>{children}</span>
)

export function TierBadge({ tier, size = 'md', prefix }: { tier?: Tier | null; size?: 'sm' | 'md' | 'lg'; prefix?: string }) {
  if (!tier) return <Badge><Loader2 className="h-3 w-3 animate-spin" />Processing</Badge>
  const m = TIER_META[tier]
  return (
    <span title={m.help} className={clsx('inline-flex items-center gap-1.5 rounded-md border font-semibold whitespace-nowrap', m.cls,
      size === 'sm' && 'px-1.5 py-0.5 text-[11px]', size === 'md' && 'px-2 py-0.5 text-xs', size === 'lg' && 'px-2.5 py-1 text-sm')}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', m.dot, tier === 'immediate' && 'animate-pulsering')} />
      {prefix && <span className="font-medium opacity-75">{prefix}</span>}{size === 'sm' ? m.short : m.label}
    </span>
  )
}

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={clsx('h-4 w-4 animate-spin text-mute', className)} />
export const Skeleton = ({ className }: { className?: string }) => <div className={clsx('skeleton', className)} />

export const Empty = ({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) => (
  <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
    {icon && <div className="mb-1 rounded-full bg-sunken p-3 text-mute">{icon}</div>}
    <p className="font-medium">{title}</p>{children && <div className="max-w-sm text-sm text-mute">{children}</div>}
  </div>
)

export const Callout = ({ tone = 'info', title, children, className }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; title?: ReactNode; children?: ReactNode; className?: string }) => (
  <div role={tone === 'danger' ? 'alert' : undefined} className={clsx('flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
    tone === 'info' && 'border-und/25 bg-undsoft/60', tone === 'warn' && 'border-urg/30 bg-urgsoft/70',
    tone === 'danger' && 'border-imm/30 bg-immsoft/70', tone === 'ok' && 'border-std/30 bg-stdsoft/70', className)}>
    {tone === 'info' || tone === 'ok' ? <Info className="mt-0.5 h-4 w-4 shrink-0 opacity-70" /> : <AlertTriangle className={clsx('mt-0.5 h-4 w-4 shrink-0', tone === 'danger' ? 'text-imm' : 'text-urg')} />}
    <div className="min-w-0">{title && <div className="font-medium">{title}</div>}{children && <div className={clsx(title && 'mt-0.5 text-mute')}>{children}</div>}</div>
  </div>
)

export const Kbd = ({ children }: { children: ReactNode }) =>
  <kbd className="rounded border border-line bg-sunken px-1 font-mono text-[10.5px] text-mute">{children}</kbd>

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...rest }, ref) =>
  <textarea ref={ref} className={clsx('input min-h-[84px] resize-y leading-relaxed', className)} {...rest} />)
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...rest }, ref) =>
  <input ref={ref} className={clsx('input h-9', className)} {...rest} />)
export const Select = ({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) =>
  <select className={clsx('input h-9 pr-8', className)} {...rest}>{children}</select>

export const Field = ({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) => (
  <div className="space-y-1.5"><label htmlFor={htmlFor} className="block text-[13px] font-medium">{label}</label>{children}{hint && <p className="text-xs text-mute">{hint}</p>}</div>
)

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; count?: number; tone?: string }[]; className?: string }) {
  return (
    <div role="tablist" className={clsx('flex gap-1 overflow-x-auto scroll-thin', className)}>
      {items.map(it => (
        <button key={it.id} role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}
          className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
            value === it.id ? 'bg-ink text-bg' : 'text-mute hover:bg-sunken hover:text-ink')}>
          {it.label}{it.count != null && <span className={clsx('rounded px-1 text-[11px] tabular-nums', value === it.id ? 'bg-bg/20' : 'bg-sunken')}>{it.count}</span>}
        </button>))}
    </div>
  )
}

/** Promise-based confirm/prompt dialog to replace window.confirm. */
type DialogReq = { title: string; body?: ReactNode; confirm: string; tone?: 'danger' | 'primary'; input?: { label: string; placeholder?: string; min?: number }; resolve: (v: string | null) => void }
const DialogCtx = createContext<(r: Omit<DialogReq, 'resolve'>) => Promise<string | null>>(async () => null)
export const useDialog = () => useContext(DialogCtx)

export function DialogProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<DialogReq | null>(null)
  const [val, setVal] = useState('')
  const ref = useRef<HTMLDialogElement>(null)
  const ask = useCallback((r: Omit<DialogReq, 'resolve'>) => new Promise<string | null>(resolve => { setVal(''); setReq({ ...r, resolve }) }), [])
  useEffect(() => { if (req) ref.current?.showModal(); else ref.current?.close() }, [req])
  const done = (v: string | null) => { req?.resolve(v); setReq(null) }
  const min = req?.input?.min ?? 0
  return (
    <DialogCtx.Provider value={ask}>
      {children}
      <dialog ref={ref} onCancel={e => { e.preventDefault(); done(null) }}
        className="w-[min(92vw,440px)] rounded-2xl border border-line bg-panel p-0 text-ink shadow-pop backdrop:bg-black/40 backdrop:backdrop-blur-[2px]">
        {req && <form method="dialog" onSubmit={e => { e.preventDefault(); if (val.trim().length >= min) done(req.input ? val.trim() : 'ok') }} className="p-5">
          <div className="flex items-start gap-3"><h3 className="text-base font-semibold">{req.title}</h3>
            <button type="button" aria-label="Close" onClick={() => done(null)} className="ml-auto rounded p-1 text-mute hover:bg-sunken"><X className="h-4 w-4" /></button></div>
          {req.body && <div className="mt-2 text-sm text-mute">{req.body}</div>}
          {req.input && <div className="mt-4"><Field label={req.input.label} hint={min ? `At least ${min} characters.` : undefined}>
            <Textarea autoFocus value={val} onChange={e => setVal(e.target.value)} placeholder={req.input.placeholder} className="min-h-[72px]" /></Field></div>}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => done(null)}>Cancel</Button>
            <Button type="submit" variant={req.tone === 'danger' ? 'danger' : 'primary'} disabled={!!req.input && val.trim().length < min}>{req.confirm}</Button>
          </div>
        </form>}
      </dialog>
    </DialogCtx.Provider>
  )
}

/** Minimal toasts. */
type Toast = { id: number; text: string; tone: 'ok' | 'err' }
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'err') => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random()
    setItems(x => [...x, { id, text, tone }])
    setTimeout(() => setItems(x => x.filter(t => t.id !== id)), tone === 'err' ? 6000 : 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
        {items.map(t => <div key={t.id} className={clsx('pointer-events-auto animate-rise rounded-lg px-3.5 py-2.5 text-sm shadow-pop',
          t.tone === 'ok' ? 'bg-ink text-bg' : 'bg-imm text-white')}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

export function Ring({ pct, size = 56, stroke = 6, children }: { pct: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const tone = pct >= 75 ? 'text-std' : pct >= 40 ? 'text-brand' : 'text-urg'
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90"><circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-sunken" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" stroke="currentColor"
          className={clsx(tone, 'transition-[stroke-dashoffset] duration-500')} strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, pct) / 100)} /></svg>
      <div className="absolute inset-0 grid place-items-center text-xs font-semibold tabular-nums">{children}</div>
    </div>
  )
}
