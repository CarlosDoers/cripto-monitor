import { useCallback, useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'cripto-monitor:theme'

function read(): Theme {
  const stored = localStorage.getItem(KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

/**
 * Follows the OS by default. An explicit choice stamps `data-theme` on <html>,
 * which the token stylesheet lets win over the media query in both directions.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(read)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    localStorage.setItem(KEY, theme)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((current) => {
      if (current === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        return prefersDark ? 'light' : 'dark'
      }
      return current === 'dark' ? 'light' : 'dark'
    })
  }, [])

  return [theme, toggle]
}

export function isDark(theme: Theme): boolean {
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches
  return theme === 'dark'
}
