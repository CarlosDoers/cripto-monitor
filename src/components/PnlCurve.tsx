import { useState } from 'react'
import { useSize } from '../lib/useSize'
import { axisTick, dateTime, signedUsd } from '../lib/format'
import type { Trade } from '../lib/performance'

interface Point {
  t: number
  value: number
}

const PAD = { top: 14, right: 12, bottom: 24, left: 58 }

/** Rounded, human tick values that bracket the data. */
function ticks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v)
  return out
}

/**
 * Cumulative net PnL over time.
 *
 * One series, so no legend — the card title names it. The zero line is the
 * reference the reader actually cares about, so it is drawn darker than the
 * grid and always included in the scale.
 */
export function PnlCurve({
  points,
  trades,
  height = 220,
}: {
  points: Point[]
  trades: Trade[]
  height?: number
}) {
  const [ref, width] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  if (points.length < 2) {
    return (
      <div ref={ref} className="state" style={{ height }}>
        <p>Se necesitan al menos dos operaciones cerradas para trazar la curva.</p>
      </div>
    )
  }

  const w = Math.max(width, 280)
  const plotW = w - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom

  const values = points.map((p) => p.value)
  // Zero always in frame: a curve that never crosses it still needs the anchor.
  const rawMin = Math.min(0, ...values)
  const rawMax = Math.max(0, ...values)
  const headroom = (rawMax - rawMin || 1) * 0.08
  const min = rawMin - headroom
  const max = rawMax + headroom

  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH

  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const area = `${PAD.left},${y(0)} ${line} ${x(points.length - 1)},${y(0)}`

  const last = points.at(-1)!
  const positive = last.value >= 0
  const stroke = positive ? 'var(--delta-up)' : 'var(--delta-down)'

  const hovered = hover !== null ? points[hover] : null
  const hoveredTrade = hover !== null ? trades[hover] : null

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - rect.left
    const ratio = (px - PAD.left) / plotW
    const i = Math.round(ratio * (points.length - 1))
    setHover(i >= 0 && i < points.length ? i : null)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg
        width={w}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Curva de PnL acumulado: ${points.length} operaciones, resultado final ${signedUsd(last.value)}`}
      >
        {ticks(min, max).map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={w - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 0 ? 'var(--baseline)' : 'var(--gridline)'}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--ink-muted)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {axisTick(v)}
            </text>
          </g>
        ))}

        <polygon points={area} fill={stroke} opacity={0.09} />
        <polyline
          points={line}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Endpoint gets a direct label; the rest live in the tooltip. */}
        <circle cx={x(points.length - 1)} cy={y(last.value)} r={3.5} fill={stroke} />

        <text
          x={PAD.left}
          y={height - 6}
          fontSize={11}
          fill="var(--ink-muted)"
        >
          {new Date(points[0].t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
        </text>
        <text
          x={w - PAD.right}
          y={height - 6}
          textAnchor="end"
          fontSize={11}
          fill="var(--ink-muted)"
        >
          {new Date(last.t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
        </text>

        {hovered && (
          <g pointerEvents="none">
            <line
              x1={x(hover!)}
              x2={x(hover!)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--ink-muted)"
              strokeWidth={1}
            />
            <circle
              cx={x(hover!)}
              cy={y(hovered.value)}
              r={4}
              fill={stroke}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {hovered && (
        <div
          className="tip"
          style={{
            position: 'absolute',
            left: Math.min(Math.max(x(hover!) - 70, 0), w - 160),
            top: 0,
            pointerEvents: 'none',
          }}
        >
          <div className="tip-title">{hoveredTrade?.symbol ?? 'Operación'}</div>
          <div className="tip-row">
            <span>Acumulado</span>
            <span>{signedUsd(hovered.value)}</span>
          </div>
          {hoveredTrade && (
            <div className="tip-row">
              <span>Esta operación</span>
              <span
                style={{ color: hoveredTrade.pnl >= 0 ? 'var(--delta-up)' : 'var(--delta-down)' }}
              >
                {signedUsd(hoveredTrade.pnl)}
              </span>
            </div>
          )}
          <div className="tip-row">
            <span>Cerrada</span>
            <span>{dateTime(hovered.t)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
