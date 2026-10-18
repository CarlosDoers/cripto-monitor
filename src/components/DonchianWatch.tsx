import { useMemo } from 'react'
import {
  compareDonchianWatch,
  watchDonchianTrend,
  type DonchianStatus,
  type DonchianWatch as Watch,
} from '../lib/donchianWatch'
import { pct, plural, price, ratio } from '../lib/format'
import { DONCHIAN_TREND_EVIDENCE as EVIDENCE } from '../lib/indicators/donchianBreakout'
import { lateBucket, lateSentence, lateSummary } from '../lib/lateEntry'
import { profileOf, strategyByKey } from '../lib/indicators/registry'
import { type Market } from '../lib/markets'
import { routeHref } from '../lib/router'
import { useWatchScan } from '../lib/useWatchScan'
import { rowContext, sideNote } from '../lib/watchContext'
import { barChoice, barMsOf, barOf, spanText, type WatchBar } from '../lib/watchBars'
import { Badge, Card, Help, TableSkeleton, TableWrap } from './ui'
import { WatchControls } from './WatchControls'
import { ContextTags, SideBadge, WatchLegend } from './WatchCells'

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

/** A reading of one contract on one bar: the watch itself and the bar it was made on. */
type Row = Watch & { bar: WatchBar }

/**
 * What entering a long at this age measured (4 h only, longs only: the shorts have no edge to arrive late to, and 1 h was not
 * measured). Past the last bucket, which is fifteen days, it says so instead of staying quiet.
 */
function late(w: Row): string {
  if (w.bar !== '4H' || w.side !== 'long') return ''
  const b = lateBucket(w.age, EVIDENCE.late.buckets)
  if (b) return ` · ${lateSentence(b)}`
  const last = EVIDENCE.late.buckets[EVIDENCE.late.buckets.length - 1]
  return w.age > last.to ? ' · con más de 15 días no se midió entrar' : ''
}

function what(w: Row): string {
  const span = (candles: number) => spanText(candles, w.bar)
  const label = barOf(w.bar).label
  const long = w.bias === 'long'
  const edge = long ? 'el máximo' : 'el mínimo'
  const ofEma = long ? 'sobre' : 'bajo'
  // What closing there would do: turn an open position the other way, or open one.
  const turn = w.side && w.bias ? `cierra el ${w.side} y abre un ${w.bias}` : `abre un ${w.bias}`
  switch (w.status) {
    case 'nueva':
      return `abrió un ${w.side}: cerró ${w.side === 'long' ? 'sobre el máximo y sobre' : 'bajo el mínimo y bajo'} la EMA 200 hace ${span(w.age + 1)}`
    case 'rompiendo':
      return `la vela en curso ya ${long ? 'supera' : 'pierde'} ${edge} de 20 velas, ${ofEma} la EMA 200: si cierra así, ${turn}`
    case 'cerca':
      return `${ofEma} la EMA 200, a ${ratio(w.distanceAtr, 1)} ATR del ${long ? 'máximo' : 'mínimo'} de 20 velas: si una vela cierra más allá, ${turn}`
    case 'tendencia':
      return `${w.side} desde hace ${span(w.age)}${w.side !== w.bias ? ' · ya perdió la EMA 200' : ''}${late(w)}`
    case 'fuera':
      return `${ofEma} la EMA 200, sin ruptura: espera un cierre ${long ? 'sobre' : 'bajo'} ${edge} de 20 velas para abrir un ${w.bias}`
    case 'corto':
      return `${w.bars} velas de ${label}; hacen falta ${w.need}`
  }
}

/**
 * "¿Qué vigilo?" for the Donchian + EMA 200 preset: the most traded X-Perps
 * against the breakout the EMA 200 allows, on 4 h (the longer reading), 1 h (the
 * short one — the preset's marginal timeframe, which the "?" says) or both, a row
 * each. On demand, like the EMA 200 card beside it, and reading the same cached
 * candles.
 */
export function DonchianWatch({ markets }: { markets: Market[] }) {
  const scan = useWatchScan(markets)
  const { ids, boards, byId, bars: shown, view, regime, loaded } = scan
  const profile = profileOf(strategyByKey('donchian'), 'trend')
  const choices = { '4H': barChoice(profile, '4H'), '1H': barChoice(profile, '1H') }

  const rows = useMemo(() => {
    const byContract = new Map<string, Row[]>()
    for (const id of ids ?? []) {
      for (const bar of shown) {
        const candles = boards[bar].byInst[id]
        if (!candles) continue
        const m = byId.get(id)
        const w = watchDonchianTrend(candles, m?.last ?? 0, id, m?.symbol ?? id.split('-')[0], barMsOf(bar))
        byContract.set(id, [...(byContract.get(id) ?? []), { ...w, bar }])
      }
    }
    // Contracts by their most urgent reading; a contract's own rows stay longer-bar first.
    return [...byContract.values()]
      .sort((a, b) => compareDonchianWatch([...a].sort(compareDonchianWatch)[0], [...b].sort(compareDonchianWatch)[0]))
      .flat()
  }, [ids, boards, byId, shown])

  const watch = new Set(rows.filter((w) => w.status === 'nueva' || w.status === 'rompiendo' || w.status === 'cerca').map((w) => w.instId))
  const total = ids?.length ?? 0
  const label = view === 'both' ? '4 h y 1 h' : barOf(shown[0]).label
  const hourly = shown.includes('1H')
  const longer = shown.includes('4H')

  return (
    <Card
      title={`Qué vigilar · Ruptura + EMA 200 en ${label}`}
      subtitle={
        ids
          ? loaded < total
            ? `Analizando ${loaded} de ${total}…`
            : `${plural(watch.size, 'contrato para vigilar', 'contratos para vigilar')} de los ${total} más negociados`
          : 'La ruptura de 20 velas que va a favor de la EMA 200. Pulsa para ver qué X-Perp están en ella'
      }
      action={
        <Help label="Qué vigilar">
          <p>
            La estrategia: entra cuando una vela cierra por encima del máximo de las 20 anteriores y por encima de la
            EMA 200 (long), o por debajo del mínimo y de la EMA (short). Stop de 2 ATR, un trailing de 8 ATR que deja
            correr la tendencia y ningún objetivo fijo.
          </p>
          {longer && (
            <>
              <p>
                {hourly && <strong>En 4 h, la lectura larga. </strong>}
                Es la Ruptura de siempre con el filtro que mejor le sentó. En 4 h, sobre 30 criptos desde 2022, mide{' '}
                <strong>{signed(EVIDENCE.board.net)} R</strong> por operación ({thousands(EVIDENCE.board.n)}{' '}
                operaciones), positiva en las dos mitades ({signed(EVIDENCE.board.halves[0])} /{' '}
                {signed(EVIDENCE.board.halves[1])}) y frente a {signed(EVIDENCE.board.plain)} R sin el filtro. En
                2018–2021, un periodo que no se tocó, {signed(EVIDENCE.old.net)} R frente a{' '}
                {signed(EVIDENCE.old.plain)}. Los longs ganan mucho más ({signed(EVIDENCE.board.longs)} R) que los
                shorts ({signed(EVIDENCE.board.shorts)} R).
              </p>
              <p>
                Acierta una de cada cuatro y sin sus diez mejores operaciones queda en{' '}
                {signed(EVIDENCE.board.withoutBest10)} R: vive de pocas tendencias largas. El filtro sube lo que gana
                cada operación, pero quita muchas y se parece al cruce de la EMA 200, así que tomarlas todas no mejora
                el resultado mensual: sirve para elegir.
              </p>
            </>
          )}
          {hourly && (
            <>
              <p>
                {longer && <strong>En 1 h, la lectura corta, y el marco justo de esta estrategia. </strong>}
                {!longer && <strong>Es la lectura corta, y el marco justo de esta estrategia. </strong>}En 1 h, sobre 30
                criptos desde 2022, mide <strong>{signed(EVIDENCE.hourly.net)} R</strong> por operación (
                {thousands(EVIDENCE.hourly.n)} operaciones; {signed(EVIDENCE.hourly.halves[0])} /{' '}
                {signed(EVIDENCE.hourly.halves[1])} en las dos mitades) frente a {signed(EVIDENCE.hourly.plain)} R sin
                el filtro: aquí el filtro es casi toda la ventaja. Es menos de la mitad que en 4 h y aguanta peor la
                comisión: con el doble queda en {signed(EVIDENCE.hourly.doubleFee)} R, y sin sus diez mejores
                operaciones en {signed(EVIDENCE.hourly.withoutBest10)} R.
              </p>
              <p>
                Los longs ganan {signed(EVIDENCE.hourly.longs)} R y los shorts {signed(EVIDENCE.hourly.shorts)} R: en 1
                h un short no tiene ventaja medida. Salta más a menudo que en 4 h, el stop queda más cerca (un
                movimiento normal lo toca) y entrar con la tendencia ya empezada no se midió en 1 h. Úsala como
                lectura de plazo corto junto a la de 4 h, no en su lugar.
              </p>
            </>
          )}
          <p>
            <strong>Señal nueva</strong> es la entrada medida, en las dos últimas velas. <strong>Rompiendo</strong> y{' '}
            <strong>cerca</strong> son para tenerlos a la vista.
          </p>
          {longer && (
            <p>
              <strong>Entrar con la tendencia ya empezada se midió</strong> (solo longs, 4 h, {EVIDENCE.late.sample.split(', ').slice(0, 3).join(', ')}): entrando a cada tramo de edad,{' '}
              {lateSummary(EVIDENCE.late.buckets, (b) => (b.from === 1 ? `en el primer día` : `desde el día ${Math.ceil(b.from / 6)}`))}. Todos pasan el listón en las dos mitades, pero
              ninguno tiene el intervalo claramente por encima de cero y, pasados tres días, sin las diez mejores operaciones queda en cero o menos:
              llegar tarde es apostar a que esta sea una de las pocas tendencias largas. Y el stop queda mucho más lejos (del{' '}
              {pct(EVIDENCE.late.buckets[0].riskPct, 0)} al {pct(EVIDENCE.late.buckets[EVIDENCE.late.buckets.length - 1].riskPct, 0)} del precio), así que el mismo riesgo
              en dólares compra menos posición. En 1 h no se midió.
            </p>
          )}
          <p>
            La columna <strong>Señal</strong> es la entrada que se está gestando y la <strong>Posición ahora</strong> la
            que la regla ya tiene abierta, simulada: no es tu cuenta. Pueden ser contrarias — por ejemplo, un short
            abierto cuya vela en curso ya rompe hacia arriba: si cierra así, cierra el short y abre un long.
          </p>
          <p>
            <strong>Contexto</strong> dice qué era cierto al entrar: si BTC estaba sobre su EMA 200 de 4 h, cuánto
            volumen traía la vela y si cerró en fin de semana. En el histórico los longs con BTC debajo y las entradas
            con poco volumen o en fin de semana ganaron menos; la etiqueta en ámbar es ese lado, y su tooltip trae
            las cifras. Describe, no puntúa ni filtra: se encontró mirando el histórico y la sección Seguimiento lo
            pone a prueba con operaciones que entonces no existían.
          </p>
        </Help>
      }
      flush
    >
      <WatchControls scan={scan} empty={markets.length === 0} bars={choices} />

      {!ids ? null : rows.length === 0 ? (
        <TableSkeleton rows={Math.min(total, 6)} cols={7} />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Contrato</th>
                <th>Señal</th>
                <th>Posición ahora</th>
                <th>Qué pasa</th>
                <th>Contexto</th>
                <th className="num">Precio</th>
                <th className="num">Ruptura en</th>
                <th className="num">Stop de la posición</th>
                <th>Gráfico</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const s = STATUS[w.status]
                const note = (side: 'long' | 'short') => sideNote('donchian', 'trend', w.bar, side)
                return (
                  <tr key={`${w.instId}-${w.bar}`}>
                    <td>
                      <span className="watch-signal">
                        <span className="ccy">{w.symbol}</span>
                        {view === 'both' && <span className="sub">{barOf(w.bar).label}</span>}
                      </span>
                    </td>
                    <td>
                      <span className="watch-signal">
                        {w.next && <SideBadge side={w.next} note={note(w.next)} />}
                        <Badge variant={s.variant} pulse={w.status === 'nueva' || w.status === 'rompiendo'}>
                          {s.label}
                        </Badge>
                      </span>
                    </td>
                    <td>
                      {w.side ? (
                        <span className="watch-signal">
                          <SideBadge side={w.side} note={note(w.side)} />
                          {w.entry !== undefined && <span className="sub">entrada {price(w.entry)}</span>}
                        </span>
                      ) : (
                        <span className="sub">—</span>
                      )}
                    </td>
                    <td className="sub watch-what">{what(w)}</td>
                    <td>
                      <ContextTags tags={rowContext(w, regime, 'donchian', 'trend', w.bar)} />
                    </td>
                    <td className="num">{price(w.price)}</td>
                    <td className="num">
                      {Number.isFinite(w.level) ? (
                        <span>
                          {price(w.level)}{' '}
                          {Number.isFinite(w.distance) && (
                            <span className="sub">
                              · {pct(w.distance)} · {ratio(w.distanceAtr, 1)} ATR
                            </span>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{w.stop !== undefined ? price(w.stop) : '—'}</td>
                    <td>
                      <a
                        className="card-link"
                        href={routeHref('estrategias', { inst: w.instId, s: 'donchian', p: 'trend', tf: w.bar })}
                      >
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
      {ids && rows.length > 0 && <WatchLegend label={view === 'both' ? 'su marco' : label} />}
    </Card>
  )
}
