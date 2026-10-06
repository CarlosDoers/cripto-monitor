import { sma, stdev } from './ta'
import { liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type StrategyResult } from './types'

/**
 * Altcoin against Bitcoin by z-score — the textbook pairs trade of crypto: the
 * ratio coin / BTC stretches, and "ratios revert far more reliably than outright
 * prices". Long the coin and short Bitcoin when the ratio is two deviations
 * below its 20-bar mean, the reverse above; out when it is back at the mean.
 *
 * It is the one family here that is neutral to the market, and the one that
 * pays twice: two legs, so the round trip costs 0.2 %. Candles are the *ratio*
 * series, built by the caller from two aligned closes (open = close, so a
 * stop that the close jumps past fills at the close, not at its level); the
 * "ATR" is the mean close-to-close move of the ratio. Written as the rule is
 * told: entry on the first bar beyond |z| 2, stop 2.5 ratio-ATRs away, and a
 * trade not back at the mean in 20 bars is closed.
 *
 * **Measured** (coin / BTC, 30 coins since 2022): −0.17 R on 4 h (9 150 trades)
 * and −0.20 R on the daily (1 446), with a 48 % hit rate — the ratio does revert
 * most of the time and the two legs' fees eat more than it pays.
 */

export interface AltRatioSettings {
  window: number
  entryZ: number
  stopAtr: number
  maxBars: number
  /** Both legs: two round trips. */
  feeRate: number
}

export const ALT_RATIO_SETTINGS: AltRatioSettings = {
  window: 20,
  entryZ: 2,
  stopAtr: 2.5,
  maxBars: 20,
  feeRate: 0.002,
}

export function analyseAltRatio(candles: Candle[], s: AltRatioSettings = ALT_RATIO_SETTINGS): StrategyResult {
  const n = candles.length
  const close = candles.map((c) => c.close)
  const mean = sma(close, s.window)
  const dev = stdev(close, s.window)
  const z = close.map((c, i) => (dev[i] > 0 ? (c - mean[i]) / dev[i] : NaN))
  const move = close.map((c, i) => (i ? Math.abs(c - close[i - 1]) : NaN))
  const unit = sma(move.map((m) => (Number.isFinite(m) ? m : 0)), 14)

  const warmup = s.window + 15
  const find = (i: number): Entry | null => {
    if (i < warmup || !(unit[i] > 0) || !Number.isFinite(z[i]) || !Number.isFinite(z[i - 1])) return null
    const long = z[i] <= -s.entryZ && z[i - 1] > -s.entryZ
    const short = z[i] >= s.entryZ && z[i - 1] < s.entryZ
    if (!long && !short) return null
    return {
      index: i,
      side: long ? 'long' : 'short',
      entry: close[i],
      stop: long ? close[i] - s.stopAtr * unit[i] : close[i] + s.stopAtr * unit[i],
      maxBars: s.maxBars,
      note: `z ${z[i].toFixed(1)}`,
    }
  }

  const signals = walk(candles, warmup, find, {
    feeRate: s.feeRate,
    exitOnClose: (i, side) => (side === 'long' ? z[i] >= 0 : z[i] <= 0),
  })
  return summarise(signals, [], Math.min(warmup, n), liveSignal(signals))
}
