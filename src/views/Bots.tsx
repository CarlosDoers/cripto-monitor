import { useBotHistory, useDcaBots, useDcaPositions, useGridBots, useGridPositions, useMarks, useTradeFee } from '../lib/queries'
import { dateTime, duration, num, pct, plural, price, share, signedUsd, usd } from '../lib/format'
import {
  Badge,
  Card,
  DeltaValue,
  EmptyState,
  ErrorNotice,
  Stat,
  TableSkeleton,
  TableWrap,
  Help,
} from '../components/ui'
import { IconAlert } from '../components/icons'
import { fuelUsed, gridLiquidationRoom, gridPlace, liquidationRoom, NEARLY_DRY, rangePosition, stopNow } from '../lib/bots'
import { LIQ_DANGER, LIQ_WATCH } from '../lib/guards'
import type { DcaBot, DcaPosition, GridBot } from '../lib/types'
import { GridBotCard } from '../components/GridBotCard'
import { HELP } from '../lib/glossary'

/**
 * Running bots: the summary across both families, one card per grid bot with
 * its range, its money and its risk, and the DCA bots' table. Embedded in
 * *En curso* it is a compact list that links here; the stopped ones are
 * history and live in the Historial as `StoppedBots`.
 */
export function Bots({ embedded = false }: { embedded?: boolean }) {
  const dca = useDcaBots()
  const grid = useGridBots()
  const bots = dca.data ?? []
  const grids = grid.data ?? []
  const marks = useMarks([...bots, ...grids].map((b) => b.instId))
  const positions = useDcaPositions(bots)
  // The per-bot details cost a request each, so only the full view asks.
  const gridPositions = useGridPositions(embedded ? [] : grids)
  const fees = useTradeFee('FUTURES')
  // OKX signs fees from the account's side: negative is charged.
  const maker = -num(fees.data?.[0]?.maker) || 0.0002
  const taker = -num(fees.data?.[0]?.taker) || 0.0005

  const nearlyDry = bots.filter((b) => fuelUsed(b, positions.data?.[b.algoId]) >= NEARLY_DRY)

  const error = dca.error ?? grid.error
  if (error) {
    return <ErrorNotice title="No se pudieron cargar los bots" message={error.message} />
  }

  const isLoading = dca.isLoading || grid.isLoading
  if (embedded) {
    return isLoading || bots.length + grids.length === 0 ? null : (
      <BotsSummary dca={bots} grids={grids} marks={marks} dcaPositions={positions.data} />
    )
  }

  const pnl = bots.reduce((s, b) => s + num(b.totalPnl), 0) + grids.reduce((s, g) => s + num(g.totalPnl), 0)
  const invested =
    bots.reduce((s, b) => s + num(b.investmentAmt), 0) + grids.reduce((s, g) => s + num(g.investment), 0)
  // Stopping now: each grid's result less closing its position at market. A
  // DCA bot's PnL is taken as it stands.
  const closeCost = grids.reduce((s, g) => s + stopNow(g, gridPositions.byAlgo[g.algoId], taker).closeCost, 0)
  const ifStopped = pnl - closeCost
  const gridProfit = grids.reduce((s, g) => s + num(g.gridProfit), 0)
  const gridFees = grids.reduce((s, g) => s - num(g.fee), 0)
  // The tightest liquidation across every bot, from the live price where known:
  // the one that decides how much room the account has, not the average.
  const rooms = [
    ...grids.map((g) => ({ name: g.instId.split('-')[0], room: gridLiquidationRoom(g, marks[g.instId]) })),
    ...bots.map((b) => ({ name: b.instId.split('-')[0], room: liquidationRoom(positions.data?.[b.algoId], marks[b.instId]) })),
  ].filter((r): r is { name: string; room: number } => r.room !== null)
  const tightest = rooms.sort((a, b) => a.room - b.room)[0]
  const count = bots.length + grids.length

  return (
    <>
      {nearlyDry.length > 0 && (
        <div className="notice notice--error">
          <IconAlert />
          <div className="notice-body">
            <p className="notice-title">
              {plural(nearlyDry.length, 'bot casi sin órdenes de seguridad', 'bots casi sin órdenes de seguridad')}
            </p>
            <p className="notice-text">
              {nearlyDry.map((b) => b.instId).join(', ')} — ha gastado tres cuartas partes de sus
              órdenes de seguridad. A partir de aquí ya no puede promediar más: si el precio sigue
              en contra, va directo al precio de liquidación.
            </p>
          </div>
        </div>
      )}

      <div className="kpi-row">
        <Stat
          label="Si los paras ahora"
          help={HELP.gridStopNow}
          hero
          loading={isLoading}
          value={<DeltaValue value={ifStopped}>{signedUsd(ifStopped)}</DeltaValue>}
          badge={
            count > 0 ? (
              <Badge variant="live" pulse>
                {plural(count, 'activo', 'activos')}
              </Badge>
            ) : undefined
          }
          foot={
            <span>
              {count
                ? `resultado ${signedUsd(pnl)}${closeCost > 0 ? ` − ${usd(closeCost)} de cerrar a mercado` : ''} · sobre ${usd(invested)} invertidos`
                : 'ningún bot en marcha'}
            </span>
          }
        />
        <Stat
          label="Ganado por las rejillas"
          help={HELP.gridProfit}
          loading={isLoading}
          value={grids.length ? <DeltaValue value={gridProfit}>{signedUsd(gridProfit)}</DeltaValue> : '—'}
          foot={<span>{grids.length ? `${usd(gridFees)} pagados en comisiones` : 'sin bots de rejilla'}</span>}
        />
        <Stat
          label="Liquidación más cercana"
          help={HELP.liqPrice}
          loading={isLoading}
          value={tightest ? `a ${share(tightest.room, 0)}` : '—'}
          foot={<span>{tightest ? `${tightest.name}, desde el precio actual` : 'ningún bot con liquidación'}</span>}
        />
        <Stat
          label="Capital comprometido"
          help={HELP.committed}
          loading={isLoading}
          value={usd(invested)}
          foot={<span>ya dentro del patrimonio, no se suma</span>}
        />
      </div>

      {!isLoading && count === 0 && (
        <Card title="Ningún bot en marcha">
          <div className="prose">
            <p>
              Cuando pongas en marcha un bot de rejilla o de DCA en OKX, aparecerá aquí con su rango, su posición, lo
              que lleva ganado y lo lejos que está de la liquidación. Los que ya paraste están en{' '}
              <a className="card-link" href="#/historial">Historial → Bots detenidos</a>.
            </p>
          </div>
        </Card>
      )}

      {grids.map((g) => (
        <GridBotCard
          key={g.algoId}
          bot={g}
          position={gridPositions.byAlgo[g.algoId]}
          mark={marks[g.instId]}
          makerFee={maker}
          takerFee={taker}
        />
      ))}

      {bots.length > 0 && <DcaCard bots={bots} dca={dca} positions={positions} marks={marks} />}

      {count > 0 && (
        <p className="bots-foot sub">
          Los bots ya detenidos, con lo que dejó cada uno, están en{' '}
          <a className="card-link" href="#/historial">Historial → Bots detenidos</a>.
        </p>
      )}
    </>
  )
}

/** One line per running bot, for *En curso*; the detail is a click away. */
function BotsSummary({
  dca,
  grids,
  marks,
  dcaPositions,
}: {
  dca: DcaBot[]
  grids: GridBot[]
  marks: Record<string, number>
  dcaPositions: Record<string, DcaPosition> | undefined
}) {
  const rows = [
    ...grids.map((g) => {
      const mark = marks[g.instId]
      const place = mark ? gridPlace(g, mark) : null
      const at = mark ? rangePosition(num(g.minPx), num(g.maxPx), mark) : null
      return {
        id: g.algoId,
        name: g.instId.split('-')[0],
        kind: 'Rejilla',
        direction: g.direction,
        lever: g.lever,
        invested: num(g.investment),
        pnl: num(g.totalPnl),
        state:
          place === 'dentro' ? `dentro del rango, al ${share(at ?? 0, 0)}` : place ? `fuera del rango, por ${place === 'encima' ? 'arriba' : 'abajo'}` : '—',
        room: gridLiquidationRoom(g, mark),
      }
    }),
    ...dca.map((b) => {
      const p = dcaPositions?.[b.algoId]
      return {
        id: b.algoId,
        name: b.instId.split('-')[0],
        kind: 'DCA',
        direction: b.direction,
        lever: b.lever,
        invested: num(b.investmentAmt),
        pnl: num(b.totalPnl),
        state: `${num(p?.fillSafetyOrds)}/${b.maxSafetyOrds} órdenes de seguridad`,
        room: liquidationRoom(p, marks[b.instId]),
      }
    }),
  ]
  return (
    <Card
      title="Bots en marcha"
      subtitle={`${plural(rows.length, 'bot', 'bots')} · el detalle de cada uno, su rango y su posición, en Bots`}
      action={
        <a className="card-link" href="#/bots">
          Ver bots →
        </a>
      }
      flush
    >
      <TableWrap>
        <table className="data">
          <thead>
            <tr>
              <th>Bot</th>
              <th>Dirección</th>
              <th className="num">Invertido</th>
              <th>Estado</th>
              <th className="num">Liquidación</th>
              <th className="num">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span>
                    <strong>{r.name}</strong> <span className="sub">{r.kind}</span>
                  </span>
                </td>
                <td>
                  <span>
                    <Badge variant={r.direction === 'short' ? 'sell' : r.direction === 'long' ? 'buy' : 'neutral'}>
                      {r.direction === 'short' ? 'Corto' : r.direction === 'long' ? 'Largo' : 'Neutral'}
                    </Badge>
                    {num(r.lever) > 0 && <span className="sub"> {r.lever}×</span>}
                  </span>
                </td>
                <td className="num">{usd(r.invested)}</td>
                <td className="sub">{r.state}</td>
                <td className="num">
                  {r.room !== null ? (
                    <span className={`badge badge--${r.room < LIQ_DANGER ? 'sell' : r.room < LIQ_WATCH ? 'warn' : 'neutral'}`}>
                      a {share(r.room, 0)}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="num">
                  <DeltaValue value={r.pnl}>{signedUsd(r.pnl)}</DeltaValue>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  )
}

/** The DCA bots: a martingale is read by the safety orders it has left. */
function DcaCard({
  bots,
  dca,
  positions,
  marks,
}: {
  bots: DcaBot[]
  dca: ReturnType<typeof useDcaBots>
  positions: ReturnType<typeof useDcaPositions>
  marks: Record<string, number>
}) {
  const isLoading = dca.isLoading
  return (
      <Card
        title="Bots DCA en marcha"
        subtitle={
          isLoading
            ? undefined
            : `${bots.length} en ejecución · el PnL ya va neto de comisiones y financiación`
        }
        flush
        dimmed={dca.isFetching && !isLoading}
      >
        {isLoading ? (
          <TableSkeleton rows={2} cols={8} />
        ) : bots.length === 0 ? (
          <EmptyState
            title="Ningún bot DCA en marcha"
            hint="Aquí aparecerán los bots de DCA de spot y de futuros con su precio medio, su objetivo y cuántas órdenes de seguridad les quedan."
          />
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Instrumento</th>
                  <th>Dirección</th>
                  <th className="num">Comprometido</th>
                  <th className="num">Precio medio</th>
                  <th className="num">
                    Objetivo
                    <Help label="Objetivo">{HELP.botTarget}</Help>
                  </th>
                  <th className="num">
                    Liquidación
                    <Help label="Liquidación">{HELP.liqPrice}</Help>
                  </th>
                  <th>
                    Munición
                    <Help label="Munición">{HELP.fuelUsed}</Help>
                  </th>
                  <th className="num">
                    Financiación
                    <Help label="Financiación">{HELP.funding}</Help>
                  </th>
                  <th className="num">PnL</th>
                </tr>
              </thead>
              <tbody>
                {bots.map((b) => {
                  const p = positions.data?.[b.algoId]
                  const used = fuelUsed(b, p)
                  const room = liquidationRoom(p, marks[b.instId])
                  const pnlValue = num(b.totalPnl)
                  return (
                    <tr key={b.algoId}>
                      <td>
                        <strong>{b.instId}</strong>
                        <span className="sub"> desde {dateTime(num(b.cTime))}</span>
                      </td>
                      <td>
                        <Badge variant={b.direction === 'long' ? 'buy' : 'sell'}>
                          {b.direction === 'long' ? 'Largo' : 'Corto'}
                        </Badge>
                        <span className="sub"> {b.lever}×</span>
                      </td>
                      <td className="num">{usd(num(b.investmentAmt))}</td>
                      <td className="num">{p ? price(num(p.avgPx)) : '—'}</td>
                      <td className="num">
                        {p && num(p.tpPx) ? price(num(p.tpPx)) : '—'}
                      </td>
                      <td className="num">
                        {p && num(p.liqPx) ? (
                          <>
                            {price(num(p.liqPx))}
                            {room !== null && (
                              <span className="sub">
                                {' '}
                                a {share(room, 1)} {marks[b.instId] ? 'del precio' : 'de la media'}
                              </span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <span className="rail">
                          <span className="rail-track">
                            <span
                              className="rail-fill"
                              style={{
                                // No floor here: a bot that has fired nothing
                                // must read as an empty gauge, not a sliver.
                                width: `${used * 100}%`,
                                background: used >= NEARLY_DRY ? 'var(--critical)' : 'var(--accent)',
                              }}
                            />
                          </span>
                          <span className="sub">
                            {num(p?.fillSafetyOrds)}/{b.maxSafetyOrds}
                          </span>
                        </span>
                      </td>
                      <td className="num">
                        <DeltaValue value={num(b.totalFundingFee)}>
                          {signedUsd(num(b.totalFundingFee))}
                        </DeltaValue>
                      </td>
                      <td className="num">
                        <DeltaValue value={pnlValue}>{signedUsd(pnlValue)}</DeltaValue>
                        <span className="sub"> {pct(num(b.pnlRatio), 2)}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
  )
}

/**
 * Bots already stopped, with what each left. The total leads because the
 * question is "have the bots paid, overall", and a list of seven signed
 * figures makes the reader add them up.
 */
export function StoppedBots() {
  const history = useBotHistory()
  const stoppedDca = history.data?.dca ?? []
  const stoppedGrid = history.data?.grid ?? []
  const all = [
    ...stoppedDca.map((b) => ({ id: b.algoId, inst: b.instId, kind: 'DCA', invested: num(b.investmentAmt), pnl: num(b.totalPnl), from: num(b.cTime), to: num(b.uTime) })),
    ...stoppedGrid.map((g) => ({ id: g.algoId, inst: g.instId, kind: 'Rejilla', invested: num(g.investment), pnl: num(g.totalPnl), from: num(g.cTime), to: num(g.uTime) })),
  ].sort((a, b) => b.to - a.to)
  const total = all.reduce((s, b) => s + b.pnl, 0)
  const wins = all.filter((b) => b.pnl > 0).length

  return (
    <Card
      title="Bots detenidos"
      subtitle={
        all.length
          ? `${plural(all.length, 'bot', 'bots')} · ${wins} con beneficio · resultado conjunto ${signedUsd(total)}`
          : 'Lo que dejó cada bot al pararse'
      }
      flush
      dimmed={history.isFetching && !history.isLoading}
    >
      {history.isLoading ? (
        <TableSkeleton rows={2} cols={6} />
      ) : all.length === 0 ? (
        <EmptyState title="Ningún bot detenido todavía" />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Instrumento</th>
                <th>Tipo</th>
                <th className="num">Invertido</th>
                <th className="num">Duración</th>
                <th className="num">Detenido</th>
                <th className="num">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {all.map((b) => (
                <tr key={b.id}>
                  <td>
                    <strong>{b.inst}</strong>
                  </td>
                  <td>{b.kind}</td>
                  <td className="num">{usd(b.invested)}</td>
                  <td className="num sub">{b.from > 0 && b.to > b.from ? duration(b.to - b.from) : '—'}</td>
                  <td className="num">{dateTime(b.to)}</td>
                  <td className="num">
                    <span>
                      <DeltaValue value={b.pnl}>{signedUsd(b.pnl)}</DeltaValue>
                      {b.invested > 0 && <span className="sub"> ({pct(b.pnl / b.invested)})</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  )
}
