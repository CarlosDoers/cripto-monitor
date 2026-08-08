import { usePortfolio } from '../lib/portfolio'
import { useBalance, usePositions } from '../lib/queries'
import { num, pct, qty, share, signedUsd, usd, usdCompact } from '../lib/format'
import { AllocationBar } from '../components/AllocationBar'
import { HoldingsTable } from '../components/HoldingsTable'
import { Card, Delta, DeltaValue, ErrorNotice, Skeleton, Stat, TableSkeleton } from '../components/ui'

/**
 * OKX reports the account margin ratio as a multiple (1.0 = the maintenance
 * requirement), and shows it as a percentage in its own UI. Below ~150 % the
 * account is close to liquidation.
 */
function marginRisk(ratio: number): string {
  if (ratio < 1.5) return 'Riesgo de liquidación'
  if (ratio < 3) return 'Precaución'
  return 'Saludable'
}

export function Overview() {
  const portfolio = usePortfolio()
  const balance = useBalance()
  const positions = usePositions()

  const account = balance.data?.[0]
  const openPositions = positions.data ?? []
  const unrealised = openPositions.reduce((sum, p) => sum + num(p.upl), 0)
  const marginRatio = num(account?.mgnRatio)
  const hasLeverage = openPositions.length > 0 && marginRatio > 0

  if (portfolio.error) {
    return (
      <ErrorNotice
        title="No se pudieron cargar los datos de la cuenta"
        message={portfolio.error.message}
      />
    )
  }

  return (
    <>
      <div className="kpi-row">
        <Stat
          label="Patrimonio total"
          hero
          loading={portfolio.isLoading}
          value={usdCompact(portfolio.netWorth)}
          foot={
            portfolio.change24h !== undefined ? (
              <>
                <Delta ratio={portfolio.change24h} />
                <span>24 h</span>
              </>
            ) : undefined
          }
        />
        <Stat
          label="Cuenta de trading"
          loading={balance.isLoading}
          value={usdCompact(num(account?.totalEq))}
          foot={<span>{portfolio.holdings.length} activos</span>}
        />
        <Stat
          label="PnL no realizado"
          loading={positions.isLoading}
          value={<DeltaValue value={unrealised}>{signedUsd(unrealised)}</DeltaValue>}
          foot={
            <span>
              {openPositions.length}{' '}
              {openPositions.length === 1 ? 'posición abierta' : 'posiciones abiertas'}
            </span>
          }
        />
        <Stat
          label="Ratio de margen"
          loading={balance.isLoading}
          value={hasLeverage ? share(marginRatio, 0) : '—'}
          foot={
            <span>{hasLeverage ? marginRisk(marginRatio) : 'Sin posiciones apalancadas'}</span>
          }
        />
      </div>

      <Card
        title="Distribución de la cartera"
        subtitle="Por valor en USD"
        dimmed={portfolio.isFetching && !portfolio.isLoading}
      >
        {portfolio.isLoading ? (
          <Skeleton height={28} />
        ) : (
          <AllocationBar holdings={portfolio.holdings} />
        )}
      </Card>

      <Card
        title="Principales activos"
        subtitle="Los 8 mayores por valor"
        flush
        dimmed={portfolio.isFetching && !portfolio.isLoading}
      >
        {portfolio.isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : (
          <HoldingsTable holdings={portfolio.holdings} limit={8} />
        )}
      </Card>

      {openPositions.length > 0 && (
        <Card
          title="Posiciones abiertas"
          flush
          dimmed={positions.isFetching && !positions.isLoading}
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Instrumento</th>
                  <th>Lado</th>
                  <th className="num">Tamaño</th>
                  <th className="num">Precio medio</th>
                  <th className="num">Marca</th>
                  <th className="num">PnL</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.slice(0, 6).map((p) => {
                  const upl = num(p.upl)
                  return (
                    <tr key={p.posId}>
                      <td>
                        <span className="ccy">{p.instId}</span>
                        {p.lever && <span className="sub"> {p.lever}×</span>}
                      </td>
                      <td>
                        <span
                          className={`badge badge--${p.posSide === 'short' ? 'sell' : 'buy'}`}
                        >
                          {p.posSide === 'short' ? 'Corto' : 'Largo'}
                        </span>
                      </td>
                      <td className="num">{qty(num(p.pos))}</td>
                      <td className="num">{num(p.avgPx) > 0 ? usd(num(p.avgPx)) : '—'}</td>
                      <td className="num">{num(p.markPx) > 0 ? usd(num(p.markPx)) : '—'}</td>
                      <td className="num">
                        <DeltaValue value={upl}>
                          {signedUsd(upl)}
                          {num(p.uplRatio) !== 0 && (
                            <span className="sub"> ({pct(num(p.uplRatio))})</span>
                          )}
                        </DeltaValue>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}
