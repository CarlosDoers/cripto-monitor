import { usePortfolio } from '../lib/portfolio'
import { usePerformance } from '../lib/performance'
import { useBalance, usePositions } from '../lib/queries'
import { num, pct, qty, share, signedUsd, usd, usdCompact } from '../lib/format'
import { AllocationBar } from '../components/AllocationBar'
import { HoldingsTable } from '../components/HoldingsTable'
import { PnlCurve } from '../components/PnlCurve'
import { IconAlert } from '../components/icons'
import {
  Card,
  Delta,
  DeltaValue,
  ErrorNotice,
  Skeleton,
  Stat,
  TableSkeleton,
} from '../components/ui'

/**
 * OKX reports the account margin ratio as a multiple of the maintenance
 * requirement, and shows it as a percentage in its own UI. Under ~150 % the
 * account is close to liquidation.
 */
const MARGIN_WARN = 3

export function Overview() {
  const portfolio = usePortfolio()
  const balance = useBalance()
  const positions = usePositions()
  const perf = usePerformance('30d')

  const account = balance.data?.[0]
  const openPositions = positions.data ?? []
  const unrealised = openPositions.reduce((sum, p) => sum + num(p.upl), 0)
  const marginRatio = num(account?.mgnRatio)
  const atRisk = openPositions.length > 0 && marginRatio > 0 && marginRatio < MARGIN_WARN

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
      {/* Emphasis: the margin ratio only earns space when it means something. */}
      {atRisk && (
        <div className="notice notice--error">
          <IconAlert />
          <div className="notice-body">
            <p className="notice-title">Margen ajustado: {share(marginRatio, 0)}</p>
            <p className="notice-text">
              Con {openPositions.length}{' '}
              {openPositions.length === 1 ? 'posición abierta' : 'posiciones abiertas'}, el margen
              se acerca al nivel de liquidación.
            </p>
          </div>
        </div>
      )}

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
          label="Operaciones ganadas"
          loading={perf.isLoading}
          value={perf.count > 0 ? share(perf.winRate, 1) : '—'}
          foot={
            <span>
              {perf.count > 0 ? `${perf.wins} de ${perf.wins + perf.losses} · 30 días` : '30 días'}
            </span>
          }
        />
        <Stat
          label="PnL realizado"
          loading={perf.isLoading}
          value={<DeltaValue value={perf.netPnl}>{signedUsd(perf.netPnl)}</DeltaValue>}
          foot={<span>30 días · {perf.count} operaciones</span>}
        />
      </div>

      {perf.count > 1 && (
        <Card
          title="Evolución del resultado"
          subtitle="PnL acumulado, últimos 30 días"
          dimmed={perf.isFetching && !perf.isLoading}
          action={
            <a className="card-link" href="#/rendimiento">
              Ver rendimiento →
            </a>
          }
        >
          <PnlCurve points={perf.equityCurve} trades={perf.trades} height={160} />
        </Card>
      )}

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
        action={
          <a className="card-link" href="#/cartera">
            Ver cartera →
          </a>
        }
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
          subtitle={
            marginRatio > 0 ? `Ratio de margen ${share(marginRatio, 0)}` : undefined
          }
          flush
          dimmed={positions.isFetching && !positions.isLoading}
          action={
            <a className="card-link" href="#/posiciones">
              Ver posiciones →
            </a>
          }
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
