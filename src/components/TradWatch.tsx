import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { runWatchNow } from '../lib/api'
import { compactUsd, pct, plural, quote, ratio } from '../lib/format'
import type { TradBoardRow } from '../lib/ledgerModel'
import type { Market } from '../lib/markets'
import { useTradBoard } from '../lib/queries'
import { lateBucket, lateSentence, lateSummary } from '../lib/lateEntry'
import { routeHref } from '../lib/router'
import {
  tradDisplay,
  tradFollowed,
  tradKindNote,
  thinReasons,
  tradSymbolByOkx,
  TRAD_KIND,
  TRAD_LIQUIDITY,
  TRAD_TREND_EVIDENCE as E,
  type TradStatus,
} from '../lib/tradMarkets'
import { Badge, Card, EmptyState, ErrorNotice, Help, TableSkeleton, TableWrap } from './ui'

const STATUS: Record<TradStatus, { label: string; variant: 'live' | 'buy' | 'neutral' }> = {
  nueva: { label: 'Señal nueva', variant: 'live' },
  cerca: { label: 'Cerca de romper', variant: 'buy' },
  tendencia: { label: 'En tendencia', variant: 'neutral' },
  fuera: { label: 'Sin posición', variant: 'neutral' },
  corto: { label: 'Historial corto', variant: 'neutral' },
}

const signed = (x: number) => `${x >= 0 ? '+' : '−'}${ratio(Math.abs(x))}`
const thousands = (n: number) => new Intl.NumberFormat('es-ES').format(n)
const day = (ms: number) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(ms))
const sessions = (n: number) => plural(n, 'sesión', 'sesiones')

/** What entering this long at its age measured on the index ETFs (daily): not measured on stocks or commodities, which say so in their kind's note. */
function late(r: TradBoardRow): string {
  if (r.kind !== 'index' || r.age === undefined) return ''
  const b = lateBucket(r.age, E.late.buckets)
  if (b) return ` · ${lateSentence(b)}`
  return r.age > E.late.buckets[E.late.buckets.length - 1].to ? ' · con más de 30 sesiones no se midió entrar' : ''
}

/** What the row says in a sentence. */
function what(r: TradBoardRow): string {
  switch (r.status) {
    case 'nueva':
      return r.age === 0
        ? 'abrió un long en el último cierre: cerró sobre el máximo de 20 días y sobre la EMA 200'
        : `abrió un long hace ${sessions(r.age ?? 1)}: cerró sobre el máximo de 20 días y sobre la EMA 200`
    case 'cerca':
      return `sobre la EMA 200, a ${ratio(r.distanceAtr ?? 0, 1)} ATR del máximo de 20 días: si una sesión cierra por encima, abre un long`
    case 'tendencia':
      return `long desde hace ${sessions(r.age ?? 0)}${r.entryAt ? `, entró el ${day(r.entryAt)}` : ''}${late(r)}`
    case 'fuera':
      if (r.shortOpen) return 'bajo la EMA 200: la regla mantendría un short, que no se sigue'
      return r.above
        ? `sobre la EMA 200, a ${ratio(r.distanceAtr ?? 0, 1)} ATR del máximo de 20 días: espera un cierre por encima`
        : 'bajo la EMA 200: la regla no abre largos'
    case 'corto':
      return `${r.bars} sesiones de historia; hacen falta ${r.need}`
  }
}

type View = 'moving' | 'trend' | 'all'

/**
 * "¿Qué vigilo?" for the daily trend rule on what OKX lists besides crypto — stocks, ETFs and four commodities. Unlike the
 * crypto cards it is not scanned in the browser: the rule needs 620 daily bars and these perpetuals have a few months, so the
 * server reads the underlying's history and writes the board after each New York close (`watchJob.ts`); this card shows it. The
 * same pass records the signals in the tracking ledger and sends them to the phone.
 */
export function TradWatch({ markets }: { markets: Market[] }) {
  const q = useTradBoard()
  // Liquidity is read live, from the tickers the Screener already holds: the board is written once a session and a book is not.
  const live = useMemo(() => new Map(markets.map((m) => [m.instId, m])), [markets])
  const client = useQueryClient()
  const [picked, setPicked] = useState<View | null>(null)
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const board = q.data?.board
  const rows = board?.rows

  const lists = useMemo(() => {
    const followed = (rows ?? []).filter((r) => tradFollowed(r.kind))
    const moving = followed.filter((r) => r.status === 'nueva' || r.status === 'cerca')
    const trend = followed.filter((r) => r.status === 'tendencia')
    return { moving, trend, rest: (rows ?? []).length - moving.length - trend.length }
  }, [rows])
  const counts = { moving: lists.moving.length, trend: lists.trend.length, rest: lists.rest }
  // Opens on what is moving; with nothing moving an empty card would say nothing, so it opens on what is in trend.
  const view: View = picked ?? (counts.moving > 0 ? 'moving' : 'trend')
  const setView = (v: View) => setPicked(v)
  const shown = view === 'moving' ? lists.moving : view === 'trend' ? [...lists.moving, ...lists.trend] : (rows ?? [])

  const refresh = async () => {
    setRunning(true)
    setNote(null)
    try {
      const { run } = await runWatchNow()
      setNote(
        !run
          ? 'El servidor no devolvió el resultado del repaso.'
          : run.status === 'skipped'
            ? 'Ya se repasó hace unos minutos: no hacía falta repetirlo.'
            : run.status === 'failed'
              ? `El repaso falló: ${run.reason ?? run.errors[0] ?? 'error desconocido'}`
              : run.errors.length
                ? `Repaso hecho con avisos: ${run.errors[0]}`
                : 'Repaso hecho. El tablero solo cambia cuando hay una sesión de Nueva York nueva.',
      )
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
      await client.invalidateQueries({ queryKey: ['trad-board'] })
      await client.invalidateQueries({ queryKey: ['watch-ledger'] })
    }
  }

  const asOf = board?.asOf
  const stale = asOf ? (Date.now() - asOf) / 86_400_000 > 4.5 : false

  const action = (
    <Help label="Qué vigilar">
      <p>
        La misma regla de la Ruptura + EMA 200, en velas <strong>diarias</strong> y solo <strong>largos</strong>: entra cuando
        una sesión cierra por encima del máximo de las 20 anteriores y por encima de su EMA 200. Stop de 2 ATR y un trailing
        de 8 ATR; no hay objetivo. Los cortos no se siguen: en los ETF de índices midieron {signed(E.indexShorts)} R.
      </p>
      <p>
        <strong>De dónde sale.</strong> Estos perpetuos llevan meses listados y la EMA 200 pide 620 velas diarias, así que el
        servidor lee la historia de lo que siguen (el ETF GLD para el oro, SLV para la plata, USO y BNO para los petróleos) y
        escribe este tablero tras cada cierre de Nueva York. Los precios son los de esa bolsa, sin ajustar por dividendos
        (son los que se operan); el perpetuo cotiza 24 h y puede diferir. La misma pasada apunta las señales nuevas en
        Seguimiento y las manda al móvil.
      </p>
      <p>
        <strong>Lo medido, en 20 ETF de índices y sectores desde 1993:</strong> {signed(E.index.net)} R por operación (
        {thousands(E.index.n)} operaciones, mitades {signed(E.index.halves[0])} / {signed(E.index.halves[1])}, {signed(E.index.withoutBest10)} R
        sin las diez mejores) frente a {signed(E.index.random)} R de una entrada larga al azar con el mismo stop. Pero:
      </p>
      <ul>
        <li>
          <strong>OKX solo lista cuatro de esos 20 ETF</strong> (SPY, QQQ, EWY y EWZ): en esos cuatro, {signed(E.okxIndex.net)} R en{' '}
          {E.okxIndex.n} operaciones frente a {signed(E.okxIndex.random)} R de una entrada larga al azar. SPY y QQQ son un mismo mercado, EWY
          y EWZ quedan en {signed(E.okxIndex.ewyEwzWithoutBest10)} R sin sus diez mejores operaciones, y desde 2022 son solo{' '}
          {E.okxIndex.recent.n} operaciones ({signed(E.okxIndex.recent.net)} R, azar {signed(E.okxIndex.recent.random)}). Los otros 16 no
          se pueden operar en OKX.
        </li>
        <li>
          <strong>En los 20 ETF, en 2022–2026 solo {signed(E.index.recent.net)} R</strong> (azar {signed(E.index.recent.random)}, y{' '}
          {signed(E.index.recent.withoutBest10)} sin las diez mejores): hoy no se distingue de comprar al azar.
        </li>
        <li>
          <strong>Como cuenta no gana a comprar SPY y mantenerlo</strong>: {pct(E.portfolio.cagr, 1)} al año y Sharpe{' '}
          {ratio(E.portfolio.sharpe)} frente a {pct(E.portfolio.spyCagr, 1)} y {ratio(E.portfolio.spySharpe)} (SPY con sus dividendos), con
          una correlación de {ratio(E.portfolio.corrSpy)} con SPY. Sí recorta la peor caída ({pct(E.portfolio.maxDd, 0)} frente a{' '}
          {pct(E.portfolio.spyMaxDd, 0)}, la de 2008), pero rinde mucho menos, y desde 2022 su Sharpe es {ratio(E.portfolio.sharpeSince2022)} frente a{' '}
          {ratio(E.portfolio.spySharpeSince2022)}.
        </li>
        <li>
          <strong>Las acciones no tienen evidencia propia</strong>: las que lista OKX son las de hoy, una selección de
          supervivientes. Su {signed(E.stocks.net)} R en largos no cuenta (una entrada al azar ya da {signed(E.stocks.random)}).
        </li>
        <li>
          <strong>Las materias primas son cuatro series</strong>: {signed(E.commodity.net)} R, pero {signed(E.commodity.withoutBest10)} R sin
          sus diez mejores. Y el perpetuo del oro y el de la plata cobran a quien está largo una financiación de dos dígitos al año.
        </li>
        <li>
          <strong>Los ETF apalancados no se siguen</strong>: midieron {signed(E.leveraged.net)} R ({signed(E.leveraged.withoutBest10)} sin las diez mejores).
        </li>
      </ul>
      <p>
        <strong>Liquidez.</strong> La investigación contó las comisiones (0,1 % la ida y vuelta) y no la horquilla, y los perpetuos de
        acciones y ETF de OKX son finos: la mediana de los 79 movía unos 55.000 US$ al día con una horquilla de 24 pb (el 16 de
        octubre). La columna es la de ahora, con el volumen de 24 horas y la horquilla; <strong>El aviso en ámbar</strong> marca menos de{' '}
        {thousands(TRAD_LIQUIDITY.minVolumeUsd)} US$ al día o más de {TRAD_LIQUIDITY.maxSpreadBp} pb, donde una posición de unos miles de
        dólares mueve el precio. El aviso al móvil lleva lo que costaría entrar con {thousands(TRAD_LIQUIDITY.refUsd)} US$ según el libro, y no
        se manda si entrar y salir cuesta más de {ratio(TRAD_LIQUIDITY.maxCostR)} R de horquilla: se apunta y se sigue igual.
      </p>
      <p>
        <strong>Entrar con la tendencia ya empezada</strong> solo se midió en los ETF de índices y sectores ({E.late.sample}): entrando a cada tramo,{' '}
        {lateSummary(E.late.buckets, (b) => (b.from === b.to ? `${b.from} sesión` : `${b.from}–${b.to} sesiones`))}. Con intervalos claros por encima de cero hasta dos semanas, pero un
        ETF que sube ya premia a cualquier largo (el azar mide {signed(E.index.random)} R), y el stop queda más lejos cuanto más tarde. En acciones y
        materias primas no se midió.
      </p>
      <p>
        <strong>Señal nueva</strong> es una entrada de las dos últimas sesiones; <strong>cerca</strong> y <strong>en tendencia</strong> son
        para tenerlos a la vista. Es contexto, no una recomendación.
      </p>
    </Help>
  )

  if (q.error && !q.data) {
    return (
      <Card title="Qué vigilar · Tendencia diaria en bolsa, ETF y oro" flush>
        <ErrorNotice title="No se pudo leer el tablero" message={q.error.message} />
      </Card>
    )
  }

  return (
    <Card
      title="Qué vigilar · Tendencia diaria en bolsa, ETF y oro"
      subtitle={
        q.isLoading
          ? 'Leyendo el tablero del servidor…'
          : !q.data?.enabled
            ? 'El servidor no tiene dónde guardar el tablero'
            : !board
              ? 'Todavía no hay tablero: lo escribe el servidor tras el cierre de Nueva York'
              : `${plural(counts.moving, 'contrato para vigilar', 'contratos para vigilar')} · cierre de Nueva York del ${day(board.asOf)}${stale ? ' (desactualizado)' : ''}`
      }
      action={action}
      flush
    >
      {q.isLoading ? (
        <TableSkeleton rows={4} cols={6} />
      ) : !q.data?.enabled ? (
        <EmptyState
          title="Falta el almacén del seguimiento"
          hint="El tablero lo escribe el mismo trabajo que apunta las señales, y necesita el almacén Blob de Vercel (en local, un fichero en .watch/)."
        />
      ) : !board || !rows ? (
        <>
          <EmptyState
            title="Aún no se ha leído ninguna sesión"
            hint="El servidor lo calcula la primera vez que repasa el mercado después del cierre de Nueva York (21:30 UTC). Puedes pedirlo ahora."
          />
          <div className="table-controls-bar ema-controls">
            <button type="button" className="btn btn--primary" onClick={refresh} disabled={running}>
              {running ? 'Repasando…' : 'Repasar ahora'}
            </button>
            {note && <span className="sub">{note}</span>}
          </div>
        </>
      ) : (
        <>
          <div className="table-controls-bar ema-controls">
            <div className="seg-control" aria-label="Qué mostrar">
              <button type="button" aria-pressed={view === 'moving'} onClick={() => setView('moving')}>
                Señal y cerca · {counts.moving}
              </button>
              <button type="button" aria-pressed={view === 'trend'} onClick={() => setView('trend')}>
                + en tendencia · {counts.trend}
              </button>
              <button type="button" aria-pressed={view === 'all'} onClick={() => setView('all')}>
                Todos · {rows.length}
              </button>
            </div>
            <button type="button" className="btn btn--outline" onClick={refresh} disabled={running}>
              {running ? 'Repasando…' : 'Actualizar'}
            </button>
            {note && <span className="sub">{note}</span>}
          </div>

          {shown.length === 0 ? (
            <EmptyState
              title="Nada para vigilar ahora"
              hint={`Ningún contrato tiene una señal nueva ni está cerca de romper. ${counts.trend} están en tendencia y ${counts.rest} sin posición: pulsa «Todos» para verlos.`}
            />
          ) : (
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th>Contrato</th>
                    <th>Tipo</th>
                    <th className="num">Liquidez</th>
                    <th>Estado</th>
                    <th>Qué pasa</th>
                    <th className="num">Cierre</th>
                    <th className="num">Ruptura en</th>
                    <th className="num">Stop del long</th>
                    <th>Gráfico</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const s = STATUS[r.status]
                    const kind = TRAD_KIND[r.kind]
                    const followed = tradFollowed(r.kind)
                    const market = live.get(r.instId)
                    const thin = market ? thinReasons(market.volumeUsd, market.spreadBps) : []
                    return (
                      <tr key={r.yahoo} className={followed ? undefined : 'is-dim'}>
                        <td>
                          <span>
                            <span className="ccy">{tradDisplay(tradSymbolByOkx(r.okx) ?? { okx: r.okx, name: r.name, kind: r.kind })}</span>{' '}
                            <span className="sub">{r.instId.replace('-USD_UM_XPERP', '')}</span>
                          </span>
                        </td>
                        <td>
                          <span title={tradKindNote(r.kind)}>
                            {kind.label}
                            <span className="sub grade-reason">
                              {kind.evidence === 'medida' ? 'evidencia medida' : kind.evidence === 'escasa' ? 'poca evidencia' : kind.evidence === 'ninguna' ? 'sin evidencia propia' : 'sin ventaja medida'}
                            </span>
                          </span>
                        </td>
                        <td className="num">
                          {market ? (
                            <span>
                              {compactUsd(market.volumeUsd)}{' '}
                              <span className="sub">· {Number.isFinite(market.spreadBps) ? `${ratio(market.spreadBps, 1)} pb` : 'sin libro'}</span>
                              {thin.length > 0 && (
                                <span
                                  className="sub thin-line"
                                  title={`${thin.map((t) => (t === 'poco volumen' ? `poco volumen (menos de ${thousands(TRAD_LIQUIDITY.minVolumeUsd)} US$ al día)` : t === 'horquilla ancha' ? `horquilla ancha (más de ${TRAD_LIQUIDITY.maxSpreadBp} pb)` : 'el libro no tiene compra y venta')).join(' y ')}. Una posición de unos miles de dólares movería el precio: entrar y salir cuesta más de lo que la investigación contó.`}
                                >
                                  poca liquidez
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="sub">—</span>
                          )}
                        </td>
                        <td>
                          {followed ? (
                            <Badge variant={s.variant} pulse={r.status === 'nueva'}>
                              {s.label}
                            </Badge>
                          ) : (
                            <Badge variant="neutral">No se sigue</Badge>
                          )}
                        </td>
                        <td className="sub watch-what">{what(r)}</td>
                        <td className="num">{Number.isFinite(r.price) ? quote(r.price) : '—'}</td>
                        <td className="num">
                          {r.level !== undefined && Number.isFinite(r.level) ? (
                            <span>
                              {quote(r.level)}{' '}
                              {r.distance !== undefined && Number.isFinite(r.distance) && (
                                <span className="sub">
                                  · {pct(r.distance)} · {ratio(r.distanceAtr ?? 0, 1)} ATR
                                </span>
                              )}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="num">{r.stop !== undefined ? quote(r.stop) : '—'}</td>
                        <td>
                          <a className="card-link" href={routeHref('analisis', { inst: r.instId })}>
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
          <p className="ema-rest">
            Cierre, ruptura y stop son los del <strong>subyacente en su bolsa</strong> (GLD para el oro, SLV para la plata, USO y
            BNO para los petróleos), sin ajustar por dividendos y al cierre del {day(board.asOf)}: el perpetuo cotiza 24 horas y puede
            diferir. Solo largos. <strong>Tipo</strong> dice cuánta evidencia hay detrás: pasa el cursor para leerla. Entre las
            acciones, la regla es la de los ETF de índices, no una medida propia. <strong>Liquidez</strong> es la de ahora en OKX, no la
            del cierre.
            {board.errors?.length ? ` No se pudo leer ${board.errors.length === 1 ? 'un símbolo' : `${board.errors.length} símbolos`} de Yahoo: ${board.errors.slice(0, 3).join(' · ')}.` : ''}
          </p>
        </>
      )}
    </Card>
  )
}
