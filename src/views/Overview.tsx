import { usePortfolio } from '../lib/portfolio'
import { usePerformance } from '../lib/performance'
import { useBalance, usePositions, useValuation } from '../lib/queries'
import { num, pct, qty, ratio, share, signedUsd, usd, usdCompact } from '../lib/format'
import { AllocationBar } from '../components/AllocationBar'
import { HoldingsTable } from '../components/HoldingsTable'
import { PnlCurve } from '../components/PnlCurve'
import { isShort } from '../lib/guards'
import { IconAlert, IconShield } from '../components/icons'
import {
  Badge,
  Card,
  Delta,
  DeltaValue,
  ErrorNotice,
  Skeleton,
  Stat,
  TableSkeleton,
  TableWrap,
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
  const valuation = useValuation()
  const perf = usePerformance('30d')

  const account = balance.data?.[0]
  const valDetails = valuation.data?.[0]?.details
  const openPositions = positions.data ?? []
  const unrealised = openPositions.reduce((sum, p) => sum + num(p.upl), 0)
  const notional = openPositions.reduce((sum, p) => sum + num(p.notionalUsd), 0)
  // Con margen aislado OKX deja vacío el ratio de la cuenta, y leerlo sin más
  // pintaba "100 %" con una posición al 8,1 de mantenimiento. El número honesto
  // entonces es el peor de las posiciones abiertas.
  const accountRatio = num(account?.mgnRatio)
  const positionRatios = openPositions.map((p) => num(p.mgnRatio)).filter((r) => r > 0)
  const marginRatio =
    accountRatio > 0 ? accountRatio : positionRatios.length ? Math.min(...positionRatios) : 0
  const atRisk = openPositions.length > 0 && marginRatio > 0 && marginRatio < MARGIN_WARN

  const tradingBal = num(valDetails?.trading)
  const fundingBal = num(valDetails?.funding)
  const earnBal = num(valDetails?.earn)

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
      {/* Alert banner if margin risk is high */}
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

      {/* One dense strip instead of a hero card plus a KPI row: the old layout
          printed the net worth twice, once in each. */}
      <div className="kpi-row">
        <Stat
          label="Patrimonio Total"
          hero
          loading={portfolio.isLoading}
          value={usd(portfolio.netWorth)}
          badge={
            portfolio.change24h !== undefined ? (
              <Delta ratio={portfolio.change24h}>{pct(portfolio.change24h)}</Delta>
            ) : undefined
          }
          foot={
            <span>
              Trading {usdCompact(tradingBal)} · Fondos {usdCompact(fundingBal)}
              {earnBal > 0 ? ` · Earn ${usdCompact(earnBal)}` : ''}
            </span>
          }
        />
        <Stat
          label="PnL No Realizado"
          loading={positions.isLoading}
          value={<DeltaValue value={unrealised}>{signedUsd(unrealised)}</DeltaValue>}
          foot={
            <span>
              {openPositions.length}{' '}
              {openPositions.length === 1 ? 'posición abierta' : 'posiciones abiertas'}
            </span>
          }
          badge={
            openPositions.length > 0 ? (
              <Badge variant="live" pulse>
                En vivo
              </Badge>
            ) : undefined
          }
        />
        <Stat
          label="PnL Realizado (30d)"
          loading={perf.isLoading}
          value={<DeltaValue value={perf.netPnl}>{signedUsd(perf.netPnl)}</DeltaValue>}
          foot={<span>{perf.count} operaciones cerradas</span>}
        />
        <Stat
          label="Tasa de Aciertos"
          loading={perf.isLoading}
          value={perf.count > 0 ? share(perf.winRate, 1) : '—'}
          foot={
            <span>
              {perf.count > 0 ? `${perf.wins} ganadas · ${perf.losses} perdidas` : '30 días'}
            </span>
          }
        />
        <Stat
          label="Factor de Beneficio"
          loading={perf.isLoading}
          value={
            perf.count > 0 && Number.isFinite(perf.profitFactor) ? ratio(perf.profitFactor) : '—'
          }
          foot={
            <span>
              {perf.count > 0
                ? `media ${signedUsd(perf.avgWin)} / ${signedUsd(-perf.avgLoss)}`
                : '30 días'}
            </span>
          }
        />
        <Stat
          label="Costes (30d)"
          loading={perf.isLoading}
          value={<DeltaValue value={perf.totalCosts}>{signedUsd(perf.totalCosts)}</DeltaValue>}
          foot={
            <span>
              {perf.grossPnl > 0
                ? `${share(Math.abs(perf.totalCosts) / perf.grossPnl, 1)} del resultado bruto`
                : 'comisiones y financiación'}
            </span>
          }
        />
      </div>

      <div className="grid-2">
        <Card
          title="Curva de Resultado"
          subtitle={`Últimos 30 días · ${signedUsd(perf.netPnl)}`}
          dimmed={perf.isFetching && !perf.isLoading}
        >
          {perf.isLoading ? (
            <Skeleton height={140} />
          ) : (
            <PnlCurve points={perf.equityCurve} trades={perf.trades} height={140} />
          )}
        </Card>

        <Card
          title="Salud de la Cuenta"
          action={
            <Badge variant={atRisk ? 'warn' : marginRatio > 0 ? 'buy' : 'neutral'}>
              <IconShield />
              {atRisk ? 'Riesgo Alto' : marginRatio > 0 ? 'Saludable' : 'Sin Riesgo'}
            </Badge>
          }
        >
          <ul className="health-list">
            <li>
              <span>Ratio de margen</span>
              <strong>
                {marginRatio > 0 ? share(marginRatio, 0) : openPositions.length ? '—' : 'sin riesgo'}
                {accountRatio === 0 && positionRatios.length > 0 && (
                  <>
                    {' '}
                    <span className="sub">peor posición</span>
                  </>
                )}
              </strong>
            </li>
            <li>
              <span>Posiciones abiertas</span>
              <strong>{openPositions.length}</strong>
            </li>
            <li>
              <span>Exposición nocional</span>
              <strong>{notional > 0 ? usdCompact(notional) : '—'}</strong>
            </li>
            <li>
              <span>Esperanza por operación</span>
              <strong>{perf.count > 0 ? signedUsd(perf.expectancy) : '—'}</strong>
            </li>
          </ul>
        </Card>
      </div>

      <Card
          title="Distribución de la Cartera"
          subtitle="Desglose porcentual por activo en USD"
          dimmed={portfolio.isFetching && !portfolio.isLoading}
        >
          {portfolio.isLoading ? (
            <Skeleton height={32} />
          ) : (
            <AllocationBar holdings={portfolio.holdings} />
          )}
        </Card>

      <Card
        title="Activos Principales"
        subtitle="Top 8 por capitalización en la cuenta"
        flush
        dimmed={portfolio.isFetching && !portfolio.isLoading}
        action={
          <a className="card-link" href="#/cartera">
            Ver cartera completa →
          </a>
        }
      >
        {portfolio.isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : (
          <HoldingsTable holdings={portfolio.holdings} limit={8} showSparkline />
        )}
      </Card>

      {/* Open Positions Card */}
      {openPositions.length > 0 && (
        <Card
          title="Posiciones Abiertas en Tiempo Real"
          subtitle={
            marginRatio > 0 ? `Ratio de margen ${share(marginRatio, 0)} · ${openPositions.length} abiertas` : undefined
          }
          flush
          dimmed={positions.isFetching && !positions.isLoading}
          action={
            <a className="card-link" href="#/posiciones">
              Gestionar posiciones →
            </a>
          }
        >
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Instrumento</th>
                  <th>Lado</th>
                  <th className="num">Tamaño</th>
                  <th className="num">Precio Entrada</th>
                  <th className="num">Precio Marca</th>
                  <th className="num">Precio Liq.</th>
                  <th className="num">PnL No Realizado</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.slice(0, 6).map((p) => {
                  const upl = num(p.upl)
                  const liq = num(p.liqPx)
                  return (
                    <tr key={p.posId}>
                      <td>
                        <span className="ccy">{p.instId}</span>
                        {p.lever && <span className="sub"> {p.lever}×</span>}
                      </td>
                      <td>
                        <Badge variant={isShort(p) ? 'sell' : 'buy'}>
                          {isShort(p) ? 'Corto' : 'Largo'}
                        </Badge>
                      </td>
                      <td className="num">{qty(num(p.pos))}</td>
                      <td className="num">{num(p.avgPx) > 0 ? usd(num(p.avgPx)) : '—'}</td>
                      <td className="num">{num(p.markPx) > 0 ? usd(num(p.markPx)) : '—'}</td>
                      <td className="num">{liq > 0 ? usd(liq) : '—'}</td>
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
          </TableWrap>
        </Card>
      )}
    </>
  )
}

