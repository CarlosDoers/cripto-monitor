import { atr, highest, linreg, lowest, sma, stdev, trueRange } from './ta'
import { liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type StrategyResult } from './types'

/**
 * The TTM Squeeze (John Carter, *Mastering the Trade*) in LazyBear's popular
 * TradingView form — the most-copied volatility-compression setup there is.
 *
 * Bollinger Bands (20, 2σ) sitting *inside* a Keltner Channel (20, 1.5 × the
 * mean true range) mean volatility has dried up; the bar the bands step back
 * outside is the release. Direction is the sign of the momentum histogram, the
 * least-squares line through the close's distance to the middle of the 20-bar
 * range and its average. Written as the rule is usually told, nothing tuned:
 *
 * - entry at the close of the release bar, if the squeeze had lasted 6 bars or
 *   more (a one-bar "squeeze" is noise, and 6 is the number the original uses);
 * - stop 2 ATR away, like the project's other trend entries;
 * - out when the momentum changes sign against the position.
 *
 * **Measured** (`npm run try`, 30 coins since 2022): 4 h +0.12 R over 3 660
 * trades, halves +0.13 / +0.11. It clears `try` but not the review: without its
 * ten best trades +0.05, without the fifty best −0.07; longs +0.24 and shorts
 * +0.01; monthly correlation with the Donchian +0.62, and adding it to
 * Donchian + EMA 200 leaves the monthly Sharpe at 0.42 (it was 0.43). The daily
 * is −0.01 R. A weaker copy of the trend edge the app already ships.
 */

export interface SqueezeSettings {
  bbLen: number
  bbMult: number
  kcLen: number
  kcMult: number
  momLen: number
  /** Bars the squeeze must have lasted before its release counts. */
  minBars: number
  stopAtr: number
  feeRate: number
}

export const SQUEEZE_SETTINGS: SqueezeSettings = {
  bbLen: 20,
  bbMult: 2,
  kcLen: 20,
  kcMult: 1.5,
  momLen: 20,
  minBars: 6,
  stopAtr: 2,
  feeRate: 0.001,
}

export function analyseSqueeze(candles: Candle[], s: SqueezeSettings = SQUEEZE_SETTINGS): StrategyResult {
  const close = candles.map((c) => c.close)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)

  const basis = sma(close, s.bbLen)
  const dev = stdev(close, s.bbLen)
  const kcMid = sma(close, s.kcLen)
  const kcRange = sma(trueRange(high, low, close), s.kcLen)
  const unit = atr(high, low, close, 14)

  const top = highest(high, s.momLen)
  const bottom = lowest(low, s.momLen)
  const mean = sma(close, s.momLen)
  const momentum = linreg(
    close.map((c, i) => c - ((top[i] + bottom[i]) / 2 + mean[i]) / 2),
    s.momLen,
  )

  // Bands inside the channel on both sides.
  const squeezed = close.map(
    (_, i) =>
      basis[i] - s.bbMult * dev[i] > kcMid[i] - s.kcMult * kcRange[i] &&
      basis[i] + s.bbMult * dev[i] < kcMid[i] + s.kcMult * kcRange[i],
  )
  // Consecutive squeezed bars ending at each bar.
  const run = new Array<number>(close.length).fill(0)
  for (let i = 0; i < close.length; i++) run[i] = squeezed[i] ? (run[i - 1] ?? 0) + 1 : 0

  const warmup = Math.max(s.bbLen, s.kcLen) + 2 * s.momLen
  const find = (i: number): Entry | null => {
    if (i < warmup || squeezed[i] || run[i - 1] < s.minBars || !(unit[i] > 0)) return null
    const m = momentum[i]
    if (!Number.isFinite(m) || m === 0) return null
    const long = m > 0
    const entry = close[i]
    return {
      index: i,
      side: long ? 'long' : 'short',
      entry,
      stop: long ? entry - s.stopAtr * unit[i] : entry + s.stopAtr * unit[i],
      note: `squeeze de ${run[i - 1]} barras`,
    }
  }

  const signals = walk(candles, warmup, find, {
    feeRate: s.feeRate,
    exitOnClose: (i, side) => (side === 'long' ? momentum[i] <= 0 : momentum[i] >= 0),
  })
  return summarise(signals, [], warmup, liveSignal(signals))
}

export const analyseSqueeze3 = (c: Candle[]) => analyseSqueeze(c, { ...SQUEEZE_SETTINGS, minBars: 3 })
export const analyseSqueeze10 = (c: Candle[]) => analyseSqueeze(c, { ...SQUEEZE_SETTINGS, minBars: 10 })
