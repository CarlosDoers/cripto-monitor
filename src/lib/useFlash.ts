import { useEffect, useRef, useState } from 'react'

export interface Flash {
  dir: 'up' | 'down' | null
  /** Changes on every flash, so a `key` restarts the animation even when the direction repeats. */
  key: number
}

/**
 * A brief tint when a live figure moves: green when it rose, red when it fell.
 *
 * Only for figures that refresh on their own (net worth, open PnL), so the eye
 * catches that something changed without reading every digit again. Moves
 * under half a cent are ignored — they are rounding, not news. The CSS drops
 * the animation under `prefers-reduced-motion`.
 */
export function useFlash(value: number | undefined): Flash {
  const prev = useRef(value)
  const [flash, setFlash] = useState<Flash>({ dir: null, key: 0 })

  useEffect(() => {
    const before = prev.current
    prev.current = value
    if (before === undefined || value === undefined) return
    if (!Number.isFinite(before) || !Number.isFinite(value) || Math.abs(value - before) < 0.005) return
    const dir = value > before ? 'up' : 'down'
    // Deferred a tick: the value that triggers this has just rendered, and the
    // tint belongs on the frame after it.
    const start = setTimeout(() => setFlash((f) => ({ dir, key: f.key + 1 })), 0)
    const end = setTimeout(() => setFlash((f) => ({ ...f, dir: null })), 1400)
    return () => {
      clearTimeout(start)
      clearTimeout(end)
    }
  }, [value])

  return flash
}
