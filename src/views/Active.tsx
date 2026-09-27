import { useDcaBots, useGridBots, useOpenOrders, usePositions } from '../lib/queries'
import { usePortfolio } from '../lib/portfolio'
import { usePerformance } from '../lib/performance'
import { dateTime, num, pct, plural, signedUsd, timeAgo, usd } from '../lib/format'
import { Card, DeltaValue, Stat } from '../components/ui'
import { HELP } from '../lib/glossary'
import { Positions } from './Positions'
import { Bots } from './Bots'
import { OpenOrders } from './Orders'

/**
 * *En curso*: everything that is open right now — positions, bots, resting
 * orders. They used to be three sections, and on a quiet day each showed a
 * strip of four zeros above an empty table. Here the figures appear only when
 * something is open, and with nothing open the page says what happened last
 * and how much money is free, which is what someone opening it wants to know.
 */
export function Active() {
  const positions = usePositions()
  const dca = useDcaBots()
  const grid = useGridBots()
  const orders = useOpenOrders()
  const portfolio = usePortfolio()
  const perf = usePerformance('all')

  const openPositions = positions.data ?? []
  const bots = [...(dca.data ?? []), ...(grid.data ?? [])]
  const openOrders = orders.data ?? []
  const loading = positions.isLoading || dca.isLoading || grid.isLoading || orders.isLoading

  const unrealised = openPositions.reduce((s, p) => s + num(p.upl), 0)
  const notional = openPositions.reduce((s, p) => s + num(p.notionalUsd), 0)
  const botPnl =
    (dca.data ?? []).reduce((s, b) => s + num(b.totalPnl), 0) +
    (grid.data ?? []).reduce((s, g) => s + num(g.totalPnl), 0)
  const botCapital =
    (dca.data ?? []).reduce((s, b) => s + num(b.investmentAmt), 0) +
    (grid.data ?? []).reduce((s, g) => s + num(g.investment), 0)
  const anything = openPositions.length + bots.length + openOrders.length > 0
  const last = perf.trades.at(-1)

  return (
    <>
      {!loading && !anything ? (
        <Card title="Nada abierto ahora mismo">
          <div className="prose idle">
            <p>
              No tienes posiciones, bots ni órdenes pendientes.{' '}
              {!portfolio.isLoading && (
                <>
                  Tienes <strong>{usd(portfolio.freeMargin)}</strong> disponibles para operar.
                </>
              )}
            </p>
            {last && (
              <p>
                Lo último que cerraste fue <strong>{last.symbol}</strong>{' '}
                {last.direction === 'short' ? 'en corto' : 'en largo'}, {timeAgo(last.closedAt)} (
                {dateTime(last.closedAt)}), con un resultado de{' '}
                <DeltaValue value={last.pnl}>{signedUsd(last.pnl)}</DeltaValue>
                {Number.isFinite(last.pnlRatio) && last.pnlRatio !== 0 && <> ({pct(last.pnlRatio)} sobre el margen)</>}.
              </p>
            )}
            <p className="sub">
              Lo ya cerrado está en <a className="card-link" href="#/historial">Historial</a> y su análisis en{' '}
              <a className="card-link" href="#/rendimiento">Rendimiento</a>. Para buscar la próxima
              operación: <a className="card-link" href="#/estrategias">Estrategias</a> y{' '}
              <a className="card-link" href="#/screener">Screener</a>.
            </p>
          </div>
        </Card>
      ) : (
        <div className="kpi-row">
          <Stat
            label="Ganancia abierta"
            help={HELP.unrealisedPnl}
            hero
            loading={loading}
            value={<DeltaValue value={unrealised + botPnl}>{signedUsd(unrealised + botPnl)}</DeltaValue>}
            foot={<span>posiciones {signedUsd(unrealised)} · bots {signedUsd(botPnl)}</span>}
          />
          <Stat
            label="Posiciones"
            help={HELP.notional}
            loading={loading}
            value={String(openPositions.length)}
            foot={<span>{openPositions.length ? `${usd(notional)} de tamaño total` : 'ninguna abierta'}</span>}
          />
          <Stat
            label="Bots"
            help={HELP.committed}
            loading={loading}
            value={String(bots.length)}
            foot={<span>{bots.length ? `${usd(botCapital)} comprometidos` : 'ninguno en marcha'}</span>}
          />
          <Stat
            label="Órdenes pendientes"
            loading={loading}
            value={String(openOrders.length)}
            foot={<span>{plural(openOrders.length, 'orden en el libro', 'órdenes en el libro')}</span>}
          />
          <Stat
            label="Dinero disponible"
            help={HELP.freeMargin}
            loading={portfolio.isLoading}
            value={usd(portfolio.freeMargin)}
            foot={<span>para abrir o reforzar posiciones</span>}
          />
        </div>
      )}

      <Positions embedded />
      <Bots embedded />
      <OpenOrders embedded />
    </>
  )
}
