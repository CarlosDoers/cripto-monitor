import { useMemo, useState } from 'react'
import { TIMEFRAMES, useSignals, type Timeframe } from '../lib/signals'
import { profileOf, STRATEGIES, strategyByKey } from '../lib/indicators/registry'
import { useClosedPositions, useInstruments, usePositions } from '../lib/queries'
import { dateTime, plural, price, ratio, share, timeAgo } from '../lib/format'
import { PriceChart } from '../components/PriceChart'
import { IconAlert } from '../components/icons'
import { Badge, Card, EmptyState, ErrorNotice, Skeleton, Stat, TableSkeleton } from '../components/ui'
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
        <Badge variant={long ? 'buy' : 'sell'}>{long ? 'LONG' : 'SHORT'}</Badge>
        <span className="muted">detectada {timeAgo(signal.time)}</span>
      </div>

      <ul className="signal-levels">
        <li>
          <span className="metric-label">Entrada</span>
          <span className="metric-value">{price(signal.entry)}</span>
        </li>
        {goal !== undefined ? (
          <li>
            <span className="metric-label">Objetivo</span>
            <span className="metric-value delta--up">{price(goal)}</span>
          </li>
        ) : (
          <li>
            <span className="metric-label">Salida</span>
            <span className="metric-value">Stop dinámico</span>
          </li>
        )}
        <li>
          <span className="metric-label">Stop</span>
          <span className="metric-value delta--down">{price(signal.stop)}</span>
        </li>
        <li>
          <span className="metric-label">{goal !== undefined ? 'Beneficio / riesgo' : 'Acumulado'}</span>
          <span className={`metric-value ${goal === undefined && openR < 0 ? 'delta--down' : ''}`}>
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
          <span className="sub">
            Precio actual {price(last)} · {share(Math.min(Math.max(progress, 0), 1), 0)} del recorrido
            al objetivo
          </span>
        </div>
      )}
    </div>
  )
}

export function Signals() {
  const [strategyKey, setStrategyKey] = useState(STRATEGIES[0].key)
  const [timeframe, setTimeframe] = useState<Timeframe>('1D')
  const [presetKey, setPresetKey] = useState(STRATEGIES[0].presets[0].key)

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

  const recent = useMemo(() => [...r.signals].reverse().slice(0, 20), [r.signals])
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
      {/* Tabs: one per strategy, extensible from the registry. */}
      <div className="tabs" role="tablist" aria-label="Indicadores">
        {STRATEGIES.map((item) => (
          <button
            key={item.key}
            role="tab"
            type="button"
            className="tab"
            aria-selected={strategyKey === item.key}
            onClick={() => pickStrategy(item.key)}
          >
            <span className="tab-label">{item.label}</span>
            <span className="tab-tagline">{item.tagline}</span>
          </button>
        ))}
      </div>

      <div className="filter-row">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
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
        <p className="muted">{s.isLoading ? 'Cargando velas…' : `${s.usableBars} velas analizadas`}</p>
      </div>

      {/* A contract listed recently simply has no daily history to work with. */}
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
        <div className="notice">
          <IconAlert />
          <div className="notice-body">
            <p className="notice-title">
              En {currentTf?.label} esta estrategia no cubre las comisiones
            </p>
            <p className="notice-text">
              El barrido dio {ratio(profile.byTimeframe[timeframe] ?? 0)} R por señal
              después de costes. Con el stop tan cerca del precio, cada ida y vuelta cuesta{' '}
              <strong>{ratio(r.avgFeeR)} R</strong>. En diario sí compensa.
            </p>
          </div>
        </div>
      )}

      {r.active && !s.isLoading && (
        <Card title="Señal abierta" subtitle="Sin alcanzar salida ni stop todavía">
          <LiveSignal signal={r.active!} last={lastPrice} />
        </Card>
      )}

      <Card
        title={`${selected} · ${currentTf?.label}`}
        subtitle={strategy.tagline}
        dimmed={dimmed}
        action={
          <span className={`regime regime--${s.regime}`}>
            {s.regime === 'trending' ? 'Con tendencia' : s.regime === 'mixed' ? 'Mixto' : 'Lateral'}
            <span className="sub"> · eficiencia {ratio(s.efficiency, 2)}</span>
          </span>
        }
      >
        {s.isLoading ? <Skeleton height={340} /> : <PriceChart candles={s.candles} result={r} />}
      </Card>

      {!s.isLoading && s.usableBars >= MIN_BARS && !regimeFits && (
        <div className="notice">
          <IconAlert />
          <div className="notice-body">
            <p className="notice-title">
              El mercado no acompaña a esta estrategia ahora mismo
            </p>
            <p className="notice-text">
              {strategy.label} necesita mercado{' '}
              {strategy.regime === 'trending' ? 'con tendencia' : 'lateral'}, y la eficiencia actual
              ({ratio(s.efficiency, 2)}) indica lo contrario. Las dos pestañas se complementan: rara
              vez sufren a la vez.
            </p>
          </div>
        </div>
      )}

      <div className="kpi-row">
        <Stat
          label="Señales detectadas"
          loading={s.isLoading}
          value={String(r.signals.length)}
          foot={<span>{r.open > 0 ? `${r.open} sin resolver` : 'todas resueltas'}</span>}
        />
        <Stat
          label="Aciertos"
          loading={s.isLoading}
          value={r.wins + r.losses > 0 ? share(r.winRate, 1) : '—'}
          foot={
            <span>
              {r.wins} ganadas · {r.losses} perdidas
            </span>
          }
        />
        <Stat
          label="Ganancia media"
          loading={s.isLoading}
          value={`${ratio(r.avgWinR)} R`}
          foot={<span>Por señal ganadora</span>}
        />
        <Stat
          label="Resultado esperado neto"
          hero
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

      <div className="grid-2">
        <Card title="Cómo funciona">
          <div className="prose">
            <p>{strategy.description}</p>
            <p className="sub">
              Preset «{preset.label}»: {preset.note}
            </p>
          </div>
        </Card>

        <Card title="Qué dice el backtest">
          <div className="prose">
            <p>
              Barrido sobre 10 instrumentos, puntuado por esperanza en R después de comisiones.
              Esperanza por temporalidad:
            </p>
            <ul className="bt-list">
              {TIMEFRAMES.map((t) => {
                const v = profile.byTimeframe[t.key] ?? 0
                return (
                  <li key={t.key}>
                    <span>{t.label}</span>
                    <span className={v > 0 ? 'delta--up' : 'delta--down'}>
                      {v >= 0 ? '+' : '−'}
                      {ratio(Math.abs(v))} R
                    </span>
                  </li>
                )
              })}
            </ul>
            <p>
              Fuera de muestra dio <strong>{ratio(profile.outOfSample)} R</strong> sobre{' '}
              {profile.sampleSize} señales.{' '}
              {profile.confidence === 'weak'
                ? 'La muestra es pequeña y el resultado cae bastante respecto al periodo de ajuste: trátalo como una ventaja posible, no demostrada.'
                : 'Se mantuvo en la mitad del histórico que no se usó para ajustar.'}
            </p>
          </div>
        </Card>
      </div>

      <Card title="Historial de señales" subtitle="Las 20 más recientes" flush dimmed={dimmed}>
        {s.isLoading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : recent.length === 0 ? (
          <EmptyState title="Sin señales en este periodo" hint="Prueba con otra temporalidad o instrumento." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Dirección</th>
                  <th className="num">Entrada</th>
                  <th className="num">{strategy.regime === 'ranging' ? 'Objetivo' : 'Salida'}</th>
                  <th className="num">Stop</th>
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
                        {sig.side === 'long' ? 'Long' : 'Short'}
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
                        <Badge variant="live">Abierta</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="footnote">
        Backtest simplificado sobre velas cerradas, sin deslizamiento y con una comisión estimada
        del 0,1 % por ida y vuelta. Las señales solo se evalúan sobre velas cerradas: la vela en
        curso no genera ninguna. Con {plural(profile.sampleSize, 'señal', 'señales')} en la
        muestra, trátalo como una ventaja plausible, no como una certeza. Esto es un indicador, no
        una recomendación de inversión.
      </p>
    </>
  )
}
