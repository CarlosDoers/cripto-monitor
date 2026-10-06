import { liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type StrategyResult } from './types'

/**
 * Turtle Soup — Linda Raschke's fade of the failed breakout (*Street Smarts*,
 * 1995), which is also what the SMC crowd calls a liquidity sweep: price runs
 * through an obvious extreme, takes the stops resting beyond it, and is back
 * inside the same bar.
 *
 * Written as the rule is told, nothing tuned:
 *
 * - a bar makes a new 20-bar low whose *previous* 20-bar low is at least four
 *   bars old (so it is a swept level, not the tail of the same slide) and
 *   closes back above that previous low → long at the close;
 * - the stop is the sweep's own extreme, the target 2 R, and a trade that has
 *   done neither in ten bars is closed at that close;
 * - shorts are the mirror image on the highs.
 *
 * **Measured** (30 coins since 2022): −0.16 R on 4 h (6 689 trades) and −0.14 R on
 * the daily (1 082), both halves negative; −0.16 R on the daily of 2018–2021
 * too. Fading the failed breakout does not pay on this board. (`try`'s random
 * control scores about −0.6 R here by construction — a 2 R target it never
 * awards — so its "advantage over chance" means nothing for this rule.)
 */

export interface TurtleSoupSettings {
  lookback: number
  /** The swept extreme must be at least this many bars old. */
  minAge: number
  targetR: number
  maxBars: number
  feeRate: number
}

export const TURTLE_SOUP_SETTINGS: TurtleSoupSettings = {
  lookback: 20,
  minAge: 4,
  targetR: 2,
  maxBars: 10,
  feeRate: 0.001,
}

export function analyseTurtleSoup(candles: Candle[], s: TurtleSoupSettings = TURTLE_SOUP_SETTINGS): StrategyResult {
  const find = (i: number): Entry | null => {
    if (i <= s.lookback) return null
    // The previous extremes and the most recent bar that set each.
    let lo = Infinity
    let loAt = -1
    let hi = -Infinity
    let hiAt = -1
    for (let k = i - s.lookback; k < i; k++) {
      if (candles[k].low <= lo) {
        lo = candles[k].low
        loAt = k
      }
      if (candles[k].high >= hi) {
        hi = candles[k].high
        hiAt = k
      }
    }

    const b = candles[i]
    const long = b.low < lo && i - loAt >= s.minAge && b.close > lo
    const short = b.high > hi && i - hiAt >= s.minAge && b.close < hi
    // Both at once is an outside bar: no way to say which sweep came first.
    if (long === short) return null

    const entry = b.close
    const stop = long ? b.low : b.high
    const risk = Math.abs(entry - stop)
    return {
      index: i,
      side: long ? 'long' : 'short',
      entry,
      stop,
      target: long ? entry + s.targetR * risk : entry - s.targetR * risk,
      maxBars: s.maxBars,
      note: long ? `barrido del mínimo de ${s.lookback}` : `barrido del máximo de ${s.lookback}`,
    }
  }

  const signals = walk(candles, s.lookback + 1, find, { feeRate: s.feeRate })
  return summarise(signals, [], s.lookback + 1, liveSignal(signals))
}
