import { useState } from 'react'
import {
  feeShareOfGrid,
  gridLiquidationRoom,
  gridPlace,
  gridStep,
  netPerArbitrage,
  nextLevels,
  rangePosition,
  stopNow,
} from '../lib/bots'
import { dateTime, duration, num, pct, plural, price, qty, ratio, share, signedUsd, timeAgo, usd } from '../lib/format'
import { HELP } from '../lib/glossary'
import { LIQ_DANGER, LIQ_WATCH } from '../lib/guards'
import { useGridOrders } from '../lib/queries'
import type { GridBot, GridPosition } from '../lib/types'
import { Badge, Card, DeltaValue, Help, TableWrap } from './ui'

const DIRECTION: Record<string, { label: string; variant: 'buy' | 'sell' | 'neutral' }> = {
  long: { label: 'Largo', variant: 'buy' },
  short: { label: 'Corto', variant: 'sell' },
  neutral: { label: 'Neutral', variant: 'neutral' },
}

interface Mark {
  key: string
  label: string
  value: number
  tone: 'price' | 'liq' | 'edge' | 'avg'
}

/**
 * The range on a line: floor and ceiling as a band, the live price, the
 * position's average and the liquidation. Placed by percentage like
 * `PositionRisk`, and with the same rule for labels: ticks may overlap, labels
 * may not, so they are placed by priority — price and liquidation first — and
 * a label that would collide is dropped (its tick stays).
 */
function GridRange({ bot, mark, avg }: { bot: GridBot; mark: number; avg?: number }) {
  const min = num(bot.minPx)
  const max = num(bot.maxPx)
  const liq = num(bot.liqPx)
  const points = [min, max, mark, ...(liq > 0 ? [liq] : []), ...(avg ? [avg] : [])].filter((x) => x > 0)
  const lo = Math.min(...points)
  const hi = Math.max(...points)
  const pad = (hi - lo) * 0.04 || hi * 0.01
  const at = (x: number) => ((x - (lo - pad)) / (hi + pad - (lo - pad))) * 100

  const marks: Mark[] = [
    { key: 'price', label: `Ahora ${price(mark)}`, value: mark, tone: 'price' as const },
    ...(liq > 0 ? [{ key: 'liq', label: `Liquidación ${price(liq)}`, value: liq, tone: 'liq' as const }] : []),
    { key: 'min', label: `Mín. ${price(min)}`, value: min, tone: 'edge' as const },
    { key: 'max', label: `Máx. ${price(max)}`, value: max, tone: 'edge' as const },
    ...(avg ? [{ key: 'avg', label: `Medio ${price(avg)}`, value: avg, tone: 'avg' as const }] : []),
  ]
  const placed: number[] = []
  const labelled = new Set<string>()
  for (const m of marks) {
    const x = at(m.value)
    if (placed.every((p) => Math.abs(p - x) > 17)) {
      placed.push(x)
      labelled.add(m.key)
    }
  }

  return (
    <div className="grid-range" role="img" aria-label={marks.map((m) => m.label).join(', ')}>
      <div className="grid-range-track">
        <span className="grid-range-band" style={{ left: `${at(min)}%`, width: `${at(max) - at(min)}%` }} />
        {marks.map((m) => (
          <span key={m.key} className={`grid-range-tick is-${m.tone}`} style={{ left: `${at(m.value)}%` }} />
        ))}
      </div>
      <div className="grid-range-labels">
        {marks
          .filter((m) => labelled.has(m.key))
          .map((m) => {
            const x = at(m.value)
            // Labels near an edge grow inwards instead of spilling out of the card.
            const align = x < 12 ? 'start' : x > 88 ? 'end' : 'center'
            return (
              <span key={m.key} className={`grid-range-label is-${m.tone} is-${align}`} style={{ left: `${x}%` }}>
                {m.label}
              </span>
            )
          })}
      </div>
    </div>
  )
}

/** The latest executions, fetched only when the panel is opened. */
function Fills({ bot }: { bot: GridBot }) {
  const [open, setOpen] = useState(false)
  const fills = useGridOrders(bot, 'filled', open)
  // OKX lists them by when the order was placed; what matters is when it filled.
  const rows = [...(fills.data ?? [])].sort((a, b) => num(b.uTime) - num(a.uTime)).slice(0, 12)
  return (
    <details className="bot-fills" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Últimas ejecuciones</summary>
      {fills.isLoading ? (
        <p className="sub">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="sub">Todavía no ha ejecutado ninguna orden.</p>
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>Lado</th>
                <th className="num">Precio</th>
                <th className="num">Tamaño</th>
                <th className="num">Comisión</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const coins = num(o.accFillSz || o.sz) * (num(o.ctVal) || 1)
                return (
                  <tr key={o.ordId}>
                    <td>{dateTime(num(o.uTime))}</td>
                    <td>
                      <Badge variant={o.side === 'buy' ? 'buy' : 'sell'}>{o.side === 'buy' ? 'Compra' : 'Venta'}</Badge>
                    </td>
                    <td className="num">{price(num(o.avgPx) || num(o.px))}</td>
                    <td className="num">
                      <span>
                        {qty(coins)} <span className="sub">{bot.instId.split('-')[0]}</span>
                      </span>
                    </td>
                    <td className="num">
                      <span>
                        {qty(Math.abs(num(o.fee)))}{' '}
                        {/* On X-Perps OKX names the contract family here ("USD_UM_XPERP"): the fee is in dollars. */}
                        <span className="sub">{o.feeCcy.startsWith('USD') ? 'US$' : o.feeCcy}</span>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </details>
  )
}

/**
 * One grid bot, read the way it works: where price is in its range, what the
 * arbitrages have made against what the fees took, what position it holds and
 * how far that position is from liquidation.
 */
export function GridBotCard({
  bot,
  position,
  mark,
  makerFee,
  takerFee,
}: {
  bot: GridBot
  position: GridPosition | undefined
  mark: number | undefined
  /** The account's maker rate, as a positive fraction (0.0002 = 0,02 %). */
  makerFee: number
  /** And its taker rate: what closing the position at market pays. */
  takerFee: number
}) {
  const live = useGridOrders(bot, 'live')
  const now = mark || num(position?.markPx)
  const symbol = bot.instId.split('-')[0]
  const dir = DIRECTION[bot.direction] ?? { label: 'Spot', variant: 'neutral' as const }
  const place = now ? gridPlace(bot, now) : null
  const at = now ? rangePosition(num(bot.minPx), num(bot.maxPx), now) : null
  const room = gridLiquidationRoom(bot, now)
  const step = gridStep(bot)
  const perArb = step !== null ? netPerArbitrage(step, makerFee) : null
  const feeShare = feeShareOfGrid(bot)
  const levels = now ? nextLevels(live.data ?? [], now) : {}
  const running = Date.now() - num(bot.cTime)
  const arbs = num(bot.arbitrageNum)
  const hours = running / 3_600_000
  const posSize = num(position?.pos)
  const noStop = !(num(bot.slTriggerPx) > 0)
  const total = num(bot.totalPnl)
  const stop = stopNow(bot, position, takerFee)

  const placeText =
    place === 'dentro'
      ? `El precio está al ${share(at ?? 0, 0)} del rango (${price(num(bot.minPx))} – ${price(num(bot.maxPx))}): la rejilla está operando.`
      : place === 'debajo'
        ? `Por debajo del rango (${price(num(bot.minPx))} – ${price(num(bot.maxPx))}). ` + (bot.direction === 'short'
          ? 'La rejilla ha recomprado todo y está parada hasta que vuelva.'
          : 'Ha comprado todos los niveles, mantiene la posición entera y ya no puede promediar.')
        : place === 'encima'
          ? `Por encima del rango (${price(num(bot.minPx))} – ${price(num(bot.maxPx))}). ` + (bot.direction === 'short'
            ? 'Ha vendido todos los niveles, mantiene el corto entero y ya no puede promediar.'
            : 'Lo ha vendido todo y está parado hasta que vuelva.')
          : null

  return (
    <Card
      title={`${symbol} · rejilla de ${bot.algoOrdType === 'contract_grid' ? 'contrato' : 'spot'}`}
      subtitle={`${bot.instId} · en marcha desde hace ${duration(running)} (${dateTime(num(bot.cTime))}) · ${plural(num(bot.gridNum), 'nivel', 'niveles')}`}
      action={
        <span className="bot-badges">
          <Badge variant={dir.variant}>{dir.label}</Badge>
          {num(bot.lever) > 0 && <Badge variant="neutral">{bot.lever}×</Badge>}
          <Badge variant={bot.state === 'running' ? 'live' : 'warn'} pulse={bot.state === 'running'}>
            {bot.state === 'running' ? 'En marcha' : bot.state}
          </Badge>
        </span>
      }
    >
      <div className="bot-card">
        {now > 0 && <GridRange bot={bot} mark={now} avg={num(position?.avgPx) || undefined} />}
        {placeText && (
          <p className={`bot-place${place !== 'dentro' ? ' is-out' : ''}`}>
            {placeText}
            <Help label="Rango">{HELP.gridRange}</Help>
          </p>
        )}

        <dl className="bot-figures">
          <div>
            <dt>
              Si lo paras ahora
              <Help label="Si lo paras ahora">{HELP.gridStopNow}</Help>
            </dt>
            <dd>
              <DeltaValue value={stop.value}>{signedUsd(stop.value)}</DeltaValue>
            </dd>
            <dd className="sub">
              {stop.keepsPosition
                ? `al pararlo mantiene la posición abierta: su flotante sigue en juego · resultado ${signedUsd(total)}`
                : `resultado ${signedUsd(total)} − ${usd(stop.closeCost)} de cerrar la posición a mercado`}
              {' · '}
              {pct(num(bot.investment) > 0 ? stop.value / num(bot.investment) : 0, 2)} sobre {usd(num(bot.investment))}
            </dd>
          </div>
          <div>
            <dt>
              De la rejilla
              <Help label="Beneficio de la rejilla">{HELP.gridProfit}</Help>
            </dt>
            <dd>
              <DeltaValue value={num(bot.gridProfit)}>{signedUsd(num(bot.gridProfit))}</DeltaValue>
            </dd>
            <dd className="sub">
              {plural(arbs, 'arbitraje', 'arbitrajes')}
              {hours >= 1 && ` · ${ratio(arbs / hours, 1)} por hora`}
            </dd>
          </div>
          <div>
            <dt>
              Flotante
              <Help label="Flotante">{HELP.gridFloat}</Help>
            </dt>
            <dd>
              <DeltaValue value={num(bot.floatProfit)}>{signedUsd(num(bot.floatProfit))}</DeltaValue>
            </dd>
            <dd className="sub">la posición que mantiene, a precio de ahora: parte del resultado, aún sin cobrar</dd>
          </div>
          <div>
            <dt>
              Comisiones pagadas
              <Help label="Comisiones">{HELP.gridFees}</Help>
            </dt>
            <dd>{usd(Math.abs(num(bot.fee)))}</dd>
            <dd className="sub">
              {feeShare !== null
                ? `ya descontadas del resultado · equivalen al ${share(feeShare, 0)} de lo ganado por la rejilla`
                : 'nada pagado aún'}
              {num(bot.fundingFee) !== 0 && ` · financiación ${signedUsd(num(bot.fundingFee))}`}
            </dd>
          </div>
          <div>
            <dt>Posición</dt>
            <dd>
              {position ? (
                <>
                  {usd(num(position.notionalUsd))} <span className="sub">{posSize < 0 ? 'en corto' : 'en largo'}</span>
                </>
              ) : (
                '—'
              )}
            </dd>
            <dd className="sub">
              {position ? `${qty(Math.abs(posSize))} contratos a ${price(num(position.avgPx))} de media` : 'sin posición abierta'}
            </dd>
          </div>
          <div>
            <dt>
              Liquidación
              <Help label="Margen">{HELP.gridMargin}</Help>
            </dt>
            <dd className={room !== null && room < LIQ_DANGER ? 'delta--down' : undefined}>
              {num(bot.liqPx) > 0 ? price(num(bot.liqPx)) : '—'}
            </dd>
            <dd className="sub">
              {room !== null ? (
                <span className={`badge badge--${room < LIQ_DANGER ? 'sell' : room < LIQ_WATCH ? 'warn' : 'neutral'}`}>
                  a {share(room, 0)} del precio
                </span>
              ) : null}{' '}
              {position?.mgnMode === 'cross' ? 'margen cruzado' : position?.mgnMode === 'isolated' ? 'margen aislado' : ''}
              {position && num(position.mgnRatio) > 0 && ` · ${share(num(position.mgnRatio), 0)}`}
            </dd>
          </div>
          <div>
            <dt>
              Por arbitraje
              <Help label="Por arbitraje">{HELP.gridPerArbitrage}</Help>
            </dt>
            <dd className={perArb !== null && perArb < 0 ? 'delta--down' : undefined}>
              {perArb !== null ? pct(perArb, 3) : '—'}
            </dd>
            <dd className="sub">
              {step !== null ? `${share(step, 3)} entre niveles − ${share(2 * makerFee, 3)} de comisiones` : ''}
            </dd>
          </div>
          <div>
            <dt>Próximas órdenes</dt>
            <dd>
              {levels.buy !== undefined || levels.sell !== undefined ? (
                <span>
                  {levels.buy !== undefined ? price(levels.buy) : '—'} <span className="sub">/</span>{' '}
                  {levels.sell !== undefined ? price(levels.sell) : '—'}
                </span>
              ) : (
                '—'
              )}
            </dd>
            <dd className="sub">compra bajo el precio / venta sobre él</dd>
          </div>
        </dl>

        <p className="bot-guard sub">
          {noStop ? (
            <>
              <strong>Sin stop:</strong> su único límite es la liquidación.
            </>
          ) : (
            <>Stop en {price(num(bot.slTriggerPx))}.</>
          )}
          {num(bot.tpTriggerPx) > 0 && ` Objetivo en ${price(num(bot.tpTriggerPx))}.`}{' '}
          Al detenerlo {bot.stopType === '2' ? 'mantiene la posición abierta' : 'cierra la posición a mercado'}.{' '}
          Actualizado {timeAgo(num(bot.uTime))}.
        </p>

        <Fills bot={bot} />
      </div>
    </Card>
  )
}
