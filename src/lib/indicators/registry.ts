import { analyseTraps, TUNED_SETTINGS } from './reversalTrap'
import { analyseDonchian, DONCHIAN_ACCURATE, DONCHIAN_SETTINGS } from './donchianBreakout'
import { analyseOpeningRange, OPENING_RANGE_ALL, OPENING_RANGE_SETTINGS } from './openingRange'
import type { Candle, Overlay, StrategyResult, StrategySignal } from './types'
import { summarise } from './types'

/**
 * The strategies the Señales view can show. Adding one means adding an entry
 * here — the view, the chart and the stats are all driven off this list.
 *
 * **Nothing gets listed here unless it made money in the sweep.** Four things
 * used to be offered that did not, and shipping them was the bug:
 *
 * - `pullback` (RSI2 à la Connors) hit 67 % on the daily and returned +0.01 R.
 *   Its accuracy was the geometry of a near target against a 3 ATR stop, which
 *   a random-entry control reproduces at 73 %. 25 stop/exit variants were swept
 *   and none was profitable.
 * - `reversal/original`, BigBeluga's published 4 ATR / 0.5 stop: −0.15 R daily.
 * - `donchian/slow` (55 bars): +0.87 R in-sample, −0.14 R out. Overfit.
 * - `donchian/momentum` (EMA100 filter): +0.74 R in-sample, +0.06 R out. Overfit.
 *
 * A strategy that loses money is not worth the screen space to explain why it
 * loses money. If one needs to come back, it has to clear costs out of sample
 * first.
 */

/**
 * Measured backtest profile. Every number here comes from running the strategy
 * over the cached candles of 10 instruments and 4 timeframes — never written by
 * hand. The UI presents them as fact, so an invented figure is misinformation
 * with money attached. Re-measure with `scripts/audit-strategies.mjs` after
 * changing any strategy parameter.
 */
export interface StrategyBacktest {
  /** Net expectancy in R per timeframe, across 10 instruments. */
  byTimeframe: Record<string, number>
  /**
   * The timeframe the strategy actually lives on, and the one the three figures
   * below are measured against. Almost all of them are daily, but the opening
   * range only exists on 15 m: its range is 30 minutes and its stop is that
   * range rather than an ATR. Measured on the daily it produces no signals at
   * all, and the audit would call a correct profile broken.
   */
  nativeTimeframe?: string
  /** Net expectancy on the half of history never used for tuning. */
  outOfSample: number
  /** Resolved signals behind those numbers, on the native timeframe. */
  sampleSize: number
  /** Measured hit rate on the native timeframe, 0–1. */
  winRate: number
  /**
   * How well established the edge is. `reasonable` holds up out of sample;
   * `weak` is positive but on a short sample or with a big drop between epochs.
   * Nothing negative ships, so there is no third value.
   */
  confidence: 'reasonable' | 'weak'
}

/**
 * A measured edge below this is inside the noise, and the trading costs of the
 * timeframe eat it. Timeframes under it are not offered — the sweep found every
 * strategy strongly negative on 15 m and 1 h, because the cost in R is
 * `feeRate / (stop distance / price)` and a 15 m stop sits ~0.25 % away, making
 * a 0.1 % round trip cost 0.4 R per signal.
 */
export const MIN_TRADABLE_R = 0.1

/** Above this the edge is solid rather than merely positive. */
const STRONG_R = 0.25

export type TimeframeVerdict = 'good' | 'marginal' | 'blocked'

/**
 * Derived from the measurements rather than listed by hand, so it can never
 * drift out of sync with `byTimeframe` when a strategy is re-measured.
 */
export function timeframeVerdict(profile: StrategyBacktest, timeframe: string): TimeframeVerdict {
  const r = profile.byTimeframe[timeframe] ?? 0
  if (r >= STRONG_R) return 'good'
  if (r >= MIN_TRADABLE_R) return 'marginal'
  return 'blocked'
}

/**
 * Whether the strategy can be computed on a timeframe at all. Almost all of
 * them work anywhere and are gated purely on cost; the opening range is built
 * out of 30-minute ranges and simply does not exist elsewhere, which is a
 * different statement from "it loses money there" and has to read differently.
 */
export function appliesTo(profile: StrategyBacktest, timeframe: string): boolean {
  return !profile.nativeTimeframe || profile.nativeTimeframe === timeframe
}

/** The timeframes this profile may actually be traded on, best first. */
export function tradableTimeframes(profile: StrategyBacktest): string[] {
  return Object.entries(profile.byTimeframe)
    .filter(([, r]) => r >= MIN_TRADABLE_R)
    .sort((a, b) => b[1] - a[1])
    .map(([tf]) => tf)
}

export interface StrategyPreset {
  key: string
  label: string
  note: string
  /** Overrides the strategy's profile — two presets can behave very differently. */
  backtest?: StrategyBacktest
}

export interface StrategyDef {
  key: string
  label: string
  /** One line, shown under the tab. */
  tagline: string
  description: string
  /**
   * Which regime it needs — used to flag when conditions are unfavourable.
   * `any` is not a shrug: it means the strategy was measured across regimes and
   * stayed profitable in all of them, so a warning would be false. Do not reach
   * for it without that measurement.
   */
  regime: 'trending' | 'ranging' | 'any'
  /**
   * Bars of deep history to pull from `/market/history-candles` on top of the
   * live query. Only worth paying for when the strategy needs more than the
   * ~1440 bars `/market/candles` will ever return: on the daily that is four
   * years, on 15 m it is a fortnight. Costs one serverless call per 100 bars,
   * fetched once and kept, so leave it unset unless the strategy is starved.
   */
  archiveBars?: number
  presets: StrategyPreset[]
  run(candles: Candle[], presetKey: string): StrategyResult
  backtest: StrategyBacktest
}

/** The profile actually in force: the preset's, falling back to the strategy's. */
export function profileOf(strategy: StrategyDef, presetKey: string): StrategyBacktest {
  return strategy.presets.find((p) => p.key === presetKey)?.backtest ?? strategy.backtest
}

/** Adapts the reversal indicator's own shape to the common contract. */
function runReversal(candles: Candle[]): StrategyResult {
  const a = analyseTraps(candles, TUNED_SETTINGS)

  const signals: StrategySignal[] = a.signals.map((s) => ({
    index: s.index,
    time: s.time,
    side: s.side,
    entry: s.entry,
    stop: s.stop,
    target: s.target,
    outcome: s.outcome,
    // A fixed-target trade banks its reward-to-risk, or loses exactly 1 R.
    resultR: s.outcome === 'win' ? s.riskReward : s.outcome === 'loss' ? -1 : undefined,
    closedIndex: s.closedIndex,
    closedTime: s.closedTime,
    feeR: s.feeR,
    riskReward: s.riskReward,
    note: `RSI ${s.rsi.toFixed(0)}`,
  }))

  const overlays: Overlay[] = [
    { key: 'upper', label: 'Techo', values: a.upper, colour: 'var(--critical)' },
    { key: 'basis', label: 'Base (objetivo)', values: a.basis, colour: 'var(--ink-muted)', dashed: true },
    { key: 'lower', label: 'Suelo', values: a.lower, colour: 'var(--good)', fillTo: 'upper' },
  ]

  const active = signals.find((s) => s.outcome === 'open') ?? null
  return summarise(signals, overlays, a.warmup, active)
}

export const STRATEGIES: StrategyDef[] = [
  {
    key: 'reversal',
    label: 'Reversión',
    tagline: 'Rupturas falsas de una envolvente ATR',
    description:
      'El precio sale de una envolvente ancha y vuelve a cerrar dentro. Interpreta que la ruptura era falsa y busca el giro hacia la línea base, que hace de objetivo. Necesita mercado lateral, que es justo el régimen en el que lleva meses el mercado.',
    regime: 'ranging',
    presets: [
      {
        key: 'tuned',
        label: 'Ajustada',
        note: 'Bandas de 2,5 ATR y stop de 0,25. Es la que más gana por señal de toda la app: +0,61 R en diario, y +0,40 R en la mitad del histórico que no se usó para ajustarla. Al barrer las variantes de alrededor, todas las vecinas seguían siendo positivas, que es la señal de que el resultado no depende de haber acertado los parámetros exactos. En 4 h mide +0,03 R, así que ese timeframe ya no se ofrece.',
      },
    ],
    run: runReversal,
    backtest: {
      byTimeframe: { '15m': -0.20, '1H': -0.02, '4H': 0.03, '1D': 0.61 },
      outOfSample: 0.40,
      sampleSize: 141,
      winRate: 0.504,
      confidence: 'reasonable',
    },
  },
  {
    key: 'donchian',
    label: 'Ruptura',
    tagline: 'Canal de Donchian al estilo Turtle',
    description:
      'Entra cuando el precio cierra por encima del máximo (o por debajo del mínimo) de las últimas 20 velas, y acompaña la tendencia con un stop dinámico muy holgado. Acierta poco y gana mucho en las pocas que salen: el 65 % de las señales pierden. Necesita mercado con tendencia, así que en un mercado lateral dará rachas largas de pérdidas aunque la esperanza sea positiva.',
    regime: 'trending',
    presets: [
      {
        key: 'fast',
        label: 'Rendimiento',
        note: 'Canal de 20 velas, stop de 2 ATR y trailing de 8. Mide +0,67 R por señal en diario, pero el resultado está concentrado en la segunda mitad del histórico: en la primera es negativa (−0,09 R). Con cuatro años de datos de 4 h también funciona ahí (+0,33 R), y en ese timeframe sí aguanta las dos mitades, así que es la opción más sólida de las dos.',
      },
      {
        key: 'accurate',
        label: 'Acierto',
        note: 'Canal de 55 filtrado por la EMA(200), stop ceñido y objetivo fijo de 1,5 R. Acierta el 49 % en vez del 34 %, a cambio de ganar menos por señal (+0,21 R). Gana menos dinero pero es mucho más llevadera de operar, y mejora fuera de muestra (+0,48 R) en lugar de empeorar. La contrapartida es que casi todo ese resultado está en la segunda mitad del histórico: en la primera se queda en +0,01 R.',
        backtest: {
          byTimeframe: { '15m': -0.18, '1H': -0.02, '4H': 0.07, '1D': 0.21 },
          outOfSample: 0.48,
          sampleSize: 143,
          winRate: 0.490,
          confidence: 'weak',
        },
      },
    ],
    run: (candles, presetKey) =>
      analyseDonchian(candles, presetKey === 'accurate' ? DONCHIAN_ACCURATE : DONCHIAN_SETTINGS),
    backtest: {
      byTimeframe: { '15m': -0.10, '1H': 0.08, '4H': 0.33, '1D': 0.67 },
      outOfSample: 0.17,
      sampleSize: 134,
      winRate: 0.343,
      confidence: 'weak',
    },
  },
  {
    key: 'opening',
    label: 'Apertura',
    tagline: 'Rotura del rango de apertura de Wall Street',
    description:
      'Toma los primeros 30 minutos desde que abre la bolsa de Nueva York, y entra cuando el precio rompe ese rango por cualquiera de los dos lados, con el stop en el extremo contrario. Cierra la posición 24 horas después, gane o pierda. Solo opera los días en que esa media hora mueve más volumen de lo habitual. Acierta poco —algo más de un tercio de las veces— porque los perdedores valen exactamente 1 R y a los ganadores se les deja correr todo el día. A diferencia de las otras dos, no depende del régimen: gana más con tendencia (+0,32 R) pero sigue ganando en mercado lateral (+0,12 R), que es donde pasa el 80 % del tiempo.',
    // Measured across regimes: +0.119 R ranging, +0.317 mixed, +0.460 trending.
    // It prefers a trend but never needs one, so the view's regime warning would
    // be misinformation on the four days out of five that sit in chop.
    regime: 'any',
    // 45 days of 15 m. /market/candles tops out at a fortnight, which is less
    // than the volume filter needs just to warm up.
    archiveBars: 4320,
    presets: [
      {
        key: 'selectiva',
        label: 'Selectiva',
        note: 'Solo los días en que la primera media hora mueve más de 1,2 veces su volumen habitual. Es el filtro de "stocks in play" del estudio original trasladado a un mercado donde no hay valores que elegir, y descarta dos de cada tres días. Gana más por señal a cambio de operar mucho menos.',
      },
      {
        key: 'todas',
        label: 'Todas',
        note: 'Sin filtro de volumen: opera cada apertura. Gana algo menos por señal pero da más del triple de operaciones, así que produce más R al año. Es la opción sensata si el problema es que la selectiva casi nunca dispara.',
        backtest: {
          byTimeframe: { '15m': 0.14, '1H': 0, '4H': 0, '1D': 0 },
          nativeTimeframe: '15m',
          outOfSample: 0.12,
          sampleSize: 5815,
          winRate: 0.282,
          confidence: 'reasonable',
        },
      },
    ],
    run: (candles, presetKey) =>
      analyseOpeningRange(
        candles,
        presetKey === 'todas' ? OPENING_RANGE_ALL : OPENING_RANGE_SETTINGS,
      ),
    backtest: {
      byTimeframe: { '15m': 0.18, '1H': 0, '4H': 0, '1D': 0 },
      nativeTimeframe: '15m',
      outOfSample: 0.23,
      sampleSize: 1832,
      winRate: 0.368,
      confidence: 'reasonable',
    },
  },
]

export function strategyByKey(key: string): StrategyDef {
  return STRATEGIES.find((s) => s.key === key) ?? STRATEGIES[0]
}

/**
 * Kaufman's efficiency ratio: net move divided by the distance actually
 * travelled, over `window` bars. Near 1 the market trends cleanly, near 0 it
 * chops. It tells you which of the two strategies has the wind behind it.
 *
 * Do not be tempted to switch strategies automatically off this. It was
 * measured: routing signals to the breakout above a 0.25–0.35 ratio and to the
 * reversal below scored +0.55 R against +0.54 R for the reversal alone. The
 * ratio has sat at 0.08–0.13 for months, so the trend branch almost never fires
 * and the "combination" is just the reversal wearing a hat.
 */
export function efficiencyRatio(candles: Candle[], window = 100): number {
  if (candles.length < window + 1) return 0
  const c = candles.map((k) => k.close)
  const end = c.length - 1
  const net = Math.abs(c[end] - c[end - window])
  let path = 0
  for (let i = end - window + 1; i <= end; i++) path += Math.abs(c[i] - c[i - 1])
  return path > 0 ? net / path : 0
}

export function regimeOf(ratio: number): 'trending' | 'mixed' | 'ranging' {
  if (ratio > 0.35) return 'trending'
  if (ratio > 0.2) return 'mixed'
  return 'ranging'
}
