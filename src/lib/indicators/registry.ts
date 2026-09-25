import { analyseTraps, TUNED_SETTINGS } from './reversalTrap'
import { analyseDonchian, DONCHIAN_SETTINGS } from './donchianBreakout'
import { analyseOpeningRange, OPENING_RANGE_SETTINGS } from './openingRange'
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
 * And three more in the 2026-09 review, once the shipped strategies were held
 * to the bar `try` sets for new ones — both halves of the history, not just the
 * aggregate:
 *
 * - `donchian/fast` on the daily: +0.67 R, of which one SOL trade (+68 R in
 *   2023) is the whole story — without it +0.17, without the best five −0.08,
 *   first half −0.09. Its 4 h stays: both halves hold there.
 * - `donchian/accurate`: +0.21 R with a 95 % interval reaching below zero and a
 *   first half of +0.01. No timeframe cleared both halves.
 * - `opening/selectiva` and the weekend days of `opening/todas`: the volume
 *   filter was mostly a weekend filter in disguise (it dropped 92 % of them).
 *   Weekends have no New York open to borrow and measured −0.17 R on 1 640
 *   trades; without them every open measures +0.25 R, and the filter lowers
 *   that at every threshold tried.
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
   * The same expectancy on the first and second half of each instrument's
   * history, for every timeframe whose aggregate clears `MIN_TRADABLE_R`. A
   * timeframe is only offered if both halves clear it too — the bar `try` puts
   * on any new strategy. An aggregate can clear it on the strength of one half,
   * or of one trade: the Donchian's daily +0.67 R was −0.09 on its first half
   * and owed itself to a single +68 R SOL trade. A timeframe with no halves
   * declared is treated as failing them.
   */
  halves: Partial<Record<string, [number, number]>>
  /**
   * The timeframe the three figures below are measured on. Daily unless set:
   * the Donchian now only clears the bar on 4 h, and the opening range only
   * exists on 15 m.
   */
  nativeTimeframe?: string
  /**
   * The strategy cannot be computed on any other timeframe at all — the opening
   * range is built out of 30-minute ranges. That is a different statement from
   * "it loses money there" and has to read differently.
   */
  exclusive?: boolean
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
 * Why a timeframe is not offered. Three different statements, and the UI must
 * not swap them: "the commission eats it" about a timeframe where the strategy
 * cannot even be computed, or where the edge exists but only on one half of the
 * history, would be a lie.
 */
export type BlockReason = 'not-applicable' | 'cost' | 'unstable'

export function blockReason(profile: StrategyBacktest, timeframe: string): BlockReason | null {
  if (!appliesTo(profile, timeframe)) return 'not-applicable'
  if ((profile.byTimeframe[timeframe] ?? 0) < MIN_TRADABLE_R) return 'cost'
  const halves = profile.halves[timeframe]
  if (!halves || Math.min(...halves) < MIN_TRADABLE_R) return 'unstable'
  return null
}

/**
 * Derived from the measurements rather than listed by hand, so it can never
 * drift out of sync with `byTimeframe` when a strategy is re-measured.
 */
export function timeframeVerdict(profile: StrategyBacktest, timeframe: string): TimeframeVerdict {
  if (blockReason(profile, timeframe)) return 'blocked'
  return (profile.byTimeframe[timeframe] ?? 0) >= STRONG_R ? 'good' : 'marginal'
}

/** Whether the strategy can be computed on a timeframe at all. */
export function appliesTo(profile: StrategyBacktest, timeframe: string): boolean {
  return !profile.exclusive || profile.nativeTimeframe === timeframe
}

/** The timeframes this profile may actually be traded on, best first. */
export function tradableTimeframes(profile: StrategyBacktest): string[] {
  return Object.keys(profile.byTimeframe)
    .filter((tf) => timeframeVerdict(profile, tf) !== 'blocked')
    .sort((a, b) => (profile.byTimeframe[b] ?? 0) - (profile.byTimeframe[a] ?? 0))
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
        note: 'Bandas de 2,5 ATR y stop de 0,25. Es la más sólida de la app: +0,61 R por señal en diario, positiva en BTC, ETH y SOL por separado, en todos los años desde 2022 y en largos y cortos. Sin sus diez mejores operaciones sigue en +0,26 R, así que no depende de unas pocas. Al barrer las variantes de alrededor, todas las vecinas seguían siendo positivas. En 4 h mide +0,03 R, así que ese timeframe no se ofrece.',
      },
    ],
    run: runReversal,
    backtest: {
      byTimeframe: { '15m': -0.20, '1H': -0.02, '4H': 0.03, '1D': 0.61 },
      halves: { '1D': [0.71, 0.40] },
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
      'Entra cuando el precio cierra por encima del máximo (o por debajo del mínimo) de las últimas 20 velas, y acompaña la tendencia con un stop dinámico muy holgado. Acierta poco y gana mucho en las pocas que salen: el 70 % de las señales pierden. Necesita mercado con tendencia, así que en un mercado lateral dará rachas largas de pérdidas aunque la esperanza sea positiva.',
    regime: 'trending',
    presets: [
      {
        key: 'fast',
        label: 'Canal 20',
        note: 'Canal de 20 velas, stop de 2 ATR y trailing de 8, solo en 4 h: +0,33 R por señal, y aguanta las dos mitades del histórico (+0,43 / +0,25). Como todo seguidor de tendencia vive de pocas operaciones grandes: sin sus cinco mejores baja a +0,17 R, y sin las diez a +0,07. En diario no se ofrece: su media de +0,67 R es casi entera una sola operación de SOL en 2023 (+68 R), y sin ella se queda en +0,17 con la primera mitad en negativo.',
      },
    ],
    run: (candles) => analyseDonchian(candles, DONCHIAN_SETTINGS),
    backtest: {
      byTimeframe: { '15m': -0.10, '1H': 0.08, '4H': 0.33, '1D': 0.67 },
      halves: { '4H': [0.43, 0.25], '1D': [-0.09, 0.17] },
      nativeTimeframe: '4H',
      outOfSample: 0.25,
      sampleSize: 899,
      winRate: 0.300,
      confidence: 'weak',
    },
  },
  {
    key: 'opening',
    label: 'Apertura',
    tagline: 'Rotura del rango de apertura de Wall Street',
    description:
      'Toma los primeros 30 minutos desde que abre la bolsa de Nueva York, y entra cuando el precio rompe ese rango por cualquiera de los dos lados, con el stop en el extremo contrario. Cierra la posición 24 horas después, gane o pierda. Solo opera de lunes a viernes: el fin de semana Nueva York no abre y no hay apertura que tomar prestada. Acierta poco —un tercio de las veces— porque los perdedores valen exactamente 1 R y a los ganadores se les deja correr todo el día. No depende del régimen: gana en mercado lateral (+0,26 R) y en mixto (+0,20 R).',
    // Measured across regimes on BTC/ETH/SOL (`npm run orb`): +0.255 R ranging,
    // +0.197 mixed, +0.007 trending on n=20 — too few to call. It never needs
    // a trend, so the view's regime warning would be misinformation.
    regime: 'any',
    // 45 days of 15 m, so the view's own statistics rest on ~30 opens rather
    // than the ten a fortnight of /market/candles would give.
    archiveBars: 4320,
    presets: [
      {
        key: 'laborables',
        label: 'Días laborables',
        note: 'Cada apertura de lunes a viernes, sin filtro de volumen. Positiva en todos los años desde 2022, en 9 de los 10 instrumentos, y sin sus diez mejores operaciones sigue en +0,19 R. Resiste hasta 0,2 % de ida y vuelta (+0,14 R), que importa porque cada entrada es una orden stop que paga el deslizamiento. Lo que conviene vigilar: la ventaja se ha ido estrechando, de +0,42 R en 2022 a +0,08 en 2025.',
      },
    ],
    run: (candles) => analyseOpeningRange(candles, OPENING_RANGE_SETTINGS),
    backtest: {
      byTimeframe: { '15m': 0.25, '1H': 0, '4H': 0, '1D': 0 },
      halves: { '15m': [0.38, 0.13] },
      nativeTimeframe: '15m',
      exclusive: true,
      outOfSample: 0.13,
      sampleSize: 4176,
      winRate: 0.329,
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
  // Only the last `window + 1` closes are read. Mapping the whole series copied
  // the 15 m archive — tens of thousands of bars — on every change of it.
  const c = candles.slice(-(window + 1)).map((k) => k.close)
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
