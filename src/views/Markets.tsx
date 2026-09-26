import { useMemo, useState } from 'react'
import { useMarkets, type Market } from '../lib/markets'
import { useClosedPositions, usePositions } from '../lib/queries'
import { pct, plural, price, ratio, usdCompact } from '../lib/format'
import { EconomicCalendar } from '../components/EconomicCalendar'
import { MarketTreemap } from '../components/MarketTreemap'
import { MarketCard } from '../components/MarketCard'
import { DivergingBars } from '../components/PerfCharts'
import {
  Badge,
  Card,
  Delta,
  DeltaValue,
  EmptyState,
  ErrorNotice,
  SearchInput,
  Skeleton,
  Stat,
  TableSkeleton,
  TableWrap,
  Help,
} from '../components/ui'
import { HELP } from '../lib/glossary'

type SortBy = 'score' | 'volume' | 'oi' | 'spread' | 'range' | 'change'

const GRADE_LABEL: Record<Market['grade'], string> = {
  excelente: 'Excelente',
  bueno: 'Bueno',
  aceptable: 'Aceptable',
  evitar: 'Evitar',
}

/** Tiles in the heat map; the rest of the board is in the table below it. */
const MAP_SIZE = 30
/** Rows per movers list. */
const MOVERS = 6
/**
 * Minimum 24 h volume to count as a mover. "The liquid half" of the board
 * reached down to contracts trading 80 k$ a day, which is where a 20 % move
 * costs a few trades and says nothing.
 */
const MOVER_MIN_VOLUME = 1_000_000
/** Table rows before "show the rest". */
const TABLE_PAGE = 25

function compactUsd(v: number): string {
  if (v >= 1e9) return `${ratio(v / 1e9, 2)} B$`
  if (v >= 1e6) return `${ratio(v / 1e6, 1)} M$`
  if (v >= 1e3) return `${ratio(v / 1e3, 0)} k$`
  return usdCompact(v)
}

export function Markets() {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('score')
  const [onlyTraded, setOnlyTraded] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const positions = usePositions()
  const closed = useClosedPositions()
  const tradedIds = useMemo(
    () => [
      ...(positions.data ?? []).map((p) => p.instId),
      ...(closed.data?.positions ?? []).map((p) => p.instId),
    ],
    [positions.data, closed.data],
  )

  const { markets, isLoading, isFetching, error, hasOpenInterest } = useMarkets(tradedIds)

  const rows = useMemo(() => {
    let list = [...markets]
    if (onlyTraded) list = list.filter((m) => m.traded)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((m) => m.symbol.toLowerCase().includes(q))

    const by: Record<SortBy, (a: Market, b: Market) => number> = {
      score: (a, b) => b.score - a.score,
      volume: (a, b) => b.volumeUsd - a.volumeUsd,
      oi: (a, b) => b.openInterestUsd - a.openInterestUsd,
      // Unquoted books sort last rather than first.
      spread: (a, b) => (a.spreadBps || Infinity) - (b.spreadBps || Infinity),
      range: (a, b) => b.rangePct - a.rangePct,
      change: (a, b) => b.change24h - a.change24h,
    }
    return list.sort(by[sortBy])
  }, [markets, search, sortBy, onlyTraded])

  const totals = useMemo(() => {
    const vol = markets.reduce((s, m) => s + m.volumeUsd, 0)
    const spreads = markets.map((m) => m.spreadBps).filter(Number.isFinite).sort((a, b) => a - b)
    const changes = markets.map((m) => m.change24h).sort((a, b) => a - b)
    return {
      vol,
      medianSpread: spreads.length ? spreads[Math.floor(spreads.length / 2)] : NaN,
      up: markets.filter((m) => m.change24h > 0).length,
      down: markets.filter((m) => m.change24h < 0).length,
      medianChange: changes.length ? changes[Math.floor(changes.length / 2)] : 0,
    }
  }, [markets])

  const byVolume = useMemo(() => [...markets].sort((a, b) => b.volumeUsd - a.volumeUsd), [markets])
  // Several X-Perp series can share a symbol; the most traded one stands for it.
  const btc = byVolume.find((m) => m.symbol === 'BTC')
  const eth = byVolume.find((m) => m.symbol === 'ETH')

  /**
   * Movers only among contracts with real volume. Across all 210 the top of
   * the list is whatever thin book moved 30 % on a few thousand dollars — a
   * number nobody could have traded, and exactly the "movimiento extremo" the
   * score already marks down.
   */
  const movers = useMemo(() => {
    const liquid = byVolume.filter((m) => m.volumeUsd >= MOVER_MIN_VOLUME)
    const sorted = [...liquid].sort((a, b) => b.change24h - a.change24h)
    return {
      pool: liquid.length,
      gainers: sorted.filter((m) => m.change24h > 0).slice(0, MOVERS),
      losers: sorted.filter((m) => m.change24h < 0).reverse().slice(0, MOVERS),
    }
  }, [byVolume])

  const mine = useMemo(() => byVolume.filter((m) => m.traded).slice(0, 8), [byVolume])
  const tableRows = showAll ? rows : rows.slice(0, TABLE_PAGE)
  const moverRows = (list: Market[]) =>
    list.map((m) => ({
      key: m.instId,
      label: m.symbol,
      value: m.change24h,
      meta: `${price(m.last)} · ${compactUsd(m.volumeUsd)}`,
    }))

  if (error) {
    return <ErrorNotice title="No se pudo cargar el listado de mercados" message={error.message} />
  }

  return (
    <>
      {/* The pulse first: where the two majors are, and whether the board as
          a whole is rising or falling. The old headline was "Recomendables
          ahora: 120", but the score ranks each contract against the others,
          so about half always qualify — a number that could not change. */}
      <div className="kpi-row">
        {([['btc', 'Bitcoin', btc], ['eth', 'Ethereum', eth]] as const).map(([key, label, m]) => (
          <Stat
            key={key}
            label={label}
            hero={key === 'btc'}
            loading={isLoading}
            value={m ? price(m.last) : '—'}
            badge={m ? <Delta ratio={m.change24h}>{pct(m.change24h)}</Delta> : undefined}
            foot={
              m ? (
                <span>
                  Rango 24 h {ratio(m.rangePct, 1)} % · vol. {compactUsd(m.volumeUsd)}
                </span>
              ) : undefined
            }
          />
        ))}
        <Stat
          label="Amplitud del mercado"
          help={HELP.breadth}
          loading={isLoading}
          value={`${totals.up} suben`}
          foot={
            <span>
              {totals.down} bajan · mediana{' '}
              <DeltaValue value={totals.medianChange}>{pct(totals.medianChange)}</DeltaValue>
              <span className="breadth-bar" aria-hidden="true">
                <span style={{ flexGrow: totals.up, background: 'var(--good)' }} />
                <span style={{ flexGrow: totals.down, background: 'var(--critical)' }} />
              </span>
            </span>
          }
        />
        <Stat
          label="Volumen 24 h"
          loading={isLoading}
          value={compactUsd(totals.vol)}
          foot={<span>{plural(markets.length, 'contrato X-Perp', 'contratos X-Perp')}</span>}
        />
        <Stat
          label="Horquilla mediana"
          help={HELP.spread}
          loading={isLoading}
          value={Number.isFinite(totals.medianSpread) ? `${ratio(totals.medianSpread, 1)} pb` : '—'}
          foot={<span>coste de entrar y salir</span>}
        />
      </div>

      <Card
        title="Mapa del mercado"
        subtitle="Los contratos con más volumen · pasa el ratón o toca un cuadro para ver su detalle"
        dimmed={isFetching && !isLoading}
      >
        {isLoading ? <Skeleton height={380} /> : <MarketTreemap markets={byVolume.slice(0, MAP_SIZE)} />}
      </Card>

      <div className="grid-2">
        <Card
          title="Mayores subidas"
          subtitle={`24 h · entre los ${movers.pool} que mueven más de 1 M$ al día`}
          dimmed={isFetching && !isLoading}
        >
          {isLoading ? (
            <Skeleton height={160} />
          ) : (
            <DivergingBars rows={moverRows(movers.gainers)} formatValue={(v) => pct(v)} />
          )}
        </Card>
        <Card
          title="Mayores caídas"
          subtitle={`24 h · entre los ${movers.pool} que mueven más de 1 M$ al día`}
          dimmed={isFetching && !isLoading}
        >
          {isLoading ? (
            <Skeleton height={160} />
          ) : (
            <DivergingBars rows={moverRows(movers.losers)} formatValue={(v) => pct(v)} />
          )}
        </Card>
      </div>

      {mine.length > 0 && (
        <Card
          title="Tus mercados"
          subtitle="Los contratos que operas o has operado · 24 h y dónde está el precio dentro de su rango"
          dimmed={isFetching && !isLoading}
        >
          <div className="market-cards">
            {mine.map((m) => (
              <MarketCard key={m.instId} market={m} />
            ))}
          </div>
        </Card>
      )}

      <Card
        title="Todos los contratos"
        subtitle={
          isLoading
            ? undefined
            : `${plural(rows.length, 'contrato', 'contratos')}${hasOpenInterest ? '' : ' · sin datos de posición abierta'}`
        }
        flush
        dimmed={isFetching && !isLoading}
      >
        <div className="table-controls-bar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar contrato (BTC, SOL, ZEC…)"
            className="table-search"
          />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn${onlyTraded ? ' btn--primary' : ''}`}
              onClick={() => setOnlyTraded(!onlyTraded)}
            >
              Solo los que opero
            </button>
            <div className="seg-control">
              {(
                [
                  ['score', 'Puntuación'],
                  ['volume', 'Volumen'],
                  ['spread', 'Horquilla'],
                  ['range', 'Movimiento'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={sortBy === key}
                  onClick={() => setSortBy(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? (
          <TableSkeleton rows={10} cols={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Sin contratos con estos filtros"
            hint={onlyTraded ? 'Aún no has operado ningún X-Perp.' : 'Prueba otro término de búsqueda.'}
          />
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Contrato</th>
                  <th>
                    Operabilidad
                    <Help label="Operabilidad">{HELP.tradability}</Help>
                  </th>
                  <th className="num">Precio</th>
                  <th className="num">24 h</th>
                  <th className="num">Volumen 24 h</th>
                  <th className="num">
                    Posición abierta
                    <Help label="Posición abierta">{HELP.openInterest}</Help>
                  </th>
                  <th className="num">
                    Horquilla
                    <Help label="Horquilla">{HELP.spread}</Help>
                  </th>
                  <th className="num">
                    Prima
                    <Help label="Prima">{HELP.basis}</Help>
                  </th>
                  <th className="num">
                    Rango 24 h
                    <Help label="Rango 24 h">{HELP.range24h}</Help>
                  </th>
                  <th className="num">
                    Apal.
                    <Help label="Apal.">{HELP.maxLeverage}</Help>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((m) => (
                  <tr key={m.instId}>
                    <td>
                      <span className="ccy">
                        {m.symbol}
                        {m.traded && (
                          <>
                            {' '}
                            <Badge>operado</Badge>
                          </>
                        )}
                      </span>
                    </td>
                    <td>
                      <span className={`grade grade--${m.grade}`} title={m.reasons.join(' · ')}>
                        <span className="grade-score">{m.score}</span>
                        {GRADE_LABEL[m.grade]}
                      </span>
                      {m.reasons.length > 0 && (
                        <span className="sub grade-reason"> {m.reasons[0]}</span>
                      )}
                    </td>
                    <td className="num">{price(m.last)}</td>
                    <td className="num">
                      <DeltaValue value={m.change24h}>{pct(m.change24h)}</DeltaValue>
                    </td>
                    <td className="num">{compactUsd(m.volumeUsd)}</td>
                    <td className="num">
                      {m.openInterestUsd > 0 ? compactUsd(m.openInterestUsd) : '—'}
                    </td>
                    <td className="num">
                      {Number.isFinite(m.spreadBps) ? `${ratio(m.spreadBps, 1)} pb` : '—'}
                    </td>
                    <td className="num">
                      {Number.isFinite(m.basis) ? (
                        <DeltaValue value={m.basis}>{pct(m.basis, 3)}</DeltaValue>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{ratio(m.rangePct, 1)} %</td>
                    <td className="num sub">{m.maxLeverage}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > TABLE_PAGE && (
              <div className="table-more">
                <button type="button" className="btn btn--outline" onClick={() => setShowAll(!showAll)}>
                  {showAll
                    ? `Mostrar solo los ${TABLE_PAGE} primeros`
                    : `Mostrar los ${rows.length - TABLE_PAGE} restantes`}
                </button>
              </div>
            )}
          </TableWrap>
        )}

        {/* The method, one click away instead of a full card above the board. */}
        <details className="prose market-method">
          <summary>Cómo se calcula la operabilidad</summary>
          <p>
            Tres factores, cada uno comparado contra el resto de contratos:{' '}
            <strong>liquidez</strong> (volumen 24 h y posición abierta, 35 %),{' '}
            <strong>coste</strong> (horquilla de compra-venta, 35 %) y{' '}
            <strong>movimiento</strong> (rango del día, 30 %). Como es una comparación, en torno a
            la mitad de los contratos queda siempre por encima de 55: la nota ordena, no avisa.
          </p>
          <p>
            El coste pesa tanto como la liquidez porque en este proyecto ya se midió que{' '}
            <strong>una ventaja se gasta en la horquilla antes que en fallar</strong>: con el stop a
            un 0,25 % del precio, un 0,1 % de ida y vuelta se lleva 0,4 R por operación.
          </p>
          <p>
            El movimiento no puntúa «cuanto más mejor». Lo ideal es un rango diario del 3 al 8 %;
            un contrato que se ha movido un 40 % en un día es riesgo de liquidación, no
            oportunidad, y baja la nota.
          </p>
          <p className="sub">
            Esto describe el mercado ahora mismo, no predice dirección ni sustituye a tu análisis.
          </p>
        </details>
      </Card>

      <EconomicCalendar />

      <p className="footnote">
        Datos públicos de OKX, actualizados cada 30 segundos. La prima es la diferencia entre el
        precio del contrato y su índice al contado: en positivo, un largo la paga al converger; en
        negativo, la cobra. La horquilla se mide sobre el mejor
        precio de compra y de venta en el momento de la consulta y cambia constantemente; en
        contratos poco líquidos puede ser mucho peor de lo que muestre cualquier foto fija. La
        posición abierta viene de <code>/public/open-interest</code>, que OKX ya expresa en dólares.
      </p>
    </>
  )
}
