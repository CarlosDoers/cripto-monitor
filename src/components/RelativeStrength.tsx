import { useMemo } from 'react'
import { plural, price, ratio, share } from '../lib/format'
import { MIN_LIQUID_VOLUME, type Market } from '../lib/markets'
import { useDailyBoard, useInstruments } from '../lib/queries'
import {
  HIGH_WINDOW,
  rankRelativeStrength,
  RELATIVE_STRENGTH_EVIDENCE as E,
  relativeStrength,
  type RelativeStrength as Row,
} from '../lib/relativeStrength'
import { routeHref } from '../lib/router'
import { NARROW, useMediaQuery } from '../lib/useMediaQuery'
import { Card, Help, TableSkeleton, TableWrap } from './ui'

/** The measurement ranked the 30 pairs with most dollar volume. */
const UNIVERSE = 30

const signed = (x: number, digits = 2) => `${x >= 0 ? '+' : '−'}${ratio(Math.abs(x), digits)}`
const days = (n: number) => (n === 0 ? 'hoy' : `hace ${plural(n, 'día', 'días')}`)

const DAY_MS = 86_400_000
/** OKX gave every spot pair that already existed the same listing date, 2021-01-29: older than that is not known. */
const LEGACY = Date.UTC(2021, 0, 31)

/** When a coin's spot pair was listed, as OKX says: "desde antes de 2021", "hace 1,1 años", "hace 321 días". */
function listedText(at: number | undefined): string {
  if (at === undefined || !Number.isFinite(at)) return '—'
  if (at <= LEGACY) return 'desde antes de 2021'
  const days = Math.max(0, (Date.now() - at) / DAY_MS)
  return days < 365 ? `hace ${plural(Math.round(days), 'día', 'días')}` : `hace ${ratio(days / 365, 1)} años`
}

function medianOf(values: (number | undefined)[]): number | undefined {
  const v = values.filter((x): x is number => x !== undefined && Number.isFinite(x)).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : undefined
}

/** One third of the ranking: a heading row and its contracts, inside the card's single table so the columns line up. */
function Leg({ title, note, rows, listed }: { title: string; note: string; rows: Row[]; listed: (r: Row) => number | undefined }) {
  return (
    <tbody>
      <tr className="rs-leg-row">
        <td colSpan={7}>
          <strong>{title}</strong> <span className="sub">{note}</span>
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.instId}>
          <td>
            <span className="ccy">{r.symbol}</span>
          </td>
          <td className="num">{price(r.price)}</td>
          <td className="num">{r.below === 0 ? 'En máximo' : `−${share(r.below)}`}</td>
          <td className="num">
            <span>
              {price(r.high)} <span className="sub">· {days(r.highAge)}</span>
            </span>
          </td>
          <td className="num">{listedText(listed(r))}</td>
          <td className="num">{Number.isFinite(r.volatility) ? share(r.volatility) : '—'}</td>
          <td>
            <a className="card-link" href={routeHref('analisis', { inst: r.instId })}>
              Ver →
            </a>
          </td>
        </tr>
      ))}
    </tbody>
  )
}

/** The same third as a phone list: one line per contract, the rest on tap — a different DOM, like the EMA scanner's. */
function LegList({ title, note, rows, listed }: { title: string; note: string; rows: Row[]; listed: (r: Row) => number | undefined }) {
  return (
    <>
      <p className="rs-leg">
        <strong>{title}</strong> <span className="sub">{note}</span>
      </p>
      <div className="ema-list">
        {rows.map((r) => (
          <details key={r.instId} className="ema-item">
            <summary>
              <span className="ccy">{r.symbol}</span>
              <span className="sub">{listedText(listed(r))}</span>
              <span className="num">{r.below === 0 ? 'En máximo' : `−${share(r.below)}`}</span>
            </summary>
            <dl>
              <dt>Precio</dt>
              <dd>{price(r.price)}</dd>
              <dt>Máximo</dt>
              <dd>
                {price(r.high)} <span className="sub">· {days(r.highAge)}</span>
              </dd>
              <dt>Volatilidad</dt>
              <dd>{Number.isFinite(r.volatility) ? `${share(r.volatility)} al día` : '—'}</dd>
            </dl>
            <a className="card-link ema-item-link" href={routeHref('analisis', { inst: r.instId })}>
              Ver en el gráfico →
            </a>
          </details>
        ))}
      </div>
    </>
  )
}

/**
 * Where the most traded crypto X-Perps stand against their 90-day high: the
 * third nearest it and the third farthest, which is the ordering the weekly
 * long-short measurement used. It is context and says so in as many words — no
 * stop, no target, no entry, and the long leg alone earned what BTC did.
 *
 * It needs nothing the Screener does not already fetch: the daily UTC candles
 * of the most traded contracts, the same queries, so it costs no request.
 */
export function RelativeStrength({ markets }: { markets: Market[] }) {
  // The top 30 as a sorted string: prices tick every 30 s and the order at the
  // cut-off with them, but the query list should only change with the set.
  const idsKey = useMemo(
    () =>
      markets
        .filter((m) => m.category === 'cripto' && m.volumeUsd >= MIN_LIQUID_VOLUME)
        .sort((a, b) => b.volumeUsd - a.volumeUsd)
        .slice(0, UNIVERSE)
        .map((m) => m.instId)
        .sort()
        .join(','),
    [markets],
  )
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey])
  const board = useDailyBoard(ids)
  const narrow = useMediaQuery(NARROW)
  const byId = useMemo(() => new Map(markets.map((m) => [m.instId, m])), [markets])

  // How long each coin has traded on OKX spot: the X-Perp board was listed all at
  // once on 2026-03-30, so the contract's own age says nothing about the coin.
  const spot = useInstruments('SPOT')
  const listedAt = useMemo(() => {
    const first = new Map<string, number>()
    for (const i of spot.data ?? []) {
      const t = Number(i.listTime)
      if (!(t > 0) || i.state !== 'live') continue
      // The USDT pair when there is one: it is the oldest and the one the measurement used.
      const rank = i.quoteCcy === 'USDT' ? 0 : 1
      const key = i.baseCcy
      const known = first.get(`${key}|${rank}`)
      if (known === undefined || t < known) first.set(`${key}|${rank}`, t)
    }
    return (symbol: string) => first.get(`${symbol}|0`) ?? first.get(`${symbol}|1`)
  }, [spot.data])
  const listed = (r: Row) => listedAt(r.symbol)

  const ranking = useMemo(
    () =>
      rankRelativeStrength(
        ids
          .filter((id) => board.byInst[id])
          .map((id) => {
            const m = byId.get(id)
            return relativeStrength(board.byInst[id], m?.last ?? 0, id, m?.symbol ?? id.split('-')[0])
          }),
      ),
    [ids, board.byInst, byId],
  )

  // Thirds of a half-loaded list would reshuffle as each answer lands: wait for all of them.
  const loading = ids.length > 0 && board.pending > 0
  const subtitle =
    ids.length === 0
      ? 'Sin contratos líquidos que ordenar'
      : loading
        ? `Leyendo velas: ${board.loaded} de ${ids.length}…`
        : ranking.k === 0
          ? `Solo ${plural(ranking.ranked, 'contrato con', 'contratos con')} ${HIGH_WINDOW} días de historial: la medición pedía nueve`
          : `Los ${ranking.k} más cerca y los ${ranking.k} más lejos de su máximo de ${HIGH_WINDOW} días, entre los ${ranking.ranked} cripto más negociados`

  return (
    <Card
      title="Fuerza relativa · cerca del máximo de 90 días"
      subtitle={subtitle}
      action={
        <Help label="Fuerza relativa">
          <p>
            Ordena los contratos cripto más negociados por lo cerca que está su precio del máximo de los últimos{' '}
            {HIGH_WINDOW} días. La medición, cada domingo, compraba el tercio más cercano y vendía en corto el más
            lejano, una semana, a partes iguales.
          </p>
          <p>
            Sobre Binance spot, 2018–2026, con las monedas que dejaron de cotizar dentro ({E.pairs} pares, {E.dead}{' '}
            deslistados; los 30 con más volumen cada semana; {E.weeks} semanas): el tercio cercano menos el lejano gana{' '}
            <strong>{signed(E.perWeek)} % por semana</strong> (t {ratio(E.t, 1)}), en el {share(E.positive, 0)} de las
            semanas y en cada uno de los {E.years} años; sin sus diez mejores semanas, {signed(E.withoutBest10)} %.
            Con comisiones {signed(E.net)} %, y la financiación de los perpetuos le quita unos{' '}
            {ratio(Math.abs(E.funding))} % semanal. En cada mitad del histórico, {signed(E.halves[0])} % y{' '}
            {signed(E.halves[1])} %.
          </p>
          <p>
            <strong>Por qué esto no es una lista de compras.</strong> Es largo-corto: solo la pata larga rinde lo mismo
            que BTC ({signed(E.longOnly.yearPct, 0)} % al año frente a {signed(E.longOnly.btcYearPct, 0)} %) con una
            caída de {signed(E.longOnly.drawdownPct, 0)} %. Entre monedas que llevan años cotizando <em>no existe</em>{' '}
            (cestas al azar: mediana {signed(E.survivors[1])} %) y dentro de una misma edad tampoco (de{' '}
            {signed(E.withinAge[0])} a {signed(E.withinAge[1])} %): en buena parte es <strong>la edad</strong> — las
            listadas hace poco y en caída frente a las veteranas ({signed(E.age.perWeek)} % por semana, t{' '}
            {ratio(E.age.t, 1)}) —, por eso la tabla muestra desde cuándo cotiza cada una. Con BTC bajo su media de 200
            días rinde {signed(E.regime.below)} % por semana (t {ratio(E.regime.belowT, 1)}); sobre ella,{' '}
            {signed(E.regime.above)} % (t {ratio(E.regime.aboveT, 1)}).
          </p>
          <p>
            <strong>Qué no se ha medido:</strong> las X-Perps llevan unos {E.xperpDays} días de historial, así que nada
            de esto se ha comprobado en estos contratos; y la medición es semanal, con cierres de domingo: entre semana
            es la foto de hoy. No hay stop, objetivo ni señal de entrada, y no es una de las estrategias medidas.
          </p>
        </Help>
      }
      flush
    >
      {ids.length === 0 ? null : loading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : ranking.k === 0 ? null : (
        <>
          {narrow ? (
            <>
              <LegList title="Más cerca de su máximo" note="el tercio que la medición compraba" rows={ranking.top} listed={listed} />
              <LegList
                title="Más lejos de su máximo"
                note="el tercio que la medición vendía en corto"
                rows={[...ranking.bottom].reverse()}
                listed={listed}
              />
            </>
          ) : (
            <TableWrap>
              <table className="data rs-table">
                <thead>
                  <tr>
                    <th>Contrato</th>
                    <th className="num">Precio</th>
                    <th className="num">Bajo el máximo</th>
                    <th className="num">Máximo de 90 días</th>
                    <th className="num">Cotiza en OKX spot</th>
                    <th className="num">Volatilidad diaria</th>
                    <th>Gráfico</th>
                  </tr>
                </thead>
                <Leg title="Más cerca de su máximo" note="el tercio que la medición compraba" rows={ranking.top} listed={listed} />
                <Leg
                  title="Más lejos de su máximo"
                  note="el tercio que la medición vendía en corto"
                  rows={[...ranking.bottom].reverse()}
                  listed={listed}
                />
              </table>
            </TableWrap>
          )}
          <p className="ema-rest">
            Contexto medido en Binance spot, no una señal: sin stop ni objetivo, y solo largo rinde lo mismo que BTC. En
            buena parte ordena por edad: la mediana de los de arriba cotiza en OKX spot{' '}
            {listedText(medianOf(ranking.top.map(listed)))} y la de los de abajo{' '}
            {listedText(medianOf(ranking.bottom.map(listed)))}.
            {ranking.short.length > 0 &&
              ` Sin ${HIGH_WINDOW} días de historial: ${ranking.short.map((x) => x.symbol).join(', ')}.`}
          </p>
        </>
      )}
    </Card>
  )
}
