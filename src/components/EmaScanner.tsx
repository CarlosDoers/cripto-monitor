import { useMemo, useState } from 'react'
import { analyseEmaTouch, compareTouches, EMA_TOUCH_EVIDENCE, HIGH_VOLUME, LOOKBACK, type EmaTouch } from '../lib/emaTouch'
import { pct, plural, price, ratio, share } from '../lib/format'
import { MIN_LIQUID_VOLUME, type Market } from '../lib/markets'
import { useDailyBoard } from '../lib/queries'
import { routeHref } from '../lib/router'
import { Badge, Card, EmptyState, Help, TableSkeleton, TableWrap } from './ui'

type Bar = '1Dutc' | '1D'

interface Scan {
  ids: string[]
  length: number
  bar: Bar
  at: number
}

const SIZES = [10, 20] as const

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

/**
 * On demand, not on a timer: pressing the button freezes the list of the most
 * traded X-Perps and the settings, and the daily candles for those contracts
 * come from the same hourly cache the Screener already fills — so a second
 * scan within the hour costs nothing. The live price completes today's candle.
 */
export function EmaScanner({ markets }: { markets: Market[] }) {
  const [size, setSize] = useState<(typeof SIZES)[number]>(10)
  const [cryptoOnly, setCryptoOnly] = useState(true)
  const [length, setLength] = useState(25)
  const [bar, setBar] = useState<Bar>('1Dutc')
  const [scan, setScan] = useState<Scan | null>(null)

  const board = useDailyBoard(scan?.ids ?? [], scan?.bar ?? '1Dutc')
  const byId = useMemo(() => new Map(markets.map((m) => [m.instId, m])), [markets])

  const run = () => {
    const ids = markets
      .filter((m) => m.volumeUsd >= MIN_LIQUID_VOLUME && (!cryptoOnly || m.category === 'cripto'))
      .sort((a, b) => b.volumeUsd - a.volumeUsd)
      .slice(0, size)
      .map((m) => m.instId)
    setScan({ ids, length, bar, at: Date.now() })
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
  const recent = results.filter((t) => t.ago !== null && t.ago <= 1)
  const ev = EMA_TOUCH_EVIDENCE

  return (
    <Card
      title={`Toques a la EMA ${scan?.length ?? length} diaria`}
      subtitle={
        scan
          ? `${scan.ids.length} X-Perp más negociados · ${loaded < total ? `analizando ${loaded} de ${total}…` : `${plural(recent.length, 'toca', 'tocan')} hoy o ayer`} · cierre diario ${scan.bar === '1Dutc' ? 'UTC (TradingView)' : 'Hong Kong (OKX)'}`
          : '¿Qué contratos de los más negociados han tocado su media? Elige y pulsa escanear'
      }
      action={
        <Help label="Toques a la EMA">
          <p>
            Un toque es una vela diaria cuyo rango incluye la EMA de ese día: el mínimo por debajo o en ella y el
            máximo por encima. La vela de hoy cuenta con el precio en vivo.
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
        <label className="ema-length">
          EMA
          <input
            type="number"
            min={5}
            max={60}
            value={length}
            onChange={(e) => setLength(Math.min(60, Math.max(5, Math.round(Number(e.target.value) || 25))))}
          />
        </label>
        <div className="seg-control" aria-label="Cierre de la vela diaria">
          <button type="button" aria-pressed={bar === '1Dutc'} onClick={() => setBar('1Dutc')} title="La vela diaria cierra a las 00:00 UTC, como en TradingView">
            Cierre UTC
          </button>
          <button type="button" aria-pressed={bar === '1D'} onClick={() => setBar('1D')} title="La vela diaria cierra a las 16:00 UTC (medianoche de Hong Kong), como en la app de OKX">
            Cierre OKX
          </button>
        </div>
        <button type="button" className="btn btn--primary" onClick={run} disabled={markets.length === 0}>
          {scan ? 'Volver a escanear' : 'Escanear'}
        </button>
      </div>

      {!scan ? null : loaded === 0 ? (
        <TableSkeleton rows={Math.min(total, 6)} cols={9} />
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
              {results.map((t) => {
                const s = status(t)
                return (
                  <tr key={t.instId}>
                    <td>
                      <span className="ccy">{t.symbol}</span>
                    </td>
                    <td>
                      <Badge variant={s.variant} pulse={t.ago === 0}>
                        {s.label}
                      </Badge>
                    </td>
                    <td className="sub">
                      {t.short
                        ? `${t.bars} velas; hacen falta ${scan.length * 3}`
                        : t.ago === null
                          ? `ninguno en ${LOOKBACK} días`
                          : `desde ${t.from} · ${t.crossed ? 'la cruzó' : t.ago === 0 ? 'de momento aguanta' : 'aguantó'}`}
                    </td>
                    <td className="sub">
                      {t.structure === null ? (
                        '—'
                      ) : (
                        <span>
                          {t.structure}
                          {t.favour !== null && <> · {t.favour ? 'a favor' : 'en contra'}</>}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {t.ago === null || !Number.isFinite(t.volume) ? (
                        <span className="muted">—</span>
                      ) : t.volumePartial ? (
                        <span className="muted" title="La vela de hoy sigue abierta: su volumen aún no es comparable">
                          en curso
                        </span>
                      ) : (
                        <span>
                          {ratio(t.volume, 1)}×{t.volume >= HIGH_VOLUME && <span className="sub"> alto</span>}
                        </span>
                      )}
                    </td>
                    <td className="num">{price(t.price)}</td>
                    <td className="num">{t.short ? '—' : price(t.ema)}</td>
                    <td className="num">
                      {/* Neutral ink: above the average is not a gain, and green and red are
                          kept for PnL. The sign carries the side. */}
                      {t.short ? '—' : pct(t.distance)}
                    </td>
                    <td className="sub">{t.short ? '—' : t.slope}</td>
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
      {scan && loaded === 0 && total === 0 && (
        <EmptyState title="Ningún contrato cumple" hint="No hay X-Perp con más de 1 M$ de volumen diario en esa selección." />
      )}
    </Card>
  )
}
