import { type ReactNode, useEffect, useState } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { ROUTES, type Route } from '../lib/router'
import { useTheme, isDark } from '../lib/theme'
import { timeAgo } from '../lib/format'
import {
  IconHistory,
  IconMoon,
  IconOrders,
  IconOverview,
  IconPositions,
  IconRefresh,
  IconSun,
  IconWallet,
} from './icons'

const NAV: Record<Route, { label: string; Icon: typeof IconOverview }> = {
  resumen: { label: 'Resumen', Icon: IconOverview },
  cartera: { label: 'Cartera', Icon: IconWallet },
  posiciones: { label: 'Posiciones', Icon: IconPositions },
  ordenes: { label: 'Órdenes', Icon: IconOrders },
  historial: { label: 'Historial', Icon: IconHistory },
}

function LastUpdated() {
  const isFetching = useIsFetching()
  const [lastDone, setLastDone] = useState(() => Date.now())
  const [, force] = useState(0)

  useEffect(() => {
    if (isFetching === 0) setLastDone(Date.now())
  }, [isFetching])

  // Re-render on a slow tick so "hace 2 min" doesn't go stale on screen.
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  if (isFetching > 0) {
    return (
      <span className="badge badge--live">
        <span className="dot-live" />
        Actualizando
      </span>
    )
  }
  return <span>Actualizado {timeAgo(lastDone)}</span>
}

export function Layout({
  route,
  navigate,
  children,
}: {
  route: Route
  navigate: (route: Route) => void
  children: ReactNode
}) {
  const [theme, toggleTheme] = useTheme()
  const queryClient = useQueryClient()

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">C</span>
          <span>Cripto Monitor</span>
        </div>

        <nav className="nav" aria-label="Secciones">
          {ROUTES.map((key) => {
            const { label, Icon } = NAV[key]
            return (
              <button
                key={key}
                type="button"
                className="nav-item"
                aria-current={route === key ? 'page' : undefined}
                onClick={() => navigate(key)}
              >
                <Icon className="nav-icon" />
                <span>{label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="btn"
            onClick={toggleTheme}
            aria-label={isDark(theme) ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          >
            {isDark(theme) ? <IconSun /> : <IconMoon />}
            <span>{isDark(theme) ? 'Claro' : 'Oscuro'}</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{NAV[route].label}</h1>
          <div className="topbar-meta">
            <LastUpdated />
            <button
              type="button"
              className="btn btn--icon"
              onClick={() => queryClient.invalidateQueries()}
              aria-label="Actualizar ahora"
              title="Actualizar ahora"
            >
              <IconRefresh />
            </button>
          </div>
        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  )
}
