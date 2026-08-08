import { useState } from 'react'
import { assignColors, OTHER_COLOR, VISIBLE } from '../lib/colors'
import { share, usd } from '../lib/format'
import type { Holding } from '../lib/types'

interface Segment {
  ccy: string
  usd: number
  weight: number
  color: string
}

function buildSegments(holdings: Holding[]): Segment[] {
  const priced = holdings.filter((h) => h.usd > 0)
  const colors = assignColors(priced.map((h) => h.ccy))

  const head = priced.slice(0, VISIBLE).map((h) => ({
    ccy: h.ccy,
    usd: h.usd,
    weight: h.weight,
    color: colors.get(h.ccy) ?? OTHER_COLOR,
  }))

  // Past ~7 classes adjacent segments blur, so the tail becomes one grey slice.
  const tail = priced.slice(VISIBLE)
  if (tail.length > 0) {
    head.push({
      ccy: `Otros (${tail.length})`,
      usd: tail.reduce((sum, h) => sum + h.usd, 0),
      weight: tail.reduce((sum, h) => sum + h.weight, 0),
      color: OTHER_COLOR,
    })
  }
  return head
}

/**
 * Part-to-whole as a stacked bar rather than a donut — close values stay
 * comparable. Segments are separated by a 2px surface gap, never a border.
 *
 * Three of the light-mode hues sit below 3:1 against the surface, so the legend
 * below (and the holdings table beside it) carry every value in text. Colour is
 * never the only way to read this chart.
 */
export function AllocationBar({ holdings }: { holdings: Holding[] }) {
  const [hover, setHover] = useState<{ seg: Segment; x: number; y: number } | null>(null)
  const segments = buildSegments(holdings)

  if (segments.length === 0) {
    return <p className="muted">Sin activos valorados.</p>
  }

  return (
    <div className="alloc">
      <div
        className="alloc-track"
        role="img"
        aria-label={`Distribución de la cartera: ${segments
          .map((s) => `${s.ccy} ${share(s.weight)}`)
          .join(', ')}`}
      >
        {segments.map((seg) => (
          <div
            key={seg.ccy}
            className="alloc-seg"
            style={{ background: seg.color, flexGrow: Math.max(seg.weight, 0.004) }}
            onMouseEnter={(e) => setHover({ seg, x: e.clientX, y: e.clientY })}
            onMouseMove={(e) => setHover({ seg, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </div>

      <ul className="legend">
        {segments.map((seg) => (
          <li key={seg.ccy} className="legend-item">
            <span className="legend-swatch" style={{ background: seg.color }} />
            {seg.ccy}
            <span className="legend-value">{share(seg.weight)}</span>
          </li>
        ))}
      </ul>

      {hover && (
        <div
          className="tip"
          style={{
            left: Math.min(hover.x + 12, window.innerWidth - 160),
            top: hover.y + 14,
          }}
        >
          <div className="tip-title">
            <span className="legend-swatch" style={{ background: hover.seg.color }} />
            {hover.seg.ccy}
          </div>
          <div className="tip-row">
            <span>Valor</span>
            <span>{usd(hover.seg.usd)}</span>
          </div>
          <div className="tip-row">
            <span>Peso</span>
            <span>{share(hover.seg.weight)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
