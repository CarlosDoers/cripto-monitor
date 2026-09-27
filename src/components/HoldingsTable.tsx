import { useMemo, useState } from 'react'
import { assignColors, OTHER_COLOR } from '../lib/colors'
import { useCandles } from '../lib/queries'
import { num, pct, plural, price, qty, share, usd } from '../lib/format'
import type { Holding } from '../lib/types'
import { Sparkline } from './Sparkline'
import { Delta, EmptyState, SearchInput, TableWrap } from './ui'

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

type SortBy = 'value' | 'balance' | 'change'

/**
 * Below this share of the portfolio a balance is dust. Cartera listed thirteen
 * of them — coins worth cents to a few dollars, from airdrops and leftovers —
 * each printing "0,0 %", and the five that matter were lost among them.
 * Relative, like the Resumen's cut, so it means the same on any account size.
 */
export const DUST = 0.005

export function HoldingsTable({
  holdings,
  limit,
  showSparkline = false,
  showSearch = false,
  foldDust = false,
}: {
  holdings: Holding[]
  limit?: number
  showSparkline?: boolean
  showSearch?: boolean
  /** Fold balances under `DUST` into one expandable row instead of listing them. */
  foldDust?: boolean
}) {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('value')
  const [showDust, setShowDust] = useState(false)

  // Derived from the full list, not the sliced one, so the colours match the
  // allocation chart whether or not this table is truncated.
  const colors = assignColors(holdings.filter((h) => h.usd > 0).map((h) => h.ccy))

  const processed = useMemo(() => {
    let list = [...holdings]
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      list = list.filter((h) => h.ccy.toLowerCase().includes(q))
    }
    if (sortBy === 'value') {
      list.sort((a, b) => b.usd - a.usd)
    } else if (sortBy === 'balance') {
      list.sort((a, b) => b.total - a.total)
    } else if (sortBy === 'change') {
      list.sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
    }
    return limit ? list.slice(0, limit) : list
  }, [holdings, search, sortBy, limit])

  // A search always shows what it finds, dust or not.
  const folding = foldDust && !showDust && !search.trim()
  const dust = folding ? processed.filter((h) => h.weight < DUST) : []
  const rows = folding ? processed.filter((h) => h.weight >= DUST) : processed
  const dustUsd = dust.reduce((sum, h) => sum + h.usd, 0)

  if (holdings.length === 0) {
    return <EmptyState title="No hay activos" hint="Tu cuenta de OKX no tiene saldo registrado." />
  }

  return (
    <>
      {showSearch && (
        <div className="table-controls-bar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar moneda…"
            className="table-search"
          />
          <div className="seg-control">
            <button
              type="button"
              aria-pressed={sortBy === 'value'}
              onClick={() => setSortBy('value')}
            >
              Valor
            </button>
            <button
              type="button"
              aria-pressed={sortBy === 'change'}
              onClick={() => setSortBy('change')}
            >
              Cambio 24 h
            </button>
            <button
              type="button"
              aria-pressed={sortBy === 'balance'}
              onClick={() => setSortBy('balance')}
            >
              Cantidad
            </button>
          </div>
        </div>
      )}

      <TableWrap>
        <table className="data">
          <thead>
            <tr>
              <th>Activo</th>
              <th className="num">Cantidad</th>
              <th className="num">Precio</th>
              <th className="num">Var. 24 h</th>
              {showSparkline && <th>Últimas 48 h</th>}
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
                        · trading {qty(h.trading)} / fondos {qty(h.funding)}
                      </span>
                    )}
                  </td>
                  <td className="num">{qty(h.total)}</td>
                  <td className="num">{h.price !== undefined ? price(h.price) : '—'}</td>
                  <td className="num">
                    {h.change24h !== undefined ? (
                      <Delta ratio={h.change24h} pill>{pct(h.change24h)}</Delta>
                    ) : (
                      '—'
                    )}
                  </td>
                  {showSparkline && (
                    <td>
                      <HoldingSpark ccy={h.ccy} color={color} />
                    </td>
                  )}
                  <td className="num">
                    <strong>{usd(h.usd)}</strong>
                  </td>
                  <td className="num">
                    <span className="rail">
                      <span className="rail-track">
                        <span
                          className="rail-fill"
                          style={{
                            width: `${Math.max(h.weight * 100, 2)}%`,
                            background: color,
                          }}
                        />
                      </span>
                      {share(h.weight)}
                    </span>
                  </td>
                </tr>
              )
            })}
            {dust.length > 0 && (
              <tr className="dust-row">
                <td>
                  <button type="button" className="card-link" onClick={() => setShowDust(true)}>
                    {plural(dust.length, 'saldo residual', 'saldos residuales')} · ver →
                  </button>
                </td>
                <td className="num" colSpan={showSparkline ? 4 : 3}>
                  <span className="sub">cada uno bajo el 0,5 % de la cartera</span>
                </td>
                <td className="num">
                  <strong>{usd(dustUsd)}</strong>
                </td>
                <td className="num">{share(dust.reduce((sum, h) => sum + h.weight, 0))}</td>
              </tr>
            )}
          </tbody>
        </table>

        {processed.length === 0 && (
          <EmptyState
            title="Sin activos con estos filtros"
            hint="Prueba con otro término de búsqueda."
          />
        )}
      </TableWrap>
    </>
  )
}

