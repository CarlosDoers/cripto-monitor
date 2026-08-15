import { analyseTraps, TUNED_SETTINGS } from './reversalTrap'
import { analyseDonchian, DONCHIAN_ACCURATE, DONCHIAN_SETTINGS } from './donchianBreakout'
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
  /** Net expectancy on the daily half of history never used for tuning. */
  outOfSample: number
  /** Resolved daily signals behind those numbers. */
  sampleSize: number
  /** Measured daily hit rate, 0–1. */
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
  /** Which regime it needs — used to flag when conditions are unfavourable. */
  regime: 'trending' | 'ranging'
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
        note: 'Bandas de 2,5 ATR y stop de 0,25. Es la configuración con mejor evidencia de toda la app: +0,54 R por señal en diario y +0,57 R en la mitad del histórico que no se usó para ajustarla. Al barrer 108 variantes alrededor, todas las vecinas siguen siendo positivas (+0,45 a +0,59 R), que es la señal de que el resultado no depende de haber acertado los parámetros exactos.',
      },
    ],
    run: runReversal,
    backtest: {
      byTimeframe: { '15m': -0.33, '1H': 0.07, '4H': 0.15, '1D': 0.54 },
      outOfSample: 0.57,
      sampleSize: 115,
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
        note: 'Canal de 20 velas, stop de 2 ATR y trailing de 8. Es la que más gana por señal (+0,75 R en diario) y es positiva en los tres instrumentos con histórico largo, pero el resultado está muy concentrado: BTC +0,24 R y ETH +0,31 R frente a SOL +1,80 R. Sin la racha de SOL la ventaja es real pero mucho más modesta.',
      },
      {
        key: 'accurate',
        label: 'Acierto',
        note: 'Canal de 55 filtrado por la EMA(200), stop ceñido y objetivo fijo de 1,5 R. Acierta el 53 % en vez del 35 %, a cambio de ganar menos por señal (+0,31 R). Gana menos dinero pero es mucho más llevadera de operar, y es la única que mejora fuera de muestra (+0,47 R) en lugar de empeorar.',
        backtest: {
          byTimeframe: { '15m': -0.42, '1H': -0.20, '4H': -0.07, '1D': 0.31 },
          outOfSample: 0.47,
          sampleSize: 115,
          winRate: 0.53,
          confidence: 'weak',
        },
      },
    ],
    run: (candles, presetKey) =>
      analyseDonchian(candles, presetKey === 'accurate' ? DONCHIAN_ACCURATE : DONCHIAN_SETTINGS),
    backtest: {
      byTimeframe: { '15m': -0.49, '1H': -0.25, '4H': -0.06, '1D': 0.75 },
      outOfSample: 0.34,
      sampleSize: 111,
      winRate: 0.351,
      confidence: 'weak',
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
