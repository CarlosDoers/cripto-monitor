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
import {
  num,
  pct,
  plural,
  price,
  qty,
  ratio,
  share,
  shownAmount,
  signedUsd,
  signedUsdOrEur,
  timeAgo,
  usd,
  usdCompact,
} from '../lib/format'
import { useAccountResult } from '../lib/result'
import { AllocationBar } from '../components/AllocationBar'
import { DUST, HoldingsTable } from '../components/HoldingsTable'
import { ProtectionBadge } from '../components/PositionGuard'
import { PnlCurve } from '../components/PnlCurve'
import { Opportunities } from '../components/Opportunities'
import { guardsFor, hasStop, isShort, LIQ_DANGER, LIQ_WATCH, liquidationDistance, positionSize } from '../lib/guards'
import { fuelUsed, liquidationRoom, NEARLY_DRY } from '../lib/bots'
import { IconAlert, IconShield } from '../components/icons'
import {
  Badge,
  Card,
  DeltaValue,
  ErrorNotice,
  Skeleton,
  Stat,
  TableSkeleton,
  TableWrap,
  Help,
} from '../components/ui'
import { HELP } from '../lib/glossary'

/**
 * OKX reports the account margin ratio as a multiple of the maintenance
 * requirement, and shows it as a percentage in its own UI. Under ~150 % the
 * account is close to liquidation.
 */
const MARGIN_WARN = 3

/** Rows in the positions card; the rest are one click away in Posiciones. */
const SHOWN_POSITIONS = 6

export function Overview() {
  const portfolio = usePortfolio()
  const balance = useBalance()
  const positions = usePositions()
  const valuation = useValuation()
  const perf = usePerformance('30d')
  const allTime = usePerformance('all')
  const account$ = useAccountResult()
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
      ? [{ key: 'margin', href: '#/encurso', link: 'Ver en curso', text: `Margen ajustado (${share(marginRatio, 0)}): se acerca al nivel de liquidación.` }]
      : []),
    ...(unprotected.length
      ? [{ key: 'stop', href: '#/encurso', link: 'Ver en curso', text: `${plural(unprotected.length, 'posición sin stop', 'posiciones sin stop')} (${unprotected.map((p) => p.instId).join(', ')}): su pérdida solo tiene como límite la liquidación.` }]
      : []),
    ...dryBots.map((r) => ({
      key: `bot-${r.bot.algoId}`,
      href: '#/encurso',
      link: 'Ver en curso',
      text: `${r.bot.instId} ha gastado ${num(r.position?.fillSafetyOrds)} de ${r.bot.maxSafetyOrds} órdenes de seguridad${r.room !== null ? ` y la liquidación está a un ${share(r.room, 0)} del precio medio` : ''}: si el precio sigue en contra ya no le queda con qué promediar.`,
    })),
    ...(locked && openPositions.length > 0
      ? [{ key: 'free', href: '#/encurso', link: 'Ver en curso', text: `Margen libre ${usd(portfolio.freeMargin)}: no queda con qué reforzar una posición que se tuerza.` }]
      : []),
  ]

  /**
   * Dust stays out of the two portfolio blocks. Before, five of the eight rows in
   * "Activos Principales" and four named slices of the legend were coins worth
   * one to four dollars printing "0,0 %", on an account of five figures. Relative
   * rather than a dollar floor, like `locked`, and the omission is stated with
   * its total so nothing disappears silently — Cartera still lists everything.
   */
  const mainHoldings = portfolio.holdings.filter((h) => h.weight >= DUST)
  const dust = portfolio.holdings.filter((h) => h.weight < DUST && h.usd > 0)
  const dustUsd = dust.reduce((sum, h) => sum + h.usd, 0)
  const dustNote =
    dust.length > 0 ? ` · ${plural(dust.length, 'saldo', 'saldos')} bajo el 0,5 % fuera (${usd(dustUsd)})` : ''

  /**
   * What the spot holdings' prices did in 24 h, in dollars. This used to sit
   * as a bare "+1,05 %" badge on Patrimonio Total, where it read as the net
   * worth's own move — but it is only the price change of the coins held,
   * weighted by their size, with stablecoins at zero. It knows nothing of the
   * derivatives (the account's real risk) or of what was closed today. On the
   * day it was caught, +1,05 % was SOL's +4 % on a quarter of the portfolio,
   * next to −111 US$ of open futures PnL it did not include.
   */
  const spotMove = portfolio.holdings.reduce(
    (sum, h) => (h.change24h ? sum + (h.usd * h.change24h) / (1 + h.change24h) : sum),
    0,
  )
  // Effective leverage: exposure against everything the account owns. 1× means
  // the positions move as much money as the whole patrimonio.
  const leverage = portfolio.netWorth > 0 ? notional / portfolio.netWorth : 0

  const lastTrade = allTime.trades.at(-1)

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
      <Summary
        loading={account$.isLoading || perf.isLoading || positions.isLoading}
        result={account$.noFlows ? null : { usd: account$.result, eur: account$.resultEur, partial: account$.partial }}
        month={{ pnl: perf.netPnl, count: perf.count }}
        last={lastTrade}
        open={{ positions: openPositions.length, unrealised, bots: botCount, botPnl }}
        free={portfolio.freeMargin}
        warnings={attention.length}
      />

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
          printed the net worth twice, once in each. Win rate and profit factor
          moved to Rendimiento: they describe how the trading went, and this
          strip answers how the account is doing. */}
      <div className="kpi-row">
        <Stat
          label="Patrimonio total"
          help={HELP.netWorth}
          hero
          loading={portfolio.isLoading}
          value={usd(portfolio.netWorth)}
          foot={
            <span>
              Trading {usdCompact(tradingBal)} · Fondos {usdCompact(fundingBal)}
              {earnBal > 0 ? ` · Earn ${usdCompact(earnBal)}` : ''}
            </span>
          }
        />
        <Stat
          label="Resultado total"
          help={HELP.totalResult}
          loading={account$.isLoading}
          value={
            account$.noFlows ? (
              '—'
            ) : (
              <DeltaValue value={shownAmount(account$.result, account$.resultEur)}>
                {signedUsdOrEur(account$.result, account$.resultEur)}
              </DeltaValue>
            )
          }
          badge={account$.partial ? <Badge variant="warn">parcial</Badge> : undefined}
          foot={
            <span>
              {account$.noFlows ? 'sin depósitos con los que comparar' : 'patrimonio menos lo que has aportado'}
            </span>
          }
        />
        <Stat
          label="Ganancia abierta"
          help={HELP.unrealisedPnl}
          loading={positions.isLoading}
          value={
            openPositions.length > 0 ? (
              <DeltaValue value={unrealised}>{signedUsd(unrealised)}</DeltaValue>
            ) : (
              '—'
            )
          }
          foot={
            <span>
              {openPositions.length > 0
                ? plural(openPositions.length, 'posición abierta', 'posiciones abiertas')
                : 'nada abierto ahora'}
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
          label="Cerrado en 30 días"
          help={HELP.realisedPnl30}
          loading={perf.isLoading}
          value={
            perf.count > 0 ? <DeltaValue value={perf.netPnl}>{signedUsd(perf.netPnl)}</DeltaValue> : '—'
          }
          foot={
            <span>
              {perf.count > 0
                ? `${plural(perf.count, 'operación', 'operaciones')} · ${perf.wins} con ganancia`
                : lastTrade
                  ? `la última cerró ${timeAgo(lastTrade.closedAt)}`
                  : 'ninguna operación cerrada'}
            </span>
          }
        />
        {/* The bots are what the user wants to see on opening the app. Their
            value is a slice of the patrimonio, never an addition to it. */}
        <Stat
          label="En bots"
          help={HELP.bots}
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
              <span>ningún bot en marcha</span>
            )
          }
        />
      </div>

      {/* What to look at next, right under how the account stands: the live
          signals of the strongest measured strategy. */}
      <Opportunities />

      <div className="grid-2">
        <Card
          title="Curva de resultado"
          subtitle={perf.isLoading ? 'Últimos 30 días' : `Últimos 30 días · ${signedUsd(perf.netPnl)}`}
          dimmed={perf.isFetching && !perf.isLoading}
        >
          {perf.isLoading ? (
            <Skeleton height={140} />
          ) : (
            <PnlCurve points={perf.equityCurve} trades={perf.trades} height={140} />
          )}
        </Card>

        <Card
          title="Salud de la cuenta"
          action={
            // Any live warning turns it to Revisar, not only the alarms: with
            // free margin exhausted it used to read "Saludable" right under a
            // notice saying the account needed attention.
            <Badge variant={attention.length > 0 ? 'warn' : marginRatio > 0 || botCount > 0 ? 'buy' : 'neutral'}>
              <IconShield />
              {atRisk
                ? 'Riesgo alto'
                : attention.length > 0
                  ? 'Revisar'
                  : marginRatio > 0 || botCount > 0
                    ? 'Saludable'
                    : 'Sin riesgo'}
            </Badge>
          }
        >
          <ul className="health-list">
            <li>
              <span>
                Ratio de margen
                <Help label="Ratio de margen">{HELP.marginRatio}</Help>
              </span>
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
              <span>
                Dinero disponible
                <Help label="Dinero disponible">{HELP.freeMargin}</Help>
              </span>
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
              <span>
                Tamaño total (nocional)
                <Help label="Tamaño total">{HELP.notional}</Help>
              </span>
              <strong>
                {notional > 0 ? usdCompact(notional) : '—'}
                {leverage > 0 && (
                  <>
                    {' '}
                    <span className={`sub ${leverage >= 3 ? 'delta--down' : ''}`}>
                      {ratio(leverage, 1)}× el patrimonio
                    </span>
                  </>
                )}
              </strong>
            </li>
            <li>
              <span>
                Bot más apurado
                <Help label="Bot más apurado">{HELP.tightestBot}</Help>
              </span>
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
              <span>
                Esperanza por operación
                <Help label="Esperanza por operación">{HELP.expectancy}</Help>
              </span>
              <strong>{perf.count > 0 ? signedUsd(perf.expectancy) : '—'}</strong>
            </li>
          </ul>
        </Card>
      </div>

      <Card
        title="Distribución de la cartera"
        subtitle={`¿En qué está tu dinero?${dustNote}`}
        dimmed={portfolio.isFetching && !portfolio.isLoading}
      >
        {portfolio.isLoading ? <Skeleton height={32} /> : <AllocationBar holdings={mainHoldings} />}
      </Card>

      <Card
        title="Activos principales"
        subtitle={`Top 8 por valor en la cuenta${dustNote}${
          portfolio.change24h !== undefined && Math.abs(spotMove) >= 0.01
            ? ` · en 24 h sus precios mueven ${signedUsd(spotMove)} (${pct(portfolio.change24h)})`
            : ''
        }`}
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
          title="Posiciones abiertas"
          subtitle={
            [
              marginRatio > 0 ? `Ratio de margen ${share(marginRatio, 0)}` : null,
              openPositions.length > SHOWN_POSITIONS
                ? `las ${SHOWN_POSITIONS} mayores de ${openPositions.length}`
                : plural(openPositions.length, 'abierta', 'abiertas'),
            ]
              .filter(Boolean)
              .join(' · ')
          }
          flush
          dimmed={positions.isFetching && !positions.isLoading}
          action={
            <a className="card-link" href="#/encurso">
              Ver todo lo abierto →
            </a>
          }
        >
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Instrumento</th>
                  <th>Lado</th>
                  <th className="num">
                    Tamaño
                    <Help label="Tamaño">{HELP.notional}</Help>
                  </th>
                  <th className="num">Entrada</th>
                  <th className="num">
                    Marca
                    <Help label="Precio marca">{HELP.markPrice}</Help>
                  </th>
                  <th className="num">
                    Liquidación
                    <Help label="Precio de liquidación">{HELP.liqPrice}</Help>
                  </th>
                  <th>
                    Protección
                    <Help label="Protección">{HELP.protection}</Help>
                  </th>
                  <th className="num">Ganancia abierta</th>
                </tr>
              </thead>
              <tbody>
                {[...openPositions]
                  .sort((a, b) => num(b.notionalUsd) - num(a.notionalUsd))
                  .slice(0, SHOWN_POSITIONS)
                  .map((p) => {
                  const upl = num(p.upl)
                  const liq = num(p.liqPx)
                  const room = liquidationDistance(p)
                  const size = positionSize(p)
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
                      {/* Dollars first: a count of contracts says nothing until
                          it is multiplied by a contract value that differs per
                          instrument, so it rides along as the unit it is. */}
                      {/* One child per cell: below 720 px a cell is a flex row
                          that pushes its children to opposite edges. */}
                      <td className="num">
                        <span>
                          {num(p.notionalUsd) > 0 ? usd(num(p.notionalUsd)) : '—'}
                          <span className="sub">
                            {' '}
                            · {qty(size.amount)} {size.unit}
                          </span>
                        </span>
                      </td>
                      {/* Contract prices, not money: price() keeps the precision
                          the instrument trades at and never converts to euros,
                          so they match Posiciones to the digit. */}
                      <td className="num">{num(p.avgPx) > 0 ? price(num(p.avgPx)) : '—'}</td>
                      <td className="num">{num(p.markPx) > 0 ? price(num(p.markPx)) : '—'}</td>
                      {/* The price alone does not say whether it is close; the
                          distance does, in the thresholds Posiciones uses. */}
                      <td className="num">
                        <span>
                          {liq > 0 ? price(liq) : '—'}
                          {room !== null && (
                            <>
                              {' '}
                              <span
                                className={`badge badge--${room < LIQ_DANGER ? 'sell' : room < LIQ_WATCH ? 'warn' : 'neutral'}`}
                              >
                                a {share(room, 0)}
                              </span>
                            </>
                          )}
                        </span>
                      </td>
                      {/* The notice above names the positions without a stop;
                          this is where the eye goes to find them. */}
                      <td>
                        <ProtectionBadge position={p} />
                      </td>
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


type Last = { symbol: string; closedAt: number }

/**
 * The answer to "¿cómo voy?" in one paragraph, before any figure. The KPI strip
 * holds the same numbers, but five numbers in a row still have to be read and
 * combined; a sentence has already done that. Each clause changes with the
 * state instead of printing zeros: with nothing open it says what money is
 * free, with no trade this month it says when the last one closed.
 */
function Summary({
  loading,
  result,
  month,
  last,
  open,
  free,
  warnings,
}: {
  loading: boolean
  result: { usd: number; eur: number; partial: boolean } | null
  month: { pnl: number; count: number }
  last: Last | undefined
  open: { positions: number; unrealised: number; bots: number; botPnl: number }
  free: number
  warnings: number
}) {
  if (loading) return <div className="summary"><Skeleton height={20} /></div>

  const shown = result ? shownAmount(result.usd, result.eur) : 0
  const openParts = [
    open.positions > 0 &&
      `${plural(open.positions, 'posición abierta', 'posiciones abiertas')} (${signedUsd(open.unrealised)})`,
    open.bots > 0 && `${plural(open.bots, 'bot en marcha', 'bots en marcha')} (${signedUsd(open.botPnl)})`,
  ].filter(Boolean)

  return (
    <div className="summary">
      <p>
        {result && (
          <>
            {shown >= 0 ? 'Has ganado ' : 'Llevas una pérdida de '}
            <DeltaValue value={shown}>
              <strong>{signedUsdOrEur(Math.abs(result.usd), Math.abs(result.eur)).replace(/^\+/, '')}</strong>
            </DeltaValue>{' '}
            desde que empezaste{result.partial ? ' (cifra parcial: falta algún depósito por valorar)' : ''}.{' '}
          </>
        )}
        {month.count > 0 ? (
          <>
            En los últimos 30 días,{' '}
            <DeltaValue value={month.pnl}>
              <strong>{signedUsd(month.pnl)}</strong>
            </DeltaValue>{' '}
            en {plural(month.count, 'operación cerrada', 'operaciones cerradas')}.{' '}
          </>
        ) : last ? (
          <>No has cerrado nada en 30 días; la última operación fue {last.symbol}, {timeAgo(last.closedAt)}. </>
        ) : null}
        {openParts.length > 0 ? (
          <>Ahora tienes {openParts.join(' y ')}.</>
        ) : (
          <>
            Ahora no tienes nada abierto: <strong>{usd(free)}</strong> están disponibles.
          </>
        )}
        {warnings > 0 && <> Hay {plural(warnings, 'aviso', 'avisos')} que revisar justo debajo.</>}
      </p>
    </div>
  )
}
