import { useMemo, useState, type ReactNode } from 'react'
import {
  MIN_SAMPLE,
  PERIODS,
  usePerformance,
  type PeriodKey,
  type Trade,
} from '../lib/performance'
import {
  dateTime,
  duration,
  pct,
  plural,
  price,
  qty,
  ratio,
  share,
  signedUsd,
  usd,
} from '../lib/format'
import { PnlCurve } from '../components/PnlCurve'
import { TradingCalendar } from '../components/TradingCalendar'
import { HourlyBars } from '../components/HourlyBars'
import { AvgCompare, DivergingBars, WinLossBar } from '../components/PerfCharts'
import {
  Badge,
  Card,
  DeltaValue,
  EmptyState,
  ErrorNotice,
  SearchInput,
  Skeleton,
  TableSkeleton,
  TableWrap,
} from '../components/ui'

function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <li>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      {hint && <span className="metric-hint">{hint}</span>}
    </li>
  )
}

function streakLabel(streak: number): string {
  if (streak === 0) return '—'
  const n = Math.abs(streak)
  return streak > 0 ? plural(n, 'ganadora', 'ganadoras') : plural(n, 'perdedora', 'perdedoras')
}

const PAGE = 15

function TradesTable({ trades }: { trades: Trade[] }) {
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'win' | 'loss' | 'liq'>('all')

  const filtered = useMemo(() => {
    let list = [...trades].reverse()
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      list = list.filter((t) => t.symbol.toLowerCase().includes(q))
    }
    if (filter === 'win') list = list.filter((t) => t.pnl > 0)
    if (filter === 'loss') list = list.filter((t) => t.pnl < 0)
    if (filter === 'liq') list = list.filter((t) => t.liquidated)
    return list
  }, [trades, search, filter])

  const rows = showAll ? filtered : filtered.slice(0, PAGE)

  return (
    <>
      <div className="table-controls-bar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por activo (ej. BTC, ETH)..."
          className="table-search"
        />
        <div className="seg-control">
          <button
            type="button"
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            Todas ({trades.length})
          </button>
          <button
            type="button"
            aria-pressed={filter === 'win'}
            onClick={() => setFilter('win')}
          >
            Ganadoras
          </button>
          <button
            type="button"
            aria-pressed={filter === 'loss'}
            onClick={() => setFilter('loss')}
          >
            Perdedoras
          </button>
          <button
            type="button"
            aria-pressed={filter === 'liq'}
            onClick={() => setFilter('liq')}
          >
            Liquidadas
          </button>
        </div>
      </div>

      <TableWrap>
        <table className="data">
          <thead>
            <tr>
              <th>Cierre</th>
              <th>Instrumento</th>
              <th>Dirección</th>
              <th className="num">Tamaño</th>
              <th className="num">Precio Entrada</th>
              <th className="num">Precio Salida</th>
              <th className="num">Duración</th>
              <th className="num">Comisiones</th>
              <th className="num">PnL Neto</th>
              <th className="num">ROI</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="sub">{dateTime(t.closedAt)}</td>
                <td>
                  <span className="ccy">{t.symbol}</span>
                  {t.liquidated && (
                    <>
                      {' '}
                      <Badge variant="warn">Liquidada</Badge>
                    </>
                  )}
                </td>
                <td>
                  <Badge variant={t.direction === 'short' ? 'sell' : 'buy'}>
                    {t.direction === 'short' ? 'Corto' : 'Largo'}
                    {t.lever > 0 && ` ${t.lever}×`}
                  </Badge>
                </td>
                <td className="num">{qty(t.size)}</td>
                <td className="num">{price(t.openPx)}</td>
                <td className="num">{price(t.closePx)}</td>
                <td className="num sub">{t.duration ? duration(t.duration) : '—'}</td>
                <td className="num sub">{usd(Math.abs(t.fee + t.fundingFee))}</td>
                <td className="num">
                  <DeltaValue value={t.pnl}>{signedUsd(t.pnl)}</DeltaValue>
                </td>
                <td className="num">
                  <DeltaValue value={t.pnlRatio}>{pct(t.pnlRatio)}</DeltaValue>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <EmptyState
            title="Sin operaciones con estos filtros"
            hint="Prueba ajustando la búsqueda o el filtro de resultado."
          />
        )}

        {filtered.length > PAGE && (
          <div className="table-more">
            <button type="button" className="btn btn--outline" onClick={() => setShowAll(!showAll)}>
              {showAll
                ? `Mostrar solo las ${PAGE} primeras`
                : `Mostrar las ${filtered.length - PAGE} operaciones restantes`}
            </button>
          </div>
        )}
      </TableWrap>
    </>
  )
}

export function Performance() {
  const [period, setPeriod] = useState<PeriodKey>('30d')
  const p = usePerformance(period)
  const dimmed = p.isFetching && !p.isLoading

  if (p.error) {
    return <ErrorNotice title="No se pudo cargar el rendimiento" message={p.error.message} />
  }

  const periodFilter = (
    <div className="seg-control">
      {PERIODS.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={period === option.key}
          onClick={() => setPeriod(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )

  if (!p.isLoading && p.count === 0) {
    return (
      <>
        <div className="filter-row">
          <p className="muted">
            {p.totalAvailable > 0
              ? `Sin operaciones cerradas en este periodo (${p.totalAvailable} en total).`
              : 'Aún no hay operaciones cerradas.'}
          </p>
          {periodFilter}
        </div>
        <Card>
          <EmptyState
            title="Sin operaciones en el periodo"
            hint="Prueba a ampliar el rango, o cierra alguna posición para empezar a acumular estadísticas."
          />
        </Card>
      </>
    )
  }

  return (
    <>
      {/* One filter row above everything it scopes. */}
      <div className="filter-row">
        <p className="muted">
          {p.isLoading
            ? 'Cargando operaciones…'
            : `${p.count} operaciones cerradas${
                p.firstTradeAt
                  ? ` · desde el ${new Date(p.firstTradeAt).toLocaleDateString('es-ES', {
                      day: 'numeric',
                      month: 'long',
                    })}`
                  : ''
              }`}
        </p>
        {periodFilter}
      </div>

      {/* Headline block, laid out like OKX's own analytics page: the total, what
          today added, and a compact curve — then the three numbers that qualify it. */}
      <Card dimmed={dimmed}>
        <div className="perf-head">
          <div className="perf-head-main">
            <span className="metric-label">Resultado realizado</span>
            <span className={`perf-total ${p.netPnl >= 0 ? 'delta--up' : 'delta--down'}`}>
              {signedUsd(p.netPnl)}
            </span>
            <span className="sub">
              Hoy{' '}
              <strong className={p.todayPnl >= 0 ? 'delta--up' : 'delta--down'}>
                {signedUsd(p.todayPnl)}
              </strong>
            </span>
          </div>
          <div className="perf-head-chart">
            {p.isLoading ? (
              <Skeleton height={110} />
            ) : (
              <PnlCurve points={p.equityCurve} trades={p.trades} height={110} />
            )}
          </div>
        </div>

        <ul className="perf-stats">
          <li>
            <span className="metric-label">Tasa de aciertos</span>
            <span className="metric-value">{p.count > 0 ? share(p.winRate, 1) : '—'}</span>
            <span className="metric-hint">
              {p.wins} ganadas · {p.losses} perdidas
            </span>
          </li>
          <li>
            <span className="metric-label">Operaciones</span>
            <span className="metric-value">{p.count}</span>
            <span className="metric-hint">cerradas en el periodo</span>
          </li>
          <li>
            <span className="metric-label">Riesgo / recompensa</span>
            <span className="metric-value">
              {p.riskReward > 0 ? `1:${ratio(p.riskReward)}` : '—'}
            </span>
            <span className="metric-hint">pérdida media frente a ganancia media</span>
          </li>
          <li>
            <span className="metric-label">Factor de beneficio</span>
            <span className="metric-value">{ratio(p.profitFactor)}</span>
            <span className="metric-hint">
              {p.profitFactor >= 1 ? 'ganas más de lo que pierdes' : 'pierdes más de lo que ganas'}
            </span>
          </li>
        </ul>
      </Card>

      <Card
        title="Calendario de trading"
        subtitle="Resultado realizado por día"
        dimmed={dimmed}
      >
        {p.isLoading ? <Skeleton height={280} /> : <TradingCalendar trades={p.trades} />}
      </Card>

      <div className="grid-2">
        <Card title="Ganadas contra perdidas" dimmed={dimmed}>
          {p.isLoading ? (
            <Skeleton height={32} />
          ) : (
            <>
              <WinLossBar wins={p.wins} losses={p.losses} />
              <div style={{ marginTop: 18 }}>
                <AvgCompare avgWin={p.avgWin} avgLoss={p.avgLoss} />
              </div>
            </>
          )}
        </Card>

        <Card title="Detalle" dimmed={dimmed}>
          {p.isLoading ? (
            <Skeleton height={140} />
          ) : (
            <ul className="metrics">
              <Metric
                label="Mejor operación"
                value={
                  p.best ? (
                    <DeltaValue value={p.best.pnl}>{signedUsd(p.best.pnl)}</DeltaValue>
                  ) : (
                    '—'
                  )
                }
                hint={p.best?.symbol}
              />
              <Metric
                label="Peor operación"
                value={
                  p.worst ? (
                    <DeltaValue value={p.worst.pnl}>{signedUsd(p.worst.pnl)}</DeltaValue>
                  ) : (
                    '—'
                  )
                }
                hint={p.worst?.symbol}
              />
              <Metric label="Racha actual" value={streakLabel(p.currentStreak)} />
              <Metric
                label="Mejor racha"
                value={`${p.longestWinStreak} seguidas`}
                hint={`Peor: ${Math.abs(p.longestLossStreak)} seguidas`}
              />
              <Metric
                label="Duración media"
                value={p.avgDuration ? duration(p.avgDuration) : '—'}
              />
              <Metric
                label="Costes totales"
                value={<span className="delta--down">{usd(Math.abs(p.totalCosts))}</span>}
                hint={
                  p.grossPnl !== 0
                    ? `${share(Math.abs(p.totalCosts) / Math.abs(p.grossPnl), 0)} del bruto`
                    : undefined
                }
              />
            </ul>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card
          title="Resultado por activo"
          subtitle="Dónde ganas y dónde pierdes"
          dimmed={dimmed}
        >
          {p.isLoading ? (
            <Skeleton height={140} />
          ) : (
            <DivergingBars
              rows={p.byInstrument.map((g) => ({
                key: g.key,
                label: g.key,
                value: g.pnl,
                meta:
                  g.trades >= MIN_SAMPLE
                    ? `${plural(g.trades, "op", "ops")} · ${share(g.winRate, 0)}`
                    : `${plural(g.trades, "op", "ops")} · muestra corta`,
              }))}
            />
          )}
        </Card>

        <Card title="Largos contra cortos" dimmed={dimmed}>
          {p.isLoading ? (
            <Skeleton height={140} />
          ) : (
            <DivergingBars
              rows={p.byDirection.map((g) => ({
                key: g.key,
                label: g.key === 'short' ? 'Cortos' : 'Largos',
                value: g.pnl,
                meta: `${plural(g.trades, "op", "ops")} · ${share(g.winRate, 0)}`,
              }))}
            />
          )}
        </Card>
      </div>

      {p.hasEntryTimes && (
        <div className="grid-2">
          <Card
            title="Resultado por hora de entrada"
            subtitle={`Hora local · las franjas con menos de ${MIN_SAMPLE} operaciones se muestran atenuadas`}
            dimmed={dimmed}
          >
            {p.isLoading ? <Skeleton height={132} /> : <HourlyBars buckets={p.byHour} />}
          </Card>

          <Card
            title="Resultado por día de la semana"
            subtitle="Según el día en que abriste la posición"
            dimmed={dimmed}
          >
            {p.isLoading ? (
              <Skeleton height={132} />
            ) : (
              <DivergingBars
                rows={p.byWeekday
                  .filter((b) => b.trades > 0)
                  .map((b) => ({
                    key: b.key,
                    label: b.label,
                    value: b.pnl,
                    meta: b.reliable
                      ? `${plural(b.trades, 'op', 'ops')} · ${share(b.winRate, 0)}`
                      : `${plural(b.trades, 'op', 'ops')} · muestra corta`,
                  }))}
              />
            )}
          </Card>
        </div>
      )}

      <Card
        title="Operaciones cerradas"
        subtitle="Cada posición cerrada, con su PnL neto"
        flush
        dimmed={dimmed}
      >
        {p.isLoading ? <TableSkeleton rows={8} cols={8} /> : <TradesTable trades={p.trades} />}
      </Card>

      <p className="footnote">
        Las estadísticas cubren posiciones cerradas de derivados, con el PnL neto que reporta OKX
        (ya descontadas comisiones y financiación). Las operaciones de spot no aparecen: OKX no
        calcula un resultado por operación en spot, y estimarlo daría cifras poco fiables.
        {p.truncated && (
          <>
            {' '}
            Tu historial supera las {p.totalAvailable} operaciones que se pueden consultar de una
            vez, así que las más antiguas quedan fuera de estos cálculos.
          </>
        )}
      </p>
    </>
  )
}
