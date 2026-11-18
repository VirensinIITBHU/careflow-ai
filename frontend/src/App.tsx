import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import { Spinner } from './components/ui'
import type { Role } from './lib/api'
import { homeFor, useAuth } from './lib/auth'
import Login from './pages/Login'

const Interview = lazy(() => import('./pages/intake/Interview'))
const Queue = lazy(() => import('./pages/Queue'))
const CaseBrief = lazy(() => import('./pages/case/CaseBrief'))
const Ops = lazy(() => import('./pages/Ops'))
const Trust = lazy(() => import('./pages/Trust'))
const AuditLog = lazy(() => import('./pages/AuditLog'))

const Loading = () => <div className="grid h-[60vh] place-items-center"><Spinner className="h-6 w-6" /></div>

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />
  return <Suspense fallback={<Loading />}>{children}</Suspense>
}

export default function App() {
  const { user, ready } = useAuth()
  if (!ready) return <Loading />
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={user ? <Shell /> : <Navigate to="/login" replace />}>
          <Route path="/interview" element={<Guard roles={['intake', 'admin']}><Interview /></Guard>} />
          <Route path="/interview/:sessionId" element={<Guard roles={['intake', 'admin']}><Interview /></Guard>} />
          <Route path="/queue" element={<Guard roles={['reviewer', 'admin']}><Queue /></Guard>} />
          <Route path="/case/:caseId" element={<Guard roles={['reviewer', 'admin']}><CaseBrief /></Guard>} />
          <Route path="/ops" element={<Guard roles={['reviewer', 'admin']}><Ops /></Guard>} />
          <Route path="/trust" element={<Guard roles={['reviewer', 'admin']}><Trust /></Guard>} />
          <Route path="/audit" element={<Guard roles={['admin']}><AuditLog /></Guard>} />
        </Route>
        <Route path="*" element={<Navigate to={user ? homeFor(user) : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  )
}
