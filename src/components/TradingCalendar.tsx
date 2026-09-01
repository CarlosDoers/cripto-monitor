import { useMemo, useState } from 'react'
import { moneyCompact, signedUsd, usd } from '../lib/format'
import type { Trade } from '../lib/performance'

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

interface DayCell {
  date: Date
  key: string
  inMonth: boolean
  pnl: number
  trades: number
  isToday: boolean
}

/**
 * A month of realised PnL, one cell per day, keyed on the day the trade was
 * CLOSED — when the profit or loss was actually realised.
 *
 * Colour encodes sign and magnitude: intensity scales with the day's result
 * relative to the biggest day of the month, so a flat month does not paint
 * itself as dramatic. The amount is printed in every non-empty cell, so the
 * colour never carries the value alone.
 */
export function TradingCalendar({ trades }: { trades: Trade[] }) {
  const [offset, setOffset] = useState(0)

  const byDay = useMemo(() => {
    const map = new Map<string, { pnl: number; trades: number }>()
    for (const t of trades) {
      // Keyed on the CLOSING day when the PnL was realised.
      const d = new Date(t.closedAt || t.openedAt)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const entry = map.get(key) ?? { pnl: 0, trades: 0 }
      entry.pnl += t.pnl
      entry.trades += 1
      map.set(key, entry)
    }
    return map
  }, [trades])

  const { cells, label, monthPnl, monthTrades, maxAbs, canGoForward } = useMemo(() => {
    const now = new Date()
    const cursor = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const year = cursor.getFullYear()
    const month = cursor.getMonth()

    // Monday-first grid: getDay() is Sunday-first.
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    const out: DayCell[] = []
    for (let i = 0; i < firstWeekday; i++) {
      const d = new Date(year, month, i - firstWeekday + 1)
      out.push({ date: d, key: `pad-${i}`, inMonth: false, pnl: 0, trades: 0, isToday: false })
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day)
      const found = byDay.get(`${year}-${month}-${day}`)
      out.push({
        date: d,
        key: `${year}-${month}-${day}`,
        inMonth: true,
        pnl: found?.pnl ?? 0,
        trades: found?.trades ?? 0,
        isToday: d.toDateString() === now.toDateString(),
      })
    }

    const inMonth = out.filter((c) => c.inMonth)
    return {
      cells: out,
      // Only the first letter: `capitalize` in CSS would give "Agosto De 2026".
      label: (() => {
        const raw = cursor.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
        return raw.charAt(0).toUpperCase() + raw.slice(1)
      })(),
      monthPnl: inMonth.reduce((s, c) => s + c.pnl, 0),
      monthTrades: inMonth.reduce((s, c) => s + c.trades, 0),
      maxAbs: Math.max(...inMonth.map((c) => Math.abs(c.pnl)), 1),
      canGoForward: offset < 0,
    }
  }, [byDay, offset])

  return (
    <div className="calendar">
      <div className="calendar-head">
        <div className="calendar-summary">
          <span className={`calendar-total ${monthPnl >= 0 ? 'delta--up' : 'delta--down'}`}>
            {signedUsd(monthPnl)}
          </span>
          <span className="sub">
            {monthTrades === 0
              ? 'sin operaciones'
              : `${monthTrades} ${monthTrades === 1 ? 'operación' : 'operaciones'}`}
          </span>
        </div>
        <div className="calendar-nav">
          <button type="button" className="btn btn--icon" onClick={() => setOffset(offset - 1)} aria-label="Mes anterior">
            ‹
          </button>
          <span className="calendar-month">{label}</span>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => setOffset(offset + 1)}
            disabled={!canGoForward}
            aria-label="Mes siguiente"
          >
            ›
          </button>
        </div>
      </div>

      <div className="calendar-grid" role="grid">
        {WEEKDAYS.map((d) => (
          <span key={d} className="calendar-weekday" role="columnheader">
            {d}
          </span>
        ))}
        {cells.map((cell) => {
          if (!cell.inMonth) return <span key={cell.key} className="calendar-cell is-outside" />
          const has = cell.trades > 0
          // Alpha stays low on purpose: the amount is printed on top in the same
          // hue, and a saturated tile would make its own label unreadable.
          const weight = has ? 0.1 + 0.28 * Math.min(Math.abs(cell.pnl) / maxAbs, 1) : 0
          const positive = cell.pnl >= 0
          return (
            <span
              key={cell.key}
              role="gridcell"
              className={`calendar-cell${has ? ' has-trades' : ''}${cell.isToday ? ' is-today' : ''}`}
              style={
                has
                  ? {
                      background: `color-mix(in srgb, var(--${positive ? 'good' : 'critical'}) ${Math.round(weight * 100)}%, transparent)`,
                      borderColor: `color-mix(in srgb, var(--${positive ? 'good' : 'critical'}) 45%, transparent)`,
                    }
                  : undefined
              }
              title={
                has
                  ? `${cell.date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}: ${usd(cell.pnl)} en ${cell.trades} ${cell.trades === 1 ? 'operación' : 'operaciones'}`
                  : undefined
              }
            >
              <span className="calendar-day">{cell.date.getDate()}</span>
              {/* Primary ink, not the delta colour: the tinted background and the
                  explicit sign already carry the polarity, and a green amount on a
                  green tile drops under the contrast floor on the strongest days. */}
              {has && <span className="calendar-pnl">{moneyCompact(cell.pnl)}</span>}
            </span>
          )
        })}
      </div>

      <p className="calendar-note">
        Calculado desde las posiciones de futuros cerradas que devuelve OKX, imputadas al día en
        que se <strong>cerraron</strong> (cuando se materializó el resultado).
      </p>
    </div>
  )
}
