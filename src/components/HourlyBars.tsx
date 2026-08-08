import { useState } from 'react'
import { MIN_SAMPLE, type TimeBucket } from '../lib/performance'
import { plural, share, signedUsd } from '../lib/format'

/**
 * Net PnL by hour of entry, as columns above and below a zero baseline.
 *
 * All 24 hours are drawn even when empty, so gaps read as "no trades here"
 * rather than compressing the day. Buckets under MIN_SAMPLE trades are drawn
 * faded and marked in the tooltip: with two or three trades a 100 % win rate
 * is noise, and the chart should not invite that reading.
 */
export function HourlyBars({ buckets }: { buckets: TimeBucket[] }) {
  const [hover, setHover] = useState<TimeBucket | null>(null)

  const active = buckets.filter((b) => b.trades > 0)
  if (active.length === 0) return <p className="muted">Sin operaciones en este periodo.</p>

  // Split the plot in proportion to the actual range, so a day that is mostly
  // profitable does not waste half its height on an empty negative band.
  const maxPositive = Math.max(0, ...buckets.map((b) => b.pnl))
  const maxNegative = Math.max(0, ...buckets.map((b) => -b.pnl))
  const bound = Math.max(maxPositive, maxNegative, 1)
  const upShare = Math.max(maxPositive, bound * 0.18)
  const downShare = Math.max(maxNegative, bound * 0.18)

  return (
    <div className="hourly">
      <div
        className="hourly-plot"
        onMouseLeave={() => setHover(null)}
        style={{ gridTemplateRows: `${upShare}fr 1px ${downShare}fr` }}
      >
        {buckets.map((b) => {
          // Relative to its own half of the plot, which is already scaled above.
          const height = (Math.abs(b.pnl) / (b.pnl >= 0 ? upShare : downShare)) * 100
          const positive = b.pnl >= 0
          return (
            <div
              key={b.index}
              className={`hourly-col${b.trades === 0 ? ' is-empty' : ''}${
                b.trades > 0 && !b.reliable ? ' is-thin' : ''
              }`}
              onMouseEnter={() => setHover(b)}
              title={`${b.label} · ${plural(b.trades, 'operación', 'operaciones')}`}
            >
              <span className="hourly-up">
                {positive && b.pnl !== 0 && (
                  <span
                    className="hourly-bar"
                    style={{ height: `${Math.min(Math.max(height, 2), 100)}%`, background: 'var(--good)' }}
                  />
                )}
              </span>
              <span className="hourly-axis" />
              <span className="hourly-down">
                {!positive && (
                  <span
                    className="hourly-bar hourly-bar--down"
                    style={{ height: `${Math.min(Math.max(height, 2), 100)}%`, background: 'var(--critical)' }}
                  />
                )}
              </span>
            </div>
          )
        })}
      </div>

      <div className="hourly-ticks" aria-hidden="true">
        {[0, 6, 12, 18, 23].map((h) => (
          <span key={h} style={{ left: `${((h + 0.5) / 24) * 100}%` }}>
            {h}h
          </span>
        ))}
      </div>

      {/* Table twin: the chart is never the only way to read these numbers. */}
      <details className="hourly-table">
        <summary>Ver los datos por hora</summary>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Hora</th>
                <th className="num">Operaciones</th>
                <th className="num">Ganadas</th>
                <th className="num">Acierto</th>
                <th className="num">PnL neto</th>
              </tr>
            </thead>
            <tbody>
              {active.map((b) => (
                <tr key={b.index}>
                  <td>{b.label}</td>
                  <td className="num">{b.trades}</td>
                  <td className="num">{b.wins}</td>
                  <td className="num">{b.reliable ? share(b.winRate, 0) : '—'}</td>
                  <td className={`num ${b.pnl >= 0 ? 'delta--up' : 'delta--down'}`}>
                    {signedUsd(b.pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {hover && hover.trades > 0 && (
        <div className="hourly-readout">
          <strong>{hover.label}</strong>
          <span>{plural(hover.trades, 'operación', 'operaciones')}</span>
          <span className={hover.pnl >= 0 ? 'delta--up' : 'delta--down'}>
            {signedUsd(hover.pnl)}
          </span>
          <span>
            {hover.reliable
              ? `${share(hover.winRate, 0)} de acierto`
              : `muestra corta (< ${MIN_SAMPLE})`}
          </span>
        </div>
      )}
    </div>
  )
}
