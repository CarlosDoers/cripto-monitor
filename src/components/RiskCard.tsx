import { useMemo, useState } from 'react'
import { useSize } from '../lib/useSize'
import { axisTick, duration, plural, share, signedUsd, usd } from '../lib/format'
import { drawdowns, MIN_SIMULATION, simulate, type CurvePoint } from '../lib/risk'
import { HELP } from '../lib/glossary'
import { Help } from './ui'

const PAD = { top: 12, right: 12, bottom: 22, left: 58 }

const day = (t: number) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })

/**
 * The realised curve drawn as distance below its own running peak: zero at
 * every new high, a trough for every bad run. The dashed line is the drop one
 * simulated run in twenty exceeds, so a trough that crosses it is the one
 * worth asking about. Values are printed in the card beside it.
 */
function Underwater({ points, bad, height = 120 }: { points: CurvePoint[]; bad?: number; height?: number }) {
  const [ref, width] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const w = Math.max(width, 280)
  const plotW = w - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom

  const deepest = Math.min(...points.map((p) => p.value), bad !== undefined ? -bad : 0)
  const min = deepest * 1.1 || -1
  const x = (i: number) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * plotW : 0)
  const y = (v: number) => PAD.top + (v / min) * plotH

  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const area = `${x(0)},${y(0)} ${line} ${x(points.length - 1)},${y(0)}`
  const hovered = hover !== null ? points[hover] : null

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const i = Math.round(((event.clientX - rect.left - PAD.left) / plotW) * (points.length - 1))
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
        aria-label={`Caída desde el máximo tras cada operación; la peor, ${usd(-deepest)}`}
      >
        {[0, min / 2, min].map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={w - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 0 ? 'var(--baseline)' : 'var(--gridline)'}
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

        <polygon points={area} fill="var(--delta-down)" opacity={0.14} />
        <polyline points={line} fill="none" stroke="var(--delta-down)" strokeWidth={1.5} strokeLinejoin="round" />

        {bad !== undefined && bad > 0 && (
          <g>
            <line
              x1={PAD.left}
              x2={w - PAD.right}
              y1={y(-bad)}
              y2={y(-bad)}
              stroke="var(--ink-secondary)"
              strokeDasharray="4 3"
            />
            <text
              x={w - PAD.right}
              y={y(-bad) - 4}
              textAnchor="end"
              fontSize={10.5}
              fill="var(--ink-secondary)"
            >
              1 de cada 20 simulaciones cae más
            </text>
          </g>
        )}

        <text x={PAD.left} y={height - 5} fontSize={11} fill="var(--ink-muted)">
          {day(points[0].t)}
        </text>
        <text x={w - PAD.right} y={height - 5} textAnchor="end" fontSize={11} fill="var(--ink-muted)">
          {day(points.at(-1)!.t)}
        </text>

        {hovered && (
          <line
            x1={x(hover!)}
            x2={x(hover!)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="var(--ink-muted)"
            strokeDasharray="2 2"
            pointerEvents="none"
          />
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
          <div className="tip-title">{day(hovered.t)}</div>
          <div className="tip-row">
            <span>Bajo el máximo</span>
            <span>{hovered.value < 0 ? usd(-hovered.value) : 'en máximos'}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * ¿Cuánto puede caer? The real worst drop and the current one, next to what
 * the same trades produce by chance, so a bad run can be read against what is
 * normal for this way of trading instead of against the last good week.
 */
export function RiskCard({ curve, pnls, symbols, longestLossStreak }: {
  curve: CurvePoint[]
  pnls: number[]
  /** One per curve point, to name the trade when a single loss was the whole drop. */
  symbols: string[]
  longestLossStreak: number
}) {
  const report = useMemo(() => drawdowns(curve), [curve])
  const sim = useMemo(() => simulate(pnls), [pnls])
  const max = report.max

  if (curve.length < 2) {
    return <p className="muted">Hacen falta al menos dos operaciones cerradas para medir caídas.</p>
  }

  // The reading. Rank against the simulation: inside the typical band, worse
  // than most, or beyond what one run in twenty produces.
  const verdict = !sim || !max
    ? null
    : sim.realRank >= 0.95
      ? { text: `Tu peor caída real (${usd(max.depth)}) es mayor que la de ${share(sim.realRank, 0)} de las simulaciones: más de lo que tu forma de operar explica por mala suerte. Merece mirar qué operaciones la formaron.` }
      : sim.realRank >= 0.75
        ? { text: `Tu peor caída real (${usd(max.depth)}) está en la parte mala de lo normal: solo ${share(sim.worseShare, 0)} de las simulaciones caen más.` }
        : { text: `Tu peor caída real (${usd(max.depth)}) está dentro de lo normal: ${share(sim.worseShare, 0)} de las simulaciones caen más.` }
  // A drop made of one trade is a sizing fact, not a streak: the loss that
  // sets the worst case is a single position, so that is where risk lives.
  const single =
    max && max.trades === 1
      ? `Esa caída fue una sola operación (${symbols[max.troughIndex] ?? 'una posición'}, ${signedUsd(pnls[max.troughIndex] ?? -max.depth)}): tu riesgo está en el tamaño de cada posición más que en las rachas.`
      : max && max.trades > 1
        ? `Se formó a lo largo de ${max.trades} operaciones.`
        : null
  // 5 000 runs cannot resolve below one in 5 000; zero would claim certainty.
  const lossShown =
    sim && sim.lossProbability === 0 ? `< ${share(1 / sim.runs, 2)}` : sim ? share(sim.lossProbability, sim.lossProbability < 0.01 ? 1 : 0) : '—'

  return (
    <>
      <ul className="perf-stats perf-stats--flush">
        <li>
          <span className="metric-label">
            Caída máxima
            <Help label="Caída máxima">{HELP.drawdown}</Help>
          </span>
          <span className={`metric-value ${max ? 'delta--down' : ''}`}>{max ? signedUsd(-max.depth) : '—'}</span>
          <span className="metric-hint">
            {max
              ? max.recoveredAt
                ? `${day(max.peakAt)} → ${day(max.troughAt)} · recuperada en ${duration(max.recoveredAt - max.peakAt)}`
                : `desde el ${day(max.peakAt)} · aún sin recuperar`
              : 'nunca bajó de un máximo'}
          </span>
        </li>
        <li>
          <span className="metric-label">Caída actual</span>
          <span className={`metric-value ${report.current > 0 ? 'delta--down' : ''}`}>
            {report.current > 0 ? signedUsd(-report.current) : 'En máximos'}
          </span>
          <span className="metric-hint">
            {report.current > 0 && report.currentSince
              ? `desde el máximo del ${day(report.currentSince)}`
              : 'el resultado está en su punto más alto'}
          </span>
        </li>
        <li>
          <span className="metric-label">
            Caída esperable
            <Help label="Simulación de Monte Carlo">{HELP.monteCarlo}</Help>
          </span>
          <span className="metric-value">{sim ? signedUsd(-sim.drawdownMedian) : '—'}</span>
          <span className="metric-hint">
            {sim
              ? `${
                  // When one loss dominates, most runs reproduce it to the cent.
                  Math.abs(sim.drawdownMedian + Math.min(0, ...pnls)) < 0.005
                    ? 'la típica es tu mayor pérdida suelta'
                    : `típica en ${sim.length} operaciones`
                } · 1 de cada 20, más de ${usd(sim.drawdown95)}`
              : `hacen falta ${MIN_SIMULATION} operaciones para simular`}
          </span>
        </li>
        <li>
          <span className="metric-label">Acabar en pérdidas</span>
          <span className="metric-value">{lossShown}</span>
          <span className="metric-hint">
            {sim ? `de cada tanda de ${sim.length} operaciones como estas` : 'muestra demasiado pequeña'}
          </span>
        </li>
      </ul>

      <div style={{ marginTop: 16 }}>
        <Underwater points={report.underwater} bad={sim?.drawdown95} />
      </div>

      {sim && (
        <div className="risk-reading">
          {verdict && (
            <p>
              {verdict.text} {single}
            </p>
          )}
          <p>
            Rachas de hasta <strong>{plural(sim.streak95, 'pérdida seguida', 'pérdidas seguidas')}</strong> entran
            en lo normal (la típica, {sim.streakMedian}); la tuya más larga fue de {longestLossStreak}. Una tanda
            típica de {sim.length} operaciones acaba en {signedUsd(sim.totalMedian)}; la peor de cada veinte, en{' '}
            {signedUsd(sim.total5)}.
          </p>
          <p className="sub">
            {sim.runs.toLocaleString('es-ES')} simulaciones remuestreando las operaciones del periodo. Supone que
            cada una es independiente y que el futuro se parece al pasado: describe tu forma de operar, no la
            predice.
          </p>
        </div>
      )}
    </>
  )
}
