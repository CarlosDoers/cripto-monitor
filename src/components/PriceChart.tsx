import { useState } from 'react'
import { useSize } from '../lib/useSize'
import { dateTime, price as fmtPrice, plural } from '../lib/format'
import type { Candle, StrategyResult } from '../lib/indicators/types'

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
 * Candles with a strategy's overlays and signals.
 *
 * The strategy supplies its own lines, so this component works for any of them:
 * an envelope, a Donchian channel, or whatever comes next. Each signal draws the
 * anatomy the original TradingView indicators use — dashed rail to the target,
 * dotted to the stop, an arrow from entry, and a tick where it worked out.
 */
export function PriceChart({
  candles,
  result,
  visible = 160,
  height = 340,
}: {
  candles: Candle[]
  result: StrategyResult
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
  const lastSignal = result.signals.at(-1)
  const wanted = lastSignal ? Math.max(visible, candles.length - lastSignal.index + 12) : visible
  const span = Math.min(wanted, MAX_VISIBLE, candles.length)
  const start = Math.max(0, candles.length - span)
  const view = candles.slice(start)
  const w = Math.max(width, 300)
  const plotW = w - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < view.length; i++) {
    min = Math.min(min, view[i].low)
    max = Math.max(max, view[i].high)
    for (const o of result.overlays) {
      const v = o.values[start + i]
      if (Number.isFinite(v)) {
        min = Math.min(min, v)
        max = Math.max(max, v)
      }
    }
  }
  const padY = (max - min) * 0.04
  min -= padY
  max += padY

  const slot = plotW / view.length
  const bodyW = Math.max(1, Math.min(slot * 0.62, 12))
  const x = (i: number) => PAD.left + i * slot + slot / 2
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH

  const linePath = (values: number[]) =>
    view
      .map((_, i) => {
        const v = values[start + i]
        return Number.isFinite(v) ? `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}` : ''
      })
      .filter(Boolean)
      .join(' ')

  // A band between two overlays, drawn where both exist.
  const bandFor = (topKey: string, bottomValues: number[]) => {
    const top = result.overlays.find((o) => o.key === topKey)
    if (!top) return ''
    const upperPts: string[] = []
    const lowerPts: string[] = []
    view.forEach((_, i) => {
      const u = top.values[start + i]
      const l = bottomValues[start + i]
      if (!Number.isFinite(u) || !Number.isFinite(l)) return
      upperPts.push(`${x(i).toFixed(1)},${y(u).toFixed(1)}`)
      lowerPts.unshift(`${x(i).toFixed(1)},${y(l).toFixed(1)}`)
    })
    return upperPts.length ? `${upperPts.join(' ')} ${lowerPts.join(' ')}` : ''
  }

  const visibleSignals = result.signals.filter((s) => s.index >= start)
  const hovered = hover !== null ? view[hover] : null

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
        aria-label={`Gráfico de velas con ${plural(visibleSignals.length, 'señal', 'señales')}`}
      >
        <defs>
          {(['long', 'short'] as const).map((side) => (
            <marker
              key={side}
              id={`arrow-${side}`}
              viewBox="0 0 8 8"
              refX={7}
              refY={4}
              markerWidth={5}
              markerHeight={5}
              orient="auto-start-reverse"
            >
              <path d="M0,1 L7,4 L0,7 z" fill={side === 'long' ? 'var(--good)' : 'var(--critical)'} />
            </marker>
          ))}
        </defs>

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

        {result.overlays.map((o) =>
          o.fillTo ? (
            <polygon key={`fill-${o.key}`} points={bandFor(o.fillTo, o.values)} fill="var(--accent)" opacity={0.05} />
          ) : null,
        )}

        {result.overlays.map((o) => (
          <path
            key={o.key}
            d={linePath(o.values)}
            fill="none"
            stroke={o.colour}
            strokeWidth={o.dashed ? 1.2 : 1.5}
            strokeDasharray={o.dashed ? '4 4' : undefined}
            opacity={o.dashed ? 0.7 : 0.55}
          />
        ))}

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
          const colour = long ? 'var(--good)' : 'var(--critical)'
          const endIndex = Math.min(s.closedIndex ?? candles.length - 1, candles.length - 1)
          const xEnd = x(Math.max(endIndex - start, i + 1))
          const marker = long ? y(candles[s.index].low) + 16 : y(candles[s.index].high) - 16
          // Trailing strategies have no fixed target; the exit price is the story.
          const finish = s.target ?? s.closedPrice

          return (
            <g key={`${s.index}-${s.side}`}>
              {finish !== undefined && (
                <>
                  <line
                    x1={x(i)}
                    x2={xEnd}
                    y1={y(finish)}
                    y2={y(finish)}
                    stroke={colour}
                    strokeWidth={1}
                    strokeDasharray="5 4"
                    opacity={0.85}
                  />
                  <line
                    x1={x(i)}
                    x2={xEnd}
                    y1={y(s.entry)}
                    y2={y(finish)}
                    stroke={colour}
                    strokeWidth={1.2}
                    opacity={0.65}
                    markerEnd={`url(#arrow-${s.side})`}
                  />
                </>
              )}
              <line
                x1={x(i)}
                x2={xEnd}
                y1={y(s.stop)}
                y2={y(s.stop)}
                stroke={colour}
                strokeWidth={1}
                strokeDasharray="2 3"
                opacity={0.5}
              />
              <path
                d={long ? `M${x(i)},${marker - 7} l5,8 l-10,0 z` : `M${x(i)},${marker + 7} l5,-8 l-10,0 z`}
                fill={colour}
                stroke="var(--surface-1)"
                strokeWidth={1}
              />
              {s.outcome === 'win' && finish !== undefined && (
                <text
                  x={xEnd}
                  y={long ? y(finish) - 6 : y(finish) + 14}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={700}
                  fill={colour}
                >
                  ✓
                </text>
              )}
            </g>
          )
        })}

        <text x={PAD.left} y={height - 5} fontSize={11} fill="var(--ink-muted)">
          {new Date(view[0].time).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
        </text>
        <text x={w - PAD.right} y={height - 5} textAnchor="end" fontSize={11} fill="var(--ink-muted)">
          {new Date(view.at(-1)!.time).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
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
        </div>
      )}

      <ul className="legend" style={{ marginTop: 10 }}>
        {result.overlays.map((o) => (
          <li key={o.key} className="legend-item">
            <span className="legend-swatch" style={{ background: o.colour }} />
            {o.label}
          </li>
        ))}
        <li className="legend-item">
          <span style={{ color: 'var(--good)' }}>▲</span> Long
          <span style={{ color: 'var(--critical)', marginLeft: 8 }}>▼</span> Short
        </li>
        <li className="legend-item">
          <svg width="24" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="24" y2="4" stroke="var(--ink-secondary)" strokeDasharray="5 4" />
          </svg>
          Salida
        </li>
        <li className="legend-item">
          <svg width="24" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="24" y2="4" stroke="var(--ink-secondary)" strokeDasharray="2 3" />
          </svg>
          Stop
        </li>
      </ul>
    </div>
  )
}
