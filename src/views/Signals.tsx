import { useEffect, useMemo, useRef, useState } from 'react'
import { TIMEFRAMES, useSignals, type Timeframe } from '../lib/signals'
import {
  appliesTo,
  blockReason,
  MIN_TRADABLE_R,
  profileOf,
  STRATEGIES,
  strategyByKey,
  timeframeVerdict,
  tradableTimeframes,
} from '../lib/indicators/registry'
import {
  useClosedPositions,
  useFills,
  useInstruments,
  usePositions,
  useTradeFee,
} from '../lib/queries'
import { feeMix } from '../lib/fees'
import { dateTime, num, pct, plural, price, ratio, share, timeAgo } from '../lib/format'
import { PriceChart } from '../components/PriceChart'
import { LevelsTable } from '../components/LevelsTable'
import { ReversalWatch } from '../components/ReversalWatch'
import { trapWatch, TUNED_SETTINGS } from '../lib/indicators/reversalTrap'
import { chartStart } from '../lib/chartWindow'
import { findLevels } from '../lib/indicators/levels'
import { findTrendlines, lineAt } from '../lib/indicators/trendlines'
import { FAST, movingAverages, SEED_FACTOR, SLOW } from '../lib/indicators/movingAverages'
import { analyseSmc } from '../lib/indicators/smc'
import { smcAnnotations, smcReading } from '../lib/smcView'
import { IconAlert, IconActivity } from '../components/icons'
import {
  Badge,
  Card,
  EmptyState,
  ErrorNotice,
  Help,
  Skeleton,
  Stat,
  TableSkeleton,
  TableWrap,
} from '../components/ui'
import type { StrategySignal } from '../lib/indicators/types'
import { HELP } from '../lib/glossary'

/** Below this many bars past warm-up there is nothing meaningful to measure. */
const MIN_BARS = 30

/**
 * The Análisis tab: the chart with support, resistance and trendlines and no
 * strategy on it. It exists so every timeframe can be looked at. The strategy
 * tabs block 15 m to 4 h because a trade there pays more in commission than
 * the signal earns — a reason that does not apply to reading a chart, where
 * nothing is traded.
 */
const ANALYSIS = 'analisis'

const ANALYSIS_TAB = {
  key: ANALYSIS,
  label: 'Análisis',
  tagline: 'Soportes, resistencias y líneas de tendencia',
}

/** Bars on screen in Análisis: a little more room than a strategy's 160. */
const ANALYSIS_VISIBLE = 200

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

/** The round trip the backtests price every signal against. */
const ASSUMED_ROUND_TRIP = 0.001

/**
 * What the account actually pays, against what the backtest assumed.
 *
 * Every expectancy figure in this view is quoted net of a 0.1 % round trip. If
 * the real fee tier is worse, those figures are optimistic and the whole view
 * is misleading; if it is better, there is money being left on the table by
 * entering at market. Either way it is only knowable from the account itself.
 */
function FeeReality({ avgFeeR, loading }: { avgFeeR: number; loading: boolean }) {
  const { data } = useTradeFee('SWAP')
  // The account trades X-Perp futures, which is where the fills that matter are.
  const { data: fills } = useFills('FUTURES')
  const fee = data?.[0]
  if (!fee) return null

  // OKX signs these from the account's point of view: negative is charged,
  // positive is a rebate. Flipping the sign gives the cost.
  const takerSide = -num(fee.takerU || fee.taker)
  const makerSide = -num(fee.maker)
  const taker = takerSide * 2
  const maker = makerSide * 2
  if (!Number.isFinite(taker) || taker <= 0) return null

  const optimistic = taker > ASSUMED_ROUND_TRIP * 1.02
  // avgFeeR is measured at ASSUMED_ROUND_TRIP, so it scales with the real rate.
  const takerR = avgFeeR * (taker / ASSUMED_ROUND_TRIP)
  const makerR = avgFeeR * (maker / ASSUMED_ROUND_TRIP)

  // What the last fills were actually charged. The tier says what each rate is;
  // only the fills say which one the account keeps paying.
  const mix = feeMix(fills ?? [], makerSide, takerSide)
  const mixRoundTrip = mix ? mix.effectiveRate * 2 : 0
  const mixR = mix ? avgFeeR * (mixRoundTrip / ASSUMED_ROUND_TRIP) : 0

  return (
    <Card
      title="Tu comisión real frente a la del barrido"
      subtitle={`Nivel ${fee.level || '—'} en tu cuenta de OKX`}
    >
      <div className="prose">
        <ul className="bt-list">
          <li>
            <span className="bt-tf">Maker (límite)</span>
            <span className="bt-val">{share(makerSide, 3)}</span>
          </li>
          <li>
            <span className="bt-tf">Taker (mercado)</span>
            <span className="bt-val">{share(takerSide, 3)}</span>
          </li>
          <li>
            <span className="bt-tf">Ida y vuelta a mercado</span>
            <span className={`bt-val ${optimistic ? 'delta--down' : 'delta--up'}`}>
              {share(taker, 3)}
            </span>
          </li>
          {mix && (
            <li>
              <span className="bt-tf">Ida y vuelta que pagas</span>
              <span
                className={`bt-val ${mixRoundTrip > ASSUMED_ROUND_TRIP * 1.02 ? 'delta--down' : 'delta--up'}`}
              >
                {share(mixRoundTrip, 3)}
              </span>
            </li>
          )}
        </ul>
        {mix && (
          <div className="tip-box">
            <strong>
              {mix.maker} de tus {mix.fills} últimas ejecuciones fueron a límite
            </strong>{' '}
            y pagaron tarifa maker; {mix.taker}{' '}
            {mix.taker === 1 ? 'cruzó el libro' : 'cruzaron el libro'} a taker. Ponderando por
            volumen sale un coste real de <strong>{share(mix.effectiveRate, 3)}</strong> por lado,{' '}
            {mixRoundTrip < ASSUMED_ROUND_TRIP * 0.98
              ? `por debajo del ${share(ASSUMED_ROUND_TRIP, 2)} que asume el barrido.`
              : mixRoundTrip > ASSUMED_ROUND_TRIP * 1.02
                ? `por encima del ${share(ASSUMED_ROUND_TRIP, 2)} que asume el barrido.`
                : `justo el ${share(ASSUMED_ROUND_TRIP, 2)} que asume el barrido.`}{' '}
            {/* La diferencia en R solo significa algo cuando hay señales que
                medir: sin ellas `avgFeeR` es 0 y la frase diría "0,00 R". */}
            {avgFeeR > 0 && (
              <>
                En esta selección eso{' '}
                {mixR < takerR ? (
                  <>
                    deja la esperanza publicada corta en torno a{' '}
                    <strong>{ratio(takerR - mixR)} R</strong> por señal.
                  </>
                ) : (
                  <>
                    le resta unos <strong>{ratio(mixR - takerR)} R</strong> por señal.
                  </>
                )}
              </>
            )}
          </div>
        )}
        {/* Sin la mezcla medida esta es la mejor estimación disponible; con
            ella sobra, porque diría lo mismo con menos precisión. */}
        {!mix && (
          <p>
            {optimistic ? (
              <>
                El barrido descuenta {share(ASSUMED_ROUND_TRIP, 2)} por señal y tú pagas{' '}
                <strong>{share(taker, 3)}</strong> entrando y saliendo a mercado, así que las cifras de
                arriba son <strong>optimistas para tu cuenta</strong>: réstales la diferencia.
              </>
            ) : (
              <>
                El barrido descuenta {share(ASSUMED_ROUND_TRIP, 2)} por señal y entrando y saliendo a
                mercado pagas <strong>{share(taker, 3)}</strong>, así que las cifras de arriba te
                aplican tal cual{taker < ASSUMED_ROUND_TRIP * 0.98 ? ' o se quedan cortas a tu favor' : ''}.
              </>
            )}
          </p>
        )}

        {!loading && avgFeeR > 0 && maker < taker && !mix && (
          <div className="tip-box">
            <strong>Entrar con orden límite en vez de a mercado</strong> baja el coste de esta
            selección de {ratio(takerR)} R a {ratio(makerR)} R por señal, es decir{' '}
            <strong>{ratio(takerR - makerR)} R más</strong> en cada una.{' '}
            {takerR - makerR >= MIN_TRADABLE_R
              ? 'A esta distancia de stop eso es más que el umbral con el que la app decide si una temporalidad es operable, así que aquí sí cambia la respuesta.'
              : 'Con el stop tan lejos del precio la diferencia es pequeña frente a la esperanza de la estrategia: se agradece, pero no cambia ninguna decisión.'}
          </div>
        )}
        <p className="sub">
          La orden límite solo cobra tarifa maker si descansa en el libro; si cruza el spread al
          entrar, paga taker igual. En temporalidades cortas esperar a que entre tu límite puede
          costarte la señal, que es un coste que no aparece en esta tabla.
        </p>
      </div>
    </Card>
  )
}

export function Signals() {
  const [strategyKey, setStrategyKey] = useState(ANALYSIS)
  const [timeframe, setTimeframe] = useState<Timeframe>('1D')
  const [presetKey, setPresetKey] = useState(STRATEGIES[0].presets[0].key)
  const [filterOutcome, setFilterOutcome] = useState<'all' | 'win' | 'loss' | 'open'>('all')

  const analysis = strategyKey === ANALYSIS
  // In Análisis this is only a placeholder so the strategy-only sections below
  // stay typed; none of them render there.
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

  const s = useSignals(selected, timeframe, analysis ? null : strategyKey, preset.key)
  /**
   * Context lines are on by default in Análisis, where they are the point, and
   * off on a strategy tab, where six levels and two trendlines drew over the
   * strategy's own bands and trade boxes until neither could be read. Each
   * mode keeps its own choice.
   */
  const [context, setContext] = useState({
    analysis: { levels: true, trends: true },
    strategy: { levels: false, trends: false },
  })
  const mode = analysis ? 'analysis' : 'strategy'
  const showLevels = context[mode].levels
  const showTrends = context[mode].trends
  const toggleContext = (key: 'levels' | 'trends') =>
    setContext((c) => ({ ...c, [mode]: { ...c[mode], [key]: !c[mode][key] } }))
  // Off by default: six levels and two trendlines already fill the chart, and
  // an average is the easiest line there to over-read as a signal.
  const [showMas, setShowMas] = useState(false)
  // Smart Money Concepts and its gaps, off by default like the averages: the
  // chart already carries levels and trendlines, and SMC alone draws a dozen
  // labelled lines.
  const [showSmc, setShowSmc] = useState(false)
  const [showGaps, setShowGaps] = useState(false)
  const r = s.result

  /**
   * Computed over every candle fetched, not the visible window: an EMA needs
   * its history to settle, and the chart only reads the tail of the values.
   * Drawn in Análisis only — on a strategy tab they would sit among the
   * strategy's own lines and read as part of it.
   */
  const mas = useMemo(
    () => (analysis && showMas ? movingAverages(s.candles) : null),
    [analysis, showMas, s.candles],
  )
  /**
   * Over every fetched candle, not the window: the 50-bar swing needs history
   * to have found its pivots, and ATR(200) to have settled. The chart then
   * draws only what falls inside its window.
   */
  const smc = useMemo(
    () => (analysis && showSmc ? analyseSmc(s.candles) : null),
    [analysis, showSmc, s.candles],
  )
  const smcNow = useMemo(() => (smc ? smcReading(smc, s.candles) : null), [smc, s.candles])

  const chartResult = useMemo(
    () => (mas ? { ...r, overlays: [...r.overlays, ...mas.overlays] } : r),
    [r, mas],
  )

  /**
   * Levels and trendlines come from the candles on screen — `chartStart()` is
   * the chart's own window — so the timeframe is respected without a
   * per-timeframe table: every tolerance is in ATRs, which are bigger on the
   * daily than on 15 m by construction. Passing the whole series instead fed
   * the detector the deep archive, and every level it found sat years away.
   *
   * Context only. Measured walk-forward, neither beats a random line at the
   * same distance — `npm run levels:sweep`, `npm run trendlines`.
   */
  const visible = analysis ? ANALYSIS_VISIBLE : undefined
  const start = chartStart(s.candles, r, visible)
  const levels = useMemo(
    () =>
      showLevels
        ? findLevels(s.candles.slice(start)).map((l) => ({ ...l, lastIndex: l.lastIndex + start }))
        : [],
    [s.candles, start, showLevels],
  )
  const trendlines = useMemo(
    () =>
      showTrends
        ? findTrendlines(s.candles.slice(start)).map((t) => ({
            ...t,
            i1: t.i1 + start,
            i2: t.i2 + start,
            lastIndex: t.lastIndex + start,
          }))
        : [],
    [s.candles, start, showTrends],
  )
  const smcDrawing = useMemo(
    () => (smc ? smcAnnotations(smc, s.candles, start, { gaps: showGaps }) : undefined),
    [smc, s.candles, start, showGaps],
  )

  const currentTf = TIMEFRAMES.find((t) => t.key === timeframe)
  const lastPrice = s.candles.at(-1)?.close ?? 0

  // The reversal's rule applied to the last closed candle. Its bands are
  // already in the result as overlays, so nothing is recomputed.
  const watch = useMemo(() => {
    if (analysis || strategy.key !== 'reversal') return null
    const band = (key: string) => r.overlays.find((o) => o.key === key)?.values ?? []
    return trapWatch(
      s.candles,
      band('upper'),
      band('basis'),
      band('lower'),
      r.signals.at(-1)?.index ?? null,
      r.active?.side ?? null,
      TUNED_SETTINGS,
    )
  }, [analysis, strategy.key, r, s.candles])

  /**
   * The nearest line on each side, horizontal or diagonal. On a chart with six
   * levels and two trendlines, "which one is price actually up against" is the
   * question, and reading it off the axis tags means comparing prices by eye.
   */
  const nearest = useMemo(() => {
    const lastBar = s.candles.length - 1
    const lines = [
      ...levels.map((l) => ({ value: l.price, what: 'horizontal' })),
      ...trendlines.map((t) => ({ value: lineAt(t, lastBar), what: 'línea de tendencia' })),
    ]
    const below = lines.filter((l) => l.value < lastPrice).sort((a, b) => b.value - a.value)[0]
    const above = lines.filter((l) => l.value > lastPrice).sort((a, b) => a.value - b.value)[0]
    return { below, above }
  }, [levels, trendlines, s.candles.length, lastPrice])
  const dimmed = s.isFetching && !s.isLoading

  const filtered = useMemo(() => {
    let list = [...r.signals].reverse()
    if (filterOutcome === 'win') list = list.filter((sig) => sig.outcome === 'win')
    if (filterOutcome === 'loss') list = list.filter((sig) => sig.outcome === 'loss')
    if (filterOutcome === 'open') list = list.filter((sig) => sig.outcome === 'open')
    return list
  }, [r.signals, filterOutcome])
  const recent = filtered.slice(0, 20)

  const selectedTab = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    selectedTab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [strategyKey])

  const regimeFits =
    strategy.regime === 'any' ||
    (strategy.regime === 'trending' && s.regime !== 'ranging') ||
    (strategy.regime === 'ranging' && s.regime !== 'trending')

  const currentVerdict = timeframeVerdict(profile, timeframe)
  const blockedFor = (reason: string) => TIMEFRAMES.filter((t) => blockReason(profile, t.key) === reason)
  const costBlocked = blockedFor('cost')
  const unstableBlocked = blockedFor('unstable')
  const bestTf = TIMEFRAMES.find((t) => t.key === tradableTimeframes(profile)[0])

  /**
   * Switching strategy or preset can invalidate the timeframe — the breakout is
   * only tradable on the daily, the reversal also on 4 h. Snapping to the best
   * measured timeframe keeps the view from ever sitting on a losing pair.
   */
  function retarget(key: string, nextPreset: string) {
    const next = strategyByKey(key)
    const nextProfile = profileOf(next, nextPreset)
    if (timeframeVerdict(nextProfile, timeframe) === 'blocked') {
      setTimeframe((tradableTimeframes(nextProfile)[0] ?? '1D') as Timeframe)
    }
  }

  function pickStrategy(key: string) {
    if (key === ANALYSIS) {
      setStrategyKey(key)
      return
    }
    const first = strategyByKey(key).presets[0].key
    setStrategyKey(key)
    setPresetKey(first)
    retarget(key, first)
  }

  function pickPreset(key: string) {
    setPresetKey(key)
    retarget(strategyKey, key)
  }

  if (s.error) {
    return <ErrorNotice title="No se pudieron cargar las velas" message={s.error.message} />
  }

  return (
    <>
      {/* Strategy selection tabs. The strip scrolls below ~720 px and a third
          strategy pushed the last tab off-screen, so the active one was
          invisible and none of the visible tabs looked selected. */}
      <div className="tabs" role="tablist" aria-label="Estrategias e Indicadores">
        {[ANALYSIS_TAB, ...STRATEGIES].map((item) => (
          <button
            key={item.key}
            ref={strategyKey === item.key ? selectedTab : null}
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

          {/* A timeframe where the measured expectancy is negative is not a
              choice worth offering: it is disabled and says why. A strategy that
              cannot be computed there at all says something different. */}
          <div className="seg-control">
            {TIMEFRAMES.map((t) => {
              const r = profile.byTimeframe[t.key] ?? 0
              const verdict = analysis ? 'open' : timeframeVerdict(profile, t.key)
              const reason = blockReason(profile, t.key)
              const halves = profile.halves[t.key]
              if (analysis) {
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={timeframe === t.key}
                    onClick={() => setTimeframe(t.key)}
                  >
                    {t.label}
                  </button>
                )
              }
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={timeframe === t.key}
                  disabled={verdict === 'blocked'}
                  onClick={() => setTimeframe(t.key)}
                  title={
                    reason === 'not-applicable'
                      ? 'No aplica: esta estrategia se construye con velas de 15 m.'
                      : reason === 'cost'
                        ? `Bloqueada: ${ratio(r)} R por señal en el barrido. Las comisiones se comen la ventaja.`
                        : reason === 'unstable'
                          ? `Bloqueada: ${ratio(r)} R de media, pero ${ratio(Math.min(...(halves ?? [0])))} R en una de las dos mitades del histórico. No se sostiene.`
                          : `Esperanza medida: ${ratio(r)} R por señal`
                  }
                >
                  {t.label}
                  {verdict === 'good' && <span className="tf-mark" aria-hidden="true" />}
                </button>
              )
            })}
          </div>

          {!analysis && (
            <div className="seg-control">
              {strategy.presets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={preset.key === p.key}
                  onClick={() => pickPreset(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="badge badge--neutral">
            <IconActivity />
            {s.isLoading ? 'Analizando...' : `${s.usableBars} velas confirmadas`}
          </span>
        </div>
      </div>

      {/* Context Notices */}
      {!analysis && !s.isLoading && s.usableBars < MIN_BARS && (
        <div className="notice">
          <IconAlert />
          <div className="notice-body">
            <p className="notice-title">Histórico insuficiente en esta temporalidad</p>
            <p className="notice-text">
              {selected} solo tiene {plural(s.candles.length, 'vela cerrada', 'velas cerradas')} en{' '}
              {currentTf?.label}, y la estrategia necesita {r.warmup} solo para arrancar sus medias.
              Los contratos perpetuos listados hace poco no tienen recorrido suficiente: prueba con
              BTC, ETH o SOL, que sí llegan a cuatro años de histórico diario. Bajar de temporalidad
              no es alternativa, porque ahí las comisiones se comen la ventaja.
            </p>
            {/* The view opens on the account's own instrument, which is usually
                a recently listed X-Perp — so this notice is often the first
                thing on screen, and the way out should be one tap. */}
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {FALLBACK.filter((id) => id !== selected).map((id) => (
                <button key={id} type="button" className="btn btn--outline" onClick={() => setInstId(id)}>
                  Ver {id}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Positive is not the same as established: between MIN_TRADABLE_R and
          STRONG_R the edge is real but thin against its own costs. Pointing at
          the daily as the safer option only makes sense for a strategy that has
          one — the opening range does not. */}
      {analysis && !s.isLoading && s.candles.length < MIN_BARS && (
        <div className="notice">
          <IconAlert />
          <div className="notice-body">
            <p className="notice-title">Pocas velas para trazar niveles</p>
            <p className="notice-text">
              {selected} solo tiene {plural(s.candles.length, 'vela cerrada', 'velas cerradas')} en{' '}
              {currentTf?.label}. Hacen falta giros de precio suficientes para encontrar soportes y
              líneas de tendencia; prueba una temporalidad más corta o un instrumento con más historia.
            </p>
          </div>
        </div>
      )}

      {!analysis && !s.isLoading && s.usableBars >= MIN_BARS && currentVerdict === 'marginal' && (
        <div className="notice notice--warning">
          <IconAlert />
          <div className="notice-body">
            <p className="notice-title">
              En {currentTf?.label} la ventaja es pequeña, no sólida
            </p>
            {profile.exclusive ? (
              <p className="notice-text">
                El barrido dio {ratio(profile.byTimeframe[timeframe] ?? 0)} R por señal después de
                costes, y cada ida y vuelta cuesta aquí <strong>{ratio(r.avgFeeR)} R</strong>: una
                parte grande del margen se va en comisiones. No hay una temporalidad más segura a la
                que moverse porque esta estrategia solo existe aquí. Lo que la sostiene es que el
                stop sea el rango de apertura entero y no un ATR ceñido, así que vigila el
                deslizamiento: la entrada es siempre una orden stop que cruza el libro.
              </p>
            ) : (
              <p className="notice-text">
                El barrido dio {ratio(profile.byTimeframe[timeframe] ?? 0)} R por señal después de
                costes, frente a {ratio(profile.byTimeframe[bestTf?.key ?? '1D'] ?? 0)} R en{' '}
                {bestTf?.label}. Cada ida y vuelta cuesta aquí <strong>{ratio(r.avgFeeR)} R</strong>,
                así que un pequeño cambio en tus comisiones se lleva por delante el margen.
                {bestTf ? ` ${bestTf.label} es la temporalidad con la evidencia detrás.` : ''}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Active Signal Card */}
      {!analysis && r.active && !s.isLoading && (
        <Card title="Señal Abierta Activa" subtitle="Posición en curso según niveles calculados" glow>
          <LiveSignal signal={r.active!} last={lastPrice} />
        </Card>
      )}

      {watch && !s.isLoading && s.usableBars >= MIN_BARS && (
        <ReversalWatch
          watch={watch}
          active={r.active}
          trapWindow={TUNED_SETTINGS.trapWindow}
          lastClosed={s.candles.at(-1)?.time ?? 0}
        />
      )}

      {/* Main Chart Card */}
      <Card
        title={`${selected} · ${currentTf?.label}`}
        subtitle={
          analysis
            ? 'Soportes, resistencias y líneas de tendencia sobre las velas en pantalla'
            : `${strategy.tagline} · Preset: ${preset.label}`
        }
        dimmed={dimmed}
        action={
          <>
            <div className="seg-control">
              <button
                type="button"
                aria-pressed={showLevels}
                onClick={() => toggleContext('levels')}
                title="Soportes y resistencias horizontales: precios donde se ha girado antes. No predicen reacciones: medidos contra una línea al azar, no la superan."
              >
                Horizontales
              </button>
              <button
                type="button"
                aria-pressed={showTrends}
                onClick={() => toggleContext('trends')}
                title="Líneas de tendencia: rectas que unen dos o más mínimos (soporte) o máximos (resistencia) sin que ninguna vela haya cerrado al otro lado. Contexto, no señal: medidas contra una paralela al azar, no la superan."
              >
                Tendencias
              </button>
              {analysis && (
                <button
                  type="button"
                  aria-pressed={showMas}
                  onClick={() => setShowMas((v) => !v)}
                  title={`EMA ${FAST} y EMA ${SLOW}. Contexto, no señal: medidas contra una copia de la propia media desplazada al azar, el precio no reacciona en ellas de forma que se pueda operar.`}
                >
                  Medias
                </button>
              )}
              {analysis && (
                <button
                  type="button"
                  aria-pressed={showSmc}
                  onClick={() => setShowSmc((v) => !v)}
                  title="Smart Money Concepts (LuxAlgo): rupturas de estructura (BOS), cambios de carácter (CHoCH), order blocks, máximos y mínimos iguales."
                >
                  SMC
                </button>
              )}
              {analysis && showSmc && (
                <button
                  type="button"
                  aria-pressed={showGaps}
                  onClick={() => setShowGaps((v) => !v)}
                  title="Huecos de valor razonable (FVG) que el precio aún no ha rellenado."
                >
                  FVG
                </button>
              )}
            </div>
            <span className={`regime regime--${s.regime}`}>
            <span className="regime-dot" />
            {s.regime === 'trending' ? 'Mercado en Tendencia' : s.regime === 'mixed' ? 'Régimen Mixto' : 'Mercado Lateral'}
              <span className="sub"> · Eficiencia {ratio(s.efficiency, 2)}</span>
            </span>
          </>
        }
      >
        {s.isLoading ? (
          <Skeleton height={analysis ? 420 : 360} />
        ) : (
          <PriceChart
            candles={s.candles}
            result={chartResult}
            levels={levels}
            trendlines={trendlines}
            annotations={smcDrawing}
            visible={visible}
            height={analysis ? 420 : 360}
          />
        )}
        {!s.isLoading && lastPrice > 0 && (nearest.below || nearest.above) && (
          <p className="sub chart-context">
            {nearest.below && (
              <span>
                Soporte más cercano <strong>{price(nearest.below.value)}</strong> (
                {pct(nearest.below.value / lastPrice - 1)}, {nearest.below.what})
              </span>
            )}
            {nearest.above && (
              <span>
                Resistencia más cercana <strong>{price(nearest.above.value)}</strong> (
                {pct(nearest.above.value / lastPrice - 1)}, {nearest.above.what})
              </span>
            )}
            <span>Dónde se ha girado antes, no dónde va a girar.</span>
          </p>
        )}
        {/* The reading, in words. What anyone takes from two averages is
            three facts — side, slope, last cross — and leaving them to be
            judged by eye off two curved lines is how they get misread. */}
        {!s.isLoading && mas && (
          <p className="sub chart-context">
            {mas.reading ? (
              <>
                <span>
                  Precio <strong>{share(Math.abs(mas.reading.vsSlow), 2)}</strong>{' '}
                  {mas.reading.vsSlow >= 0 ? 'por encima' : 'por debajo'} de la EMA {SLOW} (
                  {price(mas.reading.slow)}), que{' '}
                  {mas.reading.slope === 'plana' ? 'está plana' : mas.reading.slope}
                </span>
                <span>
                  EMA {FAST} {mas.reading.fastAbove ? 'por encima' : 'por debajo'} de la {SLOW}
                  {mas.reading.crossTime
                    ? ` desde el ${dateTime(mas.reading.crossTime)}`
                    : ' en todo el histórico cargado'}
                </span>
                <span>Contexto, no señal.</span>
              </>
            ) : (
              <span>
                {mas.overlays.length
                  ? `La EMA ${SLOW} necesita ${SLOW * SEED_FACTOR} velas para ser fiable y hay ${s.candles.length} en ${currentTf?.label}; se muestra solo la EMA ${FAST}.`
                  : `Las medias necesitan ${FAST * SEED_FACTOR} velas (EMA ${FAST}) y ${SLOW * SEED_FACTOR} (EMA ${SLOW}) para ser fiables, y hay ${s.candles.length} en ${currentTf?.label}.`}{' '}
                Prueba una temporalidad más corta.
              </span>
            )}
          </p>
        )}
        {/* The structure in words: what the two trends are and since when,
            where price sits in the range, and the nearest order blocks. */}
        {!s.isLoading && smcNow && (
          <p className="sub chart-context">
            <span>
              Estructura principal{' '}
              <strong>
                {smcNow.swing.trend === 1 ? 'alcista' : smcNow.swing.trend === -1 ? 'bajista' : 'sin definir'}
              </strong>
              {smcNow.swing.kind && smcNow.swing.time
                ? ` · ${smcNow.swing.kind} en ${price(smcNow.swing.price ?? 0)} el ${dateTime(smcNow.swing.time)}`
                : ''}
              <Help label="Smart Money Concepts">{HELP.smc}</Help>
            </span>
            <span>
              Interna{' '}
              <strong>
                {smcNow.internal.trend === 1 ? 'alcista' : smcNow.internal.trend === -1 ? 'bajista' : 'sin definir'}
              </strong>
              {smcNow.internal.kind && smcNow.internal.time
                ? ` · ${smcNow.internal.kind} el ${dateTime(smcNow.internal.time)}`
                : ''}
            </span>
            {smcNow.rangePosition !== null && (
              <span>
                Precio en zona{' '}
                <strong>
                  {Math.abs(smcNow.rangePosition - 0.5) <= 0.025
                    ? 'de equilibrio'
                    : smcNow.rangePosition > 0.5
                      ? 'premium'
                      : 'de descuento'}
                </strong>{' '}
                ({share(Math.min(1, Math.max(0, smcNow.rangePosition)), 0)} del rango {price(smcNow.bottom)}–
                {price(smcNow.top)})
              </span>
            )}
            {smcNow.obBelow && (
              <span>
                OB por debajo <strong>{price(smcNow.obBelow.bottom)}–{price(smcNow.obBelow.top)}</strong> (
                {pct(smcNow.obBelow.top / lastPrice - 1)})
              </span>
            )}
            {smcNow.obAbove && (
              <span>
                OB por encima <strong>{price(smcNow.obAbove.bottom)}–{price(smcNow.obAbove.top)}</strong> (
                {pct(smcNow.obAbove.bottom / lastPrice - 1)})
              </span>
            )}
            {showGaps && (
              <span>
                FVG sin rellenar: {smcNow.gapsUp} alcistas · {smcNow.gapsDown} bajistas
              </span>
            )}
          </p>
        )}
      </Card>

      {analysis ? (
        <LevelsTable
          levels={levels}
          trendlines={trendlines}
          candles={s.candles}
          lastPrice={lastPrice}
          loading={s.isLoading}
          dimmed={dimmed}
        />
      ) : (
      <>
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
            help={HELP.signalsDetected}
            loading={s.isLoading}
            value={String(r.signals.length)}
            foot={<span>{r.open > 0 ? `${r.open} sin resolver` : 'todas resueltas'}</span>}
          />
          <Stat
            label="Tasa de Aciertos"
            help={HELP.signalWinRate}
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
            help={HELP.r}
            loading={s.isLoading}
            value={`${ratio(r.avgWinR)} R`}
            foot={<span>Por señal ganadora</span>}
          />
          <Stat
            label="Esperanza Neta"
            help={HELP.expectancyR}
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
                Barrido sobre hasta 10 instrumentos, puntuado por esperanza en R neta de comisiones
                (0,1 %). En diario solo BTC, ETH y SOL tienen años de historia; los contratos X-Perp
                cuentan en las temporalidades cortas:
              </p>
              <ul className="bt-list">
                {TIMEFRAMES.map((t) => {
                  const v = profile.byTimeframe[t.key] ?? 0
                  const applies = appliesTo(profile, t.key)
                  const reason = blockReason(profile, t.key)
                  const isBlocked = reason !== null
                  return (
                    <li key={t.key} className={isBlocked ? 'is-blocked' : undefined}>
                      <span className="bt-tf">
                        {t.label}
                        {isBlocked && (
                          <span className="bt-lock">
                            {' '}
                            {reason === 'not-applicable'
                              ? 'no aplica'
                              : reason === 'unstable'
                                ? 'inestable'
                                : 'bloqueada'}
                          </span>
                        )}
                      </span>
                      {applies ? (
                        <span className={`bt-val ${v > 0 ? 'delta--up' : 'delta--down'}`}>
                          {v >= 0 ? '+' : '−'}
                          {ratio(Math.abs(v))} R
                        </span>
                      ) : (
                        <span className="bt-val sub">—</span>
                      )}
                    </li>
                  )
                })}
              </ul>
              <p className="sub">
                Acierto medido en{' '}
                {TIMEFRAMES.find((t) => t.key === (profile.nativeTimeframe ?? '1D'))?.label ?? 'diario'}{' '}
                <strong>{share(profile.winRate, 1)}</strong> sobre{' '}
                {plural(profile.sampleSize, 'señal resuelta', 'señales resueltas')}. Fuera de muestra,
                en la mitad del histórico que no se usó para ajustar:{' '}
                <strong>{ratio(profile.outOfSample)} R</strong>.
                {profile.confidence === 'weak'
                  ? ' Cae respecto al periodo de ajuste o la muestra es corta: trátalo como una ventaja posible, no demostrada.'
                  : ' Se mantiene fuera de muestra, que es la mejor evidencia disponible en la app.'}
              </p>
              {/* Two reasons a timeframe is off, and they are not interchangeable:
                  the cost of a tight stop, or the strategy not existing there at
                  all. Saying "the commission eats it" about the second is a lie. */}
              {profile.exclusive && (
                <p className="sub">
                  Esta estrategia solo existe en{' '}
                  {TIMEFRAMES.find((t) => t.key === profile.nativeTimeframe)?.label ??
                    profile.nativeTimeframe}
                  : el rango de apertura son 30 minutos y hace falta esa resolución para
                  construirlo. El resto de temporalidades no están bloqueadas por comisiones, es
                  que no se pueden calcular.
                </p>
              )}
              {costBlocked.length > 0 && (
                <p className="sub">
                  {costBlocked.length === 1 ? 'La temporalidad' : 'Las temporalidades'}{' '}
                  {costBlocked.map((t) => t.label).join(', ')}{' '}
                  {costBlocked.length === 1 ? 'está bloqueada' : 'están bloqueadas'} porque la
                  esperanza medida no llega a {ratio(MIN_TRADABLE_R)} R. No es que la estrategia
                  falle más: el stop está tan cerca del precio que la comisión se lleva la ventaja
                  entera.
                </p>
              )}
              {/* A third reason, and it is not the commission: the average
                  clears the bar on the strength of one half of the history, or
                  of a handful of trades. */}
              {unstableBlocked.length > 0 && (
                <p className="sub">
                  {unstableBlocked.map((t) => {
                    const [a, b] = profile.halves[t.key] ?? [0, 0]
                    return (
                      <span key={t.key}>
                        En {t.label} la media es de {ratio(profile.byTimeframe[t.key] ?? 0)} R, pero
                        mide {ratio(a)} R en la primera mitad del histórico y {ratio(b)} R en la
                        segunda: no se sostiene en las dos, así que no se ofrece.{' '}
                      </span>
                    )
                  })}
                </p>
              )}
            </div>
          </Card>
        </div>

        <FeeReality avgFeeR={r.avgFeeR} loading={s.isLoading} />

        {/* Signal History Table */}
        <Card
          title="Historial Reciente de Señales"
          subtitle={
            filtered.length > 20
              ? `Las 20 más recientes de ${filtered.length}`
              : 'Registro de ejecuciones y resolución de niveles'
          }
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
            <TableWrap>
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
            </TableWrap>
          )}
        </Card>
      </>
      )}
    </>
  )
}

