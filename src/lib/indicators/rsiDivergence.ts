import { rsi } from './ta'
import { liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type StrategyResult } from './types'

/**
 * Regular RSI divergence — price makes a lower low while the RSI makes a higher
 * low (and the mirror at highs), the most-drawn pattern on crypto charts.
 *
 * Written as TradingView's own divergence indicator defines it, nothing tuned:
 * pivots are confirmed with five bars on each side, the previous pivot of the
 * same kind must be between 5 and 60 bars back, and the RSI is the usual 14.
 * A pivot is only known five bars after it happened, so the entry is at the
 * close of that confirming bar — not at the pivot, which no one could have
 * traded. The stop is the pivot itself, the target 2 R, and a trade that has
 * done neither in 20 bars is closed at that close.
 *
 * **Measured** (30 coins since 2022): +0.02 R on 4 h (2 831 trades) and +0.09 R on
 * the daily (436).
 */

export interface RsiDivergenceSettings {
  left: number
  right: number
  minGap: number
  maxGap: number
  rsiLen: number
  targetR: number
  maxBars: number
  feeRate: number
}

export const RSI_DIVERGENCE_SETTINGS: RsiDivergenceSettings = {
  left: 5,
  right: 5,
  minGap: 5,
  maxGap: 60,
  rsiLen: 14,
  targetR: 2,
  maxBars: 20,
  feeRate: 0.001,
}

export function analyseRsiDivergence(
  candles: Candle[],
  s: RsiDivergenceSettings = RSI_DIVERGENCE_SETTINGS,
): StrategyResult {
  const n = candles.length
  const oscillator = rsi(
    candles.map((c) => c.close),
    s.rsiLen,
  )

  // A pivot low is lower than the `left` bars before it and no higher than the
  // `right` after it; known only `right` bars later.
  const pivotLow = new Array<boolean>(n).fill(false)
  const pivotHigh = new Array<boolean>(n).fill(false)
  for (let j = s.left; j + s.right < n; j++) {
    let isLow = true
    let isHigh = true
    for (let k = j - s.left; k <= j + s.right && (isLow || isHigh); k++) {
      if (k === j) continue
      const before = k < j
      if (before ? candles[k].low <= candles[j].low : candles[k].low < candles[j].low) isLow = false
      if (before ? candles[k].high >= candles[j].high : candles[k].high > candles[j].high) isHigh = false
    }
    pivotLow[j] = isLow
    pivotHigh[j] = isHigh
  }

  const previous = (flags: boolean[], j: number) => {
    for (let k = j - 1; k >= Math.max(0, j - s.maxGap); k--) if (flags[k]) return k
    return -1
  }

  const warmup = s.rsiLen + s.left + s.right + s.maxGap
  const find = (i: number): Entry | null => {
    const j = i - s.right
    if (j < s.left) return null
    const entry = candles[i].close

    if (pivotLow[j]) {
      const p = previous(pivotLow, j)
      if (
        p >= 0 &&
        j - p >= s.minGap &&
        candles[j].low < candles[p].low &&
        oscillator[j] > oscillator[p] &&
        entry > candles[j].low
      ) {
        const risk = entry - candles[j].low
        return {
          index: i,
          side: 'long',
          entry,
          stop: candles[j].low,
          target: entry + s.targetR * risk,
          maxBars: s.maxBars,
          note: `divergencia alcista · RSI ${oscillator[p].toFixed(0)}→${oscillator[j].toFixed(0)}`,
        }
      }
    }
    if (pivotHigh[j]) {
      const p = previous(pivotHigh, j)
      if (
        p >= 0 &&
        j - p >= s.minGap &&
        candles[j].high > candles[p].high &&
        oscillator[j] < oscillator[p] &&
        entry < candles[j].high
      ) {
        const risk = candles[j].high - entry
        return {
          index: i,
          side: 'short',
          entry,
          stop: candles[j].high,
          target: entry - s.targetR * risk,
          maxBars: s.maxBars,
          note: `divergencia bajista · RSI ${oscillator[p].toFixed(0)}→${oscillator[j].toFixed(0)}`,
        }
      }
    }
    return null
  }

  const signals = walk(candles, warmup, find, { feeRate: s.feeRate })
  return summarise(signals, [], warmup, liveSignal(signals))
}
