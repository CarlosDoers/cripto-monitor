import { useSyncExternalStore, useCallback } from 'react'

/**
 * Hash routing in a dozen lines. Enough for a five-tab dashboard, and it gives
 * shareable URLs and a working back button without pulling in a router.
 */

export const ROUTES = [
  // Tu cuenta
  'resumen',
  'encurso',
  'cartera',
  'rendimiento',
  'historial',
  // El mercado
  'mercados',
  'screener',
  'analisis',
  'estrategias',
  // Ayuda
  'guia',
] as const
export type Route = (typeof ROUTES)[number]

/**
 * Old addresses, from before the sections were merged. A bookmark or a link in
 * a note must still land somewhere sensible rather than on the Resumen.
 */
const ALIASES: Record<string, Route> = {
  senales: 'estrategias',
  posiciones: 'encurso',
  bots: 'encurso',
  ordenes: 'historial',
}

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if ((ROUTES as readonly string[]).includes(hash)) return hash as Route
  return ALIASES[hash] ?? 'resumen'
}

export function useRoute(): [Route, (route: Route) => void] {
  const route = useSyncExternalStore(subscribe, currentRoute, () => 'resumen' as Route)
  const navigate = useCallback((next: Route) => {
    window.location.hash = `/${next}`
  }, [])
  return [route, navigate]
}
