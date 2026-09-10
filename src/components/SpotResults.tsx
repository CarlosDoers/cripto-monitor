import { useMemo } from 'react'
import { useSpotFills } from '../lib/queries'
import { computeSpot, DOLLAR_QUOTES } from '../lib/spot'
import { dateTime, plural, qty, share, signedUsd, usd } from '../lib/format'
import {
  Badge,
  Card,
  DeltaValue,
  EmptyState,
  ErrorNotice,
  Stat,
  TableSkeleton,
  TableWrap,
} from './ui'

/**
 * Below this share of proceeds priced, the headline is incomplete enough that
 * the reader has to be told without going looking. Not 0.5: at 52 % coverage
 * nearly half of what the account sold is missing from the figure, and that is
 * exactly the case the badge exists for.
 */
const THIN_COVERAGE = 0.9

/**
 * Spot results, and the size of what they leave out.
 *
 * OKX reports no per-trade result for spot, so this is reconstructed by FIFO in
 * `computeSpot`. The reconstruction is exact for coins bought and sold on this
 * account and impossible for coins that arrived by deposit or airdrop — those
 * were acquired somewhere the API cannot see.
 *
 * Which is why the uncovered figure sits in the KPI strip rather than in a
 * footnote. On this account the split ran 537 US$ priced against 5 888 US$ not,
 * and a lone "+537 US$ en spot" would have read as the whole story.
 */
export function SpotResults() {
  const { data, isLoading, isFetching, error } = useSpotFills()
  const spot = useMemo(() => computeSpot(data?.fills ?? []), [data?.fills])

  if (error) {
    return <ErrorNotice title="No se pudieron cargar las operaciones de spot" message={error.message} />
  }

  if (!isLoading && spot.fillCount === 0) {
    return (
      <Card title="Resultado en Spot" flush>
        <EmptyState
          title="Sin operaciones de spot en el histórico"
          hint="Aquí aparecerá el resultado de los ciclos de compra y venta que se puedan emparejar."
        />
      </Card>
    )
  }

  const thin = spot.coverage < THIN_COVERAGE
  const traded = spot.pairs.filter((p) => p.sells > 0 || p.buys > 0)

  return (
    <>
      <div className="kpi-row">
        <Stat
          label="Resultado en Spot"
          loading={isLoading}
          value={<DeltaValue value={spot.netUsd}>{signedUsd(spot.netUsd)}</DeltaValue>}
          badge={
            thin && !isLoading ? <Badge variant="warn">parcial</Badge> : undefined
          }
          foot={
            <span>
              Ciclos completos de compra y venta, ya con comisiones ({usd(spot.feesUsd)})
            </span>
          }
        />
        <Stat
          label="Vendido sin Coste Conocido"
          loading={isLoading}
          value={usd(spot.uncoveredUsd)}
          foot={<span>Monedas llegadas por depósito: se vendieron aquí, se compraron fuera</span>}
        />
        <Stat
          label="Cobertura del Cálculo"
          loading={isLoading}
          value={share(spot.coverage, 0)}
          foot={
            <span>
              De {usd(spot.coveredUsd + spot.uncoveredUsd)} vendidos, lo que se puede valorar
            </span>
          }
        />
        <Stat
          label="Histórico Analizado"
          loading={isLoading}
          value={String(spot.fillCount)}
          foot={
            <span>
              {plural(spot.fillCount, 'ejecución', 'ejecuciones')}
              {spot.firstTs > 0 && <> desde {dateTime(spot.firstTs)}</>}
            </span>
          }
        />
      </div>

      <Card
        title="Spot por Par"
        subtitle="Reconstruido por FIFO — OKX no da resultado por operación en spot"
        flush
        dimmed={isFetching && !isLoading}
      >
        {isLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : (
          <>
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th>Par</th>
                    <th className="num">Compras</th>
                    <th className="num">Ventas</th>
                    <th className="num">Comisiones</th>
                    <th className="num">Sin coste conocido</th>
                    <th className="num">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {traded.map((p) => (
                    <tr key={p.instId}>
                      <td>
                        <strong>{p.instId}</strong>
                        {p.lastTs > 0 && (
                          <span className="sub"> última {dateTime(p.lastTs)}</span>
                        )}
                      </td>
                      <td className="num">{p.buys}</td>
                      <td className="num">{p.sells}</td>
                      <td className="num sub">{usd(p.fees)}</td>
                      <td className="num">
                        {p.uncoveredProceeds > 0 ? (
                          <span className="delta--down">
                            {DOLLAR_QUOTES.has(p.quote)
                              ? usd(p.uncoveredProceeds)
                              : `${qty(p.uncoveredProceeds)} ${p.quote}`}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num">
                        {p.coveredProceeds > 0 ? (
                          <DeltaValue value={p.realised - p.fees}>
                            {signedUsd(p.realised - p.fees)}
                          </DeltaValue>
                        ) : p.sells === 0 ? (
                          // Bought and still held: there is no result yet, which
                          // is not the same as one that cannot be worked out.
                          <span className="sub">sin cerrar</span>
                        ) : (
                          <span className="sub">no valorable</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="sub" style={{ padding: '10px 16px 14px' }}>
              El resultado empareja cada venta con las compras anteriores del mismo par, en orden de
              llegada. Cuando una venta no tiene compra que la respalde es porque esas monedas
              entraron por depósito o airdrop: se vendieron en OKX pero se compraron fuera, y su
              precio de coste no está en ninguna API. Esos ingresos se cuentan aparte y nunca como
              beneficio — ponerles coste cero inventaría una ganancia y ponerles precio de mercado
              inventaría un empate.
              {data?.truncated && (
                <>
                  {' '}
                  Además tu historial supera las {spot.fillCount} ejecuciones que se pueden consultar
                  de una vez, así que las compras más antiguas quedan fuera y su parte aparece como
                  no valorable.
                </>
              )}
            </p>
          </>
        )}
      </Card>
    </>
  )
}
