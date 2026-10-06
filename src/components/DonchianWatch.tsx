import { useMemo } from 'react'
import {
  compareDonchianWatch,
  watchDonchianTrend,
  type DonchianStatus,
  type DonchianWatch as Watch,
} from '../lib/donchianWatch'
import { pct, plural, price, ratio } from '../lib/format'
import { DONCHIAN_TREND_EVIDENCE as EVIDENCE } from '../lib/indicators/donchianBreakout'
import { type Market } from '../lib/markets'
import { routeHref } from '../lib/router'
import { hoursOf as hours, useWatchScan } from '../lib/useWatchScan'
import { Badge, Card, Help, TableSkeleton, TableWrap } from './ui'
import { WatchControls } from './WatchControls'

const STATUS: Record<DonchianStatus, { label: string; variant: 'live' | 'buy' | 'warn' | 'neutral' }> = {
  nueva: { label: 'Señal nueva', variant: 'live' },
  rompiendo: { label: 'Rompiendo ahora', variant: 'warn' },
  cerca: { label: 'Cerca de romper', variant: 'buy' },
  tendencia: { label: 'En tendencia', variant: 'neutral' },
  fuera: { label: 'Sin posición', variant: 'neutral' },
  corto: { label: 'Historial corto', variant: 'neutral' },
}

const signed = (x: number) => `${x >= 0 ? '+' : '−'}${ratio(Math.abs(x))}`
const thousands = (n: number) => new Intl.NumberFormat('es-ES').format(n)

const entry = (w: Watch) => (w.entry === undefined ? '—' : price(w.entry))

function what(w: Watch): string {
  const long = w.bias === 'long'
  const edge = long ? 'el máximo' : 'el mínimo'
  const ofEma = long ? 'sobre' : 'bajo'
  switch (w.status) {
    case 'nueva':
      return `${w.side === 'long' ? 'largo' : 'corto'}: cerró ${w.side === 'long' ? 'sobre el máximo y sobre' : 'bajo el mínimo y bajo'} la EMA 200 hace ${hours(w.age + 1)} · entrada ${entry(w)}`
    case 'rompiendo':
      return `la vela en curso ya ${long ? 'supera' : 'pierde'} ${edge} de 20 velas, ${ofEma} la EMA 200: si cierra así, ${w.side ? 'da la vuelta' : `entra en ${long ? 'largo' : 'corto'}`}`
    case 'cerca':
      return `${ofEma} la EMA 200, a ${ratio(w.distanceAtr, 1)} ATR de ${edge} de 20 velas: una vela podría romperlo${w.side ? ' y darle la vuelta' : ''}`
    case 'tendencia':
      return `${w.side === 'long' ? 'largo' : 'corto'} desde hace ${hours(w.age)} · entrada ${entry(w)}${w.side !== w.bias ? ' · ya perdió la EMA 200' : ''}`
    case 'fuera':
      return `${ofEma} la EMA 200, sin ruptura: espera un cierre ${long ? 'sobre' : 'bajo'} ${edge} de 20 velas`
    case 'corto':
      return `${w.bars} velas de 4 h; hacen falta ${w.need}`
  }
}

/**
 * "¿Qué vigilo?" for the Donchian + EMA 200 preset on 4 h: the most traded
 * X-Perps against the breakout the EMA 200 allows. On demand, like the EMA 200
 * card beside it, and reading the same cached candles.
 */
export function DonchianWatch({ markets }: { markets: Market[] }) {
  const scan = useWatchScan(markets)
  const { ids, board, byId } = scan

  const rows = useMemo(
    () =>
      (ids ?? [])
        .filter((id) => board.byInst[id])
        .map((id) => {
          const m = byId.get(id)
          return watchDonchianTrend(board.byInst[id], m?.last ?? 0, id, m?.symbol ?? id.split('-')[0])
        })
        .sort(compareDonchianWatch),
    [ids, board.byInst, byId],
  )
  const watch = rows.filter((w) => w.status === 'nueva' || w.status === 'rompiendo' || w.status === 'cerca')
  const total = ids?.length ?? 0

  return (
    <Card
      title="Qué vigilar · Ruptura + EMA 200 en 4 h"
      subtitle={
        ids
          ? board.loaded < total
            ? `Analizando ${board.loaded} de ${total}…`
            : `${plural(watch.length, 'contrato para vigilar', 'contratos para vigilar')} de los ${total} más negociados`
          : 'La ruptura de 20 velas que va a favor de la EMA 200. Pulsa para ver qué X-Perp están en ella'
      }
      action={
        <Help label="Qué vigilar">
          <p>
            La estrategia: entra cuando una vela de 4 h cierra por encima del máximo de las 20 anteriores y por encima
            de la EMA 200 (largo), o por debajo del mínimo y de la EMA (corto). Stop de 2 ATR, un trailing de 8 ATR que
            deja correr la tendencia y ningún objetivo fijo.
          </p>
          <p>
            Es la Ruptura de siempre con el filtro que mejor le sentó. En 4 h, sobre 30 criptos desde 2022, mide{' '}
            <strong>{signed(EVIDENCE.board.net)} R</strong> por operación ({thousands(EVIDENCE.board.n)} operaciones),
            positiva en las dos mitades ({signed(EVIDENCE.board.halves[0])} / {signed(EVIDENCE.board.halves[1])}) y
            frente a {signed(EVIDENCE.board.plain)} R sin el filtro. En 2018–2021, un periodo que no se tocó,{' '}
            {signed(EVIDENCE.old.net)} R frente a {signed(EVIDENCE.old.plain)}. Los largos ganan mucho más (
            {signed(EVIDENCE.board.longs)} R) que los cortos ({signed(EVIDENCE.board.shorts)} R).
          </p>
          <p>
            Acierta una de cada cuatro y sin sus diez mejores operaciones queda en {signed(EVIDENCE.board.withoutBest10)}{' '}
            R: vive de pocas tendencias largas. El filtro sube lo que gana cada operación, pero quita muchas y se parece
            al cruce de la EMA 200, así que tomarlas todas no mejora el resultado mensual: sirve para elegir.
          </p>
          <p>
            <strong>Señal nueva</strong> es la entrada medida, en las dos últimas velas. <strong>Rompiendo</strong> y{' '}
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
                <th className="num">Ruptura en</th>
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
                      <Badge variant={s.variant} pulse={w.status === 'nueva' || w.status === 'rompiendo'}>
                        {s.label}
                      </Badge>
                    </td>
                    <td className="sub watch-what">{what(w)}</td>
                    <td className="num">{price(w.price)}</td>
                    <td className="num">{Number.isFinite(w.level) ? price(w.level) : '—'}</td>
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
                      <a className="card-link" href={routeHref('estrategias', { inst: w.instId, s: 'donchian', p: 'trend' })}>
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
