import { useState } from 'react'
import { useSize } from '../lib/useSize'
import { pct, price, ratio } from '../lib/format'
import type { Market } from '../lib/markets'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Tile<T> extends Rect {
  item: T
}

/**
 * Squarified treemap (Bruls, Huijsing & van Wijk). Lays items out in rows along
 * the shorter side of the remaining space, closing a row as soon as adding one
 * more item would make its worst aspect ratio worse. The result is tiles as
 * close to square as the values allow — which is what makes a label fit.
 */
function squarify<T>(items: { value: number; item: T }[], rect: Rect): Tile<T>[] {
  const total = items.reduce((s, i) => s + i.value, 0)
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return []
  const scale = (rect.w * rect.h) / total
  const areas = items.map((i) => ({ area: i.value * scale, item: i.item }))

  const out: Tile<T>[] = []
  let free = { ...rect }
  let row: typeof areas = []

  const worst = (r: typeof areas, side: number) => {
    const sum = r.reduce((s, a) => s + a.area, 0)
    const max = Math.max(...r.map((a) => a.area))
    const min = Math.min(...r.map((a) => a.area))
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
  }

  const layRow = (r: typeof areas) => {
    const sum = r.reduce((s, a) => s + a.area, 0)
    if (free.w >= free.h) {
      // Column on the left, as wide as the row needs.
      const w = sum / free.h
      let y = free.y
      for (const a of r) {
        const h = a.area / w
        out.push({ x: free.x, y, w, h, item: a.item })
        y += h
      }
      free = { x: free.x + w, y: free.y, w: free.w - w, h: free.h }
    } else {
      const h = sum / free.w
      let x = free.x
      for (const a of r) {
        const w = a.area / h
        out.push({ x, y: free.y, w, h, item: a.item })
        x += w
      }
      free = { x: free.x, y: free.y + h, w: free.w, h: free.h - h }
    }
  }

  for (const a of areas) {
    const side = Math.min(free.w, free.h)
    if (row.length === 0 || worst([...row, a], side) <= worst(row, side)) {
      row.push(a)
    } else {
      layRow(row)
      row = [a]
    }
  }
  if (row.length) layRow(row)
  return out
}

/** Past this move the colour stops deepening: 8 % is a big day for a major. */
const FULL_TINT = 0.08

/**
 * Below this width thirty tiles become slivers too small to label, so the map
 * keeps the largest ones. The table below still has every contract.
 */
const NARROW = 600
const NARROW_TILES = 14

function money(v: number): string {
  if (v >= 1e9) return `${ratio(v / 1e9, 2)} B$`
  if (v >= 1e6) return `${ratio(v / 1e6, 1)} M$`
  return `${ratio(v / 1e3, 0)} k$`
}

/**
 * The top of the board at a glance: every tile as large as its 24 h volume and
 * tinted by its 24 h move, green up and red down, deeper the further it went.
 *
 * Volume and not market cap, because OKX gives volume and not supply — and for
 * someone who trades, where the money is changing hands is the more useful
 * size anyway. The colour always ships with a printed signed percentage, so the
 * tile never relies on hue alone; the full table below is its twin.
 */
export function MarketTreemap({ markets, height = 380 }: { markets: Market[]; height?: number }) {
  const [ref, width] = useSize<HTMLDivElement>()
  const [focus, setFocus] = useState<string | null>(null)
  const shown = width > 0 && width < NARROW ? markets.slice(0, NARROW_TILES) : markets
  const tiles = squarify(
    shown.map((m) => ({ value: m.volumeUsd, item: m })),
    { x: 0, y: 0, w: width, h: height },
  )
  // A phone has no hover, so a tap picks the tile whose detail is spelled out
  // under the map; with nothing picked, the largest one is described.
  const detail = shown.find((m) => m.instId === focus) ?? shown[0]

  return (
    <div className="treemap-wrap">
      <div ref={ref} className="treemap" style={{ height }} role="img" aria-label="Mapa de calor por volumen y variación 24 h">
        {tiles.map(({ x, y, w, h, item: m }) => {
          const tint = Math.round(18 + Math.min(Math.abs(m.change24h) / FULL_TINT, 1) * 62)
          const tone = m.change24h >= 0 ? 'var(--good)' : 'var(--critical)'
          // Labels only where they fit; the tooltip carries everything.
          // Two lines need ~36 px with the padding; below that the change
          // was clipped mid-glyph ("+24,9").
          const roomy = w > 86 && h > 58
          const fits = w > 48 && h > 38
          return (
            <div
              key={m.instId}
              className={`treemap-tile${detail?.instId === m.instId ? ' is-focus' : ''}`}
              onMouseEnter={() => setFocus(m.instId)}
              onClick={() => setFocus(m.instId)}
              style={{
                left: x,
                top: y,
                width: w,
                height: h,
                background: `color-mix(in srgb, ${tone} ${tint}%, var(--surface-2))`,
              }}
              title={`${m.symbol} · ${price(m.last)} · ${pct(m.change24h)} en 24 h · volumen ${Math.round(m.volumeUsd / 1e6)} M$`}
            >
              {fits && (
                <>
                  <span className={`treemap-symbol${roomy ? ' treemap-symbol--big' : ''}`}>{m.symbol}</span>
                  <span className="treemap-change">{pct(m.change24h)}</span>
                  {roomy && <span className="treemap-price">{price(m.last)}</span>}
                </>
              )}
            </div>
          )
        })}
      </div>
      {detail && (
        <p className="treemap-detail">
          <strong>{detail.symbol}</strong> {price(detail.last)}{' '}
          <span className={detail.change24h >= 0 ? 'delta--up' : 'delta--down'}>
            {pct(detail.change24h)}
          </span>
          <span className="sub">
            {' '}
            · volumen {money(detail.volumeUsd)} · rango 24 h {ratio(detail.rangePct, 1)} %
          </span>
        </p>
      )}
      <div className="treemap-legend">
        <span>Tamaño: volumen 24 h · {shown.length} contratos</span>
        <span className="treemap-scale" aria-hidden="true">
          <span>−8 %</span>
          <span className="treemap-scale-bar" />
          <span>+8 %</span>
        </span>
      </div>
    </div>
  )
}
