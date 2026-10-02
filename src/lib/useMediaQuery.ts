import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether a media query matches, kept in sync with the window.
 *
 * For layout that has to change the DOM rather than just its styling — the
 * Resumen moves the open positions up on a phone. Reordering with CSS `order`
 * would leave the reading and tab order disagreeing with what is on screen.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** The width below which tables turn into cards — the CSS breakpoint. */
export const NARROW = '(max-width: 720px)'
