import { useState } from 'react'
import { useSize } from '../lib/useSize'
import { dateTime, price as fmtPrice, plural } from '../lib/format'
import type { Candle, Signal, TrapAnalysis } from '../lib/indicators/reversalTrap'

const PAD = { top: 12, right: 66, bottom: 22, left: 10 }

/** Past this many candles the bodies are thinner than a pixel. */
const MAX_VISIBLE = 400

/** Rounded tick values bracketing the range. */
function ticks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1
  const mag = 10 ** Math.floor(Math.log10(span / count))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= span / count) ?? mag * 10
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v)
  return out
}

/**
 * Candles with the indicator's envelope and its signals.
 *
 * Only the visible window is drawn — running the analysis over 1200 bars but
 * plotting them all would give each candle under a pixel. Bodies collapse to a
 * single line as they get thinner, which is what a real chart does too.
 */
export function PriceChart({
  candles,
  analysis,
  visible = 160,
  height = 340,
}: {
  candles: Candle[]
  analysis: TrapAnalysis
  visible?: number
  height?: number
}) {
  const [ref, width] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  if (candles.length < 2) {
    return (
      <div ref={ref} className="state" style={{ height }}>
        <p>Sin velas suficientes para dibujar el gráfico.</p>
      </div>
    )
  }

  // Widen the window if needed so the most recent signal is always on screen —
  // otherwise a chart of a signal indicator can show no signals at all.
  const lastSignal = analysis.signals.at(-1)
  const wanted = lastSignal
    ? Math.max(visible, candles.length - lastSignal.index + 12)
    : visible
  const span = Math.min(wanted, MAX_VISIBLE, candles.length)
  const start = Math.max(0, candles.length - span)
  const view = candles.slice(start)
  const w = Math.max(width, 300)
  const plotW = w - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom

  // Scale to the candles plus whatever band is on screen, so nothing clips.
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < view.length; i++) {
    const g = start + i
    min = Math.min(min, view[i].low, analysis.lower[g] || Infinity)
    max = Math.max(max, view[i].high, analysis.upper[g] || -Infinity)
  }
  const padY = (max - min) * 0.04
  min -= padY
  max += padY

  const slot = plotW / view.length
  const bodyW = Math.max(1, Math.min(slot * 0.62, 12))
  const x = (i: number) => PAD.left + i * slot + slot / 2
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH

  const linePath = (series: number[]) =>
    view
      .map((_, i) => {
        const v = series[start + i]
        return Number.isFinite(v) ? `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}` : ''
      })
      .filter(Boolean)
      .join(' ')

  // Envelope fill, only across the bars where both bands exist.
  const bandArea = (() => {
    const top: string[] = []
    const bottom: string[] = []
    view.forEach((_, i) => {
      const u = analysis.upper[start + i]
      const l = analysis.lower[start + i]
      if (!Number.isFinite(u) || !Number.isFinite(l)) return
      top.push(`${x(i).toFixed(1)},${y(u).toFixed(1)}`)
      bottom.unshift(`${x(i).toFixed(1)},${y(l).toFixed(1)}`)
    })
    return top.length ? `${top.join(' ')} ${bottom.join(' ')}` : ''
  })()

  const visibleSignals = analysis.signals.filter((s) => s.index >= start)
  const hovered = hover !== null ? view[hover] : null
  const hoveredGlobal = hover !== null ? start + hover : -1

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const i = Math.floor((event.clientX - rect.left - PAD.left) / slot)
    setHover(i >= 0 && i < view.length ? i : null)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg
        width={w}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Gráfico de velas con la envolvente del indicador y ${plural(
          visibleSignals.length,
          'señal',
          'señales',
        )}`}
      >
        {ticks(min, max).map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--gridline)" />
            <text
              x={w - PAD.right + 6}
              y={y(v)}
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--ink-muted)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {fmtPrice(v)}
            </text>
          </g>
        ))}

        {bandArea && <polygon points={bandArea} fill="var(--accent)" opacity={0.05} />}
        <path d={linePath(analysis.upper)} fill="none" stroke="var(--critical)" strokeWidth={1.5} opacity={0.55} />
        <path d={linePath(analysis.lower)} fill="none" stroke="var(--good)" strokeWidth={1.5} opacity={0.55} />
        <path
          d={linePath(analysis.basis)}
          fill="none"
          stroke="var(--ink-muted)"
          strokeWidth={1.2}
          strokeDasharray="4 4"
          opacity={0.7}
        />

        {view.map((c, i) => {
          const up = c.close >= c.open
          const colour = up ? 'var(--good)' : 'var(--critical)'
          const bodyTop = y(Math.max(c.open, c.close))
          const bodyBottom = y(Math.min(c.open, c.close))
          return (
            <g key={c.time} opacity={hover === null || hover === i ? 1 : 0.75}>
              <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={colour} strokeWidth={1} />
              <rect
                x={x(i) - bodyW / 2}
                y={bodyTop}
                width={bodyW}
                height={Math.max(bodyBottom - bodyTop, 1)}
                fill={colour}
              />
            </g>
          )
        })}

        {visibleSignals.map((s) => {
          const i = s.index - start
          const long = s.side === 'long'
          const cy = long ? y(candles[s.index].low) + 16 : y(candles[s.index].high) - 16
          return (
            <g key={`${s.index}-${s.side}`}>
              <path
                d={
                  long
                    ? `M${x(i)},${cy - 7} l5,8 l-10,0 z`
                    : `M${x(i)},${cy + 7} l5,-8 l-10,0 z`
                }
                fill={long ? 'var(--good)' : 'var(--critical)'}
                stroke="var(--surface-1)"
                strokeWidth={1}
              />
            </g>
          )
        })}

        <text x={PAD.left} y={height - 5} fontSize={11} fill="var(--ink-muted)">
          {new Date(view[0].time).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
        </text>
        <text
          x={w - PAD.right}
          y={height - 5}
          textAnchor="end"
          fontSize={11}
          fill="var(--ink-muted)"
        >
          {new Date(view.at(-1)!.time).toLocaleDateString('es-ES', {
            day: 'numeric',
            month: 'short',
          })}
        </text>

        {hovered && (
          <line
            x1={x(hover!)}
            x2={x(hover!)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="var(--ink-muted)"
            strokeWidth={1}
            opacity={0.5}
            pointerEvents="none"
          />
        )}
      </svg>

      {hovered && (
        <div
          className="tip"
          style={{
            position: 'absolute',
            left: Math.min(Math.max(x(hover!) - 80, 0), w - 170),
            top: 4,
            pointerEvents: 'none',
          }}
        >
          <div className="tip-title">{dateTime(hovered.time)}</div>
          <div className="tip-row">
            <span>Apertura</span>
            <span>{fmtPrice(hovered.open)}</span>
          </div>
          <div className="tip-row">
            <span>Máx / mín</span>
            <span>
              {fmtPrice(hovered.high)} / {fmtPrice(hovered.low)}
            </span>
          </div>
          <div className="tip-row">
            <span>Cierre</span>
            <span>{fmtPrice(hovered.close)}</span>
          </div>
          {Number.isFinite(analysis.rsiSeries[hoveredGlobal]) && (
            <div className="tip-row">
              <span>RSI</span>
              <span>{analysis.rsiSeries[hoveredGlobal].toFixed(0)}</span>
            </div>
          )}
        </div>
      )}

      <ul className="legend" style={{ marginTop: 10 }}>
        <li className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--critical)' }} />
          Techo de la envolvente
        </li>
        <li className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--ink-muted)' }} />
          Línea base (objetivo)
        </li>
        <li className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--good)' }} />
          Suelo de la envolvente
        </li>
        <li className="legend-item">
          <span style={{ color: 'var(--good)' }}>▲</span> Señal long
          <span style={{ color: 'var(--critical)', marginLeft: 8 }}>▼</span> Señal short
        </li>
      </ul>
    </div>
  )
}

export type { Signal }
