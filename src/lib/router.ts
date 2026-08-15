import { useSyncExternalStore, useCallback } from 'react'

/**
 * Hash routing in a dozen lines. Enough for a five-tab dashboard, and it gives
 * shareable URLs and a working back button without pulling in a router.
 */

export const ROUTES = [
  'resumen',
  'senales',
  'mercados',
  'rendimiento',
  'cartera',
  'posiciones',
  'ordenes',
  'historial',
] as const
export type Route = (typeof ROUTES)[number]

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  return (ROUTES as readonly string[]).includes(hash) ? (hash as Route) : 'resumen'
}

export function useRoute(): [Route, (route: Route) => void] {
  const route = useSyncExternalStore(subscribe, currentRoute, () => 'resumen' as Route)
  const navigate = useCallback((next: Route) => {
    window.location.hash = `/${next}`
  }, [])
  return [route, navigate]
}
