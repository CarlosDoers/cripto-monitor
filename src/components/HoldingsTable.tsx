import { assignColors, OTHER_COLOR } from '../lib/colors'
import { useCandles } from '../lib/queries'
import { num, pct, price, qty, share, usd } from '../lib/format'
import type { Holding } from '../lib/types'
import { Sparkline } from './Sparkline'
import { Delta, EmptyState } from './ui'

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'USD'])

function HoldingSpark({ ccy, color }: { ccy: string; color: string }) {
  const instId = STABLES.has(ccy) ? undefined : `${ccy}-USDT`
  const { data } = useCandles(instId)

  // OKX returns candles newest-first; the sparkline reads left-to-right.
  const closes = (data ?? [])
    .map((candle) => num(candle[4]))
    .reverse()
    .filter((v) => v > 0)

  if (closes.length < 2) return <div style={{ width: 84, height: 26 }} />
  return <Sparkline values={closes} color={color} />
}

export function HoldingsTable({
  holdings,
  limit,
  showSparkline = false,
}: {
  holdings: Holding[]
  limit?: number
  showSparkline?: boolean
}) {
  // Derived from the full list, not the sliced one, so the colours match the
  // allocation chart whether or not this table is truncated.
  const colors = assignColors(holdings.filter((h) => h.usd > 0).map((h) => h.ccy))
  const rows = limit ? holdings.slice(0, limit) : holdings

  if (rows.length === 0) {
    return <EmptyState title="No hay activos" hint="Tu cuenta de OKX no tiene saldo." />
  }

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Activo</th>
            <th className="num">Cantidad</th>
            <th className="num">Precio</th>
            <th className="num">24 h</th>
            {showSparkline && <th>Tendencia 48 h</th>}
            <th className="num">Valor</th>
            <th className="num">Peso</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => {
            const color = colors.get(h.ccy) ?? OTHER_COLOR
            return (
              <tr key={h.ccy}>
                <td>
                  <span className="ccy">
                    <span className="ccy-dot" style={{ background: color }} />
                    {h.ccy}
                  </span>
                  {h.funding > 0 && h.trading > 0 && (
                    <span className="sub">
                      {' '}
                      · trading {qty(h.trading)} / funding {qty(h.funding)}
                    </span>
                  )}
                </td>
                <td className="num">{qty(h.total)}</td>
                <td className="num">{h.price !== undefined ? price(h.price) : '—'}</td>
                <td className="num">
                  {h.change24h !== undefined ? (
                    <Delta ratio={h.change24h}>{pct(h.change24h)}</Delta>
                  ) : (
                    '—'
                  )}
                </td>
                {showSparkline && (
                  <td>
                    <HoldingSpark ccy={h.ccy} color={color} />
                  </td>
                )}
                <td className="num">{usd(h.usd)}</td>
                <td className="num">
                  <span className="rail">
                    <span className="rail-track">
                      <span
                        className="rail-fill"
                        style={{ width: `${Math.max(h.weight * 100, 2)}%` }}
                      />
                    </span>
                    {share(h.weight)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
