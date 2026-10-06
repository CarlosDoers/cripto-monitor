import { useMemo } from 'react'
import { compareWatch, watchEmaCross, type EmaWatch as Watch, type WatchStatus } from '../lib/emaWatch'
import { pct, plural, price, ratio } from '../lib/format'
import { type Market } from '../lib/markets'
import { profileOf, strategyByKey } from '../lib/indicators/registry'
import { routeHref } from '../lib/router'
import { hoursOf as hours, useWatchScan } from '../lib/useWatchScan'
import { Badge, Card, Help, TableSkeleton, TableWrap } from './ui'
import { WatchControls } from './WatchControls'

const STATUS: Record<WatchStatus, { label: string; variant: 'live' | 'buy' | 'warn' | 'neutral' }> = {
  nueva: { label: 'Señal nueva', variant: 'live' },
  cruzando: { label: 'Cruzando ahora', variant: 'warn' },
  cerca: { label: 'Cerca de cruzar', variant: 'buy' },
  tendencia: { label: 'En tendencia', variant: 'neutral' },
  fuera: { label: 'Sin posición', variant: 'neutral' },
  corto: { label: 'Historial corto', variant: 'neutral' },
}

function what(w: Watch): string {
  const dir = w.side === 'long' ? 'largo' : 'corto'
  switch (w.status) {
    case 'nueva':
      return `${dir}: cerró ${w.side === 'long' ? 'sobre' : 'bajo'} la EMA hace ${hours(w.age + 1)}`
    case 'cruzando':
      return `la vela en curso va ${w.side === 'long' ? 'por debajo' : 'por encima'}: si cierra así, da la vuelta`
    case 'cerca':
      return `a ${ratio(w.distanceAtr, 1)} ATR de la EMA: una vela podría cruzarla`
    case 'tendencia':
      return `${dir} desde hace ${hours(w.age)}`
    case 'fuera':
      return 'saltó el stop; espera al próximo cruce'
    case 'corto':
      return `${w.bars} velas de 4 h; hacen falta 600`
  }
}

/**
 * "¿Qué vigilo?": the most traded X-Perps against the EMA 200 strategy on 4 h,
 * the one EMA configuration of the 162 swept that cleared the bar. On demand,
 * like the touch scan below it.
 */
export function EmaWatch({ markets }: { markets: Market[] }) {
  const scan = useWatchScan(markets)
  const { ids, board, byId } = scan
  const strategy = strategyByKey('ema200')
  const profile = profileOf(strategy, strategy.presets[0].key)

  const rows = useMemo(
    () =>
      (ids ?? [])
        .filter((id) => board.byInst[id])
        .map((id) => {
          const m = byId.get(id)
          return watchEmaCross(board.byInst[id], m?.last ?? 0, id, m?.symbol ?? id.split('-')[0])
        })
        .sort(compareWatch),
    [ids, board.byInst, byId],
  )
  const watch = rows.filter((w) => w.status === 'nueva' || w.status === 'cruzando' || w.status === 'cerca')
  const total = ids?.length ?? 0

  return (
    <Card
      title="Qué vigilar · EMA 200 en 4 h"
      subtitle={
        ids
          ? board.loaded < total
            ? `Analizando ${board.loaded} de ${total}…`
            : `${plural(watch.length, 'contrato para vigilar', 'contratos para vigilar')} de los ${total} más negociados`
          : 'La única combinación de EMA que pasó el listón, de 162 probadas. Pulsa para ver qué X-Perp están en ella'
      }
      action={
        <Help label="Qué vigilar">
          <p>
            La estrategia: largo mientras las velas de 4 h cierran por encima de la EMA 200, corto mientras cierran
            por debajo, y la vuelta en cada cruce, con un stop de 2 ATR.
          </p>
          <p>
            Se probaron 162 combinaciones: 9 EMAs (de 9 a 200), en 1 h, 4 h y diario, operadas como cruce, rebote o
            retroceso, con dos salidas distintas. Solo esta pasó todo: en 4 h mide{' '}
            <strong>+{ratio(profile.byTimeframe['4H'] ?? 0)} R</strong> por operación, positiva en las dos mitades del
            histórico, con las EMAs vecinas también positivas y por encima de entradas al azar. Acierta una de cada
            seis: vive de pocas tendencias largas.
          </p>
          <p>
            <strong>Señal nueva</strong> es la entrada medida, en las dos últimas velas. <strong>Cruzando</strong> y{' '}
            <strong>cerca</strong> son para tenerlos a la vista. Entrar en una tendencia ya empezada no está medido.
          </p>
        </Help>
      }
      flush
    >
      <WatchControls scan={scan} empty={markets.length === 0} />

      {!ids ? null : rows.length === 0 ? (
        <TableSkeleton rows={Math.min(total, 6)} cols={7} />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Contrato</th>
                <th>Estado</th>
                <th>Qué pasa</th>
                <th className="num">Precio</th>
                <th className="num">EMA 200</th>
                <th className="num">Distancia</th>
                <th className="num">Stop</th>
                <th>Gráfico</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const s = STATUS[w.status]
                return (
                  <tr key={w.instId}>
                    <td>
                      <span>
                        <span className="ccy">{w.symbol}</span>{' '}
                        {w.side && (
                          <Badge variant={w.side === 'long' ? 'buy' : 'sell'}>{w.side === 'long' ? 'Largo' : 'Corto'}</Badge>
                        )}
                      </span>
                    </td>
                    <td>
                      <Badge variant={s.variant} pulse={w.status === 'nueva' || w.status === 'cruzando'}>
                        {s.label}
                      </Badge>
                    </td>
                    <td className="sub watch-what">{what(w)}</td>
                    <td className="num">{price(w.price)}</td>
                    <td className="num">{Number.isFinite(w.ema) ? price(w.ema) : '—'}</td>
                    <td className="num">
                      {Number.isFinite(w.distance) ? (
                        <span>
                          {pct(w.distance)} <span className="sub">· {ratio(w.distanceAtr, 1)} ATR</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{w.stop !== undefined ? price(w.stop) : '—'}</td>
                    <td>
                      <a className="card-link" href={routeHref('estrategias', { inst: w.instId, s: 'ema200' })}>
                        Ver →
                      </a>
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
