import { useMemo, useState } from 'react'
import { TIMEFRAMES, useSignals, type Timeframe } from '../lib/signals'
import { profileOf, STRATEGIES, strategyByKey } from '../lib/indicators/registry'
import { useClosedPositions, useInstruments, usePositions } from '../lib/queries'
import { dateTime, plural, price, ratio, share, timeAgo } from '../lib/format'
import { PriceChart } from '../components/PriceChart'
import { IconAlert, IconActivity } from '../components/icons'
import {
  Badge,
  Card,
  EmptyState,
  ErrorNotice,
  Skeleton,
  Stat,
  TableSkeleton,
} from '../components/ui'
import type { StrategySignal } from '../lib/indicators/types'

/** Below this many bars past warm-up there is nothing meaningful to measure. */
const MIN_BARS = 30

/** Offered even with no position in them. */
const FALLBACK = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT']

function LiveSignal({ signal, last }: { signal: StrategySignal; last: number }) {
  const long = signal.side === 'long'
  const goal = signal.target
  const progress = goal
    ? long
      ? (last - signal.entry) / (goal - signal.entry)
      : (signal.entry - last) / (signal.entry - goal)
    : null
  // Without a fixed target, progress is measured in R earned so far.
  const risk = Math.abs(signal.entry - signal.stop)
  const openR = risk > 0 ? (long ? last - signal.entry : signal.entry - last) / risk : 0

  return (
    <div className={`signal-live signal-live--${signal.side}`}>
      <div className="signal-live-head">
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Badge variant={long ? 'buy' : 'sell'} pulse>
            {long ? '▲ POSICIÓN LONG' : '▼ POSICIÓN SHORT'}
          </Badge>
          <span className="live-pill">En Curso</span>
        </div>
        <span className="muted">detectada {timeAgo(signal.time)}</span>
      </div>

      <ul className="signal-levels">
        <li>
          <span className="metric-label">Precio Entrada</span>
          <span className="metric-value">{price(signal.entry)}</span>
        </li>
        {goal !== undefined ? (
          <li>
            <span className="metric-label">Take Profit (Objetivo)</span>
            <span className="metric-value delta--up">{price(goal)}</span>
          </li>
        ) : (
          <li>
            <span className="metric-label">Estrategia de Salida</span>
            <span className="metric-value">Trailing Stop Dinámico</span>
          </li>
        )}
        <li>
          <span className="metric-label">Stop Loss</span>
          <span className="metric-value delta--down">{price(signal.stop)}</span>
        </li>
        <li>
          <span className="metric-label">{goal !== undefined ? 'Ratio Beneficio/Riesgo' : 'R Acumulado'}</span>
          <span className={`metric-value ${goal === undefined && openR < 0 ? 'delta--down' : 'delta--up'}`}>
            {goal !== undefined
              ? ratio(signal.riskReward ?? 0)
              : `${openR >= 0 ? '+' : '−'}${ratio(Math.abs(openR))} R`}
          </span>
        </li>
      </ul>

      {progress !== null && (
        <div className="signal-progress">
          <div className="signal-progress-track">
            <span
              className="signal-progress-fill"
              style={{
                width: `${Math.min(Math.max(progress * 100, 0), 100)}%`,
                background: progress >= 0 ? 'var(--good)' : 'var(--critical)',
              }}
            />
          </div>
          <div className="signal-progress-labels">
            <span>Precio actual: <strong>{price(last)}</strong></span>
            <span>{share(Math.min(Math.max(progress, 0), 1), 0)} del recorrido al objetivo</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function Signals() {
  const [strategyKey, setStrategyKey] = useState(STRATEGIES[0].key)
  const [timeframe, setTimeframe] = useState<Timeframe>('1D')
  const [presetKey, setPresetKey] = useState(STRATEGIES[0].presets[0].key)
  const [filterOutcome, setFilterOutcome] = useState<'all' | 'win' | 'loss' | 'open'>('all')

  const strategy = strategyByKey(strategyKey)
  const preset = strategy.presets.find((p) => p.key === presetKey) ?? strategy.presets[0]
  const profile = profileOf(strategy, preset.key)

  const positions = usePositions()
  const closed = useClosedPositions()
  const futures = useInstruments('FUTURES')
  const swaps = useInstruments('SWAP')

  const options = useMemo(() => {
    const listed = new Map([...(futures.data ?? []), ...(swaps.data ?? [])].map((i) => [i.instId, i]))
    const open = (positions.data ?? []).map((p) => p.instId)
    const traded = (closed.data?.positions ?? []).map((p) => p.instId)
    const extras = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP'].filter((i) => listed.has(i))
    return [...new Set([...open, ...traded, ...extras, ...FALLBACK])].filter((id) => {
      const inst = listed.get(id)
      return !inst || inst.state === 'live'
    })
  }, [positions.data, closed.data, futures.data, swaps.data])

  const [instId, setInstId] = useState('')
  const selected = instId || options[0] || 'BTC-USDT'

  const s = useSignals(selected, timeframe, strategyKey, preset.key)
  const r = s.result
  const currentTf = TIMEFRAMES.find((t) => t.key === timeframe)
  const lastPrice = s.candles.at(-1)?.close ?? 0
  const dimmed = s.isFetching && !s.isLoading

  const recent = useMemo(() => {
    let list = [...r.signals].reverse()
    if (filterOutcome === 'win') list = list.filter((sig) => sig.outcome === 'win')
    if (filterOutcome === 'loss') list = list.filter((sig) => sig.outcome === 'loss')
    if (filterOutcome === 'open') list = list.filter((sig) => sig.outcome === 'open')
    return list.slice(0, 20)
  }, [r.signals, filterOutcome])

  const regimeFits =
    (strategy.regime === 'trending' && s.regime !== 'ranging') ||
    (strategy.regime === 'ranging' && s.regime !== 'trending')

  function pickStrategy(key: string) {
    setStrategyKey(key)
    setPresetKey(strategyByKey(key).presets[0].key)
  }

  if (s.error) {
    return <ErrorNotice title="No se pudieron cargar las velas" message={s.error.message} />
  }

  return (
    <>
      {/* Strategy selection tabs */}
      <div className="tabs" role="tablist" aria-label="Estrategias e Indicadores">
        {STRATEGIES.map((item) => (
          <button
            key={item.key}
            role="tab"
            type="button"
            className="tab"
            aria-selected={strategyKey === item.key}
            onClick={() => pickStrategy(item.key)}
          >
            <div className="tab-inner">
              <span className="tab-label">{item.label}</span>
              <span className="tab-tagline">{item.tagline}</span>
            </div>
            {strategyKey === item.key && <span className="tab-indicator" />}
          </button>
        ))}
      </div>

      {/* Control / Filter Bar */}
      <div className="filter-row">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="select-wrap">
            <select
              className="select"
              value={selected}
              onChange={(e) => setInstId(e.target.value)}
              aria-label="Instrumento"
            >
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          <div className="seg-control">
            {TIMEFRAMES.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={timeframe === t.key}
                onClick={() => setTimeframe(t.key)}
                title={`Esperanza histórica: ${ratio(profile.byTimeframe[t.key] ?? 0)} R por señal`}
              >
                {t.label}
                {(profile.byTimeframe[t.key] ?? 0) > 0.1 && (
                  <span className="tf-mark" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>

          <div className="seg-control">
            {strategy.presets.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={preset.key === p.key}
                onClick={() => setPresetKey(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="badge badge--neutral">
            <IconActivity />
            {s.isLoading ? 'Analizando...' : `${s.usableBars} velas confirmadas`}
          </span>
        </div>
      </div>

      {/* Context Notices */}
      {!s.isLoading && s.usableBars < MIN_BARS && (
        <div className="notice">
          <IconAlert />
          <div className="notice-body">
            <p className="notice-title">Histórico insuficiente en esta temporalidad</p>
            <p className="notice-text">
              {selected} solo tiene {plural(s.candles.length, 'vela cerrada', 'velas cerradas')} en{' '}
              {currentTf?.label}, y la estrategia necesita {r.warmup} solo para arrancar sus medias.
              Prueba una temporalidad más corta o un instrumento con más recorrido.
            </p>
          </div>
        </div>
      )}

      {!s.isLoading && s.usableBars >= MIN_BARS && (profile.byTimeframe[timeframe] ?? 0) <= 0.1 && (
        <div className="notice notice--warning">
          <IconAlert />
          <div className="notice-body">
            <p className="notice-title">
              En {currentTf?.label} esta estrategia no cubre las comisiones estimadas
            </p>
            <p className="notice-text">
              El barrido histórico dio {ratio(profile.byTimeframe[timeframe] ?? 0)} R por señal
              después de costes. Con el stop tan cerca del precio, cada ida y vuelta cuesta{' '}
              <strong>{ratio(r.avgFeeR)} R</strong>. En temporalidad diaria (1D) el rendimiento es netamente positivo.
            </p>
          </div>
        </div>
      )}

      {/* Active Signal Card */}
      {r.active && !s.isLoading && (
        <Card title="Señal Abierta Activa" subtitle="Posición en curso según niveles calculados" glow>
          <LiveSignal signal={r.active!} last={lastPrice} />
        </Card>
      )}

      {/* Main Chart Card */}
      <Card
        title={`${selected} · ${currentTf?.label}`}
        subtitle={`${strategy.tagline} · Preset: ${preset.label}`}
        dimmed={dimmed}
        action={
          <span className={`regime regime--${s.regime}`}>
            <span className="regime-dot" />
            {s.regime === 'trending' ? 'Mercado en Tendencia' : s.regime === 'mixed' ? 'Régimen Mixto' : 'Mercado Lateral'}
            <span className="sub"> · Eficiencia {ratio(s.efficiency, 2)}</span>
          </span>
        }
      >
        {s.isLoading ? <Skeleton height={360} /> : <PriceChart candles={s.candles} result={r} height={360} />}
      </Card>

      {!s.isLoading && s.usableBars >= MIN_BARS && !regimeFits && (
        <div className="notice">
          <IconAlert />
          <div className="notice-body">
            <p className="notice-title">
              El mercado actual no acompaña al régimen óptimo de esta estrategia
            </p>
            <p className="notice-text">
              {strategy.label} está optimizada para mercado{' '}
              {strategy.regime === 'trending' ? 'con tendencia' : 'lateral'}, y la eficiencia actual
              ({ratio(s.efficiency, 2)}) indica lo contrario.
            </p>
          </div>
        </div>
      )}

      {/* Strategy KPI Row */}
      <div className="kpi-row">
        <Stat
          label="Señales Detectadas"
          loading={s.isLoading}
          value={String(r.signals.length)}
          foot={<span>{r.open > 0 ? `${r.open} sin resolver` : 'todas resueltas'}</span>}
        />
        <Stat
          label="Tasa de Aciertos"
          loading={s.isLoading}
          value={r.wins + r.losses > 0 ? share(r.winRate, 1) : '—'}
          foot={
            <span>
              {r.wins} ganadas · {r.losses} perdidas
            </span>
          }
        />
        <Stat
          label="Ganancia Media (Win)"
          loading={s.isLoading}
          value={`${ratio(r.avgWinR)} R`}
          foot={<span>Por señal ganadora</span>}
        />
        <Stat
          label="Esperanza Matemática Neta"
          hero
          glow
          loading={s.isLoading}
          value={
            <span className={r.expectancyNetR >= 0 ? 'delta--up' : 'delta--down'}>
              {r.expectancyNetR >= 0 ? '+' : '−'}
              {ratio(Math.abs(r.expectancyNetR))} R
            </span>
          }
          foot={
            <span>
              Bruto {ratio(r.expectancyR)} R − comisión {ratio(r.avgFeeR)} R
            </span>
          }
        />
      </div>

      {/* Strategy Details Grid */}
      <div className="grid-2">
        <Card title="Mecánica de la Estrategia">
          <div className="prose">
            <p>{strategy.description}</p>
            <div className="tip-box">
              <strong>Preset «{preset.label}»:</strong> {preset.note}
            </div>
          </div>
        </Card>

        <Card title="Validación y Backtest Estadístico">
          <div className="prose">
            <p>
              Barrido sobre 10 instrumentos principales, puntuado por esperanza en R neta de comisiones (0.1%):
            </p>
            <ul className="bt-list">
              {TIMEFRAMES.map((t) => {
                const v = profile.byTimeframe[t.key] ?? 0
                return (
                  <li key={t.key}>
                    <span className="bt-tf">{t.label}</span>
                    <span className={`bt-val ${v > 0 ? 'delta--up' : 'delta--down'}`}>
                      {v >= 0 ? '+' : '−'}
                      {ratio(Math.abs(v))} R
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="sub">
              Fuera de muestra (Out of sample): <strong>{ratio(profile.outOfSample)} R</strong> ({profile.sampleSize} señales).
            </p>
          </div>
        </Card>
      </div>

      {/* Signal History Table */}
      <Card
        title="Historial Reciente de Señales"
        subtitle="Registro de ejecuciones y resolución de niveles"
        flush
        dimmed={dimmed}
        action={
          <div className="seg-control">
            <button
              type="button"
              aria-pressed={filterOutcome === 'all'}
              onClick={() => setFilterOutcome('all')}
            >
              Todas
            </button>
            <button
              type="button"
              aria-pressed={filterOutcome === 'win'}
              onClick={() => setFilterOutcome('win')}
            >
              Ganadas
            </button>
            <button
              type="button"
              aria-pressed={filterOutcome === 'loss'}
              onClick={() => setFilterOutcome('loss')}
            >
              Perdidas
            </button>
            <button
              type="button"
              aria-pressed={filterOutcome === 'open'}
              onClick={() => setFilterOutcome('open')}
            >
              Abiertas
            </button>
          </div>
        }
      >
        {s.isLoading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : recent.length === 0 ? (
          <EmptyState title="Sin señales con el filtro actual" hint="Prueba cambiando el filtro o la temporalidad." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Dirección</th>
                  <th className="num">Precio Entrada</th>
                  <th className="num">{strategy.regime === 'ranging' ? 'Objetivo (TP)' : 'Precio Salida'}</th>
                  <th className="num">Stop Loss</th>
                  <th className="num">Resultado</th>
                  <th>Contexto</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((sig) => (
                  <tr key={`${sig.index}-${sig.side}`}>
                    <td className="sub">{dateTime(sig.time)}</td>
                    <td>
                      <Badge variant={sig.side === 'long' ? 'buy' : 'sell'}>
                        {sig.side === 'long' ? 'Long ▲' : 'Short ▼'}
                      </Badge>
                    </td>
                    <td className="num">{price(sig.entry)}</td>
                    <td className="num">
                      {sig.target !== undefined
                        ? price(sig.target)
                        : sig.closedPrice !== undefined
                          ? price(sig.closedPrice)
                          : '—'}
                    </td>
                    <td className="num">{price(sig.stop)}</td>
                    <td className="num">
                      {sig.resultR !== undefined ? (
                        <span className={sig.resultR >= 0 ? 'delta--up' : 'delta--down'}>
                          {sig.resultR >= 0 ? '+' : '−'}
                          {ratio(Math.abs(sig.resultR))} R
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="sub">{sig.note ?? '—'}</td>
                    <td>
                      {sig.outcome === 'win' ? (
                        <Badge variant="buy">Ganada</Badge>
                      ) : sig.outcome === 'loss' ? (
                        <Badge variant="sell">Perdida</Badge>
                      ) : (
                        <Badge variant="live" pulse>Abierta</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

