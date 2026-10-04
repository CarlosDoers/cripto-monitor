import { useMemo, useState } from 'react'
import { num, signedUsd, usd } from '../lib/format'
import type { Trade } from '../lib/performance'
import type { Position } from '../lib/types'
import { useSize } from '../lib/useSize'

/**
 * Small charts for the Resumen's figures. Each one draws the very number it
 * sits under, never a stand-in: a curve behind the net worth would have to be
 * invented, because OKX keeps no history of it.
 *
 * Bars are `<span>`s and therefore carry `display: block` in the CSS — an
 * inline span ignores width and height and silently never draws.
 */

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const dayLabel = (d: Date) => d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * One bar per day for the last `days`, above the line for a positive day and
 * below for a negative one, keyed on the closing day like the calendar. The
 * line under the bars is the readout: hovering or tapping a bar names it, and
 * otherwise it names the latest day with a result.
 */
export function DailyBars({ trades, days = 30 }: { trades: Trade[]; days?: number }) {
  const [active, setActive] = useState<number | null>(null)

  const bars = useMemo(() => {
    const byDay = new Map<string, { pnl: number; count: number }>()
    for (const t of trades) {
      const k = dayKey(new Date(t.closedAt || t.openedAt))
      const e = byDay.get(k) ?? { pnl: 0, count: 0 }
      e.pnl += t.pnl
      e.count += 1
      byDay.set(k, e)
    }
    const today = new Date()
    return Array.from({ length: days }, (_, i) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i))
      const e = byDay.get(dayKey(date))
      return { date, pnl: e?.pnl ?? 0, count: e?.count ?? 0 }
    })
  }, [trades, days])

  const max = Math.max(...bars.map((b) => Math.abs(b.pnl)), 1)
  const lastTraded = [...bars].reverse().findIndex((b) => b.count > 0)
  const shown = active ?? (lastTraded >= 0 ? bars.length - 1 - lastTraded : null)
  const pick = shown !== null ? bars[shown] : null

  return (
    <div className="mini-daily" onPointerLeave={() => setActive(null)}>
      <div
        className="mini-daily-bars"
        role="img"
        aria-label={`Resultado cerrado por día, últimos ${days} días`}
      >
        {bars.map((b, i) => {
          const h = b.count ? Math.max(2, (Math.abs(b.pnl) / max) * 100) : 0
          return (
            <span
              key={i}
              className={`mini-daily-slot${i === shown ? ' is-active' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => setActive(i)}
            >
              <span className="mini-daily-half">
                {b.pnl > 0 && <span className="mini-daily-bar is-up" style={{ height: `${h}%` }} />}
              </span>
              <span className="mini-daily-half is-down">
                {b.pnl < 0 && <span className="mini-daily-bar is-down" style={{ height: `${h}%` }} />}
              </span>
            </span>
          )
        })}
      </div>
      <p className="mini-readout">
        {pick ? (
          <>
            {dayLabel(pick.date)}:{' '}
            {pick.count ? (
              <>
                <strong className={pick.pnl >= 0 ? 'delta--up' : 'delta--down'}>{signedUsd(pick.pnl)}</strong> ·{' '}
                {pick.count} {pick.count === 1 ? 'operación' : 'operaciones'}
              </>
            ) : (
              'sin operaciones'
            )}
          </>
        ) : (
          'sin operaciones en el periodo'
        )}
      </p>
    </div>
  )
}

/**
 * The open PnL split by position: a bar each, growing right for a gain and
 * left for a loss from a shared centre, with the amount beside it. Four at
 * most; the rest are counted.
 */
export function PositionBars({ positions }: { positions: Position[] }) {
  const rows = [...positions]
    .map((p) => ({ id: p.instId, symbol: p.instId.split('-')[0], upl: num(p.upl) }))
    .sort((a, b) => Math.abs(b.upl) - Math.abs(a.upl))
  const shown = rows.slice(0, 4)
  const max = Math.max(...shown.map((r) => Math.abs(r.upl)), 1)
  return (
    <ul className="mini-pos" aria-label="Ganancia abierta por posición">
      {shown.map((r) => {
        const w = `${Math.max(2, (Math.abs(r.upl) / max) * 100)}%`
        return (
          <li key={r.id}>
            <span className="mini-pos-sym">{r.symbol}</span>
            <span className="mini-pos-track">
              <span className="mini-pos-half">
                {r.upl < 0 && <span className="mini-pos-bar is-down" style={{ width: w }} />}
              </span>
              <span className="mini-pos-half is-right">
                {r.upl > 0 && <span className="mini-pos-bar is-up" style={{ width: w }} />}
              </span>
            </span>
            <span className={`mini-pos-val ${r.upl >= 0 ? 'delta--up' : 'delta--down'}`}>{signedUsd(r.upl)}</span>
          </li>
        )
      })}
      {rows.length > shown.length && <li className="mini-pos-more">y {rows.length - shown.length} más</li>}
    </ul>
  )
}

/**
 * A whole split into two parts, side by side, with a 2 px surface gap — the
 * net worth as what was put in and what it made, or, after a loss, as what is
 * left and what went.
 */
export function SplitBar({
  parts,
  label,
}: {
  parts: { key: string; value: number; tone: 'base' | 'up' | 'down' }[]
  label: string
}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0)
  if (!(total > 0)) return null
  return (
    <div className="split-bar" role="img" aria-label={label}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span
            key={p.key}
            className={`split-bar-part is-${p.tone}`}
            style={{ flexGrow: p.value / total }}
            title={`${p.key}: ${usd(p.value)}`}
          />
        ))}
    </div>
  )
}

/**
 * The net worth day by day, from the history the app records itself (OKX keeps
 * none). A thin line in ink, not a PnL colour: the net worth moves with
 * deposits as much as with results, so up is not a gain. Its label says when
 * the record starts, so a short line is not read as the account's whole life.
 */
export function NetWorthTrail({ points }: { points: { date: string; netWorth: number }[] }) {
  const [ref, width] = useSize<HTMLDivElement>()
  const height = 34
  const values = points.map((p) => p.netWorth)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * (width - 4) + 2 : width / 2)
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join('')
  const first = points[0]
  const last = points.at(-1)!
  const since = new Date(`${first.date}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })

  return (
    <div className="networth-trail">
      <p className="networth-trail-label">
        Patrimonio diario desde el {since}
        <span className="sub">
          {' '}
          · {usd(first.netWorth)} → {usd(last.netWorth)}
        </span>
      </p>
      <div ref={ref} className="networth-trail-plot">
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`Patrimonio diario: de ${usd(first.netWorth)} el ${since} a ${usd(last.netWorth)} hoy, ${points.length} días`}>
            <path d={line} fill="none" stroke="var(--ink-secondary)" strokeWidth={1.5} />
            <circle cx={x(points.length - 1)} cy={y(last.netWorth)} r={2.5} fill="var(--ink-primary)" />
          </svg>
        )}
      </div>
    </div>
  )
}
