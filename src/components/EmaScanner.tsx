import { useEffect, useMemo, useRef, useState } from 'react'
import { diffScans, readScan, scanKey, writeScan, type ScanRecord } from '../lib/emaScanMemory'
import {
  analyseEmaTouch,
  compareTouches,
  countSides,
  EMA_TOUCH_EVIDENCE,
  HIGH_VOLUME,
  structureText,
  touchesWithin,
  touchStory,
  type EmaTouch,
} from '../lib/emaTouch'
import { pct, plural, price, ratio, share, timeAgo } from '../lib/format'
import { MIN_LIQUID_VOLUME, type Market } from '../lib/markets'
import { useDailyBoard } from '../lib/queries'
import { routeHref } from '../lib/router'
import { NARROW, useMediaQuery } from '../lib/useMediaQuery'
import { Badge, Card, EmptyState, Help, TableSkeleton, TableWrap } from './ui'

type Bar = '1Dutc' | '1D'

interface Scan {
  ids: string[]
  length: number
  bar: Bar
  /** How many candles back count: 3 is today, yesterday and the day before. */
  window: Window
  size: Size
  cryptoOnly: boolean
  at: number
  /** What the last scan with these same settings found, read when this one started. */
  previous: ScanRecord | null
}

const SIZES = [10, 20] as const
type Size = (typeof SIZES)[number]
const WINDOWS = [3, 10] as const
type Window = (typeof WINDOWS)[number]
type Side = 'todos' | 'arriba' | 'abajo'

/** An X-Perp has ~185 daily bars and the EMA needs three times its length: 60 is the most that fits. */
const MIN_LENGTH = 5
const MAX_LENGTH = 60
const SHORTCUTS = [10, 25, 50] as const
const clampLength = (text: string) => Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(Number(text)) || 25))

const signedR = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${ratio(Math.abs(x))}`

const status = (t: EmaTouch) =>
  t.short
    ? { label: 'Historial corto', variant: 'neutral' as const }
    : t.ago === 0
      ? { label: 'Tocando hoy', variant: 'live' as const }
      : t.ago === 1
        ? { label: 'Tocó ayer', variant: 'buy' as const }
        : t.ago !== null
          ? { label: `Hace ${t.ago} días`, variant: 'neutral' as const }
          : { label: 'Sin toque', variant: 'neutral' as const }

function Volume({ t }: { t: EmaTouch }) {
  if (t.ago === null || !Number.isFinite(t.volume)) return <span className="muted">—</span>
  if (t.volumePartial) {
    return (
      <span className="muted" title="La vela de hoy sigue abierta: su volumen aún no es comparable">
        en curso
      </span>
    )
  }
  return (
    <span>
      {ratio(t.volume, 1)}×{t.volume >= HIGH_VOLUME && <span className="sub"> alto</span>}
    </span>
  )
}

/**
 * On demand, not on a timer: pressing the button freezes the list of the most
 * traded X-Perps and the settings, and the daily candles for those contracts
 * come from the same hourly cache the Screener already fills — so a second
 * scan within the hour costs nothing. The live price completes today's candle.
 *
 * It answers one question — which of the 20 most liquid contracts touched the
 * EMA in the last 3 candles — so the table holds only those, with the day of
 * each touch, and the rest are named in a line underneath. Around it, only
 * description: which side each came from, how long it had stayed away, and what
 * changed since the last scan with the same settings. None of that ranks
 * anything — the touch was measured and carries no edge, nor does a filter on it.
 */
export function EmaScanner({ markets }: { markets: Market[] }) {
  const [size, setSize] = useState<Size>(20)
  const [cryptoOnly, setCryptoOnly] = useState(true)
  // Kept as typed: clamping on every keystroke turned "30" into "5" and then "50".
  const [lengthText, setLengthText] = useState('25')
  const [bar, setBar] = useState<Bar>('1Dutc')
  const [window, setWindow] = useState<Window>(3)
  const [side, setSide] = useState<Side>('todos')
  const [scan, setScan] = useState<Scan | null>(null)
  const [kept, setKept] = useState(false)
  const narrow = useMediaQuery(NARROW)

  const length = clampLength(lengthText)
  const board = useDailyBoard(scan?.ids ?? [], scan?.bar ?? '1Dutc')
  const byId = useMemo(() => new Map(markets.map((m) => [m.instId, m])), [markets])
  const symbolOf = (id: string) => byId.get(id)?.symbol ?? id.split('-')[0]

  const run = () => {
    const ids = markets
      .filter((m) => m.volumeUsd >= MIN_LIQUID_VOLUME && (!cryptoOnly || m.category === 'cripto'))
      .sort((a, b) => b.volumeUsd - a.volumeUsd)
      .slice(0, size)
      .map((m) => m.instId)
    const next = { length, bar, window, size, cryptoOnly }
    setLengthText(String(length))
    setSide('todos')
    setKept(false)
    setScan({ ...next, ids, at: Date.now(), previous: readScan(scanKey(next)) })
  }

  const results = useMemo(() => {
    if (!scan) return []
    return scan.ids
      .filter((id) => board.byInst[id])
      .map((id) => {
        const m = byId.get(id)
        return analyseEmaTouch(board.byInst[id], scan.length, m?.last ?? 0, id, m?.symbol ?? id.split('-')[0])
      })
      .sort(compareTouches)
  }, [scan, board.byInst, byId])

  const loaded = results.length
  const total = scan?.ids.length ?? 0
  // Every request has answered, well or badly: a contract that fails must not
  // leave the card at "Analizando 19 de 20…" for good.
  const done = !!scan && board.pending === 0
  const unread = done && scan ? scan.ids.filter((id) => !board.byInst[id]).map(symbolOf) : []
  // Those that touched inside the window go in the table; the rest are only named.
  const hits = scan ? results.filter((t) => !t.short && touchesWithin(t, scan.window).length > 0) : []
  const misses = scan ? results.filter((t) => !t.short && touchesWithin(t, scan.window).length === 0) : []
  const shorts = results.filter((t) => t.short)
  const sides = countSides(hits)
  const shown = side === 'todos' ? hits : hits.filter((t) => t.from === side)
  const windowText = scan?.window === 3 ? 'las últimas 3 velas' : `los últimos ${scan?.window} días`
  const ev = EMA_TOUCH_EVIDENCE

  // What changed since the previous scan with the same settings. The record is
  // saved once per scan, when it is complete; the comparison follows the live
  // price, like the table does.
  // `hits` is rebuilt every render; its ids are what the record depends on.
  const hitKey = hits.map((t) => t.instId).join()
  const record = useMemo<ScanRecord | null>(
    () => (scan && done ? { at: scan.at, scanned: scan.ids, hits: hitKey ? hitKey.split(',') : [] } : null),
    [scan, done, hitKey],
  )
  const changes = scan && record ? diffScans(scan.previous, record) : null
  const savedFor = useRef(0)
  useEffect(() => {
    if (!scan || !record || savedFor.current === scan.at) return
    savedFor.current = scan.at
    setKept(writeScan(scanKey(scan), record))
  }, [scan, record])
  const fresh = new Set(changes?.fresh)

  const cardTitle = `Toques a la EMA ${scan?.length ?? length} diaria`
  const closeText = scan?.bar === '1Dutc' ? 'UTC (TradingView)' : 'Hong Kong (OKX)'

  return (
    <Card
      title={cardTitle}
      subtitle={
        scan
          ? `${!done ? `Analizando ${loaded} de ${total}…` : `${hits.length} de los ${total} X-Perp más negociados ${hits.length === 1 ? 'tocó' : 'tocaron'} la EMA ${scan.length} en ${windowText}`} · cierre diario ${closeText}`
          : '¿Cuáles de los contratos más negociados han tocado su media en las últimas velas? Pulsa para buscarlo'
      }
      action={
        <Help label="Toques a la EMA">
          <p>
            Un toque es una vela diaria cuyo rango incluye la EMA de ese día: el mínimo por debajo o en ella y el
            máximo por encima. La vela de hoy cuenta con el precio en vivo. Por defecto se miran las últimas 3
            velas —hoy, que sigue abierta, ayer y anteayer— de los 20 contratos con más volumen; también puedes
            ampliar a 10 días.
          </p>
          <p>
            <strong>Desde arriba</strong> es que el precio venía por encima y bajó hasta la media;{' '}
            <strong>desde abajo</strong>, que venía por debajo y subió hasta ella. Cuenta la vela anterior al último
            toque. <strong>Antes</strong> dice cuántos días llevaba sin tocarla: un contrato que acaba de llegar y uno
            que lleva días pegado a ella no son lo mismo de ver, aunque ninguno de los dos sea mejor señal.
          </p>
          <p>
            <strong>Nuevo</strong> y <strong>ya no toca</strong> comparan con la última búsqueda hecha con los mismos
            ajustes, y se guardan solo en este navegador.
          </p>
          <p>
            <strong>Es contexto, no una señal.</strong> Medido con la EMA {ev.length} diaria en {ev.coins} criptos desde{' '}
            {ev.since} ({ev.touches} toques): tras tocarla, el precio se alejó un ATR por el lado
            del que venía el {share(ev.rejection, 0)} de las veces; con copias de la misma línea desplazadas, el{' '}
            {share(ev.decoy, 0)}.
          </p>
          <p>
            <strong>Estructura, volumen y vela tampoco la hacen más fiable.</strong> Con la estructura a favor:{' '}
            {share(ev.favour.rejection, 0)} (las copias, {share(ev.favour.decoy, 0)}). Con volumen alto es peor,{' '}
            {share(ev.highVolume.rejection, 0)}: suele acompañar a las rupturas. Las tres juntas llegan al{' '}
            {share(ev.all3.rejection, 0)}, pero las copias con el mismo filtro, al {share(ev.all3.decoy, 0)}: lo que sube
            es el filtro (una vela fuerte a favor de la tendencia), no la EMA.
          </p>
          <p>
            <strong>Y operado tampoco gana.</strong> Entrando al cierre de la vela que aguanta, con el stop en su mecha y
            objetivo de 2 veces el riesgo: {signedR(ev.trade.netR)} R por operación en {ev.trade.n} operaciones. Saliendo
            cuando una vela cierra al otro lado de la EMA da {signedR(ev.trade.emaExitNetR)} R, pero solo por cinco
            tendencias enormes: sin ellas, {signedR(ev.trade.emaExitWithoutTop5)} R.
          </p>
        </Help>
      }
      flush
    >
      <div className="table-controls-bar ema-controls">
        <div className="seg-control" aria-label="Cuántos contratos">
          {SIZES.map((n) => (
            <button key={n} type="button" aria-pressed={size === n} onClick={() => setSize(n)}>
              Top {n}
            </button>
          ))}
        </div>
        <div className="seg-control" aria-label="Qué contratos">
          <button type="button" aria-pressed={cryptoOnly} onClick={() => setCryptoOnly(true)}>
            Cripto
          </button>
          <button type="button" aria-pressed={!cryptoOnly} onClick={() => setCryptoOnly(false)}>
            Todo
          </button>
        </div>
        <div className="seg-control" aria-label="Cuántas velas mirar">
          {WINDOWS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={window === n}
              onClick={() => setWindow(n)}
              title={n === 3 ? 'Hoy (aún abierta), ayer y anteayer' : 'Los últimos 10 días'}
            >
              {n === 3 ? 'Últimas 3 velas' : '10 días'}
            </button>
          ))}
        </div>
        <div className="ema-length-group">
          <label className="ema-length">
            EMA
            <input
              type="number"
              inputMode="numeric"
              min={MIN_LENGTH}
              max={MAX_LENGTH}
              value={lengthText}
              onChange={(e) => setLengthText(e.target.value)}
              onBlur={() => setLengthText(String(length))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') run()
              }}
            />
          </label>
          <div className="seg-control" aria-label="Longitudes habituales">
            {SHORTCUTS.map((n) => (
              <button key={n} type="button" aria-pressed={length === n} onClick={() => setLengthText(String(n))}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="seg-control" aria-label="Cierre de la vela diaria">
          <button type="button" aria-pressed={bar === '1Dutc'} onClick={() => setBar('1Dutc')} title="La vela diaria cierra a las 00:00 UTC, como en TradingView">
            Cierre UTC
          </button>
          <button type="button" aria-pressed={bar === '1D'} onClick={() => setBar('1D')} title="La vela diaria cierra a las 16:00 UTC (medianoche de Hong Kong), como en la app de OKX">
            Cierre OKX
          </button>
        </div>
        <button type="button" className="btn btn--primary" onClick={run} disabled={markets.length === 0}>
          {scan ? 'Volver a buscar' : 'Buscar toques'}
        </button>
      </div>

      {scan && done && total > 0 && (
        <p className="ema-changes">
          {changes ? (
            changes.fresh.length === 0 && changes.gone.length === 0 ? (
              <span>Sin cambios desde el escaneo {timeAgo(changes.since)}.</span>
            ) : (
              <span>
                Desde el escaneo {timeAgo(changes.since)}:{' '}
                {changes.fresh.length > 0 && (
                  <span>
                    <strong>{plural(changes.fresh.length, 'nuevo', 'nuevos')}</strong> ({changes.fresh.map(symbolOf).join(', ')})
                  </span>
                )}
                {changes.fresh.length > 0 && changes.gone.length > 0 && ' · '}
                {changes.gone.length > 0 && (
                  <span>
                    <strong>{changes.gone.length === 1 ? 'ya no toca' : 'ya no tocan'}</strong> ({changes.gone.map(symbolOf).join(', ')})
                  </span>
                )}
                .
              </span>
            )
          ) : kept ? (
            <span>Primer escaneo con estos ajustes: el siguiente dirá qué ha cambiado.</span>
          ) : null}
        </p>
      )}

      {scan && done && hits.length > 1 && (
        <div className="ema-filter">
          {sides.arriba > 0 && sides.abajo > 0 ? (
            <div className="seg-control" aria-label="Por dónde venía el precio">
              <button type="button" aria-pressed={side === 'todos'} onClick={() => setSide('todos')}>
                Todos {hits.length}
              </button>
              <button type="button" aria-pressed={side === 'arriba'} onClick={() => setSide('arriba')} title="El precio venía por encima y bajó hasta la EMA">
                Desde arriba {sides.arriba}
              </button>
              <button type="button" aria-pressed={side === 'abajo'} onClick={() => setSide('abajo')} title="El precio venía por debajo y subió hasta la EMA">
                Desde abajo {sides.abajo}
              </button>
            </div>
          ) : (
            <span>
              {sides.arriba > 0
                ? `Los ${hits.length} vinieron desde arriba: bajaron hasta la EMA.`
                : `Los ${hits.length} vinieron desde abajo: subieron hasta la EMA.`}
            </span>
          )}
        </div>
      )}

      {!scan ? null : loaded === 0 ? (
        !done ? (
          <TableSkeleton rows={Math.min(total, 6)} cols={9} />
        ) : total > 0 ? (
          <p className="ema-rest">No se pudieron leer las velas de ninguno de los {total} contratos. Vuelve a buscar en un momento.</p>
        ) : null
      ) : hits.length === 0 ? (
        done && (
          <p className="ema-rest">
            Ninguno de los {total - unread.length} contratos ha tocado la EMA {scan.length} en {windowText}.
          </p>
        )
      ) : narrow ? (
        <div className="ema-list">
          {shown.map((t) => {
            const s = status(t)
            return (
              <details key={t.instId} className="ema-item">
                <summary>
                  <span className="ccy">{symbolOf(t.instId)}</span>
                  <Badge variant={s.variant} pulse={t.ago === 0}>
                    {s.label}
                  </Badge>
                  {fresh.has(t.instId) && <Badge variant="warn">Nuevo</Badge>}
                  <span className="sub">desde {t.from}</span>
                  <span className="num">{pct(t.distance)}</span>
                </summary>
                <dl>
                  <dt>Cómo</dt>
                  <dd className="sub">{touchStory(t, scan.window)}</dd>
                  <dt>Estructura</dt>
                  <dd className="sub">{structureText(t)}</dd>
                  <dt>Volumen</dt>
                  <dd>
                    <Volume t={t} />
                  </dd>
                  <dt>Precio</dt>
                  <dd>{price(t.price)}</dd>
                  <dt>EMA {scan.length}</dt>
                  <dd>{price(t.ema)}</dd>
                  <dt>Pendiente</dt>
                  <dd className="sub">{t.slope}</dd>
                </dl>
                <a className="card-link ema-item-link" href={routeHref('analisis', { inst: t.instId, ema: String(scan.length) })}>
                  Ver en el gráfico →
                </a>
              </details>
            )
          })}
        </div>
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Contrato</th>
                <th>Estado</th>
                <th>Cómo</th>
                <th>Estructura</th>
                <th className="num">Volumen</th>
                <th className="num">Precio</th>
                <th className="num">EMA {scan.length}</th>
                <th className="num">Distancia</th>
                <th>Pendiente</th>
                <th>Gráfico</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const s = status(t)
                return (
                  <tr key={t.instId}>
                    <td>
                      <span>
                        <span className="ccy">{t.symbol}</span> {fresh.has(t.instId) && <Badge variant="warn">Nuevo</Badge>}
                      </span>
                    </td>
                    <td>
                      <Badge variant={s.variant} pulse={t.ago === 0}>
                        {s.label}
                      </Badge>
                    </td>
                    <td className="sub watch-what">{touchStory(t, scan.window)}</td>
                    <td className="sub">{structureText(t)}</td>
                    <td className="num">
                      <Volume t={t} />
                    </td>
                    <td className="num">{price(t.price)}</td>
                    <td className="num">{price(t.ema)}</td>
                    <td className="num">
                      {/* Neutral ink: above the average is not a gain, and green and red are
                          kept for PnL. The sign carries the side. */}
                      {pct(t.distance)}
                    </td>
                    <td className="sub">{t.slope}</td>
                    <td>
                      <a
                        className="card-link"
                        href={routeHref('analisis', { inst: t.instId, ema: String(scan.length) })}
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
      {scan && done && hits.length > 0 && shown.length === 0 && (
        <p className="ema-rest">Ninguno de los que tocaron vino desde {side}.</p>
      )}
      {scan && done && total > 0 && (misses.length > 0 || shorts.length > 0 || unread.length > 0) && (
        <p className="ema-rest">
          {misses.length > 0 && (
            <span>
              <strong>Sin toque en {windowText}:</strong> {misses.map((t) => t.symbol).join(', ')}.{' '}
            </span>
          )}
          {shorts.length > 0 && (
            <span>
              <strong>Historial corto</strong> (hacen falta {scan.length * 3} velas diarias): {shorts.map((t) => t.symbol).join(', ')}.{' '}
            </span>
          )}
          {unread.length > 0 && loaded > 0 && (
            <span>
              <strong>No se pudieron leer:</strong> {unread.join(', ')}.
            </span>
          )}
        </p>
      )}
      {scan && done && total === 0 && (
        <EmptyState title="Ningún contrato cumple" hint="No hay X-Perp con más de 1 M$ de volumen diario en esa selección." />
      )}
    </Card>
  )
}
