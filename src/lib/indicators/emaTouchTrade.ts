import { atr, ema } from './ta'
import { analyseSmc } from './smc'
import { feeInR, summarise, type Candle, type StrategyResult, type StrategySignal } from './types'

/**
 * A touch of the daily EMA 25, traded the way the user trades it — so it can
 * be measured instead of assumed.
 *
 * The rules, written before measuring:
 *   · signal   the first candle of a touch (its range contains that day's EMA,
 *              the candle before did not) that **holds**: it closes on the side
 *              it came from
 *   · side     from above, long — the EMA as support; from below, short
 *   · entry    that candle's close
 *   · stop     the wick that tested the EMA: the candle's low for a long, its
 *              high for a short. Defines 1 R
 *   · exit     a fixed 2 R target
 *
 * The variants change one thing each: the stop at 1 ATR beyond the EMA, the
 * exit on a daily close back across the EMA, or requiring the confirmations —
 * internal SMC structure in favour and the touch candle's volume ≥ 1.5× its
 * 20-day mean. `npm run ematouch` already found those confirmations add nothing
 * to whether price respects the line; this asks whether any of it pays.
 *
 * Entry is at a close, so nothing of the entry bar is left to resolve; exits
 * are checked from the next bar, stop before target. One position at a time.
 */

export interface EmaTouchTradeSettings {
  length: number
  /** 'wick' = the touch candle's extreme; a number = that many ATRs beyond the EMA. */
  stop: 'wick' | number
  /** 'target' = fixed `targetR`; 'ema' = a close back across the EMA. */
  exit: 'target' | 'ema'
  targetR: number
  /** Require internal structure in favour and high volume on the touch. */
  confirmed: boolean
  highVolume: number
  feeRate: number
}

export const EMA_TOUCH_TRADE: EmaTouchTradeSettings = {
  length: 25,
  stop: 'wick',
  exit: 'target',
  targetR: 2,
  confirmed: false,
  highVolume: 1.5,
  feeRate: 0.001,
}

const VOL_LOOKBACK = 20

export function analyseEmaTouchTrade(
  candles: Candle[],
  settings: EmaTouchTradeSettings = EMA_TOUCH_TRADE,
): StrategyResult {
  const { length, stop: stopRule, exit, targetR, confirmed, highVolume, feeRate } = settings
  const close = candles.map((c) => c.close)
  const line = ema(close, length)
  const a = atr(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    close,
    14,
  )
  const trend = confirmed ? analyseSmc(candles).internalTrendSeries : []
  const warmup = Math.max(length * 3, VOL_LOOKBACK + 1)

  const signals: StrategySignal[] = []
  let open: { signal: StrategySignal; risk: number } | null = null

  const touching = (i: number) => candles[i].low <= line[i] && line[i] <= candles[i].high

  const close_ = (price: number, i: number) => {
    if (!open) return
    const { signal, risk } = open
    signal.resultR = (signal.side === 'long' ? price - signal.entry : signal.entry - price) / risk
    signal.outcome = signal.resultR > 0 ? 'win' : 'loss'
    signal.closedIndex = i
    signal.closedTime = candles[i].time
    signal.closedPrice = price
    open = null
  }

  for (let i = 1; i < candles.length; i++) {
    const bar = candles[i]

    if (open) {
      const s = open.signal
      const long = s.side === 'long'
      if (long ? bar.low <= s.stop : bar.high >= s.stop) close_(s.stop, i)
      else if (s.target !== undefined && (long ? bar.high >= s.target : bar.low <= s.target)) close_(s.target, i)
      else if (exit === 'ema' && (long ? bar.close < line[i] : bar.close > line[i])) close_(bar.close, i)
    }
    if (open || i < warmup) continue
    if (!Number.isFinite(line[i]) || !Number.isFinite(line[i - 1]) || !(a[i] > 0)) continue
    if (!touching(i) || touching(i - 1)) continue

    const fromAbove = candles[i - 1].close > line[i - 1]
    const held = fromAbove ? bar.close > line[i] : bar.close < line[i]
    if (!held) continue

    if (confirmed) {
      const dir = fromAbove ? 1 : -1
      if (trend[i - 1] !== dir) continue
      let sum = 0
      for (let k = i - VOL_LOOKBACK; k < i; k++) sum += candles[k].vol ?? NaN
      const ratio = (bar.vol ?? NaN) / (sum / VOL_LOOKBACK)
      if (!(ratio >= highVolume)) continue
    }

    const side = fromAbove ? 'long' : 'short'
    const entry = bar.close
    const stop =
      stopRule === 'wick'
        ? fromAbove
          ? bar.low
          : bar.high
        : fromAbove
          ? line[i] - stopRule * a[i]
          : line[i] + stopRule * a[i]
    const risk: number = fromAbove ? entry - stop : stop - entry
    // A stop so close that the round trip costs more than 1 R cannot be traded.
    if (!(risk > 0) || feeInR(entry, stop, feeRate) > 1) continue

    const signal: StrategySignal = {
      index: i,
      time: bar.time,
      side,
      entry,
      stop,
      target: exit === 'target' ? (fromAbove ? entry + targetR * risk : entry - targetR * risk) : undefined,
      riskReward: exit === 'target' ? targetR : undefined,
      outcome: 'open',
      feeR: feeInR(entry, stop, feeRate),
      note: `toque EMA ${length} desde ${fromAbove ? 'arriba' : 'abajo'}`,
    }
    signals.push(signal)
    open = { signal, risk }
  }

  const live = open as { signal: StrategySignal } | null
  return summarise(signals, [], warmup, live ? live.signal : null)
}

/** Variant 1: the stop at 1 ATR beyond the EMA instead of the wick. */
export const analyseEmaTouchAtrStop = (c: Candle[]) =>
  analyseEmaTouchTrade(c, { ...EMA_TOUCH_TRADE, stop: 1 })

/** Variant 2: out on a daily close back across the EMA instead of at 2 R. */
export const analyseEmaTouchEmaExit = (c: Candle[]) =>
  analyseEmaTouchTrade(c, { ...EMA_TOUCH_TRADE, exit: 'ema' })

/** Variant 3: only with structure in favour and high volume on the touch. */
export const analyseEmaTouchConfirmed = (c: Candle[]) =>
  analyseEmaTouchTrade(c, { ...EMA_TOUCH_TRADE, confirmed: true })
