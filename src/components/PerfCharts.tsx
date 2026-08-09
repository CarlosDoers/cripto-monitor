import { share, signedUsd } from '../lib/format'

/**
 * Wins against losses. Two segments, each directly labelled, separated by a 2px
 * surface gap — the counts are readable without relying on the colours.
 */
export function WinLossBar({ wins, losses }: { wins: number; losses: number }) {
  const total = wins + losses
  if (total === 0) return <p className="muted">Sin operaciones cerradas.</p>

  const winShare = wins / total

  return (
    <div className="winloss">
      <div className="winloss-track" role="img" aria-label={`${wins} ganadoras, ${losses} perdedoras`}>
        {wins > 0 && (
          <div className="winloss-seg winloss-seg--win" style={{ flexGrow: wins }}>
            {winShare > 0.12 && <span>{wins}</span>}
          </div>
        )}
        {losses > 0 && (
          <div className="winloss-seg winloss-seg--loss" style={{ flexGrow: losses }}>
            {1 - winShare > 0.12 && <span>{losses}</span>}
          </div>
        )}
      </div>
      <div className="winloss-legend">
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--good)' }} />
          Ganadoras <span className="legend-value">{wins} · {share(winShare)}</span>
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--critical)' }} />
          Perdedoras <span className="legend-value">{losses} · {share(1 - winShare)}</span>
        </span>
      </div>
    </div>
  )
}

export interface DivergingRow {
  key: string
  label: string
  value: number
  meta?: string
}

/**
 * Values above and below a zero baseline. The axis sits where zero falls in the
 * range, so bar length is comparable across rows and the sign is carried by
 * direction as well as colour. Every row prints its own value.
 */
export function DivergingBars({
  rows,
  formatValue = signedUsd,
}: {
  rows: DivergingRow[]
  /** Defaults to currency; pass another formatter when the values are not money. */
  formatValue?: (value: number) => string
}) {
  if (rows.length === 0) return <p className="muted">Sin datos en este periodo.</p>

  // The zero line sits where zero actually falls in the range, rather than at a
  // fixed midpoint: one shared scale for both arms, and no half-empty track
  // when the data leans heavily one way.
  const maxPositive = Math.max(0, ...rows.map((r) => r.value))
  const maxNegative = Math.max(0, ...rows.map((r) => -r.value))
  const span = maxPositive + maxNegative || 1
  const zeroPct = (maxNegative / span) * 100

  return (
    <ul className="diverging">
      {rows.map((row) => {
        const pct = (Math.abs(row.value) / span) * 100
        const positive = row.value >= 0
        return (
          <li key={row.key} className="diverging-row">
            <span className="diverging-label">
              {row.label}
              {row.meta && <span className="sub"> {row.meta}</span>}
            </span>
            <span className="diverging-track">
              <span className="diverging-zero" style={{ left: `${zeroPct}%` }} />
              <span
                className="diverging-bar"
                style={{
                  left: positive ? `${zeroPct}%` : `${zeroPct - pct}%`,
                  width: `${Math.max(pct, 0.6)}%`,
                  background: positive ? 'var(--good)' : 'var(--critical)',
                  borderRadius: positive ? '0 3px 3px 0' : '3px 0 0 3px',
                }}
              />
            </span>
            <span className={`diverging-value ${positive ? 'delta--up' : 'delta--down'}`}>
              {formatValue(row.value)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Average win against average loss, drawn on one shared scale so the asymmetry
 * is visible at a glance — the number that decides whether a win rate is enough.
 */
export function AvgCompare({ avgWin, avgLoss }: { avgWin: number; avgLoss: number }) {
  const bound = Math.max(avgWin, avgLoss, 1)
  const rows = [
    { label: 'Ganancia media', value: avgWin, color: 'var(--good)' },
    { label: 'Pérdida media', value: -avgLoss, color: 'var(--critical)' },
  ]

  return (
    <ul className="avg-compare">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="avg-label">{r.label}</span>
          <span className="avg-track">
            <span
              className="avg-bar"
              style={{ width: `${(Math.abs(r.value) / bound) * 100}%`, background: r.color }}
            />
          </span>
          <span className={`avg-value ${r.value >= 0 ? 'delta--up' : 'delta--down'}`}>
            {signedUsd(r.value)}
          </span>
        </li>
      ))}
    </ul>
  )
}
