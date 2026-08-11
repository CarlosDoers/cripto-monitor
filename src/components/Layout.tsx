import { type ReactNode, useEffect, useState } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { ROUTES, type Route } from '../lib/router'
import { useTheme, isDark } from '../lib/theme'
import { timeAgo } from '../lib/format'
import {
  IconHistory,
  IconMore,
  IconMoon,
  IconOrders,
  IconOverview,
  IconPerformance,
  IconSignal,
  IconPositions,
  IconRefresh,
  IconSun,
  IconWallet,
} from './icons'

const NAV: Record<Route, { label: string; description: string; Icon: typeof IconOverview }> = {
  resumen: {
    label: 'Resumen',
    description: 'La salud de la cuenta, riesgo y oportunidades en una sola vista.',
    Icon: IconOverview,
  },
  senales: {
    label: 'Señales',
    description: 'Contexto de mercado, niveles operativos y fiabilidad de la estrategia.',
    Icon: IconSignal,
  },
  rendimiento: {
    label: 'Rendimiento',
    description: 'Qué está funcionando, qué cuesta dinero y dónde ajustar el proceso.',
    Icon: IconPerformance,
  },
  cartera: {
    label: 'Cartera',
    description: 'Distribución, exposición y evolución de todos tus activos.',
    Icon: IconWallet,
  },
  posiciones: {
    label: 'Posiciones',
    description: 'Exposición abierta, margen, liquidación y PnL en tiempo real.',
    Icon: IconPositions,
  },
  ordenes: {
    label: 'Órdenes',
    description: 'Órdenes pendientes e historial de ejecución por mercado.',
    Icon: IconOrders,
  },
  historial: {
    label: 'Historial',
    description: 'Ejecuciones, movimientos y costes recientes de la cuenta.',
    Icon: IconHistory,
  },
}

const MOBILE_PRIMARY: Route[] = ['resumen', 'senales', 'rendimiento', 'cartera']
const MOBILE_MORE: Route[] = ['posiciones', 'ordenes', 'historial']

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
      <span className="update-status update-status--live">
        <span className="dot-live" />
        Actualizando
      </span>
    )
  }
  return (
    <span className="update-status">
      <span className="update-status-dot" />
      Actualizado {timeAgo(lastDone)}
    </span>
  )
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
  const isFetching = useIsFetching()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const routeMeta = NAV[route]

  function go(route: Route) {
    setMobileMenuOpen(false)
    navigate(route)
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <button type="button" className="brand" onClick={() => go('resumen')}>
          <span className="brand-mark" aria-hidden="true">
            <span>C</span>
          </span>
          <span className="brand-copy">
            <span className="brand-name">Cripto Monitor</span>
            <span className="brand-caption">OKX · solo lectura</span>
          </span>
        </button>

        <p className="nav-label">Espacio de trabajo</p>
        <nav className="nav" aria-label="Secciones">
          {ROUTES.map((key) => {
            const { label, Icon } = NAV[key]
            return (
              <button
              key={key}
              type="button"
              className="nav-item"
              aria-current={route === key ? 'page' : undefined}
              onClick={() => go(key)}
            >
              <Icon className="nav-icon" />
              <span>{label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-pulse">
          <span className="sidebar-pulse-orb" aria-hidden="true" />
          <div>
            <p>Monitor privado</p>
            <span>Datos sincronizados con OKX</span>
          </div>
        </div>

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
          <div className="page-heading">
            <p className="page-overline">Panel personal · datos en vivo</p>
            <h1>{routeMeta.label}</h1>
            <p className="page-description">{routeMeta.description}</p>
          </div>
          <div className="topbar-actions">
            <LastUpdated />
            <button
              type="button"
              className="btn btn--icon theme-toggle"
              onClick={toggleTheme}
              aria-label={isDark(theme) ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
              title={isDark(theme) ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            >
              {isDark(theme) ? <IconSun /> : <IconMoon />}
            </button>
            <button
              type="button"
              className={`btn btn--icon refresh-button${isFetching > 0 ? ' is-refreshing' : ''}`}
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

      <nav className="mobile-nav" aria-label="Secciones principales">
        {MOBILE_PRIMARY.map((key) => {
          const { label, Icon } = NAV[key]
          return (
            <button
              key={key}
              type="button"
              className="mobile-nav-item"
              aria-current={route === key ? 'page' : undefined}
              onClick={() => go(key)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          )
        })}
        <button
          type="button"
          className="mobile-nav-item"
          aria-current={MOBILE_MORE.includes(route) ? 'page' : undefined}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-more-menu"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <IconMore />
          <span>Más</span>
        </button>
      </nav>

      {mobileMenuOpen && (
        <div className="mobile-menu" id="mobile-more-menu" role="dialog" aria-modal="true" aria-label="Más secciones">
          <button
            type="button"
            className="mobile-menu-backdrop"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Cerrar menú"
          />
          <div className="mobile-menu-sheet">
            <div className="mobile-menu-head">
              <div>
                <p className="page-overline">Más secciones</p>
                <h2>Profundiza en la cuenta</h2>
              </div>
              <button type="button" className="btn btn--icon" onClick={() => setMobileMenuOpen(false)} aria-label="Cerrar menú">
                <IconMore />
              </button>
            </div>
            <div className="mobile-menu-links">
              {MOBILE_MORE.map((key) => {
                const { label, description, Icon } = NAV[key]
                return (
                  <button
                    key={key}
                    type="button"
                    className="mobile-menu-link"
                    aria-current={route === key ? 'page' : undefined}
                    onClick={() => go(key)}
                  >
                    <span className="mobile-menu-icon"><Icon /></span>
                    <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
