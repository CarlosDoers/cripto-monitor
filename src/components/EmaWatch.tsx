import { useMemo } from 'react'
import { compareWatch, watchEmaCross, type EmaWatch as Watch, type WatchStatus } from '../lib/emaWatch'
import { CONTEXT_EVIDENCE, HIGH_VOLUME } from '../lib/entryContext'
import { pct, plural, price, ratio } from '../lib/format'
import { type Market } from '../lib/markets'
import { profileOf, strategyByKey } from '../lib/indicators/registry'
import { routeHref } from '../lib/router'
import { useWatchScan } from '../lib/useWatchScan'
import { rowContext, sideNote } from '../lib/watchContext'
import { barChoice, barMsOf, barOf, spanText, type WatchBar } from '../lib/watchBars'
import { Badge, Card, Help, TableSkeleton, TableWrap } from './ui'
import { WatchControls } from './WatchControls'
import { ContextTags, SideBadge, WatchLegend } from './WatchCells'

const STATUS: Record<WatchStatus, { label: string; variant: 'live' | 'buy' | 'warn' | 'neutral' }> = {
  nueva: { label: 'Señal nueva', variant: 'live' },
  cruzando: { label: 'Cruzando ahora', variant: 'warn' },
  cerca: { label: 'Cerca de cruzar', variant: 'buy' },
  tendencia: { label: 'En tendencia', variant: 'neutral' },
  fuera: { label: 'Sin posición', variant: 'neutral' },
  corto: { label: 'Historial corto', variant: 'neutral' },
}

type Row = Watch & { bar: WatchBar }

const signed = (x: number) => `${x >= 0 ? '+' : '−'}${ratio(Math.abs(x))}`

function what(w: Row): string {
  const span = (candles: number) => spanText(candles, w.bar)
  // What closing across the line would do: turn the open position, or open one.
  const turn = w.side && w.next ? `cierra el ${w.side} y abre un ${w.next}` : `abre un ${w.next}`
  switch (w.status) {
    case 'nueva':
      return `abrió un ${w.side}: cerró ${w.side === 'long' ? 'sobre' : 'bajo'} la EMA hace ${span(w.age + 1)}`
    case 'cruzando':
      return `la vela en curso va ${w.side === 'long' ? 'por debajo' : 'por encima'} de la EMA: si cierra así, ${turn}`
    case 'cerca':
      return `a ${ratio(w.distanceAtr, 1)} ATR de la EMA: si una vela la cruza, ${turn}`
    case 'tendencia':
      return `${w.side} desde hace ${span(w.age)}`
    case 'fuera':
      return 'saltó el stop; espera al próximo cruce'
    case 'corto':
      return `${w.bars} velas de ${barOf(w.bar).label}; hacen falta 600`
  }
}

/**
 * "¿Qué vigilo?": the most traded X-Perps against the EMA 200 strategy on 4 h,
 * the one EMA configuration of the 162 swept that cleared the bar. On demand,
 * like the touch scan below it. Only 4 h is offered — the registry blocks the
 * strategy on 1 h, and so does this card.
 */
export function EmaWatch({ markets }: { markets: Market[] }) {
  const scan = useWatchScan(markets)
  const { ids, boards, byId, bars: shown, view, regime, loaded } = scan
  const strategy = strategyByKey('ema200')
  const profile = profileOf(strategy, strategy.presets[0].key)
  const ev = CONTEXT_EVIDENCE['ema200/base@4H']
  // The cross is only measured as tradable on 4 h: 1 h is offered disabled, with the reason.
  const choices = { '4H': barChoice(profile, '4H'), '1H': barChoice(profile, '1H') }

  const rows = useMemo(() => {
    const byContract = new Map<string, Row[]>()
    for (const id of ids ?? []) {
      for (const bar of shown) {
        const candles = boards[bar].byInst[id]
        if (!candles) continue
        const m = byId.get(id)
        const w = watchEmaCross(candles, m?.last ?? 0, id, m?.symbol ?? id.split('-')[0], barMsOf(bar))
        byContract.set(id, [...(byContract.get(id) ?? []), { ...w, bar }])
      }
    }
    return [...byContract.values()]
      .sort((a, b) => compareWatch([...a].sort(compareWatch)[0], [...b].sort(compareWatch)[0]))
      .flat()
  }, [ids, boards, byId, shown])

  const watch = new Set(rows.filter((w) => w.status === 'nueva' || w.status === 'cruzando' || w.status === 'cerca').map((w) => w.instId))
  const total = ids?.length ?? 0
  const label = view === 'both' ? '4 h y 1 h' : barOf(shown[0]).label

  return (
    <Card
      title={`Qué vigilar · EMA 200 en ${label}`}
      subtitle={
        ids
          ? loaded < total
            ? `Analizando ${loaded} de ${total}…`
            : `${plural(watch.size, 'contrato para vigilar', 'contratos para vigilar')} de los ${total} más negociados`
          : 'La única combinación de EMA que pasó el listón, de 162 probadas. Pulsa para ver qué X-Perp están en ella'
      }
      action={
        <Help label="Qué vigilar">
          <p>
            La estrategia: long mientras las velas de 4 h cierran por encima de la EMA 200, short mientras cierran
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
          <p>
            La columna <strong>Señal</strong> es la entrada que se está gestando y la <strong>Posición ahora</strong> la
            que la estrategia ya tiene abierta, simulada: no es tu cuenta. Aquí siempre son contrarias mientras cruza:
            un long abierto con la vela ya por debajo de la EMA es un short en camino.
          </p>
          <p>
            <strong>Contexto</strong> dice qué era cierto al entrar: si BTC estaba sobre su EMA 200 de 4 h, cuánto
            volumen traía la vela y si cerró en fin de semana. En el cruce, con la vela a {ratio(HIGH_VOLUME, 1)} veces el
            volumen medio o más midió {signed(ev.volume.with)} R por operación y con menos {signed(ev.volume.without)} R;
            los longs con BTC sobre su EMA, {signed(ev.longs.with)} R y con BTC debajo {signed(ev.longs.without)} R.
            Describe, no puntúa ni filtra: se encontró mirando el histórico y la sección Seguimiento lo pone a prueba
            con operaciones que entonces no existían.
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
                <th className="num">EMA 200</th>
                <th className="num">Stop de la posición</th>
                <th>Gráfico</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const s = STATUS[w.status]
                const note = (side: 'long' | 'short') => sideNote('ema200', 'base', w.bar, side)
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
                        <Badge variant={s.variant} pulse={w.status === 'nueva' || w.status === 'cruzando'}>
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
                      <ContextTags tags={rowContext(w, regime, 'ema200', 'base', w.bar)} />
                    </td>
                    <td className="num">{price(w.price)}</td>
                    <td className="num">
                      {Number.isFinite(w.ema) ? (
                        <span>
                          {price(w.ema)}{' '}
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
                        href={routeHref('estrategias', { inst: w.instId, s: 'ema200', tf: w.bar })}
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
      {ids && rows.length > 0 && <WatchLegend label={view === 'both' ? 'su marco' : barOf(shown[0]).label} />}
    </Card>
  )
}
