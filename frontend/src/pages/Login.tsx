import clsx from 'clsx'
import { ArrowRight, AudioLines, ClipboardCheck, FileSearch, Languages, ShieldCheck, Sparkles, UserCog } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Logo, WakeBanner } from '../components/Shell'
import { Button, Callout, Field, Input } from '../components/ui'
import { msg } from '../lib/api'
import { homeFor, useAuth } from '../lib/auth'

const ROLES = [
  { u: 'intake1', role: 'Intake', icon: <AudioLines className="h-5 w-5" />, text: 'Take a patient history by typing or voice, with suggested questions.' },
  { u: 'reviewer1', role: 'Reviewer', icon: <ClipboardCheck className="h-5 w-5" />, text: 'Review submitted cases, check the source, and approve or reject.' },
  { u: 'admin1', role: 'Admin', icon: <UserCog className="h-5 w-5" />, text: 'Reviewer access plus the audit log.' },
]

function DemoConversation() {
  return (
    <div className="relative mt-10 max-w-md space-y-3 text-[13.5px]">
      <div className="animate-rise rounded-2xl rounded-bl-sm border border-white/10 bg-white/[.06] px-4 py-3 backdrop-blur" style={{ animationDelay: '.1s' }}>
        <div className="mb-1 text-[11px] uppercase tracking-wider text-white/50">Patient · Hinglish</div>
        Mujhe kal se <mark className="rounded bg-amber-300/30 px-0.5 text-white">bukhar</mark> hai aur aaj subah se <mark className="rounded bg-red-400/30 px-0.5 text-white">saans lene mein dikkat</mark> ho rahi hai.
      </div>
      <div className="ml-8 animate-rise rounded-2xl rounded-br-sm bg-white px-4 py-3 text-slate-900 shadow-pop" style={{ animationDelay: '.6s' }}>
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-700"><Sparkles className="h-3 w-3" />Ask next</div>
        <div className="font-medium">Kya saans ki takleef abhi bhi ho rahi hai, aaram karte waqt bhi?</div>
        <div className="mt-0.5 text-slate-500">Is the breathing difficulty happening right now, even while resting?</div>
      </div>
      <div className="flex animate-rise flex-wrap gap-1.5 pl-1" style={{ animationDelay: '1.1s' }}>
        {['fever · since yesterday', 'breathing difficulty'].map((t, i) =>
          <span key={t} className={clsx('rounded-full border px-2.5 py-1 text-xs', i === 1 ? 'border-red-300/40 bg-red-400/15 text-red-100' : 'border-white/15 bg-white/5 text-white/80')}>{t}</span>)}
      </div>
    </div>
  )
}

export default function Login() {
  const { user, signIn } = useAuth()
  const nav = useNavigate()
  const [u, setU] = useState(''), [p, setP] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState<string | null>(null)
  if (user) return <Navigate to={homeFor(user)} replace />
  const go = async (name: string, pass: string) => {
    setBusy(name); setErr('')
    try { const me = await signIn(name, pass); nav(homeFor(me)) } catch (e) { setErr(msg(e)) }
    setBusy(null)
  }
  return (
    <div className="flex min-h-full flex-col">
      <WakeBanner />
      <div className="grid flex-1 lg:grid-cols-[1.05fr_1fr]">
        <section className="relative hidden overflow-hidden bg-[#0b1d24] p-12 text-white lg:flex lg:flex-col">
          <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-teal-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-48 -left-24 h-[420px] w-[420px] rounded-full bg-amber-400/10 blur-3xl" />
          <Logo className="relative [&>span]:text-white" />
          <div className="relative mt-auto">
            <h1 className="max-w-lg font-display text-[44px] font-semibold leading-[1.05] tracking-tight">
              Patient intake in Hindi,<br /><span className="text-teal-300">Hinglish and English.</span>
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/70">
              Intake staff get suggested questions while they take a history. Reviewers see a short summary next to the patient's
              own words, so every point can be checked against what was actually said.
            </p>
            <DemoConversation />
            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-white/60">
              <span className="flex items-center gap-1.5"><Languages className="h-4 w-4" />English · Hindi · Hinglish</span>
              <span className="flex items-center gap-1.5"><FileSearch className="h-4 w-4" />Linked to the source</span>
              <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" />A person makes every decision</span>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <Logo className="mb-8 lg:hidden" />
            <h2 className="font-display text-3xl font-semibold tracking-tight">Sign in</h2>
            <p className="mt-1 text-sm text-mute">Choose a demo account, or enter your details.</p>
            <div className="mt-6 space-y-2.5">
              {ROLES.map(r => (
                <button key={r.u} onClick={() => go(r.u, 'careflow-demo')} disabled={!!busy}
                  className="group flex w-full items-center gap-3.5 rounded-xl border border-line bg-panel p-3.5 text-left shadow-card transition hover:-translate-y-px hover:border-brand/50 hover:shadow-pop disabled:opacity-60">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brandsoft text-brand">{r.icon}</span>
                  <span className="min-w-0 flex-1"><span className="flex items-baseline gap-2"><b className="text-[15px]">{r.role}</b><code className="font-mono text-[11px] text-mute">{r.u}</code></span>
                    <span className="block text-[13px] leading-snug text-mute">{r.text}</span></span>
                  <ArrowRight className={clsx('h-4 w-4 shrink-0 text-mute transition group-hover:translate-x-0.5 group-hover:text-brand', busy === r.u && 'animate-pulse')} />
                </button>))}
            </div>
            <div className="my-6 flex items-center gap-3 text-xs text-mute"><div className="h-px flex-1 bg-line" />or<div className="h-px flex-1 bg-line" /></div>
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); go(u, p) }}>
              <Field label="Username" htmlFor="u"><Input id="u" value={u} onChange={e => setU(e.target.value)} autoComplete="username" required /></Field>
              <Field label="Password" htmlFor="p" hint="Demo password: careflow-demo (unless your backend sets DEMO_PASSWORD)."><Input id="p" type="password" value={p} onChange={e => setP(e.target.value)} autoComplete="current-password" required /></Field>
              {err && <Callout tone="danger">{err}</Callout>}
              <Button type="submit" className="w-full" size="lg" loading={busy === u && !!u}>Sign in</Button>
            </form>
            <p className="mt-8 text-center text-xs leading-relaxed text-mute">Demo accounts only. Use made-up patient details. Not for clinical use.</p>
          </div>
        </section>
      </div>
    </div>
  )
}
