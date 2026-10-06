import { liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type StrategyResult } from './types'

/**
 * The reversal candles every chart guide lists — engulfing and hammer /
 * shooting star — traded where the guides say to trade them: at an extreme.
 * "At support" is not measurable, but a 20-bar low or high is, so that is the
 * context: a bullish pattern whose low makes a new 20-bar low, a bearish one
 * whose high makes a new 20-bar high.
 *
 * Written as the patterns are defined, nothing tuned: an engulfing candle's
 * body covers the previous body from the other side; a hammer has a body of at
 * most a third of its range, a lower wick of at least twice the body and almost
 * no upper wick (the shooting star is its mirror). Entry at the close of the
 * pattern, stop at its extreme, target 2 R, and a trade that has done neither in
 * ten bars is closed at that close.
 *
 * **Measured** (30 coins since 2022): −0.08 R on 4 h (6 101 trades) and +0.03 R on
 * the daily (985).
 */

export interface CandlePatternSettings {
  lookback: number
  targetR: number
  maxBars: number
  feeRate: number
}

export const CANDLE_PATTERN_SETTINGS: CandlePatternSettings = { lookback: 20, targetR: 2, maxBars: 10, feeRate: 0.001 }

export function analyseCandlePatterns(
  candles: Candle[],
  s: CandlePatternSettings = CANDLE_PATTERN_SETTINGS,
): StrategyResult {
  const find = (i: number): Entry | null => {
    if (i <= s.lookback) return null
    let lo = Infinity
    let hi = -Infinity
    for (let k = i - s.lookback; k < i; k++) {
      lo = Math.min(lo, candles[k].low)
      hi = Math.max(hi, candles[k].high)
    }

    const b = candles[i]
    const p = candles[i - 1]
    const range = b.high - b.low
    if (!(range > 0)) return null
    const body = Math.abs(b.close - b.open)
    const top = Math.max(b.open, b.close)
    const bottom = Math.min(b.open, b.close)

    const bullEngulf = p.close < p.open && b.close > b.open && b.open <= p.close && b.close >= p.open
    const hammer = body <= range / 3 && bottom - b.low >= 2 * body && b.high - top <= 0.1 * range
    const bearEngulf = p.close > p.open && b.close < b.open && b.open >= p.close && b.close <= p.open
    const star = body <= range / 3 && b.high - top >= 2 * body && bottom - b.low <= 0.1 * range

    const long = Math.min(b.low, bullEngulf ? p.low : b.low) <= lo && (bullEngulf || hammer)
    const short = Math.max(b.high, bearEngulf ? p.high : b.high) >= hi && (bearEngulf || star)
    if (long === short) return null

    const stop = long ? Math.min(b.low, bullEngulf ? p.low : b.low) : Math.max(b.high, bearEngulf ? p.high : b.high)
    const risk = Math.abs(b.close - stop)
    return {
      index: i,
      side: long ? 'long' : 'short',
      entry: b.close,
      stop,
      target: long ? b.close + s.targetR * risk : b.close - s.targetR * risk,
      maxBars: s.maxBars,
      note: long ? (bullEngulf ? 'envolvente alcista' : 'martillo') : bearEngulf ? 'envolvente bajista' : 'estrella fugaz',
    }
  }

  const signals = walk(candles, s.lookback + 1, find, { feeRate: s.feeRate })
  return summarise(signals, [], s.lookback + 1, liveSignal(signals))
}
