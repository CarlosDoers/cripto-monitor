import { usePortfolio } from '../lib/portfolio'
import { usePerformance } from '../lib/performance'
import {
  useAlgoOrders,
  useBalance,
  useDcaBots,
  useDcaPositions,
  useGridBots,
  usePositions,
  useValuation,
} from '../lib/queries'
import { num, pct, plural, price, qty, ratio, share, signedUsd, usd, usdCompact } from '../lib/format'
import { AllocationBar } from '../components/AllocationBar'
import { HoldingsTable } from '../components/HoldingsTable'
import { PnlCurve } from '../components/PnlCurve'
import { guardsFor, hasStop, isShort } from '../lib/guards'
import { fuelUsed, liquidationRoom, NEARLY_DRY } from '../lib/bots'
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
  const dcaBots = useDcaBots()
  const gridBots = useGridBots()
  const algos = useAlgoOrders()
  const dcaList = dcaBots.data ?? []
  const botPositions = useDcaPositions(dcaList)

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
  // Under 1 % of equity free is not a rounding detail: an isolated position that
  // turns cannot be topped up, so the only remaining options are close or be
  // liquidated. Relative, because "50 US$ free" means different things on a
  // 500 US$ account and a 50.000 US$ one.
  const locked =
    portfolio.netWorth > 0 && portfolio.freeMargin / portfolio.netWorth < 0.01

  /**
   * What the running bots are worth right now.
   *
   * This is a *slice* of the patrimonio, never an addition to it. Measured
   * against this account: the bots' committed capital plus their PnL came to
   * 1 175,55 US$ and `frozenBal − isoEq` came to 1 175,47 — the same money,
   * eight cents apart. It already sits inside `totalEq`, and inside the
   * `asset-valuation` figure the hero stat prints, so adding it would count it
   * twice.
   */
  const botValue =
    (dcaBots.data ?? []).reduce((sum, b) => sum + num(b.investmentAmt) + num(b.totalPnl), 0) +
    (gridBots.data ?? []).reduce((sum, g) => sum + num(g.investment) + num(g.totalPnl), 0)
  const botPnl =
    (dcaBots.data ?? []).reduce((sum, b) => sum + num(b.totalPnl), 0) +
    (gridBots.data ?? []).reduce((sum, g) => sum + num(g.totalPnl), 0)
  const botCount = (dcaBots.data ?? []).length + (gridBots.data ?? []).length

  /**
   * The Resumen is the view that gets opened, so it has to carry every warning
   * the app raises anywhere — not just its own. Before this, a position with no
   * stop was flagged only in Posiciones and a bot running out of safety orders
   * only in Bots, while this page said "Saludable". Measured the day it changed:
   * the ETH bot sat at 7 of 9 safety orders with liquidation 14 % below its
   * average, showing a green +75 US$, and nothing on this screen said so.
   *
   * Each warning uses the exact rule of the view it comes from (`hasStop`,
   * `NEARLY_DRY`), so the two can never disagree about what counts.
   */
  // Only claimed once the stops have loaded, so a slow request never invents an alarm.
  const unprotected = algos.data
    ? openPositions.filter((p) => !hasStop(guardsFor(p, algos.data)))
    : []
  const botRisk = dcaList
    .map((bot) => {
      const position = botPositions.data?.[bot.algoId]
      return { bot, position, used: fuelUsed(bot, position), room: liquidationRoom(position) }
    })
    .sort((a, b) => b.used - a.used)
  const tightest = botRisk[0]
  const dryBots = botRisk.filter((r) => r.used >= NEARLY_DRY)
  const alarm = atRisk || unprotected.length > 0 || dryBots.length > 0
  const attention: { key: string; text: string; href: string; link: string }[] = [
    ...(atRisk
      ? [{ key: 'margin', href: '#/posiciones', link: 'Ver posiciones', text: `Margen ajustado (${share(marginRatio, 0)}): se acerca al nivel de liquidación.` }]
      : []),
    ...(unprotected.length
      ? [{ key: 'stop', href: '#/posiciones', link: 'Ver posiciones', text: `${plural(unprotected.length, 'posición sin stop', 'posiciones sin stop')} (${unprotected.map((p) => p.instId).join(', ')}): su pérdida solo tiene como límite la liquidación.` }]
      : []),
    ...dryBots.map((r) => ({
      key: `bot-${r.bot.algoId}`,
      href: '#/bots',
      link: 'Ver bots',
      text: `${r.bot.instId} ha gastado ${num(r.position?.fillSafetyOrds)} de ${r.bot.maxSafetyOrds} órdenes de seguridad${r.room !== null ? ` y la liquidación está a un ${share(r.room, 0)} del precio medio` : ''}: si el precio sigue en contra ya no le queda con qué promediar.`,
    })),
    ...(locked && openPositions.length > 0
      ? [{ key: 'free', href: '#/posiciones', link: 'Ver posiciones', text: `Margen libre ${usd(portfolio.freeMargin)}: no queda con qué reforzar una posición que se tuerza.` }]
      : []),
  ]

  /**
   * Dust stays out of the two portfolio blocks. Before, five of the eight rows in
   * "Activos Principales" and four named slices of the legend were coins worth
   * one to four dollars printing "0,0 %", on an account of five figures. Relative
   * rather than a dollar floor, like `locked`, and the omission is stated with
   * its total so nothing disappears silently — Cartera still lists everything.
   */
  const DUST = 0.005
  const mainHoldings = portfolio.holdings.filter((h) => h.weight >= DUST)
  const dust = portfolio.holdings.filter((h) => h.weight < DUST && h.usd > 0)
  const dustUsd = dust.reduce((sum, h) => sum + h.usd, 0)
  const dustNote =
    dust.length > 0 ? ` · ${plural(dust.length, 'saldo', 'saldos')} bajo el 0,5 % fuera (${usd(dustUsd)})` : ''

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
      {attention.length > 0 && (
        <div className={`notice ${alarm ? 'notice--error' : 'notice--warning'}`}>
          <IconAlert />
          <div className="notice-body">
            <p className="notice-title">Requiere atención</p>
            {attention.map((a) => (
              <p key={a.key} className="notice-text">
                {a.text}{' '}
                <a className="card-link" href={a.href}>
                  {a.link} →
                </a>
              </p>
            ))}
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
        {/* Took the slot the 30-day costs had. The strip holds six and no more,
            so a new figure up here means one moves out — costs still live in
            Rendimiento as "Costes totales". */}
        <Stat
          label="En Bots"
          loading={dcaBots.isLoading || gridBots.isLoading}
          value={botCount > 0 ? usd(botValue) : '—'}
          badge={
            botCount > 0 ? (
              <Badge variant="live" pulse>
                {plural(botCount, 'activo', 'activos')}
              </Badge>
            ) : undefined
          }
          foot={
            botCount > 0 ? (
              <span>
                <DeltaValue value={botPnl}>{signedUsd(botPnl)}</DeltaValue> · ya dentro del
                patrimonio
              </span>
            ) : (
              <span>Ningún bot en marcha</span>
            )
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
            <Badge variant={alarm ? 'warn' : marginRatio > 0 || botCount > 0 ? 'buy' : 'neutral'}>
              <IconShield />
              {atRisk
                ? 'Riesgo Alto'
                : alarm
                  ? 'Revisar'
                  : marginRatio > 0 || botCount > 0
                    ? 'Saludable'
                    : 'Sin Riesgo'}
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
              <span>Margen libre</span>
              <strong>
                {portfolio.isLoading ? '—' : usd(portfolio.freeMargin)}
                {!portfolio.isLoading && locked && (
                  <>
                    {' '}
                    <span className="sub">todo comprometido</span>
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
              <span>Bot más apurado</span>
              <strong>
                {tightest ? (
                  <>
                    <span className={tightest.used >= NEARLY_DRY ? 'delta--down' : undefined}>
                      {num(tightest.position?.fillSafetyOrds)}/{tightest.bot.maxSafetyOrds}
                    </span>{' '}
                    <span className="sub">
                      {tightest.bot.instId.split('-')[0]} órdenes de seguridad
                      {tightest.room !== null && ` · liq. a ${share(tightest.room, 0)}`}
                    </span>
                  </>
                ) : dcaBots.isLoading ? (
                  '—'
                ) : (
                  'ninguno'
                )}
              </strong>
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
          subtitle={`Desglose porcentual por activo en USD${dustNote}`}
          dimmed={portfolio.isFetching && !portfolio.isLoading}
        >
          {portfolio.isLoading ? (
            <Skeleton height={32} />
          ) : (
            <AllocationBar holdings={mainHoldings} />
          )}
        </Card>

      <Card
        title="Activos Principales"
        subtitle={`Top 8 por valor en la cuenta${dustNote}`}
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
          <HoldingsTable holdings={mainHoldings} limit={8} showSparkline />
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
                      {/* Contract prices, not money: price() keeps the precision
                          the instrument trades at and never converts to euros,
                          so they match Posiciones to the digit. */}
                      <td className="num">{num(p.avgPx) > 0 ? price(num(p.avgPx)) : '—'}</td>
                      <td className="num">{num(p.markPx) > 0 ? price(num(p.markPx)) : '—'}</td>
                      <td className="num">{liq > 0 ? price(liq) : '—'}</td>
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

