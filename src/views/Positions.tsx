import { usePositions } from '../lib/queries'
import { dateTime, num, pct, price, qty, signedUsd, usd } from '../lib/format'
import { Card, DeltaValue, EmptyState, ErrorNotice, Stat, TableSkeleton } from '../components/ui'

export function Positions() {
  const { data, isLoading, isFetching, error } = usePositions()
  const positions = data ?? []

  const unrealised = positions.reduce((sum, p) => sum + num(p.upl), 0)
  const realised = positions.reduce((sum, p) => sum + num(p.realizedPnl), 0)
  const notional = positions.reduce((sum, p) => sum + num(p.notionalUsd), 0)
  const funding = positions.reduce((sum, p) => sum + num(p.fundingFee), 0)

  if (error) {
    return <ErrorNotice title="No se pudieron cargar las posiciones" message={error.message} />
  }

  return (
    <>
      <div className="kpi-row">
        <Stat
          label="PnL no realizado"
          hero
          loading={isLoading}
          value={<DeltaValue value={unrealised}>{signedUsd(unrealised)}</DeltaValue>}
        />
        <Stat
          label="PnL realizado"
          loading={isLoading}
          value={<DeltaValue value={realised}>{signedUsd(realised)}</DeltaValue>}
        />
        <Stat label="Exposición nocional" loading={isLoading} value={usd(notional)} />
        <Stat
          label="Comisiones de financiación"
          loading={isLoading}
          value={<DeltaValue value={funding}>{signedUsd(funding)}</DeltaValue>}
        />
      </div>

      <Card
        title="Posiciones abiertas"
        subtitle={isLoading ? undefined : `${positions.length} abiertas`}
        flush
        dimmed={isFetching && !isLoading}
      >
        {isLoading ? (
          <TableSkeleton rows={4} cols={7} />
        ) : positions.length === 0 ? (
          <EmptyState
            title="Sin posiciones abiertas"
            hint="Aquí aparecerán tus posiciones de futuros, margen y opciones."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Instrumento</th>
                  <th>Lado</th>
                  <th className="num">Tamaño</th>
                  <th className="num">Precio medio</th>
                  <th className="num">Precio marca</th>
                  <th className="num">Liquidación</th>
                  <th className="num">Margen</th>
                  <th className="num">PnL no realizado</th>
                  <th className="num">Abierta</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const upl = num(p.upl)
                  const liq = num(p.liqPx)
                  return (
                    <tr key={p.posId}>
                      <td>
                        <span className="ccy">{p.instId}</span>
                        <span className="sub"> {p.mgnMode === 'cross' ? 'cruzado' : 'aislado'}</span>
                      </td>
                      <td>
                        <span className={`badge badge--${p.posSide === 'short' ? 'sell' : 'buy'}`}>
                          {p.posSide === 'short' ? 'Corto' : 'Largo'}
                          {p.lever && ` ${p.lever}×`}
                        </span>
                      </td>
                      <td className="num">{qty(num(p.pos))}</td>
                      <td className="num">{num(p.avgPx) > 0 ? price(num(p.avgPx)) : '—'}</td>
                      <td className="num">{num(p.markPx) > 0 ? price(num(p.markPx)) : '—'}</td>
                      <td className="num">{liq > 0 ? price(liq) : '—'}</td>
                      <td className="num">{num(p.margin) > 0 ? usd(num(p.margin)) : '—'}</td>
                      <td className="num">
                        <DeltaValue value={upl}>
                          {signedUsd(upl)}
                          {num(p.uplRatio) !== 0 && (
                            <span className="sub"> ({pct(num(p.uplRatio))})</span>
                          )}
                        </DeltaValue>
                      </td>
                      <td className="num sub">{dateTime(p.cTime)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
