import { useBotHistory, useDcaBots, useDcaPositions, useGridBots } from '../lib/queries'
import { dateTime, num, pct, plural, price, share, signedUsd, usd } from '../lib/format'
import {
  Badge,
  Card,
  DeltaValue,
  EmptyState,
  ErrorNotice,
  Stat,
  TableSkeleton,
  TableWrap,
} from '../components/ui'
import { IconAlert } from '../components/icons'
import { fuelUsed, liquidationRoom, NEARLY_DRY } from '../lib/bots'

export function Bots() {
  const dca = useDcaBots()
  const grid = useGridBots()
  const history = useBotHistory()
  const bots = dca.data ?? []
  const positions = useDcaPositions(bots)
  const grids = grid.data ?? []

  const invested = bots.reduce((sum, b) => sum + num(b.investmentAmt), 0)
  const pnl = bots.reduce((sum, b) => sum + num(b.totalPnl), 0)
  const funding = bots.reduce((sum, b) => sum + num(b.totalFundingFee), 0)

  // The worst fuel gauge across the bots, because that is the one that decides
  // how much room the account still has, not the average.
  const tightest = bots.reduce(
    (worst, b) => Math.max(worst, fuelUsed(b, positions.data?.[b.algoId])),
    0,
  )
  const nearlyDry = bots.filter((b) => fuelUsed(b, positions.data?.[b.algoId]) >= NEARLY_DRY)

  const error = dca.error ?? grid.error
  if (error) {
    return <ErrorNotice title="No se pudieron cargar los bots" message={error.message} />
  }

  const isLoading = dca.isLoading
  const stoppedDca = history.data?.dca ?? []
  const stoppedGrid = history.data?.grid ?? []

  return (
    <>
      {nearlyDry.length > 0 && (
        <div className="notice notice--error">
          <IconAlert />
          <div className="notice-body">
            <p className="notice-title">
              {plural(nearlyDry.length, 'bot casi sin munición', 'bots casi sin munición')}
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
          label="PnL de los Bots"
          hero
          glow
          loading={isLoading}
          value={<DeltaValue value={pnl}>{signedUsd(pnl)}</DeltaValue>}
          badge={
            bots.length > 0 ? (
              <Badge variant="live" pulse>
                {plural(bots.length, 'activo', 'activos')}
              </Badge>
            ) : undefined
          }
        />
        <Stat
          label="Capital Comprometido"
          loading={isLoading}
          value={usd(invested)}
          foot={<span>Reservado por los bots, no necesariamente desplegado</span>}
        />
        <Stat
          label="Munición Gastada"
          loading={isLoading}
          value={share(tightest, 0)}
          foot={<span>Órdenes de seguridad usadas por el bot más apurado</span>}
        />
        <Stat
          label="Financiación Acumulada"
          loading={isLoading}
          value={<DeltaValue value={funding}>{signedUsd(funding)}</DeltaValue>}
          foot={<span>Ya descontada del PnL de al lado, no se resta otra vez</span>}
        />
      </div>

      <Card
        title="Bots DCA en Marcha"
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
                  <th className="num">Precio Medio</th>
                  <th className="num">Objetivo</th>
                  <th className="num">Liquidación</th>
                  <th>Munición</th>
                  <th className="num">Financiación</th>
                  <th className="num">PnL</th>
                </tr>
              </thead>
              <tbody>
                {bots.map((b) => {
                  const p = positions.data?.[b.algoId]
                  const used = fuelUsed(b, p)
                  const room = liquidationRoom(p)
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
                            {room !== null && <span className="sub"> a {share(room, 1)}</span>}
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

      {grids.length > 0 && (
        <Card title="Bots de Rejilla en Marcha" flush dimmed={grid.isFetching}>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Instrumento</th>
                  <th className="num">Inversión</th>
                  <th className="num">Rango</th>
                  <th className="num">Niveles</th>
                  <th className="num">Arbitrajes</th>
                  <th className="num">PnL</th>
                </tr>
              </thead>
              <tbody>
                {grids.map((g) => (
                  <tr key={g.algoId}>
                    <td>
                      <strong>{g.instId}</strong>
                      <span className="sub"> desde {dateTime(num(g.cTime))}</span>
                    </td>
                    <td className="num">{usd(num(g.investment))}</td>
                    <td className="num">
                      {price(num(g.minPx))} – {price(num(g.maxPx))}
                    </td>
                    <td className="num">{g.gridNum}</td>
                    <td className="num">{g.arbitrageNum}</td>
                    <td className="num">
                      <DeltaValue value={num(g.totalPnl)}>{signedUsd(num(g.totalPnl))}</DeltaValue>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      <Card
        title="Bots Detenidos"
        subtitle="Lo que dejó cada bot al pararse"
        flush
        dimmed={history.isFetching && !history.isLoading}
      >
        {history.isLoading ? (
          <TableSkeleton rows={2} cols={5} />
        ) : stoppedDca.length + stoppedGrid.length === 0 ? (
          <EmptyState title="Ningún bot detenido todavía" />
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Instrumento</th>
                  <th>Tipo</th>
                  <th className="num">Invertido</th>
                  <th className="num">Detenido</th>
                  <th className="num">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {stoppedDca.map((b) => (
                  <tr key={b.algoId}>
                    <td>
                      <strong>{b.instId}</strong>
                    </td>
                    <td>DCA</td>
                    <td className="num">{usd(num(b.investmentAmt))}</td>
                    <td className="num">{dateTime(num(b.uTime))}</td>
                    <td className="num">
                      <DeltaValue value={num(b.totalPnl)}>{signedUsd(num(b.totalPnl))}</DeltaValue>
                    </td>
                  </tr>
                ))}
                {stoppedGrid.map((g) => (
                  <tr key={g.algoId}>
                    <td>
                      <strong>{g.instId}</strong>
                    </td>
                    <td>Rejilla</td>
                    <td className="num">{usd(num(g.investment))}</td>
                    <td className="num">{dateTime(num(g.uTime))}</td>
                    <td className="num">
                      <DeltaValue value={num(g.totalPnl)}>{signedUsd(num(g.totalPnl))}</DeltaValue>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  )
}
