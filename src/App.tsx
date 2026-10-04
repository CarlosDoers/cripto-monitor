import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError, probe } from './lib/api'
import { useRoute } from './lib/router'
import { useCurrency } from './lib/currency'
import { useEurRate } from './lib/portfolio'
import { Layout } from './components/Layout'
import { Gate } from './components/Gate'
import { Card, ErrorNotice, Skeleton } from './components/ui'
import { Overview } from './views/Overview'

/**
 * Every view but the Resumen loads when it is first opened. The bundle was
 * 581 KB in one file, most of it the chart, the indicators and the Screener,
 * downloaded before the Resumen could show a figure. The Resumen stays in the
 * main file because it is what opens.
 */
const Performance = lazy(() => import('./views/Performance').then((m) => ({ default: m.Performance })))
const Signals = lazy(() => import('./views/Signals').then((m) => ({ default: m.Signals })))
const Markets = lazy(() => import('./views/Markets').then((m) => ({ default: m.Markets })))
const Screener = lazy(() => import('./views/Screener').then((m) => ({ default: m.Screener })))
const Portfolio = lazy(() => import('./views/Portfolio').then((m) => ({ default: m.Portfolio })))
const Active = lazy(() => import('./views/Active').then((m) => ({ default: m.Active })))
const History = lazy(() => import('./views/History').then((m) => ({ default: m.History })))
const Funding = lazy(() => import('./views/Funding').then((m) => ({ default: m.Funding })))
const Guide = lazy(() => import('./views/Guide').then((m) => ({ default: m.Guide })))

function ViewLoading() {
  return (
    <div className="view-loading" aria-busy="true">
      <Skeleton height={96} />
      <Skeleton height={280} />
    </div>
  )
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep showing the last good data while a refetch runs, and don't retry
      // a 401/403 — those are configuration problems, not transient ones.
      placeholderData: <T,>(previous: T) => previous,
      // Data counts as fresh for a while after it arrives. Without this every
      // component that mounted with a query already in the cache refetched it:
      // one load of the Resumen fired the spot tickers 32 times and the five
      // pages of closed positions 5 times each in its first 12 seconds, and
      // each of those is a serverless invocation and a slice of OKX's limit.
      staleTime: 20_000,
      retry: (failureCount, error) => {
        // A rate limit is the one 4xx that passes on its own: OKX's
        // `funding-rate?instId=ANY` returned 429 on opening Financiación, and
        // without a retry the page showed the error for the five minutes until
        // its next refetch.
        if (error instanceof ApiError && error.status === 429) return failureCount < 3
        if (error instanceof ApiError && error.status < 500) return false
        return failureCount < 2
      },
      // A rate limit needs longer than an outage: the funding board
      // (`funding-rate?instId=ANY`) answered 429 to a second call 3 s after
      // the first and 200 again at 6 s, so 1 s and 2 s retries both landed
      // inside the window. 3, 6, 12 s for a 429; 1, 2 s otherwise. Jittered
      // so retries do not collide again.
      retryDelay: (attempt, error) =>
        (error instanceof ApiError && error.status === 429 ? 3_000 : 1_000) * 2 ** attempt + Math.random() * 500,
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
  // Subscribing here re-renders the whole view tree when the display currency
  // changes. The formatters read the currency from a module store rather than
  // taking it as a prop, so without this only the sidebar would update.
  useCurrency()
  useEurRate()
  return (
    <Layout route={route} navigate={navigate}>
      <Suspense fallback={<ViewLoading />}>
      {route === 'resumen' && <Overview />}
      {route === 'encurso' && <Active />}
      {route === 'cartera' && <Portfolio />}
      {route === 'rendimiento' && <Performance />}
      {route === 'historial' && <History />}
      {route === 'mercados' && <Markets />}
      {route === 'screener' && <Screener />}
      {route === 'analisis' && <Signals section="analysis" />}
      {route === 'estrategias' && <Signals section="strategies" />}
      {route === 'financiacion' && <Funding />}
      {route === 'guia' && <Guide />}
      </Suspense>
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
