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

/** `#/estrategias?inst=X` → `['estrategias', 'inst=X']`. */
function splitHash(): [string, string] {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const q = hash.indexOf('?')
  return q < 0 ? [hash, ''] : [hash.slice(0, q), hash.slice(q + 1)]
}

function currentRoute(): Route {
  const [path] = splitHash()
  if ((ROUTES as readonly string[]).includes(path)) return path as Route
  return ALIASES[path] ?? 'resumen'
}

/**
 * One query parameter of the current hash, so a link can open a view already
 * pointed at something — the Resumen's opportunities open Estrategias on their
 * own contract. A string, so `useSyncExternalStore` compares it by value.
 */
export function useRouteParam(name: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(splitHash()[1]).get(name),
    () => null,
  )
}

/** A link to a view with parameters: `routeHref('estrategias', { inst })`. */
export function routeHref(route: Route, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString()
  return `#/${route}${query ? `?${query}` : ''}`
}

export function useRoute(): [Route, (route: Route) => void] {
  const route = useSyncExternalStore(subscribe, currentRoute, () => 'resumen' as Route)
  const navigate = useCallback((next: Route) => {
    window.location.hash = `/${next}`
  }, [])
  return [route, navigate]
}
