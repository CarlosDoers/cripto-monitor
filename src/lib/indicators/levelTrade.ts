import { findLevels, LEVEL_SETTINGS, type LevelSettings } from './levels'
import { atr } from './ta'
import { feeInR, summarise, type Candle, type Overlay, type StrategyResult, type StrategySignal } from './types'

/**
 * The two ways a support/resistance level is normally traded, so each can be
 * measured instead of assumed.
 *
 * **Rebote** treats the level as a wall: buy a touch of support, sell a touch of
 * resistance, stop just beyond it. **Ruptura** treats it as a gate: buy the
 * close that clears resistance, stop back inside.
 *
 * They are deliberately opposite bets on the same line, and both are here for a
 * reason — `npm run levels:sweep` already found that price neither respects nor
 * breaks a level more often than it does a random line at the same distance, so
 * whichever of these looks better in a backtest is the one to distrust most.
 *
 * Levels are rebuilt every `refresh` bars from the preceding `window`, never
 * from the whole series: a level fitted to bars it is then judged on is
 * guaranteed to look respected.
 */

export interface LevelTradeSettings {
  levels: LevelSettings
  /** Bars of history the detector sees. */
  window: number
  /** Rebuild the levels every this many bars. */
  refresh: number
  /** How close to a level counts as a touch, in ATRs. */
  touchAtr: number
  /** Stop beyond the level, in ATRs. Defines 1 R. */
  stopAtr: number
  targetR: number
  feeRate: number
}

export const LEVEL_TRADE_SETTINGS: LevelTradeSettings = {
  levels: LEVEL_SETTINGS,
  window: 400,
  refresh: 20,
  touchAtr: 0.25,
  stopAtr: 0.5,
  targetR: 2,
  feeRate: 0.001,
}

type Mode = 'rebote' | 'ruptura'

function analyse(candles: Candle[], settings: LevelTradeSettings, mode: Mode): StrategyResult {
  const { levels: levelSettings, window, refresh, touchAtr, stopAtr, targetR, feeRate } = settings
  const warmup = window + levelSettings.atrLen + 5
  if (candles.length < warmup + 10) return summarise([], [], candles.length, null)

  const a = atr(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    candles.map((c) => c.close),
    levelSettings.atrLen,
  )

  const signals: StrategySignal[] = []
  let open: { signal: StrategySignal; risk: number } | null = null
  let levels: number[] = []

  /**
   * Resolve against one bar. Stop before target: when a single bar touches both
   * there is no way to know which came first, so assume the worse.
   *
   * This runs on the entry bar too, and that is not a detail. Managing only from
   * the next bar excuses exactly the bars that dip to a level and then collapse
   * through it — the losers — and turned this strategy from negative into a
   * false +0.35 R on the daily.
   */
  const resolve = (o: { signal: StrategySignal; risk: number }, bar: Candle, i: number): boolean => {
    const long = o.signal.side === 'long'
    const hitStop = long ? bar.low <= o.signal.stop : bar.high >= o.signal.stop
    const hitTarget = o.signal.target
      ? long
        ? bar.high >= o.signal.target
        : bar.low <= o.signal.target
      : false
    if (!hitStop && !hitTarget) return false
    o.signal.resultR = hitStop ? -1 : targetR
    o.signal.outcome = hitStop ? 'loss' : 'win'
    o.signal.closedIndex = i
    o.signal.closedTime = bar.time
    o.signal.closedPrice = hitStop ? o.signal.stop : o.signal.target!
    return true
  }

  for (let i = warmup; i < candles.length; i++) {
    const bar = candles[i]

    if (open && resolve(open, bar, i)) open = null

    if ((i - warmup) % refresh === 0) {
      levels = findLevels(candles.slice(i - window, i), levelSettings).map((l) => l.price)
    }
    if (open || !levels.length) continue

    const unit = a[i]
    if (!Number.isFinite(unit) || unit <= 0) continue
    const touch = unit * touchAtr
    const prev = candles[i - 1].close

    for (const level of levels) {
      let side: 'long' | 'short' | null = null
      let entry = level

      if (mode === 'rebote') {
        // Entry sits at the level, so the bar has to have actually traded there:
        // filling at a price the candle never reached is free money on paper.
        if (prev > level && bar.low <= level) side = 'long'
        else if (prev < level && bar.high >= level) side = 'short'
        entry = level
      } else {
        // Closed clear of the level having been on the other side of it.
        if (prev <= level && bar.close > level + touch) side = 'long'
        else if (prev >= level && bar.close < level - touch) side = 'short'
        entry = bar.close
      }
      if (!side) continue

      const stop = side === 'long' ? level - stopAtr * unit : level + stopAtr * unit
      const risk = Math.abs(entry - stop)
      if (!(risk > 0)) continue

      const signal: StrategySignal = {
        index: i,
        time: bar.time,
        side,
        entry,
        stop,
        target: side === 'long' ? entry + targetR * risk : entry - targetR * risk,
        riskReward: targetR,
        outcome: 'open',
        feeR: feeInR(entry, stop, feeRate),
        note: `${mode} · nivel ${level.toFixed(4)}`,
      }
      signals.push(signal)
      open = { signal, risk }
      if (resolve(open, bar, i)) open = null
      break // one position at a time; the nearest level wins
    }
  }

  const overlays: Overlay[] = []
  const last = signals[signals.length - 1]
  return summarise(signals, overlays, warmup, last && last.outcome === 'open' ? last : null)
}

export function analyseLevelBounce(
  candles: Candle[],
  settings: LevelTradeSettings = LEVEL_TRADE_SETTINGS,
): StrategyResult {
  return analyse(candles, settings, 'rebote')
}

export function analyseLevelBreak(
  candles: Candle[],
  settings: LevelTradeSettings = LEVEL_TRADE_SETTINGS,
): StrategyResult {
  return analyse(candles, settings, 'ruptura')
}
