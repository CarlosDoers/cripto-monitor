import { useMemo, useState } from 'react'
import { TIMEFRAMES, useSignals, type Timeframe } from '../lib/signals'
import { useClosedPositions, useInstruments, usePositions } from '../lib/queries'
import { MIN_SAMPLE } from '../lib/performance'
import { dateTime, plural, price, ratio, share, timeAgo } from '../lib/format'
import { PriceChart } from '../components/PriceChart'
import { DivergingBars } from '../components/PerfCharts'
import { Badge, Card, EmptyState, ErrorNotice, Skeleton, Stat, TableSkeleton } from '../components/ui'
import type { Signal } from '../lib/indicators/reversalTrap'

/** Instruments worth offering even with no open position in them. */
const FALLBACK = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT']

function SignalCard({ signal, last }: { signal: Signal; last: number }) {
  const long = signal.side === 'long'
  const progress = long
    ? (last - signal.entry) / (signal.target - signal.entry)
    : (signal.entry - last) / (signal.entry - signal.target)

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
        <li>
          <span className="metric-label">Objetivo</span>
          <span className="metric-value delta--up">{price(signal.target)}</span>
        </li>
        <li>
          <span className="metric-label">Stop</span>
          <span className="metric-value delta--down">{price(signal.stop)}</span>
        </li>
        <li>
          <span className="metric-label">Beneficio / riesgo</span>
          <span className="metric-value">{ratio(signal.riskReward)}</span>
        </li>
      </ul>

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
    </div>
  )
}

export function Signals() {
  const [timeframe, setTimeframe] = useState<Timeframe>('1H')

  const positions = usePositions()
  const closed = useClosedPositions()
  const futures = useInstruments('FUTURES')
  const swaps = useInstruments('SWAP')

  // Lead with what is actually traded — open positions first, then everything
  // traded recently, then a few liquid majors. Instruments that have expired
  // are dropped: they would load but never produce a live signal.
  const options = useMemo(() => {
    const listed = new Map(
      [...(futures.data ?? []), ...(swaps.data ?? [])].map((i) => [i.instId, i]),
    )
    const open = (positions.data ?? []).map((p) => p.instId)
    const traded = (closed.data?.positions ?? []).map((p) => p.instId)
    const extras = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP'].filter((i) =>
      listed.has(i),
    )

    return [...new Set([...open, ...traded, ...extras, ...FALLBACK])].filter((id) => {
      const inst = listed.get(id)
      // Spot pairs are not in these catalogues; keep them, drop dead contracts.
      return !inst || inst.state === 'live'
    })
  }, [positions.data, closed.data, futures.data, swaps.data])

  const [instId, setInstId] = useState('')
  const selected = instId || options[0] || 'BTC-USDT'

  const s = useSignals(selected, timeframe)
  const lastPrice = s.candles.at(-1)?.close ?? 0
  const dimmed = s.isFetching && !s.isLoading

  const recent = useMemo(() => [...s.signals].reverse().slice(0, 20), [s.signals])

  const buckets = useMemo(() => {
    const merged = s.longBuckets.map((b, i) => ({
      bucket: b.bucket,
      total: b.total + s.shortBuckets[i].total,
      wins: b.wins + s.shortBuckets[i].wins,
    }))
    return merged
      .filter((b) => b.total > 0)
      .map((b) => ({
        key: String(b.bucket),
        label: `RSI ${b.bucket * 10}`,
        // Centre on 50 %: above is better than a coin flip, below is worse.
        value: b.total >= MIN_SAMPLE ? (b.wins / b.total - 0.5) * 100 : 0,
        meta:
          b.total >= MIN_SAMPLE
            ? `${plural(b.total, 'señal', 'señales')} · ${share(b.wins / b.total, 0)}`
            : `${plural(b.total, 'señal', 'señales')} · muestra corta`,
      }))
  }, [s.longBuckets, s.shortBuckets])

  if (s.error) {
    return <ErrorNotice title="No se pudieron cargar las velas" message={s.error.message} />
  }

  return (
    <>
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
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <p className="muted">
          {s.isLoading ? 'Cargando velas…' : `${s.usableBars} velas analizadas`}
        </p>
      </div>

      {s.active && !s.isLoading && (
        <Card title="Señal abierta" subtitle="Sin alcanzar objetivo ni stop todavía">
          <SignalCard signal={s.active} last={lastPrice} />
        </Card>
      )}

      <Card
        title={`${selected} · ${TIMEFRAMES.find((t) => t.key === timeframe)?.label}`}
        subtitle="Envolvente del indicador y señales detectadas"
        dimmed={dimmed}
      >
        {s.isLoading ? (
          <Skeleton height={340} />
        ) : (
          <PriceChart candles={s.candles} analysis={s} />
        )}
      </Card>

      <div className="kpi-row">
        <Stat
          label="Señales detectadas"
          loading={s.isLoading}
          value={String(s.signals.length)}
          foot={<span>{s.open > 0 ? `${s.open} sin resolver` : 'todas resueltas'}</span>}
        />
        <Stat
          label="Aciertos"
          loading={s.isLoading}
          value={s.wins + s.losses > 0 ? share(s.winRate, 1) : '—'}
          foot={
            <span>
              {s.wins} al objetivo · {s.losses} al stop
            </span>
          }
        />
        <Stat
          label="Beneficio / riesgo medio"
          loading={s.isLoading}
          value={ratio(s.avgRiskReward)}
          foot={<span>Por señal, según objetivo y stop</span>}
        />
        <Stat
          label="Resultado esperado"
          hero
          loading={s.isLoading}
          value={
            <span className={s.expectancyR >= 0 ? 'delta--up' : 'delta--down'}>
              {s.expectancyR >= 0 ? '+' : '−'}
              {ratio(Math.abs(s.expectancyR))} R
            </span>
          }
          foot={<span>Por señal, en múltiplos del riesgo</span>}
        />
      </div>

      <div className="grid-2">
        <Card title="Fiabilidad según el RSI de entrada" dimmed={dimmed}>
          {s.isLoading ? (
            <Skeleton height={140} />
          ) : buckets.length === 0 ? (
            <EmptyState title="Aún no hay señales resueltas" />
          ) : (
            <>
              <DivergingBars
                rows={buckets}
                formatValue={(v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${ratio(Math.abs(v), 0)} pp`}
              />
              <p className="sub" style={{ marginTop: 12 }}>
                Desviación en puntos porcentuales respecto al 50 %. A la derecha, ese nivel de RSI
                acertó más de la mitad de las veces.
              </p>
            </>
          )}
        </Card>

        <Card title="Cómo leer esto" dimmed={false}>
          <div className="prose">
            <p>
              El indicador dibuja una envolvente ancha alrededor de una media móvil. Cuando el
              precio la perfora y vuelve a cerrar dentro, interpreta que la ruptura era falsa y
              espera un giro hacia la línea base, que es el objetivo.
            </p>
            <p>
              <strong>El acierto por sí solo no dice si el sistema gana.</strong> Con un
              beneficio/riesgo de {ratio(s.avgRiskReward)}, harían falta{' '}
              {share(1 / (1 + s.avgRiskReward), 0)} de aciertos para quedar en tablas. El resultado
              esperado en R ya combina ambas cosas.
            </p>
          </div>
        </Card>
      </div>

      <Card
        title="Historial de señales"
        subtitle="Las 20 más recientes"
        flush
        dimmed={dimmed}
      >
        {s.isLoading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : recent.length === 0 ? (
          <EmptyState
            title="Sin señales en este periodo"
            hint="Prueba con otra temporalidad o instrumento."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Dirección</th>
                  <th className="num">Entrada</th>
                  <th className="num">Objetivo</th>
                  <th className="num">Stop</th>
                  <th className="num">B/R</th>
                  <th className="num">RSI</th>
                  <th>Resultado</th>
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
                    <td className="num">{price(sig.target)}</td>
                    <td className="num">{price(sig.stop)}</td>
                    <td className="num">{ratio(sig.riskReward)}</td>
                    <td className="num">{sig.rsi.toFixed(0)}</td>
                    <td>
                      {sig.outcome === 'win' ? (
                        <Badge variant="buy">Objetivo</Badge>
                      ) : sig.outcome === 'loss' ? (
                        <Badge variant="sell">Stop</Badge>
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
        Backtest simplificado sobre velas cerradas, sin comisiones ni deslizamiento. Cuando una
        vela toca objetivo y stop a la vez se cuenta como acierto, igual que en el indicador
        original, así que el porcentaje real será algo peor. Las señales solo se evalúan sobre
        velas cerradas: la vela en curso no genera ninguna. Esto es un indicador, no una
        recomendación de inversión.
      </p>
    </>
  )
}
