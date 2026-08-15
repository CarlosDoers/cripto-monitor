import { type ReactNode, useEffect, useState } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { ROUTES, type Route } from '../lib/router'
import { useTheme, isDark } from '../lib/theme'
import { setCurrency, useCurrency } from '../lib/currency'
import { timeAgo, usdCompact } from '../lib/format'
import { usePortfolio } from '../lib/portfolio'
import { MarketTicker } from './MarketTicker'
import { Delta } from './ui'
import {
  IconHistory,
  IconMore,
  IconMoon,
  IconOrders,
  IconOverview,
  IconPerformance,
  IconSignal,
  IconMarkets,
  IconPositions,
  IconRefresh,
  IconSun,
  IconWallet,
  IconShield,
  IconSparkles,
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
  mercados: {
    label: 'Mercados',
    description: 'Qué contratos perpetuos tienen liquidez y condiciones para operar ahora.',
    Icon: IconMarkets,
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
const MOBILE_MORE: Route[] = ['mercados', 'posiciones', 'ordenes', 'historial']

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
        <span>Actualizando</span>
      </span>
    )
  }
  return (
    <span className="update-status">
      <span className="update-status-dot" />
      <span>{timeAgo(lastDone)}</span>
    </span>
  )
}

function QuickPortfolioBadge() {
  const portfolio = usePortfolio()
  if (portfolio.isLoading || !portfolio.netWorth) return null

  return (
    <div className="topbar-quick-kpi" title="Patrimonio total actual">
      <span className="topbar-kpi-label">Patrimonio</span>
      <span className="topbar-kpi-val">{usdCompact(portfolio.netWorth)}</span>
      {portfolio.change24h !== undefined && (
        <Delta ratio={portfolio.change24h} pill />
      )}
    </div>
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
  const { currency } = useCurrency()
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
            <IconSparkles />
          </span>
          <span className="brand-copy">
            <span className="brand-name">Cripto Monitor</span>
            <span className="brand-caption">
              <span className="brand-status-dot" />
              OKX Live Sync
            </span>
          </span>
        </button>

        <p className="nav-label">Terminal de Control</p>
        <nav className="nav" aria-label="Secciones">
          {ROUTES.map((key) => {
            const { label, Icon } = NAV[key]
            const isCurrent = route === key
            return (
              <button
                key={key}
                type="button"
                className={`nav-item${isCurrent ? ' nav-item--active' : ''}`}
                aria-current={isCurrent ? 'page' : undefined}
                onClick={() => go(key)}
              >
                <Icon className="nav-icon" />
                <span className="nav-text">{label}</span>
                {isCurrent && <span className="nav-active-glow" aria-hidden="true" />}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-pulse">
          <span className="sidebar-pulse-orb" aria-hidden="true">
            <IconShield />
          </span>
          <div className="sidebar-pulse-text">
            <p>Conexión Segura</p>
            <span>HMAC SHA-256 · Solo Lectura</span>
          </div>
        </div>

        <div className="sidebar-footer">
          {/* OKX shows amounts in whatever currency the account is set to. The
              API always returns USD, so this converts for display — pick euros
              here and the figures line up with the OKX app. */}
          <div className="seg-control currency-switch" role="group" aria-label="Moneda">
            {(['USD', 'EUR'] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={currency === c}
                onClick={() => setCurrency(c)}
              >
                {c === 'USD' ? 'US$' : '€'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn--theme"
            onClick={toggleTheme}
            aria-label={isDark(theme) ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          >
            {isDark(theme) ? <IconSun /> : <IconMoon />}
            <span>{isDark(theme) ? 'Modo Claro' : 'Modo Oscuro'}</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <MarketTicker />

        <header className="topbar">
          <div className="page-heading">
            <div className="page-title-row">
              <h1>{routeMeta.label}</h1>
              <span className="page-badge">OKX Real-Time</span>
            </div>
            <p className="page-description">{routeMeta.description}</p>
          </div>
          <div className="topbar-actions">
            <QuickPortfolioBadge />
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
              aria-label="Actualizar datos"
              title="Actualizar datos de OKX"
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
          const isCurrent = route === key
          return (
            <button
              key={key}
              type="button"
              className={`mobile-nav-item${isCurrent ? ' is-active' : ''}`}
              aria-current={isCurrent ? 'page' : undefined}
              onClick={() => go(key)}
            >
              <span className="mobile-nav-icon-wrap">
                <Icon />
              </span>
              <span>{label}</span>
            </button>
          )
        })}
        <button
          type="button"
          className={`mobile-nav-item${MOBILE_MORE.includes(route) ? ' is-active' : ''}`}
          aria-current={MOBILE_MORE.includes(route) ? 'page' : undefined}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-more-menu"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <span className="mobile-nav-icon-wrap">
            <IconMore />
          </span>
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
            <div className="mobile-menu-handle" aria-hidden="true" />
            <div className="mobile-menu-head">
              <div>
                <p className="page-overline">Menú Adicional</p>
                <h2>Otras Secciones</h2>
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
                    <span className="mobile-menu-text">
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

