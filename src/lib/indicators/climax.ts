import { atr } from './ta'
import { liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type StrategyResult } from './types'

/**
 * The climax reversal — exhaustion on a volume spike, the pattern behind "buy
 * the capitulation". Price makes a new extreme on a bar that is both wide and
 * unusually heavy, and still closes away from that extreme: the last sellers
 * (or buyers) are spent and someone took the other side at the lows.
 *
 * Written as the rule is told, nothing tuned:
 *
 * - a new 20-bar low (high), a range of at least 1.5 ATR and a volume of at
 *   least twice the average of the 20 bars before it — ATR and averages are
 *   read on the bars *before*, so the spike is not part of its own baseline;
 * - the close sits in the upper (lower) half of the bar;
 * - entry at the close, stop at the bar's extreme, target 2 R, and a trade that
 *   has done neither in ten bars is closed at that close.
 *
 * **Measured** (30 coins since 2022): −0.07 R on 4 h (2 923 trades) and on the
 * daily (501); −0.16 R on the daily of 2018–2021.
 */

export interface ClimaxSettings {
  lookback: number
  rangeAtr: number
  volMult: number
  /** How far from the extreme the close must sit, as a share of the bar. */
  closeFrac: number
  targetR: number
  maxBars: number
  feeRate: number
}

export const CLIMAX_SETTINGS: ClimaxSettings = {
  lookback: 20,
  rangeAtr: 1.5,
  volMult: 2,
  closeFrac: 0.5,
  targetR: 2,
  maxBars: 10,
  feeRate: 0.001,
}

export function analyseClimax(candles: Candle[], s: ClimaxSettings = CLIMAX_SETTINGS): StrategyResult {
  const unit = atr(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    candles.map((c) => c.close),
    14,
  )
  const warmup = Math.max(s.lookback, 14) + 1

  const find = (i: number): Entry | null => {
    if (i < warmup || !(unit[i - 1] > 0)) return null
    let lo = Infinity
    let hi = -Infinity
    let vol = 0
    for (let k = i - s.lookback; k < i; k++) {
      lo = Math.min(lo, candles[k].low)
      hi = Math.max(hi, candles[k].high)
      vol += candles[k].vol ?? 0
    }
    const meanVol = vol / s.lookback
    const b = candles[i]
    const range = b.high - b.low
    if (!(meanVol > 0) || (b.vol ?? 0) < s.volMult * meanVol || range < s.rangeAtr * unit[i - 1]) return null

    const long = b.low <= lo && b.close >= b.low + s.closeFrac * range
    const short = b.high >= hi && b.close <= b.high - s.closeFrac * range
    if (long === short) return null

    const stop = long ? b.low : b.high
    const risk = Math.abs(b.close - stop)
    return {
      index: i,
      side: long ? 'long' : 'short',
      entry: b.close,
      stop,
      target: long ? b.close + s.targetR * risk : b.close - s.targetR * risk,
      maxBars: s.maxBars,
      note: `volumen ${(((b.vol ?? 0) / meanVol)).toFixed(1)}× · rango ${(range / unit[i - 1]).toFixed(1)} ATR`,
    }
  }

  const signals = walk(candles, warmup, find, { feeRate: s.feeRate })
  return summarise(signals, [], warmup, liveSignal(signals))
}
