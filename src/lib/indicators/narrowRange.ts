import { liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type StrategyResult } from './types'

/**
 * NR7 — Toby Crabel's narrow-range breakout (*Day Trading with Short Term Price
 * Patterns and Opening Range Breakout*, 1990), the textbook way to trade a
 * volatility contraction.
 *
 * A bar whose range is strictly the smallest of the last seven marks a pause;
 * the next bar's break of its high or low is the move. Written as the rule is
 * told, nothing tuned:
 *
 * - two stop orders at the NR7 bar's high and low, live for the next bar only;
 * - a bar that touches both is a loss: whichever side came first, the other end
 *   is the stop. (Skipping those bars looks cautious and is the opposite — it
 *   deletes exactly the trades that are certain −1 R, and turned the true
 *   −0.07 R of the 4 h into +0.32 R on the first run.)
 * - the stop is the opposite end of the NR7 bar, so the narrower the pause the
 *   tighter the risk (and the larger the fee in R, which is what to watch);
 * - out at the close of the third bar counting the entry bar.
 *
 * **Measured** (30 coins since 2022): NR7 −0.07 R on 4 h (23 973 trades) and
 * −0.02 R on the daily (4 116); the inside bar −0.03 R and +0.02 R. Neither
 * clears anything.
 */

export interface NarrowRangeSettings {
  /** The setup bar must be the narrowest of this many, itself included. */
  bars: number
  /** Bars held, the entry bar included. */
  holdBars: number
  feeRate: number
}

export const NARROW_RANGE_SETTINGS: NarrowRangeSettings = { bars: 7, holdBars: 3, feeRate: 0.001 }

/**
 * The two stop orders on a setup bar, as the next bar fills them. When it reaches
 * both levels the side that came first is unknowable, but the outcome is not:
 * the other level is the stop. The side whose level sits nearer the open is taken
 * as the likelier first, and the kit scores the stop on the entry bar.
 */
function breakout(setup: Candle, next: Candle): Pick<Entry, 'side' | 'entry' | 'stop'> | null {
  const up = next.high >= setup.high
  const down = next.low <= setup.low
  if (!up && !down) return null
  const long = up && down ? Math.abs(next.open - setup.high) <= Math.abs(next.open - setup.low) : up
  // A stop order into a gap fills at the open, not at the level.
  return {
    side: long ? 'long' : 'short',
    entry: long ? Math.max(setup.high, next.open) : Math.min(setup.low, next.open),
    stop: long ? setup.low : setup.high,
  }
}

export function analyseNr7(candles: Candle[], s: NarrowRangeSettings = NARROW_RANGE_SETTINGS): StrategyResult {
  const range = candles.map((c) => c.high - c.low)

  /** `j` is the setup bar; the trade, if any, opens inside bar `j + 1`. */
  const find = (j: number): Entry | null => {
    if (j < s.bars || j + 1 >= candles.length) return null
    for (let k = j - s.bars + 1; k < j; k++) if (range[k] <= range[j]) return null

    const entry = breakout(candles[j], candles[j + 1])
    if (!entry) return null
    return {
      index: j + 1,
      ...entry,
      maxBars: s.holdBars - 1,
      intrabar: true,
      note: `NR${s.bars} · rango ${(((candles[j].high - candles[j].low) / candles[j].close) * 100).toFixed(2)} %`,
    }
  }

  const signals = walk(candles, s.bars, find, { feeRate: s.feeRate })
  return summarise(signals, [], s.bars, liveSignal(signals))
}

/** An inside bar is the narrowest pause there is: two bars, the second within the first. */
export function analyseInsideBar(candles: Candle[], s: NarrowRangeSettings = NARROW_RANGE_SETTINGS): StrategyResult {
  const find = (j: number): Entry | null => {
    if (j < 1 || j + 1 >= candles.length) return null
    const setup = candles[j]
    const mother = candles[j - 1]
    if (!(setup.high < mother.high && setup.low > mother.low)) return null

    const entry = breakout(setup, candles[j + 1])
    if (!entry) return null
    return { index: j + 1, ...entry, maxBars: s.holdBars - 1, intrabar: true, note: 'barra interior' }
  }
  const signals = walk(candles, 1, find, { feeRate: s.feeRate })
  return summarise(signals, [], 2, liveSignal(signals))
}
