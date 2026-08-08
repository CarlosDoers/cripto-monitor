import { useState, type ReactNode } from 'react'
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
import { HourlyBars } from '../components/HourlyBars'
import { AvgCompare, DivergingBars, WinLossBar } from '../components/PerfCharts'
import {
  Badge,
  Card,
  DeltaValue,
  EmptyState,
  ErrorNotice,
  Skeleton,
  Stat,
  TableSkeleton,
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
  // Most recent first — the opposite of the chronological order the curve needs.
  const all = [...trades].reverse()
  const rows = showAll ? all : all.slice(0, PAGE)

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Cerrada</th>
            <th>Instrumento</th>
            <th>Dirección</th>
            <th className="num">Tamaño</th>
            <th className="num">Entrada</th>
            <th className="num">Salida</th>
            <th className="num">Duración</th>
            <th className="num">Comisiones</th>
            <th className="num">PnL neto</th>
            <th className="num">%</th>
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

      {/* Never truncate silently — say what is hidden and offer the rest. */}
      {all.length > PAGE && (
        <div className="table-more">
          <button type="button" className="btn" onClick={() => setShowAll(!showAll)}>
            {showAll
              ? `Mostrar solo las ${PAGE} últimas`
              : `Mostrar las ${all.length - PAGE} restantes`}
          </button>
        </div>
      )}
    </div>
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

      <div className="kpi-row">
        <Stat
          label="Operaciones ganadas"
          hero
          loading={p.isLoading}
          value={share(p.winRate, 1)}
          foot={
            <span>
              {p.wins} ganadas · {p.losses} perdidas
            </span>
          }
        />
        <Stat
          label="PnL realizado"
          loading={p.isLoading}
          value={<DeltaValue value={p.netPnl}>{signedUsd(p.netPnl)}</DeltaValue>}
          foot={<span>Neto, tras comisiones</span>}
        />
        <Stat
          label="Factor de beneficio"
          loading={p.isLoading}
          value={ratio(p.profitFactor)}
          foot={
            <span>
              {p.profitFactor >= 1
                ? 'Ganas más de lo que pierdes'
                : 'Pierdes más de lo que ganas'}
            </span>
          }
        />
        <Stat
          label="Resultado por operación"
          loading={p.isLoading}
          value={<DeltaValue value={p.expectancy}>{signedUsd(p.expectancy)}</DeltaValue>}
          foot={<span>Media de {plural(p.count, "operación", "operaciones")}</span>}
        />
      </div>

      <Card
        title="Evolución del resultado"
        subtitle="PnL acumulado en US$, tras cada operación cerrada"
        dimmed={dimmed}
      >
        {p.isLoading ? <Skeleton height={220} /> : <PnlCurve points={p.equityCurve} trades={p.trades} />}
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
