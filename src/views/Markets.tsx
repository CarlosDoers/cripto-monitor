import { useMemo, useState } from 'react'
import { useMarkets, type Market } from '../lib/markets'
import { useClosedPositions, usePositions } from '../lib/queries'
import { pct, plural, price, ratio, usdCompact } from '../lib/format'
import { Badge, Card, EmptyState, ErrorNotice, SearchInput, Stat, TableSkeleton } from '../components/ui'

type SortBy = 'score' | 'volume' | 'oi' | 'spread' | 'range' | 'change'

const GRADE_LABEL: Record<Market['grade'], string> = {
  excelente: 'Excelente',
  bueno: 'Bueno',
  aceptable: 'Aceptable',
  evitar: 'Evitar',
}

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
    const good = markets.filter((m) => m.grade === 'excelente' || m.grade === 'bueno').length
    const spreads = markets.map((m) => m.spreadBps).filter(Number.isFinite).sort((a, b) => a - b)
    return {
      vol,
      good,
      medianSpread: spreads.length ? spreads[Math.floor(spreads.length / 2)] : NaN,
    }
  }, [markets])

  if (error) {
    return <ErrorNotice title="No se pudo cargar el listado de mercados" message={error.message} />
  }

  return (
    <>
      <div className="kpi-row">
        <Stat
          label="Contratos X-Perp activos"
          loading={isLoading}
          value={String(markets.length)}
          foot={<span>perpetuos listados en OKX</span>}
        />
        <Stat
          label="Recomendables ahora"
          hero
          loading={isLoading}
          value={String(totals.good)}
          foot={<span>con puntuación de 55 o más</span>}
        />
        <Stat
          label="Volumen 24 h total"
          loading={isLoading}
          value={compactUsd(totals.vol)}
          foot={<span>suma de todos los X-Perp</span>}
        />
        <Stat
          label="Horquilla mediana"
          loading={isLoading}
          value={Number.isFinite(totals.medianSpread) ? `${ratio(totals.medianSpread, 1)} pb` : '—'}
          foot={<span>coste de entrar y salir</span>}
        />
      </div>

      <Card
        title="Cómo se calcula la puntuación"
        subtitle="Mide las condiciones para operar, no si el precio va a subir"
      >
        <div className="prose">
          <p>
            Tres factores, cada uno comparado contra el resto de contratos:{' '}
            <strong>liquidez</strong> (volumen 24 h y posición abierta, 35 %),{' '}
            <strong>coste</strong> (horquilla de compra-venta, 35 %) y{' '}
            <strong>movimiento</strong> (rango del día, 30 %).
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
        </div>
      </Card>

      <Card
        title="Contratos perpetuos"
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
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Contrato</th>
                  <th>Operabilidad</th>
                  <th className="num">Precio</th>
                  <th className="num">24 h</th>
                  <th className="num">Volumen 24 h</th>
                  <th className="num">Posición abierta</th>
                  <th className="num">Horquilla</th>
                  <th className="num">Rango 24 h</th>
                  <th className="num">Apal.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
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
                    <td className={`num ${m.change24h >= 0 ? 'delta--up' : 'delta--down'}`}>
                      {pct(m.change24h)}
                    </td>
                    <td className="num">{compactUsd(m.volumeUsd)}</td>
                    <td className="num">
                      {m.openInterestUsd > 0 ? compactUsd(m.openInterestUsd) : '—'}
                    </td>
                    <td className="num">
                      {Number.isFinite(m.spreadBps) ? `${ratio(m.spreadBps, 1)} pb` : '—'}
                    </td>
                    <td className="num">{ratio(m.rangePct, 1)} %</td>
                    <td className="num sub">{m.maxLeverage}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="footnote">
        Datos públicos de OKX, actualizados cada 30 segundos. La horquilla se mide sobre el mejor
        precio de compra y de venta en el momento de la consulta y cambia constantemente; en
        contratos poco líquidos puede ser mucho peor de lo que muestre cualquier foto fija. La
        posición abierta viene de <code>/public/open-interest</code>, que OKX ya expresa en dólares.
      </p>
    </>
  )
}
