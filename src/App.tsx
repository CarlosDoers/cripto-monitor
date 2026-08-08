import { useCallback, useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError, probe } from './lib/api'
import { useRoute } from './lib/router'
import { Layout } from './components/Layout'
import { Gate } from './components/Gate'
import { Card, ErrorNotice, Skeleton } from './components/ui'
import { Overview } from './views/Overview'
import { Performance } from './views/Performance'
import { Portfolio } from './views/Portfolio'
import { Positions } from './views/Positions'
import { Orders } from './views/Orders'
import { History } from './views/History'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep showing the last good data while a refetch runs, and don't retry
      // a 401/403 — those are configuration problems, not transient ones.
      placeholderData: <T,>(previous: T) => previous,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false
        return failureCount < 2
      },
      refetchOnWindowFocus: true,
    },
  },
})

type Status = 'checking' | 'locked' | 'unconfigured' | 'ready' | 'error'

function SetupNotice() {
  return (
    <div className="content" style={{ maxWidth: 640, margin: '48px auto' }}>
      <Card title="Falta configurar las credenciales de OKX">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p>
            El servidor no tiene las claves de la API. Defínelas como variables de entorno —
            nunca con el prefijo <code>VITE_</code>, o acabarían en el navegador:
          </p>
          <pre
            style={{
              background: 'var(--surface-inset)',
              padding: '12px 14px',
              borderRadius: 'var(--radius)',
              overflowX: 'auto',
              fontSize: 12.5,
              fontFamily: 'var(--mono)',
            }}
          >
            {`OKX_API_KEY=…\nOKX_API_SECRET=…\nOKX_API_PASSPHRASE=…`}
          </pre>
          <p className="muted">
            En local van en <code>.env.local</code>. En Vercel, en Settings → Environment
            Variables. Consulta el README para los pasos completos.
          </p>
        </div>
      </Card>
    </div>
  )
}

function Views() {
  const [route, navigate] = useRoute()
  return (
    <Layout route={route} navigate={navigate}>
      {route === 'resumen' && <Overview />}
      {route === 'rendimiento' && <Performance />}
      {route === 'cartera' && <Portfolio />}
      {route === 'posiciones' && <Positions />}
      {route === 'ordenes' && <Orders />}
      {route === 'historial' && <History />}
    </Layout>
  )
}

export default function App() {
  const [status, setStatus] = useState<Status>('checking')
  const [message, setMessage] = useState('')

  const check = useCallback(async () => {
    try {
      const result = await probe()
      setStatus(result.configured ? 'ready' : 'unconfigured')
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        setStatus('locked')
        return
      }
      setStatus('error')
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  if (status === 'checking') {
    return (
      <div className="content" style={{ maxWidth: 640, margin: '48px auto', gap: 12 }}>
        <Skeleton height={36} width="45%" />
        <Skeleton height={120} />
      </div>
    )
  }

  if (status === 'locked') return <Gate onUnlock={check} />

  if (status === 'error') {
    return (
      <div className="content" style={{ maxWidth: 640, margin: '48px auto' }}>
        <ErrorNotice title="No se pudo contactar con el servidor" message={message} />
      </div>
    )
  }

  if (status === 'unconfigured') return <SetupNotice />

  return (
    <QueryClientProvider client={queryClient}>
      <Views />
    </QueryClientProvider>
  )
}
