import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMarkets } from '../lib/markets'
import { useClosedPositions, useDailyBoard, usePositions } from '../lib/queries'
import {
  compareRows,
  NO_FILTERS,
  passes,
  PRESETS,
  technicals,
  type ScreenFilters,
  type ScreenRow,
  type SortKey,
} from '../lib/screener'
import { pct, plural, price, ratio, share } from '../lib/format'
import { Sparkline } from '../components/Sparkline'
import { useSize } from '../lib/useSize'
import { Badge, Card, DeltaValue, EmptyState, ErrorNotice, Help, SearchInput, TableSkeleton, TableWrap } from '../components/ui'
import { HELP } from '../lib/glossary'

/** Contracts that get daily candles, by volume. Past this the book is too thin for an RSI to mean much. */
const TECH_UNIVERSE = 80
const PAGE = 50

type View = 'resumen' | 'rendimiento' | 'tecnico' | 'graficos'

const CATEGORY_LABEL = { cripto: 'Cripto', accion: 'Acción', materia: 'Materia prima' } as const

function compactUsd(v: number): string {
  if (v >= 1e9) return `${ratio(v / 1e9, 2)} B$`
  if (v >= 1e6) return `${ratio(v / 1e6, 1)} M$`
  if (v >= 1e3) return `${ratio(v / 1e3, 0)} k$`
  return `${ratio(v, 0)} $`
}

/** A signed move tinted by its size, like Finviz's performance grid. Full tint at ±20 %. */
function Heat({ value }: { value: number }) {
  if (!Number.isFinite(value)) return <span className="sub">—</span>
  const tint = Math.round(Math.min(Math.abs(value) / 0.2, 1) * 55)
  const tone = value >= 0 ? 'var(--good)' : 'var(--critical)'
  return (
    <span className="heat" style={{ background: `color-mix(in srgb, ${tone} ${tint}%, transparent)` }}>
      {pct(value)}
    </span>
  )
}

function Select<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: [T, string][]
}) {
  return (
    <label className="screen-field">
      <span className="screen-field-label">{label}</span>
      <select
        className="select"
        value={String(value)}
        onChange={(e) => {
          const hit = options.find(([v]) => String(v) === e.target.value)
          if (hit) onChange(hit[0])
        }}
      >
        {options.map(([v, text]) => (
          <option key={String(v)} value={String(v)}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * The swing structure needs 50 bars either side of a pivot and the board has
 * ~180 days, so on most contracts it has not broken yet. Printing "—" beside
 * an internal CHoCH read as a contradiction; the reading now falls back to the
 * internal trend and names which scale each part belongs to.
 */
function structureLabel(t: NonNullable<ScreenRow['tech']>): ReactNode {
  const word = (bias: number) => (bias === 1 ? 'alcista' : 'bajista')
  const trend =
    t.smc.swing !== 0
      ? `Principal ${word(t.smc.swing)}`
      : t.smc.internal !== 0
        ? `Interna ${word(t.smc.internal)}`
        : '—'
  const b = t.smc.last
  return (
    <span>
      {trend}
      {b && (
        <span className="sub">
          {' '}
          · {b.kind} {b.scale === 'swing' ? 'principal' : 'interno'} {b.bias > 0 ? '↑' : '↓'}{' '}
          {b.barsAgo === 0 ? 'hoy' : `hace ${plural(b.barsAgo, 'día', 'días')}`}
        </span>
      )}
    </span>
  )
}

function reversalBadge(t: NonNullable<ScreenRow['tech']>): ReactNode {
  switch (t.reversal) {
    case 'long-activa':
      return <Badge variant="buy">Long abierta</Badge>
    case 'short-activa':
      return <Badge variant="sell">Short abierta</Badge>
    case 'vigila-long':
      return <Badge variant="neutral">Vigila long</Badge>
    case 'vigila-short':
      return <Badge variant="neutral">Vigila short</Badge>
    default:
      return <span className="sub">—</span>
  }
}

/** One contract in the charts view: 90 daily closes, drawn at the tile's real width. */
function ChartTile({ row: r, hasCandles }: { row: ScreenRow; hasCandles: boolean }) {
  const [ref, width] = useSize<HTMLDivElement>()
  const t = r.tech
  // Coloured by the span it draws, not by the day: a 90-day chart that rose
  // drawn red because today fell reads as a contradiction.
  const first = t?.closes[0] ?? NaN
  const up = t ? t.closes[t.closes.length - 1] >= first : r.change24h >= 0
  return (
    <article className="market-card">
      <header className="market-card-head">
        <span className="market-card-symbol">{r.symbol}</span>
        <DeltaValue value={r.change24h}>{pct(r.change24h)}</DeltaValue>
      </header>
      <span className="market-card-price">{price(r.last)}</span>
      <div ref={ref}>
        {t ? (
          <Sparkline
            values={t.closes}
            color={up ? 'var(--good)' : 'var(--critical)'}
            width={Math.max(width, 80)}
            height={40}
          />
        ) : (
          <span className="sub">
            {hasCandles ? 'Listado hace menos de 30 días' : 'Fuera de los 80 con más volumen'}
          </span>
        )}
      </div>
      {t && (
        <span className="sub">
          {t.closes.length - 1} d {pct(t.closes[t.closes.length - 1] / first - 1)} · RSI {ratio(t.rsi14, 0)}
        </span>
      )}
    </article>
  )
}

export function Screener() {
  const positions = usePositions()
  const closed = useClosedPositions()
  const tradedIds = useMemo(
    () => [
      ...(positions.data ?? []).map((p) => p.instId),
      ...(closed.data?.positions ?? []).map((p) => p.instId),
    ],
    [positions.data, closed.data],
  )
  const { markets, isLoading, isFetching, error } = useMarkets(tradedIds)

  // The top 80 by volume, as a sorted string: prices tick every 30 s and the
  // order near the cut-off with them, but the query list should only change
  // when the set itself does.
  const universeKey = useMemo(
    () =>
      [...markets]
        .sort((a, b) => b.volumeUsd - a.volumeUsd)
        .slice(0, TECH_UNIVERSE)
        .map((m) => m.instId)
        .sort()
        .join(','),
    [markets],
  )
  const universe = useMemo(() => (universeKey ? universeKey.split(',') : []), [universeKey])
  const board = useDailyBoard(universe)

  const rows = useMemo<ScreenRow[]>(
    () =>
      markets.map((m) => {
        const candles = board.byInst[m.instId]
        return { ...m, tech: candles ? technicals(candles, m) : null }
      }),
    [markets, board.byInst],
  )

  const [presetKey, setPresetKey] = useState('todos')
  const [filters, setFilters] = useState<ScreenFilters>(NO_FILTERS)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'volume', desc: true })
  const [view, setView] = useState<View>('resumen')
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [showAll, setShowAll] = useState(false)
  // Twelve presets scroll sideways; the chosen one must be on screen or the
  // strip looks like nothing is selected (the rule Señales' tabs follow).
  const selectedPreset = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    selectedPreset.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [presetKey])

  const set = <K extends keyof ScreenFilters>(key: K, value: ScreenFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setPresetKey('')
  }

  function applyPreset(key: string) {
    const p = PRESETS.find((x) => x.key === key)!
    setPresetKey(key)
    setFilters({ ...NO_FILTERS, ...p.filters, onlyTraded: filters.onlyTraded })
    setSort({ key: p.sort, desc: p.desc })
    setShowAll(false)
  }

  const matched = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => passes(r, filters))
      .filter((r) => !q || r.symbol.toLowerCase().includes(q))
      .sort((a, b) => compareRows(a, b, sort.key, sort.desc))
  }, [rows, filters, search, sort])
  const shown = showAll ? matched : matched.slice(0, PAGE)
  const active = Object.entries(filters).filter(
    ([k, v]) => v !== NO_FILTERS[k as keyof ScreenFilters],
  ).length
  const preset = PRESETS.find((p) => p.key === presetKey)
  const techPending = board.pending > 0

  function header(label: string, key: SortKey, help?: ReactNode, numeric = true) {
    const on = sort.key === key
    return (
      <th className={numeric ? 'num' : undefined}>
        <button
          type="button"
          className={`th-sort${on ? ' is-on' : ''}`}
          onClick={() => setSort({ key, desc: on ? !sort.desc : key !== 'symbol' })}
        >
          {label}
          {on ? (sort.desc ? ' ▼' : ' ▲') : ''}
        </button>
        {help && <Help label={label}>{help}</Help>}
      </th>
    )
  }

  if (error) return <ErrorNotice title="No se pudo cargar el tablero" message={error.message} />

  return (
    <>
      {/* Finviz's Signal menu: one tap sets the filters and the order. */}
      <div className="tabs screen-presets" role="tablist" aria-label="Atajos">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            ref={presetKey === p.key ? selectedPreset : null}
            type="button"
            role="tab"
            className="tab"
            aria-selected={presetKey === p.key}
            onClick={() => applyPreset(p.key)}
          >
            <span className="tab-label">{p.label}</span>
          </button>
        ))}
      </div>

      <div className="filter-row">
        <p className="muted">
          {isLoading
            ? 'Cargando tablero…'
            : `${plural(matched.length, 'contrato cumple', 'contratos cumplen')} ${
                preset ? `«${preset.label}»` : 'los filtros'
              } · ${preset?.note ?? `${plural(active, 'filtro activo', 'filtros activos')}`}`}
          {techPending && (
            <span className="sub">
              {' '}
              · calculando técnicos {board.loaded}/{universe.length}
            </span>
          )}
          <Help label="Qué anticipan los atajos">{HELP.screener}</Help>
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn--outline${showFilters ? ' is-on' : ''}`}
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
          >
            Filtros{active ? ` (${active})` : ''}
          </button>
          {active > 0 && (
            <button type="button" className="btn btn--outline" onClick={() => applyPreset('todos')}>
              Quitar filtros
            </button>
          )}
        </div>
      </div>

      {showFilters && (
        <Card title="Filtros" subtitle="Los técnicos usan velas diarias UTC de los 80 contratos con más volumen">
          <div className="screen-filters">
            <Select
              label="Tipo"
              value={filters.category}
              onChange={(v) => set('category', v)}
              options={[
                ['todas', 'Todos'],
                ['cripto', 'Cripto'],
                ['accion', 'Acciones'],
                ['materia', 'Materias primas'],
              ]}
            />
            <Select
              label="Volumen 24 h"
              value={filters.minVolume}
              onChange={(v) => set('minVolume', v)}
              options={[
                [0, 'Cualquiera'],
                [100_000, 'Más de 100 k$'],
                [1_000_000, 'Más de 1 M$'],
                [10_000_000, 'Más de 10 M$'],
                [50_000_000, 'Más de 50 M$'],
              ]}
            />
            <Select
              label="Rendimiento 7 d"
              value={filters.perf7}
              onChange={(v) => set('perf7', v)}
              options={[
                ['', 'Cualquiera'],
                ['up', 'Sube'],
                ['up5', 'Más de +5 %'],
                ['up10', 'Más de +10 %'],
                ['down', 'Baja'],
                ['down5', 'Menos de −5 %'],
                ['down10', 'Menos de −10 %'],
              ]}
            />
            <Select
              label="Rendimiento 30 d"
              value={filters.perf30}
              onChange={(v) => set('perf30', v)}
              options={[
                ['', 'Cualquiera'],
                ['up', 'Sube'],
                ['up10', 'Más de +10 %'],
                ['up20', 'Más de +20 %'],
                ['down', 'Baja'],
                ['down10', 'Menos de −10 %'],
                ['down20', 'Menos de −20 %'],
              ]}
            />
            <Select
              label="RSI (14) diario"
              value={filters.rsi}
              onChange={(v) => set('rsi', v)}
              options={[
                ['', 'Cualquiera'],
                ['oversold', 'Sobreventa (< 30)'],
                ['low', '30 – 50'],
                ['high', '50 – 70'],
                ['overbought', 'Sobrecompra (> 70)'],
              ]}
            />
            <Select
              label="Precio vs media 20"
              value={filters.sma20}
              onChange={(v) => set('sma20', v)}
              options={[
                ['', 'Cualquiera'],
                ['above', 'Por encima'],
                ['below', 'Por debajo'],
              ]}
            />
            <Select
              label="Precio vs media 50"
              value={filters.sma50}
              onChange={(v) => set('sma50', v)}
              options={[
                ['', 'Cualquiera'],
                ['above', 'Por encima'],
                ['below', 'Por debajo'],
              ]}
            />
            <Select
              label="Máximos y mínimos"
              value={filters.extremes}
              onChange={(v) => set('extremes', v)}
              options={[
                ['', 'Cualquiera'],
                ['high20', 'Nuevo máximo 20 d'],
                ['near20', 'A menos del 5 % del máx. 20 d'],
                ['low20', 'Nuevo mínimo 20 d'],
                ['high50', 'Nuevo máximo 50 d'],
                ['low50', 'Nuevo mínimo 50 d'],
              ]}
            />
            <Select
              label="Volatilidad (30 d)"
              value={filters.volatility}
              onChange={(v) => set('volatility', v)}
              options={[
                ['', 'Cualquiera'],
                ['low', 'Baja (< 3 % al día)'],
                ['mid', 'Media (3 – 6 %)'],
                ['high', 'Alta (> 6 %)'],
              ]}
            />
            <Select
              label="Volumen relativo"
              value={filters.relVolume}
              onChange={(v) => set('relVolume', v)}
              options={[
                [0, 'Cualquiera'],
                [1.5, 'Más de 1,5×'],
                [2, 'Más de 2×'],
                [3, 'Más de 3×'],
              ]}
            />
            <Select
              label="Tendencia (medias)"
              value={filters.trend}
              onChange={(v) => set('trend', v)}
              options={[
                ['', 'Cualquiera'],
                ['alcista', 'Alcista'],
                ['bajista', 'Bajista'],
              ]}
            />
            <Select
              label="Estructura SMC"
              value={filters.structure}
              onChange={(v) => set('structure', v)}
              options={[
                ['', 'Cualquiera'],
                ['swing-up', 'Principal alcista'],
                ['swing-down', 'Principal bajista'],
                ['choch5', 'CHoCH en 5 días'],
                ['bos5', 'BOS en 5 días'],
              ]}
            />
            <Select
              label="Reversión (diario)"
              value={filters.reversal}
              onChange={(v) => set('reversal', v)}
              options={[
                ['', 'Cualquiera'],
                ['any', 'Señal o vigilando'],
                ['activa', 'Señal abierta'],
                ['vigila', 'Vigilando'],
              ]}
            />
            <label className="screen-field screen-check">
              <input
                type="checkbox"
                checked={filters.onlyTraded}
                onChange={(e) => set('onlyTraded', e.target.checked)}
              />
              <span>Solo los que opero</span>
            </label>
          </div>
        </Card>
      )}

      <Card
        title="Resultados"
        subtitle={
          filters.minVolume === 0 && active === 0
            ? 'Los técnicos solo existen para los 80 contratos con más volumen; el resto muestra «—»'
            : undefined
        }
        flush
        dimmed={isFetching && !isLoading}
        action={
          <div className="seg-control">
            {(
              [
                ['resumen', 'Resumen'],
                ['rendimiento', 'Rendimiento'],
                ['tecnico', 'Técnico'],
                ['graficos', 'Gráficos'],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        <div className="table-controls-bar">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar: BTC, AAPL…" className="table-search" />
        </div>

        {isLoading ? (
          <TableSkeleton rows={10} cols={8} />
        ) : matched.length === 0 ? (
          <EmptyState
            title="Ningún contrato cumple estos filtros"
            hint={techPending ? 'Aún se están calculando los técnicos; espera unos segundos.' : 'Prueba a relajar algún filtro.'}
          />
        ) : view === 'graficos' ? (
          <div className="market-cards screen-charts">
            {shown.map((r) => (
              <ChartTile key={r.instId} row={r} hasCandles={Boolean(board.byInst[r.instId])} />
            ))}
          </div>
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  {header('Contrato', 'symbol', undefined, false)}
                  {view === 'resumen' && (
                    <>
                      <th>Tipo</th>
                      <th className="num">Precio</th>
                      {header('24 h', 'change')}
                      {header('Volumen 24 h', 'volume')}
                      {header('RSI', 'rsi', HELP.rsi)}
                      <th>Tendencia</th>
                      <th>
                        Estructura
                        <Help label="Estructura">{HELP.smc}</Help>
                      </th>
                      <th>Reversión</th>
                    </>
                  )}
                  {view === 'rendimiento' && (
                    <>
                      <th className="num">Precio</th>
                      {header('Desde apertura', 'fromOpen')}
                      {header('24 h', 'change')}
                      {header('7 d', 'perf7')}
                      {header('30 d', 'perf30')}
                      {header('90 d', 'perf90')}
                      {header('Desde listado', 'perfListed')}
                    </>
                  )}
                  {view === 'tecnico' && (
                    <>
                      {header('RSI', 'rsi', HELP.rsi)}
                      {header('vs media 20', 'vsSma20')}
                      {header('vs media 50', 'vsSma50')}
                      {header('vs máx. 20 d', 'vsHigh20')}
                      {header('Volatilidad', 'volatility', HELP.volatility)}
                      {header('ATR', 'atr')}
                      {header('Vol. relativo', 'relVolume', HELP.relVolume)}
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const t = r.tech
                  return (
                    <tr key={r.instId}>
                      <td>
                        <span className="ccy">{r.symbol}</span>
                        {r.traded && (
                          <>
                            {' '}
                            <Badge>operado</Badge>
                          </>
                        )}
                      </td>
                      {view === 'resumen' && (
                        <>
                          <td className="sub">{CATEGORY_LABEL[r.category]}</td>
                          <td className="num">{price(r.last)}</td>
                          <td className="num">
                            <DeltaValue value={r.change24h}>{pct(r.change24h)}</DeltaValue>
                          </td>
                          <td className="num">{compactUsd(r.volumeUsd)}</td>
                          <td className="num">
                            {t ? (
                              <span className={t.rsi14 > 70 || t.rsi14 < 30 ? 'rsi-edge' : undefined}>
                                {ratio(t.rsi14, 0)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="sub">{t ? t.trend[0].toUpperCase() + t.trend.slice(1) : '—'}</td>
                          <td>{t ? structureLabel(t) : <span className="sub">—</span>}</td>
                          <td>{t ? reversalBadge(t) : <span className="sub">—</span>}</td>
                        </>
                      )}
                      {view === 'rendimiento' && (
                        <>
                          <td className="num">{price(r.last)}</td>
                          <td className="num">
                            <Heat value={t?.fromOpen ?? NaN} />
                          </td>
                          <td className="num">
                            <Heat value={r.change24h} />
                          </td>
                          <td className="num">
                            <Heat value={t?.perf7 ?? NaN} />
                          </td>
                          <td className="num">
                            <Heat value={t?.perf30 ?? NaN} />
                          </td>
                          <td className="num">
                            <Heat value={t?.perf90 ?? NaN} />
                          </td>
                          <td className="num">
                            <Heat value={t?.perfListed ?? NaN} />
                          </td>
                        </>
                      )}
                      {view === 'tecnico' && (
                        <>
                          <td className="num">{t ? ratio(t.rsi14, 0) : '—'}</td>
                          <td className="num">{t && Number.isFinite(t.vsSma20) ? pct(t.vsSma20) : '—'}</td>
                          <td className="num">{t && Number.isFinite(t.vsSma50) ? pct(t.vsSma50) : '—'}</td>
                          <td className="num">{t ? pct(t.vsHigh20) : '—'}</td>
                          <td className="num">{t ? share(t.volatilityMonth, 1) : '—'}</td>
                          <td className="num">{t ? share(t.atrPct, 1) : '—'}</td>
                          <td className="num">{t && Number.isFinite(t.relVolume) ? `${ratio(t.relVolume, 1)}×` : '—'}</td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableWrap>
        )}

        {matched.length > PAGE && (
          <div className="table-more">
            <button type="button" className="btn btn--outline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? `Mostrar solo los ${PAGE} primeros` : `Mostrar los ${matched.length - PAGE} restantes`}
            </button>
          </div>
        )}
      </Card>

      <p className="footnote">
        Datos públicos de OKX: precio y volumen cada 30 segundos, velas diarias (UTC) cada hora. El
        tablero X-Perp se listó el 30 de marzo de 2026, así que no hay historia para una media de 200
        días ni un máximo anual; el rendimiento «desde listado» cuenta desde entonces. Los filtros
        describen el mercado: medidos sobre 30 criptos y 248 semanas, ninguno
        selecciona de forma fiable lo que batirá al resto, y el único efecto que se sostiene es
        pequeño — tras un CHoCH bajista, un 1 % peor que el resto la semana siguiente.
      </p>
    </>
  )
}
