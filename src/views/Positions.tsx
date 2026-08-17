import { useAlgoOrders, usePositions } from '../lib/queries'
import { dateTime, num, pct, plural, price, qty, share, signedUsd, usd } from '../lib/format'
import { Badge, Card, DeltaValue, EmptyState, ErrorNotice, Stat, TableSkeleton, TableWrap } from '../components/ui'
import { FundingCost, ProtectionBadge } from '../components/PositionGuard'
import { guardsFor, hasStop } from '../lib/guards'
import { IconAlert } from '../components/icons'

export function Positions() {
  const { data, isLoading, isFetching, error } = usePositions()
  const algos = useAlgoOrders()
  const positions = data ?? []

  // The one thing worth interrupting the page for: money at risk with nothing
  // behind it. Only claimed once the algo orders have actually loaded, so a
  // slow request can never invent an alarm.
  const unprotected = algos.data
    ? positions.filter((p) => !hasStop(guardsFor(p, algos.data)))
    : []

  const unrealised = positions.reduce((sum, p) => sum + num(p.upl), 0)
  const realised = positions.reduce((sum, p) => sum + num(p.realizedPnl), 0)
  const notional = positions.reduce((sum, p) => sum + num(p.notionalUsd), 0)
  const funding = positions.reduce((sum, p) => sum + num(p.fundingFee), 0)

  if (error) {
    return <ErrorNotice title="No se pudieron cargar las posiciones" message={error.message} />
  }

  return (
    <>
      {unprotected.length > 0 && (
        <div className="notice notice--error">
          <IconAlert />
          <div className="notice-body">
            <p className="notice-title">
              {plural(unprotected.length, 'posición abierta sin stop', 'posiciones abiertas sin stop')}
            </p>
            <p className="notice-text">
              {unprotected.map((p) => p.instId).join(', ')} — sin orden de stop-loss registrada en
              OKX, así que {unprotected.length === 1 ? 'su pérdida' : 'sus pérdidas'} solo{' '}
              {unprotected.length === 1 ? 'tiene' : 'tienen'} como límite la liquidación. Se
              comprueban las órdenes condicionales y OCO; un stop mental no cuenta aquí.
            </p>
          </div>
        </div>
      )}

      <div className="kpi-row">
        <Stat
          label="PnL No Realizado"
          hero
          glow
          loading={isLoading}
          value={<DeltaValue value={unrealised}>{signedUsd(unrealised)}</DeltaValue>}
          badge={
            positions.length > 0 ? (
              <Badge variant="live" pulse>
                {positions.length} activas
              </Badge>
            ) : undefined
          }
        />
        <Stat
          label="PnL Realizado (Sesión)"
          loading={isLoading}
          value={<DeltaValue value={realised}>{signedUsd(realised)}</DeltaValue>}
        />
        <Stat
          label="Exposición Nocional Total"
          loading={isLoading}
          value={usd(notional)}
          foot={<span>Valor total de contratos en mercado</span>}
        />
        <Stat
          label="Financiación Acumulada"
          loading={isLoading}
          value={<DeltaValue value={funding}>{signedUsd(funding)}</DeltaValue>}
          foot={<span>Tasas de funding de posiciones abiertas</span>}
        />
      </div>

      <Card
        title="Posiciones Abiertas en Vivo"
        subtitle={isLoading ? undefined : `${positions.length} contratos abiertos en derivados / margen`}
        flush
        dimmed={isFetching && !isLoading}
      >
        {isLoading ? (
          <TableSkeleton rows={4} cols={7} />
        ) : positions.length === 0 ? (
          <EmptyState
            title="Sin posiciones abiertas"
            hint="Aquí aparecerán tus posiciones activas de futuros, perpetuos y margen con su riesgo en tiempo real."
          />
        ) : (
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
                  <th className="num">Distancia Liq.</th>
                  <th>Protección</th>
                  <th className="num">Financiación</th>
                  <th className="num">Margen Usado</th>
                  <th className="num">PnL No Realizado</th>
                  <th className="num">Apertura</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const upl = num(p.upl)
                  const uplRatio = num(p.uplRatio)
                  const liq = num(p.liqPx)
                  const mark = num(p.markPx)
                  const liqDist = liq > 0 && mark > 0 ? Math.abs(mark - liq) / mark : 0
                  const isLiqRisk = liqDist > 0 && liqDist < 0.1

                  return (
                    <tr key={p.posId}>
                      <td>
                        <span className="ccy">{p.instId}</span>
                        <span className="sub"> · {p.mgnMode === 'cross' ? 'Cruzado' : 'Aislado'}</span>
                      </td>
                      <td>
                        <Badge variant={p.posSide === 'short' ? 'sell' : 'buy'}>
                          {p.posSide === 'short' ? 'Corto' : 'Largo'}
                          {p.lever && ` ${p.lever}×`}
                        </Badge>
                      </td>
                      <td className="num">{qty(num(p.pos))}</td>
                      <td className="num">{num(p.avgPx) > 0 ? price(num(p.avgPx)) : '—'}</td>
                      <td className="num">{mark > 0 ? price(mark) : '—'}</td>
                      <td className="num">
                        {liq > 0 ? (
                          <span className={isLiqRisk ? 'delta--down font-bold' : ''}>
                            {price(liq)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num">
                        {liqDist > 0 ? (
                          <span
                            className={`badge badge--${isLiqRisk ? 'sell' : liqDist < 0.25 ? 'warn' : 'neutral'}`}
                          >
                            {share(liqDist, 1)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <ProtectionBadge position={p} />
                      </td>
                      <td className="num">
                        <FundingCost position={p} />
                      </td>
                      <td className="num">{num(p.margin) > 0 ? usd(num(p.margin)) : '—'}</td>
                      <td className="num">
                        <DeltaValue value={upl}>
                          <strong>{signedUsd(upl)}</strong>
                          {uplRatio !== 0 && (
                            <span className="sub"> ({pct(uplRatio)})</span>
                          )}
                        </DeltaValue>
                      </td>
                      <td className="num sub">{dateTime(p.cTime)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  )
}

