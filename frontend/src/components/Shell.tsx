import clsx from 'clsx'
import { Activity, ClipboardList, LogOut, MessagesSquare, Moon, ScrollText, ShieldCheck, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth, useTheme } from '../lib/auth'
import { useHealth } from '../lib/health'

export const Logo = ({ className }: { className?: string }) => (
  <div className={clsx('flex items-center gap-2', className)}>
    <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0"><rect width="32" height="32" rx="8" className="fill-brand" />
      <path d="M8.5 17.5c2.2 0 3-5 5-5s2.6 9 5 9 2.4-4 4.5-4" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    <span className="font-display text-[19px] font-semibold tracking-tight">CareFlow<span className="text-brand"> AI</span></span>
  </div>
)

function ServerDot() {
  const h = useHealth()
  const label = h.phase === 'up' ? `Connected · v${h.health?.version}` : h.phase === 'waking' ? `Server waking up… ${h.waitedS}s` : h.phase === 'down' ? 'Server unreachable' : 'Connecting…'
  return (
    <div className="flex items-center gap-2 text-xs text-mute" title={h.health ? `Policy ${h.health.policy_version}` : undefined}>
      <span className={clsx('h-2 w-2 rounded-full', h.phase === 'up' ? 'bg-std' : h.phase === 'down' ? 'bg-imm' : 'animate-pulse bg-urg')} />{label}
    </div>
  )
}

export function WakeBanner() {
  const h = useHealth()
  if (h.phase !== 'waking' && h.phase !== 'down') return null
  return (
    <div className={clsx('flex items-center justify-center gap-2 px-4 py-2 text-center text-[13px]', h.phase === 'down' ? 'bg-immsoft text-imm' : 'bg-urgsoft text-urg')}>
      {h.phase === 'waking'
        ? <><span className="h-2 w-2 animate-pulse rounded-full bg-urg" />The server is waking up from sleep ({h.waitedS}s). Free hosting pauses idle servers; this usually takes under a minute.</>
        : <>Cannot reach the server. Check the API URL (VITE_API_BASE_URL) and that the backend is running.</>}
    </div>
  )
}

const Item = ({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) => (
  <NavLink to={to} className={({ isActive }) => clsx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition',
    isActive ? 'bg-panel text-ink shadow-card ring-1 ring-line' : 'text-mute hover:bg-panel/60 hover:text-ink')}>
    <span className="[&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span><span className="hidden lg:inline">{children}</span>
  </NavLink>
)

export default function Shell() {
  const { user, signOut } = useAuth()
  const { dark, toggle } = useTheme()
  if (!user) return null
  const staff = user.role !== 'intake'
  const nav = <>
    {user.role !== 'reviewer' && <Item to="/interview" icon={<MessagesSquare />}>Live interview</Item>}
    {staff && <Item to="/queue" icon={<ClipboardList />}>Review queue</Item>}
    {staff && <Item to="/ops" icon={<Activity />}>Operations</Item>}
    {staff && <Item to="/trust" icon={<ShieldCheck />}>Trust &amp; safety</Item>}
    {user.role === 'admin' && <Item to="/audit" icon={<ScrollText />}>Audit log</Item>}
  </>
  return (
    <div className="flex min-h-full flex-col">
      <WakeBanner />
      <div className="flex min-h-0 flex-1">
        <aside className="sticky top-0 hidden h-screen w-[68px] shrink-0 flex-col border-r border-line bg-sunken/60 px-3 py-4 sm:flex lg:w-[232px]">
          <Logo className="px-1.5 [&>span]:hidden lg:[&>span]:inline" />
          <nav className="mt-7 flex flex-col gap-1">{nav}</nav>
          <div className="mt-auto space-y-3">
            <div className="hidden rounded-lg border border-line bg-panel/70 p-2.5 text-[11.5px] leading-snug text-mute lg:block">
              <b className="text-ink">Synthetic data only.</b> Not for clinical use. The AI organizes, asks and flags; people decide.
            </div>
            <div className="hidden lg:block"><ServerDot /></div>
            <div className="flex items-center gap-2 rounded-lg px-1.5">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brandsoft text-[13px] font-semibold uppercase text-brand">{user.username.slice(0, 2)}</div>
              <div className="hidden min-w-0 flex-1 lg:block"><div className="truncate text-sm font-medium">{user.username}</div><div className="text-xs capitalize text-mute">{user.role}</div></div>
            </div>
            <div className="flex gap-1 lg:px-1">
              <button onClick={toggle} aria-label="Toggle dark mode" className="rounded-lg p-2 text-mute hover:bg-panel hover:text-ink">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
              <button onClick={signOut} aria-label="Sign out" className="rounded-lg p-2 text-mute hover:bg-panel hover:text-ink"><LogOut className="h-4 w-4" /></button>
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-line bg-panel px-4 py-2.5 sm:hidden">
            <Logo /><div className="ml-auto flex gap-1">
              <button onClick={toggle} aria-label="Toggle dark mode" className="rounded-lg p-2 text-mute">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
              <button onClick={signOut} aria-label="Sign out" className="rounded-lg p-2 text-mute"><LogOut className="h-4 w-4" /></button></div>
          </header>
          <nav className="flex gap-1 overflow-x-auto border-b border-line bg-sunken/60 px-3 py-2 sm:hidden [&_span.hidden]:inline">{nav}</nav>
          <main className="min-w-0 flex-1"><Outlet /></main>
        </div>
      </div>
    </div>
  )
}
