import { analyseTraps, ORIGINAL_SETTINGS, TUNED_SETTINGS } from './reversalTrap'
import {
  analyseDonchian,
  DONCHIAN_ACCURATE,
  DONCHIAN_SETTINGS,
  DONCHIAN_SLOW,
} from './donchianBreakout'
import type { Candle, Overlay, StrategyResult, StrategySignal } from './types'
import { summarise } from './types'

/**
 * The strategies the Señales view can show. Adding one means adding an entry
 * here — the view, the chart and the stats are all driven off this list.
 *
 * `backtest` records what the sweep found, so the UI can be honest about how
 * well established each edge is instead of implying they are equivalent.
 */

export interface StrategyBacktest {
  /** Net expectancy in R per timeframe, across 10 instruments. */
  byTimeframe: Record<string, number>
  /** Net expectancy on the half of history never used for tuning. */
  outOfSample: number
  /** Resolved signals behind those numbers. */
  sampleSize: number
  confidence: 'reasonable' | 'weak'
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
function runReversal(candles: Candle[], presetKey: string): StrategyResult {
  const settings = presetKey === 'original' ? ORIGINAL_SETTINGS : TUNED_SETTINGS
  const a = analyseTraps(candles, settings)

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
      'El precio sale de una envolvente ancha y vuelve a cerrar dentro. Interpreta que la ruptura era falsa y busca el giro hacia la línea base, que hace de objetivo. Necesita mercado lateral.',
    regime: 'ranging',
    presets: [
      {
        key: 'tuned',
        label: 'Ajustada',
        note: 'Bandas de 2,5 ATR y stop ceñido. Rentable en 8 de 10 instrumentos del barrido y mejora fuera de muestra.',
      },
      {
        key: 'original',
        label: 'Original',
        note: 'Los valores de BigBeluga: 4 ATR y stop 0,5. En el barrido salió plana o negativa.',
      },
    ],
    run: runReversal,
    backtest: {
      byTimeframe: { '15m': -0.3, '1H': 0.0, '4H': -0.01, '1D': 0.53 },
      outOfSample: 0.22,
      sampleSize: 1222,
      confidence: 'reasonable',
    },
  },
  {
    key: 'donchian',
    label: 'Ruptura',
    tagline: 'Canal de Donchian al estilo Turtle',
    description:
      'Entra cuando el precio cierra por encima del máximo (o por debajo del mínimo) de las últimas 20 velas, y acompaña la tendencia con un stop dinámico muy holgado. Pocos aciertos, pero los ganadores corren mucho. Necesita mercado con tendencia.',
    regime: 'trending',
    presets: [
      {
        key: 'fast',
        label: 'Rendimiento',
        note: 'Canal de 20 velas y stop dinámico holgado. Acierta poco (~39 %) pero los ganadores corren mucho: es la variante que más gana por operación.',
      },
      {
        key: 'slow',
        label: 'Lenta (55)',
        note: 'Igual que la anterior con un canal de 55 velas: menos señales y más largas.',
      },
      {
        key: 'accurate',
        label: 'Acierto',
        note: 'Canal de 55 filtrado por la EMA(200), stop ceñido y objetivo fijo de 1,5 R. Sube el acierto del 39 % al 52 % a cambio de ganar menos por operación (+0,29 R en vez de +0,50 R). Solo diario.',
        backtest: {
          byTimeframe: { '15m': -0.21, '1H': -0.19, '4H': -0.05, '1D': 0.29 },
          outOfSample: 0.47,
          sampleSize: 117,
          confidence: 'weak',
        },
      },
    ],
    run: (candles, presetKey) =>
      analyseDonchian(
        candles,
        presetKey === 'accurate'
          ? DONCHIAN_ACCURATE
          : presetKey === 'slow'
            ? DONCHIAN_SLOW
            : DONCHIAN_SETTINGS,
      ),
    backtest: {
      byTimeframe: { '15m': -0.23, '1H': -0.11, '4H': -0.08, '1D': 0.48 },
      outOfSample: 0.19,
      sampleSize: 104,
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
