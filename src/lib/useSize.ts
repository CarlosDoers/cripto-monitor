import { useEffect, useRef, useState } from 'react'

/**
 * Measures an element so charts can draw in real pixels.
 *
 * The alternative — a scaled viewBox — stretches strokes and markers along one
 * axis, which is exactly the kind of distortion a chart must not introduce.
 */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    setWidth(el.getBoundingClientRect().width)

    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}
