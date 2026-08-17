import { usePortfolio } from '../lib/portfolio'
import { usePerformance } from '../lib/performance'
import { useBalance, usePositions, useValuation } from '../lib/queries'
import { num, pct, qty, share, signedUsd, usd, usdCompact } from '../lib/format'
import { AllocationBar } from '../components/AllocationBar'
import { HoldingsTable } from '../components/HoldingsTable'
import { PnlCurve } from '../components/PnlCurve'
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
  const marginRatio = num(account?.mgnRatio)
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

      {/* Main Hero Card: Net Worth + Account Health & Account Breakdown */}
      <section className="overview-hero">
        <div className="overview-hero__intro">
          <div className="overview-hero__eyebrow">
            <span className="live-pulse-dot" />
            <span className="page-overline">Patrimonio Global</span>
          </div>
          <div className="overview-hero__value-row">
            <h2 className="overview-hero__value">
              {portfolio.isLoading ? <Skeleton height={42} width={180} /> : usd(portfolio.netWorth)}
            </h2>
            {portfolio.change24h !== undefined && (
              <Delta ratio={portfolio.change24h} pill>
                {pct(portfolio.change24h)} 24h
              </Delta>
            )}
          </div>
          <div className="overview-hero__sub-balances">
            <div className="sub-bal-pill">
              <span className="sub-bal-dot" style={{ background: 'var(--series-1)' }} />
              <span className="sub-bal-label">Trading:</span>
              <strong className="sub-bal-val">{usdCompact(tradingBal)}</strong>
            </div>
            <div className="sub-bal-pill">
              <span className="sub-bal-dot" style={{ background: 'var(--series-3)' }} />
              <span className="sub-bal-label">Fondos:</span>
              <strong className="sub-bal-val">{usdCompact(fundingBal)}</strong>
            </div>
            {earnBal > 0 && (
              <div className="sub-bal-pill">
                <span className="sub-bal-dot" style={{ background: 'var(--series-4)' }} />
                <span className="sub-bal-label">Earn:</span>
                <strong className="sub-bal-val">{usdCompact(earnBal)}</strong>
              </div>
            )}
          </div>
        </div>

        <div className="overview-hero__chart">
          <div className="hero-chart-head">
            <span className="metric-label">Curva 30 Días</span>
            <strong className={perf.netPnl >= 0 ? 'delta--up' : 'delta--down'}>
              {signedUsd(perf.netPnl)}
            </strong>
          </div>
          {perf.isLoading ? (
            <Skeleton height={100} />
          ) : (
            <PnlCurve points={perf.equityCurve} trades={perf.trades} height={100} />
          )}
        </div>

        <div className="overview-hero__health">
          <div className="overview-health-head">
            <span className="metric-label">Salud de la Cuenta</span>
            <Badge variant={atRisk ? 'warn' : marginRatio > 0 ? 'buy' : 'neutral'}>
              <IconShield />
              {atRisk ? 'Riesgo Alto' : marginRatio > 0 ? 'Saludable' : 'Sin Riesgo'}
            </Badge>
          </div>
          <ul className="health-list">
            <li>
              <span>Ratio de margen</span>
              <strong>{marginRatio > 0 ? share(marginRatio, 0) : '100%'}</strong>
            </li>
            <li>
              <span>Posiciones</span>
              <strong>{openPositions.length} activas</strong>
            </li>
            <li>
              <span>Tasa de acierto</span>
              <strong>{perf.count > 0 ? share(perf.winRate, 1) : '—'}</strong>
            </li>
          </ul>
        </div>
      </section>

      {/* KPI Stats Row */}
      <div className="kpi-row">
        <Stat
          label="Patrimonio Total"
          hero
          glow
          loading={portfolio.isLoading}
          value={usdCompact(portfolio.netWorth)}
          foot={
            portfolio.change24h !== undefined ? (
              <>
                <Delta ratio={portfolio.change24h} />
                <span>en las últimas 24 horas</span>
              </>
            ) : undefined
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
          label="PnL Realizado (30d)"
          loading={perf.isLoading}
          value={<DeltaValue value={perf.netPnl}>{signedUsd(perf.netPnl)}</DeltaValue>}
          foot={<span>{perf.count} operaciones cerradas</span>}
        />
      </div>

      {/* Allocation and Assets Grid */}
      <div className="overview-grid">
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
      </div>

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
                        <Badge variant={p.posSide === 'short' ? 'sell' : 'buy'}>
                          {p.posSide === 'short' ? 'Corto' : 'Largo'}
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

