import { atr, ema } from './ta'
import { resolveTrade } from './tradeKit'
import { summarise, feeInR, type Candle, type StrategyResult, type StrategySignal } from './types'

/**
 * Fair Value Gap fill — the entry ICT teaches and half of crypto Twitter
 * repeats. Three candles where the third does not overlap the first leave an
 * imbalance; price is said to come back for it.
 *
 * Written as it is usually taught, nothing tuned:
 *
 * - a bullish gap: the low of a bar is above the high of the bar two before it,
 *   the bar between them closed up, and the gap is at least half an ATR (smaller
 *   ones are noise);
 * - a limit order at the middle of the gap (the "consequent encroachment"),
 *   live for 20 bars, cancelled if a bar closes through the gap first — and only
 *   one order at a time: a newer gap replaces the pending one;
 * - the stop is the low of the bar that started the move, the target 2 R, and a
 *   trade that has done neither in 30 bars is closed at that close;
 * - the fill bar is resolved like any entry bar, stop before target;
 * - bearish gaps are the mirror image.
 *
 * **Measured** (30 coins, OKX daily, since 2022): +0.109 R over 866 trades (halves
 * +0.11 / +0.09), and +0.07 R over 296 on 2018–2021, which no earlier measurement
 * had seen. All 18 neighbouring settings (entry depth, minimum gap, target,
 * order life, one at a time) are positive in both periods, and the gap is worth
 * +0.14 R (3.2σ) and +0.17 R (2.0σ) over a control with the same orders at
 * random dates and sides. Still not shippable: the monthly 95 % interval is
 * [−0.03, +0.24], the first calendar half is +0.01, +0.11 is under
 * `MIN_TRADABLE_R`, and the replication on 2018–21 is thin — +0.07 R (PSR 81 %),
 * with 2018 −0.13, 2019 0.00, 2020 −0.03 and 2021 +0.26, and longs and shorts
 * swapping places between the periods (2018–21 longs +0.29 / shorts −0.27;
 * 2022–26 +0.04 / +0.20). 4 h is +0.02 R. ICT's own remedy — trade a gap only
 * with the trend (`trendLen`) — does not fix it: EMA 50 / 100 / 200 measure
 * +0.12 / +0.15 / +0.09 on 2022–26 and +0.10 / +0.10 / −0.03 on 2018–21.
 *
 * Two simulation rules decide that number. A limit order against the move is not
 * credited its target on the fill bar (`limitFill` in the kit: the bar's high may
 * have come before the fill) — without it the same code measured +0.14 R and, on
 * 2018–21, +0.14 R where it is +0.07. And a fill that needs price to trade 0.2 %
 * through the level measures +0.08 R: touching a limit is not filling it.
 */

export interface FvgSettings {
  /** Where in the gap the limit sits, from its near edge (0) to its far edge (1): 0.5 is the middle. */
  entryDepth: number
  /**
   * How far price must trade *through* the limit, as a share of the price, before
   * it counts as filled. 0 is the usual backtest — filled the moment it is
   * touched — which flatters a limit order: queues exist.
   */
  penetration: number
  /** Trade only with the trend: bullish gaps above this EMA, bearish ones below. 0 = off. */
  trendLen: number
  minGapAtr: number
  fillWindow: number
  targetR: number
  maxBars: number
  feeRate: number
}

export const FVG_SETTINGS: FvgSettings = { entryDepth: 0.5, penetration: 0, trendLen: 0, minGapAtr: 0.5, fillWindow: 20, targetR: 2, maxBars: 30, feeRate: 0.001 }

interface Pending {
  side: 'long' | 'short'
  entry: number
  stop: number
  target: number
  /** The gap's far edge: a close beyond it cancels the order. */
  edge: number
  expires: number
}

export function analyseFvg(candles: Candle[], s: FvgSettings = FVG_SETTINGS): StrategyResult {
  const n = candles.length
  const unit = atr(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    candles.map((c) => c.close),
    14,
  )
  const trend = s.trendLen ? ema(candles.map((c) => c.close), s.trendLen) : null
  const warmup = Math.max(20, s.trendLen)
  const signals: StrategySignal[] = []
  let pending: Pending | null = null

  let i = warmup
  while (i < n) {
    const b = candles[i]
    if (pending) {
      const long = pending.side === 'long'
      if (long ? b.low <= pending.entry * (1 - s.penetration) : b.high >= pending.entry * (1 + s.penetration)) {
        // Filled at the level, no price improvement assumed.
        const risk = Math.abs(pending.entry - pending.stop)
        if (risk > 0 && feeInR(pending.entry, pending.stop, s.feeRate) <= 1) {
          const signal = resolveTrade(
            candles,
            {
              index: i,
              side: pending.side,
              entry: pending.entry,
              stop: pending.stop,
              target: pending.target,
              maxBars: s.maxBars,
              intrabar: true,
              limitFill: true,
              note: 'relleno del hueco de valor justo',
            },
            { feeRate: s.feeRate },
          )
          signals.push(signal)
          pending = null
          if (signal.outcome === 'open') break
          i = (signal.closedIndex ?? i) + 1
          continue
        }
        pending = null
      } else if (i > pending.expires || (long ? b.close < pending.edge : b.close > pending.edge)) {
        pending = null
      }
    }

    // A gap that closes on this bar becomes tomorrow's order.
    if (i >= 2 && unit[i - 1] > 0) {
      const first = candles[i - 2]
      const middle = candles[i - 1]
      const gapUp = b.low - first.high
      const gapDown = first.low - b.high
      const withTrend = (up: boolean) => !trend || (up ? b.close > trend[i] : b.close < trend[i])
      if (gapUp >= s.minGapAtr * unit[i - 1] && middle.close > middle.open && withTrend(true)) {
        const entry = b.low - s.entryDepth * gapUp
        const risk = entry - first.low
        pending = { side: 'long', entry, stop: first.low, target: entry + s.targetR * risk, edge: first.high, expires: i + s.fillWindow }
      } else if (gapDown >= s.minGapAtr * unit[i - 1] && middle.close < middle.open && withTrend(false)) {
        const entry = b.high + s.entryDepth * gapDown
        const risk = first.high - entry
        pending = { side: 'short', entry, stop: first.high, target: entry - s.targetR * risk, edge: first.low, expires: i + s.fillWindow }
      }
    }
    i++
  }

  const last = signals[signals.length - 1]
  return summarise(signals, [], warmup, last && last.outcome === 'open' ? last : null)
}

// The neighbourhood, one parameter at a time around the headline (`npm run try`).
export const analyseFvgDepth25 = (c: Candle[]) => analyseFvg(c, { ...FVG_SETTINGS, entryDepth: 0.25 })
export const analyseFvgDepth75 = (c: Candle[]) => analyseFvg(c, { ...FVG_SETTINGS, entryDepth: 0.75 })
export const analyseFvgGap025 = (c: Candle[]) => analyseFvg(c, { ...FVG_SETTINGS, minGapAtr: 0.25 })
export const analyseFvgGap100 = (c: Candle[]) => analyseFvg(c, { ...FVG_SETTINGS, minGapAtr: 1 })
export const analyseFvgTarget15 = (c: Candle[]) => analyseFvg(c, { ...FVG_SETTINGS, targetR: 1.5 })
export const analyseFvgTarget3 = (c: Candle[]) => analyseFvg(c, { ...FVG_SETTINGS, targetR: 3 })
export const analyseFvgWindow10 = (c: Candle[]) => analyseFvg(c, { ...FVG_SETTINGS, fillWindow: 10 })
export const analyseFvgWindow40 = (c: Candle[]) => analyseFvg(c, { ...FVG_SETTINGS, fillWindow: 40 })
export const analyseFvgTradeThrough = (c: Candle[]) => analyseFvg(c, { ...FVG_SETTINGS, penetration: 0.002 })

// With the trend: ICT's rule that a gap is only worth trading in the direction of the bias.
export const analyseFvgTrend50 = (c: Candle[]) => analyseFvg(c, { ...FVG_SETTINGS, trendLen: 50 })
export const analyseFvgTrend100 = (c: Candle[]) => analyseFvg(c, { ...FVG_SETTINGS, trendLen: 100 })
export const analyseFvgTrend200 = (c: Candle[]) => analyseFvg(c, { ...FVG_SETTINGS, trendLen: 200 })
