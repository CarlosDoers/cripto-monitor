import { useState } from 'react'
import { assignColors, OTHER_COLOR, VISIBLE } from '../lib/colors'
import { share, usd } from '../lib/format'
import { activeCurrency, convert } from '../lib/currency'

const WHOLE = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })
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

/**
 * The same distribution as a ring, for the Resumen, where it sits beside the
 * account health. A ring rather than the bar there because this account's
 * slices are few and far apart (two-thirds, a third, a twentieth): part to
 * whole at a glance, which is the one job a ring does well. Close values would
 * still belong in the bar, and every value is printed in the legend beside it.
 *
 * Hovering a slice or its legend row puts that coin in the centre; otherwise
 * the centre holds the total. Slices are separated by a surface gap.
 */
export function AllocationDonut({ holdings, total }: { holdings: Holding[]; total: number }) {
  const [active, setActive] = useState<string | null>(null)
  const segments = buildSegments(holdings)
  if (segments.length === 0) return <p className="muted">Sin activos valorados.</p>

  const R = 52
  const STROKE = 14
  const C = 2 * Math.PI * R
  // A 2 px gap between slices, measured along the circumference.
  const GAP = segments.length > 1 ? 2 : 0
  const sum = segments.reduce((s, x) => s + x.weight, 0) || 1
  let offset = 0
  const arcs = segments.map((seg) => {
    const len = (seg.weight / sum) * C
    const arc = { seg, dash: Math.max(0.5, len - GAP), offset }
    offset += len
    return arc
  })
  const focus = segments.find((s) => s.ccy === active)

  return (
    <div className="donut" onPointerLeave={() => setActive(null)}>
      <svg
        className="donut-svg"
        viewBox="0 0 140 140"
        role="img"
        aria-label={`Distribución de la cartera: ${segments.map((s) => `${s.ccy} ${share(s.weight)}`).join(', ')}`}
      >
        {/* Start at twelve o'clock and run clockwise. */}
        <g transform="rotate(-90 70 70)">
          {arcs.map(({ seg, dash, offset: o }) => (
            <circle
              key={seg.ccy}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={seg.color}
              strokeWidth={active === seg.ccy ? STROKE + 4 : STROKE}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-o}
              opacity={active && active !== seg.ccy ? 0.35 : 1}
              onPointerEnter={() => setActive(seg.ccy)}
              onClick={() => setActive(seg.ccy)}
              style={{ transition: 'opacity 0.15s ease, stroke-width 0.15s ease', cursor: 'default' }}
            />
          ))}
        </g>
        {/* Whole units and the currency on its own line: with cents, the
            total ran into the ring. */}
        <text x="70" y="60" textAnchor="middle" className="donut-center-label">
          {focus ? focus.ccy : 'Total'}
        </text>
        <text x="70" y="79" textAnchor="middle" className="donut-center-value">
          {focus ? share(focus.weight) : WHOLE.format(convert(total))}
        </text>
        <text x="70" y="94" textAnchor="middle" className="donut-center-label">
          {focus ? usd(focus.usd) : activeCurrency() === 'EUR' ? '€' : 'US$'}
        </text>
      </svg>
      <ul className="donut-legend">
        {segments.map((seg) => (
          <li
            key={seg.ccy}
            className={active === seg.ccy ? 'is-active' : undefined}
            onPointerEnter={() => setActive(seg.ccy)}
          >
            <span className="legend-swatch" style={{ background: seg.color }} />
            <span className="donut-legend-name">{seg.ccy}</span>
            <span className="donut-legend-share">{share(seg.weight)}</span>
            <span className="donut-legend-value">{usd(seg.usd)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
