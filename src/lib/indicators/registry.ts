import { analyseTraps, ORIGINAL_SETTINGS, TUNED_SETTINGS } from './reversalTrap'
import {
  analyseDonchian,
  DONCHIAN_ACCURATE,
  DONCHIAN_MOMENTUM,
  DONCHIAN_SETTINGS,
  DONCHIAN_SLOW,
} from './donchianBreakout'
import { analysePullback, PULLBACK_DEFAULT, PULLBACK_TP } from './pullbackTrend'
import type { Candle, Overlay, StrategyResult, StrategySignal } from './types'
import { summarise } from './types'

/**
 * The strategies the Señales view can show. Adding one means adding an entry
 * here — the view, the chart and the stats are all driven off this list.
 *
 * `backtest` records what the sweep found, so the UI can be honest about how
 * well established each edge is instead of implying they are equivalent.
 */

/**
 * Measured backtest profile. Every number here comes from running the strategy
 * over the cached candles of 10 instruments and 4 timeframes — never written by
 * hand. The UI presents them as fact, so an invented figure is misinformation
 * with money attached. Re-measure after changing any strategy parameter.
 */
export interface StrategyBacktest {
  /** Net expectancy in R per timeframe, across 10 instruments. */
  byTimeframe: Record<string, number>
  /** Net expectancy on the daily half of history never used for tuning. */
  outOfSample: number
  /** Resolved daily signals behind those numbers. */
  sampleSize: number
  /**
   * `negative` means the measurement says it loses money. It stays selectable
   * — hiding it would be worse than saying so — but the UI must not present it
   * as an edge.
   */
  confidence: 'reasonable' | 'weak' | 'negative'
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
      byTimeframe: { '15m': -0.34, '1H': 0.07, '4H': 0.15, '1D': 0.54 },
      outOfSample: 0.57,
      sampleSize: 115,
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
          byTimeframe: { '15m': -0.42, '1H': -0.20, '4H': -0.07, '1D': 0.30 },
          outOfSample: 0.47,
          sampleSize: 116,
          confidence: 'weak',
        },
      },
      {
        key: 'momentum',
        label: 'Momentum',
        note: 'Ruptura de 20 filtrada por la EMA(100), stop 2 ATR y trailing 6 ATR. En diario es la que más gana (+0,74 R) pero fuera de muestra cae a +0,06 R, así que ese número está lejos de estar establecido. Solo diaria: en 15 m pierde 0,51 R por señal.',
        backtest: {
          byTimeframe: { '15m': -0.51, '1H': -0.33, '4H': 0.15, '1D': 0.74 },
          outOfSample: 0.06,
          sampleSize: 86,
          confidence: 'weak',
        },
      },
    ],
    run: (candles, presetKey) =>
      analyseDonchian(
        candles,
        presetKey === 'accurate'
          ? DONCHIAN_ACCURATE
          : presetKey === 'momentum'
            ? DONCHIAN_MOMENTUM
            : presetKey === 'slow'
              ? DONCHIAN_SLOW
              : DONCHIAN_SETTINGS,
      ),
    backtest: {
      byTimeframe: { '15m': -0.34, '1H': -0.20, '4H': -0.09, '1D': 0.50 },
      outOfSample: 0.19,
      sampleSize: 100,
      confidence: 'weak',
    },
  },
  {
    key: 'pullback',
    label: 'Pullback',
    tagline: 'Corrección dentro de la tendencia (RSI2 estilo Connors)',
    description:
      'Compra la caída dentro de una tendencia alcista (o vende el rebote en una bajista). Filtra por la EMA(200), espera a que el precio pierda su EMA rápida y al RSI(2) estirarse al extremo (≤10), y sale cuando el RSI(2) vuelve a su media. Es la lógica de Larry Connors. Acierta muchísimo —entre el 62 % y el 68 % según la temporalidad— pero en el barrido ese acierto NO se traduce en dinero: la esperanza queda en cero porque las pocas pérdidas, con un stop de 3 ATR, se comen las muchas ganancias pequeñas. Se deja seleccionable para poder verlo, no como recomendación.',
    regime: 'trending',
    presets: [
      {
        key: 'default',
        label: 'Reversión RSI2',
        note: 'EMA(200) de filtro, entrada con RSI(2) ≤ 10 y salida al volver el RSI(2) a 50. Acierta el 67 % en diario, pero la esperanza medida es +0,01 R: el acierto sí es geometría de la salida, no una ventaja. Se probaron 25 combinaciones de stop y salida y ninguna llegó a ser rentable.',
      },
      {
        key: 'tp',
        label: 'Con Objetivo',
        note: 'Igual que la anterior con toma de beneficios fija de 2 R. Baja el acierto al 46 % y sube la esperanza a +0,09 R en diario: sigue sin ser una ventaja clara.',
      },
    ],
    run: (candles, presetKey) => analysePullback(candles, presetKey === 'tp' ? PULLBACK_TP : PULLBACK_DEFAULT),
    backtest: {
      byTimeframe: { '15m': -0.11, '1H': -0.06, '4H': -0.01, '1D': 0.01 },
      outOfSample: 0.02,
      sampleSize: 176,
      confidence: 'negative',
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
