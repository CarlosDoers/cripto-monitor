import { type ReactNode, useEffect, useState } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { ROUTES, type Route } from '../lib/router'
import { useTheme, isDark } from '../lib/theme'
import { setCurrency, useCurrency } from '../lib/currency'
import { timeAgo } from '../lib/format'
import { ClaudeExport } from './ClaudeExport'
import { MarketTicker } from './MarketTicker'
import {
  IconHistory,
  IconMore,
  IconMoon,
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
  IconFilter,
  IconTarget,
  IconBook,
  IconFunding,
} from './icons'

type NavGroup = 'cuenta' | 'mercado' | 'ayuda'

/**
 * Each section says, in its description, the question it answers — that is
 * the whole contract of the page, and it is shown under the title.
 */
const NAV: Record<Route, { label: string; description: string; group: NavGroup; Icon: typeof IconOverview }> = {
  resumen: {
    label: 'Resumen',
    description: '¿Cómo voy? Lo que has ganado, lo que tienes en marcha y lo que requiere atención.',
    group: 'cuenta',
    Icon: IconOverview,
  },
  encurso: {
    label: 'En curso',
    description: '¿Qué tengo abierto ahora? Posiciones, bots y órdenes pendientes, con su riesgo.',
    group: 'cuenta',
    Icon: IconPositions,
  },
  cartera: {
    label: 'Cartera',
    description: '¿Qué tengo? Cada moneda, cuánto vale y cuánto está disponible.',
    group: 'cuenta',
    Icon: IconWallet,
  },
  rendimiento: {
    label: 'Rendimiento',
    description: '¿Qué funciona y qué no? Tus operaciones cerradas, analizadas.',
    group: 'cuenta',
    Icon: IconPerformance,
  },
  historial: {
    label: 'Historial',
    description: '¿Qué ha pasado? Órdenes, ejecuciones, bots, depósitos y movimientos.',
    group: 'cuenta',
    Icon: IconHistory,
  },
  mercados: {
    label: 'Mercados',
    description: '¿Cómo está el mercado hoy? Qué sube, qué baja y dónde se mueve el dinero.',
    group: 'mercado',
    Icon: IconMarkets,
  },
  screener: {
    label: 'Screener',
    description: '¿Qué contratos cumplen lo que busco? Filtra todo el tablero de una vez.',
    group: 'mercado',
    Icon: IconFilter,
  },
  analisis: {
    label: 'Análisis',
    description: '¿Dónde está el precio? Soportes, tendencias, estructura SMC y medias sobre el gráfico.',
    group: 'mercado',
    Icon: IconSignal,
  },
  estrategias: {
    label: 'Estrategias',
    description: '¿Hay alguna señal? Las cuatro estrategias medidas, con sus resultados reales.',
    group: 'mercado',
    Icon: IconTarget,
  },
  financiacion: {
    label: 'Financiación',
    description: '¿Dónde se cobra por esperar? Cubrir lo que tienes con un corto y cobrar la financiación, sin apostar por el precio.',
    group: 'mercado',
    Icon: IconFunding,
  },
  guia: {
    label: 'Guía',
    description: 'Cómo leer cada sección y qué se ha comprobado que funciona.',
    group: 'ayuda',
    Icon: IconBook,
  },
}

const GROUPS: { key: NavGroup; label: string }[] = [
  { key: 'cuenta', label: 'Tu cuenta' },
  { key: 'mercado', label: 'El mercado' },
  { key: 'ayuda', label: 'Ayuda' },
]

/**
 * The four the bottom bar reaches in one tap. An editorial choice about what
 * gets used most, not a list of what exists.
 */
const MOBILE_PRIMARY: Route[] = ['resumen', 'encurso', 'analisis', 'rendimiento']

/**
 * Everything else, derived rather than listed — and it has to be.
 *
 * Written by hand, this went stale the moment a view was added: `NAV` is a
 * `Record<Route, …>` so TypeScript demands an entry for a new route, but a
 * `Route[]` demands nothing. Bots shipped completely unreachable on phones
 * while the desktop sidebar, which does derive from `ROUTES`, showed it fine —
 * and nothing failed, because there was nothing to fail. Derived, a new route
 * is reachable everywhere by construction.
 */
const MOBILE_MORE: Route[] = ROUTES.filter((r) => !MOBILE_PRIMARY.includes(r))

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

  // The text folds away on narrow phones (see app.css), so it is also the
  // pill's accessible name and tooltip.
  if (isFetching > 0) {
    return (
      <span className="update-status update-status--live" title="Actualizando" aria-label="Actualizando">
        <span className="dot-live" />
        <span className="update-status-text">Actualizando</span>
      </span>
    )
  }
  const ago = timeAgo(lastDone)
  return (
    <span className="update-status" title={`Actualizado ${ago}`} aria-label={`Actualizado ${ago}`}>
      <span className="update-status-dot" />
      <span className="update-status-text">{ago}</span>
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

        {/* Grouped by the question being asked: about the account, or about
            the market. Ten sections in one flat list read as ten unrelated
            things. */}
        <nav className="nav" aria-label="Secciones">
          {GROUPS.map((g) => (
            <div key={g.key} className="nav-group">
              <p className="nav-label">{g.label}</p>
              {ROUTES.filter((key) => NAV[key].group === g.key).map((key) => {
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
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-pulse">
          <span className="sidebar-pulse-orb" aria-hidden="true">
            <IconShield />
          </span>
          <div className="sidebar-pulse-text">
            <p>Solo lectura</p>
            <span>La app no puede operar ni retirar</span>
          </div>
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
            <LastUpdated />
            <ClaudeExport />
            {/* Currency and theme are both display preferences, so they live
                together in the top bar instead of at the foot of the sidebar.
                OKX shows amounts in whatever currency the account is set to;
                the API always returns USD, so this converts for display and the
                figures line up with the OKX app. */}
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
                <p className="page-overline">Más secciones</p>
                <h2>Todo lo demás</h2>
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

