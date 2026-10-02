import { highest, lowest } from './ta'
import { feeInR, summarise, type Candle, type StrategyResult, type StrategySignal } from './types'

/**
 * %R Trend Exhaustion [upslidedown], v2.3 — TradingView, ported for measurement.
 *
 * Two Williams %R, a fast one (21 bars, EMA 7) and a slow one (112 bars,
 * EMA 3). Both above −20 is "overbought"; both below −80 is "oversold". The
 * indicator draws a box over the price range while the condition lasts and a
 * triangle on the bar it ends. Its own strategy menu defaults to "3 Reversal
 * Trade @ Triangle": short when an overbought spell ends, long when an
 * oversold one does.
 *
 * **The indicator has no exit.** It sends entries to an external backtester
 * (TTS) and leaves stop and target to whoever configures it. So the exits here
 * are a choice, not a port: the stop is the far side of the box the indicator
 * itself draws (the extreme of the spell just ended), and the trade closes on
 * the stop or on the indicator's next opposite triangle. The variants change
 * only that.
 */

export interface PercentRSettings {
  fastLen: number
  fastSmooth: number
  slowLen: number
  slowSmooth: number
  threshold: number
  /** 'reversal' = strategy 3, 'reenter' = strategy 4 (the mirror). */
  mode: 'reversal' | 'reenter'
  /** Fixed target in R. 0 = hold until the opposite triangle. */
  targetR: number
  feeRate: number
}

export const PERCENT_R_SETTINGS: PercentRSettings = {
  fastLen: 21,
  fastSmooth: 7,
  slowLen: 112,
  slowSmooth: 3,
  threshold: 20,
  mode: 'reversal',
  targetR: 0,
  feeRate: 0.001,
}

/** `ta.ema` over a series with a leading run of NaN, as Pine handles `na`. */
function emaFrom(values: number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  const start = values.findIndex(Number.isFinite)
  if (start < 0 || values.length - start < length) return out
  const alpha = 2 / (length + 1)
  let seed = 0
  for (let i = start; i < start + length; i++) seed += values[i]
  out[start + length - 1] = seed / length
  for (let i = start + length; i < values.length; i++) {
    out[i] = alpha * values[i] + (1 - alpha) * out[i - 1]
  }
  return out
}

/** `100 * (close - highest(high)) / (highest(high) - lowest(low))` */
function percentR(candles: Candle[], length: number): number[] {
  const hi = highest(candles.map((c) => c.high), length)
  const lo = lowest(candles.map((c) => c.low), length)
  return candles.map((c, i) => (hi[i] > lo[i] ? (100 * (c.close - hi[i])) / (hi[i] - lo[i]) : NaN))
}

export function analysePercentR(
  candles: Candle[],
  settings: PercentRSettings = PERCENT_R_SETTINGS,
): StrategyResult {
  const { fastLen, fastSmooth, slowLen, slowSmooth, threshold, mode, targetR, feeRate } = settings
  const fast = fastSmooth > 1 ? emaFrom(percentR(candles, fastLen), fastSmooth) : percentR(candles, fastLen)
  const slow = slowSmooth > 1 ? emaFrom(percentR(candles, slowLen), slowSmooth) : percentR(candles, slowLen)
  const warmup = slowLen + slowSmooth + 5

  const signals: StrategySignal[] = []
  let open: { signal: StrategySignal; risk: number } | null = null

  // The boxes: the price range of the spell in progress, excluding the bar
  // that ends it, exactly as the Pine freezes them.
  let obTop = NaN
  let obBottom = NaN
  let osTop = NaN
  let osBottom = NaN
  let wasOb = false
  let wasOs = false

  const close = (price: number, i: number) => {
    if (!open) return
    const { signal, risk } = open
    const gross = signal.side === 'long' ? price - signal.entry : signal.entry - price
    signal.resultR = gross / risk
    signal.outcome = signal.resultR > 0 ? 'win' : 'loss'
    signal.closedIndex = i
    signal.closedTime = candles[i].time
    signal.closedPrice = price
    open = null
  }

  for (let i = 1; i < candles.length; i++) {
    const bar = candles[i]

    // Manage first, against this bar's range. Stop before target.
    if (open) {
      const s = open.signal
      const long = s.side === 'long'
      if (long ? bar.low <= s.stop : bar.high >= s.stop) close(s.stop, i)
      else if (s.target && (long ? bar.high >= s.target : bar.low <= s.target)) close(s.target, i)
    }

    if (!Number.isFinite(fast[i]) || !Number.isFinite(slow[i])) continue
    const ob = fast[i] >= -threshold && slow[i] >= -threshold
    const os = fast[i] <= -100 + threshold && slow[i] <= -100 + threshold
    const obEnd = !ob && wasOb
    const osEnd = !os && wasOs

    let side: 'long' | 'short' | null = null
    let stop = NaN
    if (i >= warmup) {
      // Strategy 3 fades the spell that ended; strategy 4 rejoins it.
      if (obEnd) {
        side = mode === 'reversal' ? 'short' : 'long'
        stop = mode === 'reversal' ? obTop : obBottom
      } else if (osEnd) {
        side = mode === 'reversal' ? 'long' : 'short'
        stop = mode === 'reversal' ? osBottom : osTop
      }
    }

    // Box bookkeeping, after the end-of-spell read above.
    if (ob && !wasOb) {
      obTop = bar.high
      obBottom = bar.low
    } else if (ob) {
      obTop = Math.max(obTop, bar.high)
      obBottom = Math.min(obBottom, bar.low)
    }
    if (os && !wasOs) {
      osTop = bar.high
      osBottom = bar.low
    } else if (os) {
      osTop = Math.max(osTop, bar.high)
      osBottom = Math.min(osBottom, bar.low)
    }
    wasOb = ob
    wasOs = os

    if (!side) continue
    // The opposite triangle ends the trade in progress.
    if (open && open.signal.side !== side) close(bar.close, i)
    if (open) continue

    const entry = bar.close
    const risk: number = side === 'long' ? entry - stop : stop - entry
    if (!(risk > 0)) continue

    const signal: StrategySignal = {
      index: i,
      time: bar.time,
      side,
      entry,
      stop,
      target: targetR ? (side === 'long' ? entry + targetR * risk : entry - targetR * risk) : undefined,
      riskReward: targetR || undefined,
      outcome: 'open',
      feeR: feeInR(entry, stop, feeRate),
      note: side === 'long' ? 'fin de sobreventa' : 'fin de sobrecompra',
    }
    signals.push(signal)
    open = { signal, risk }
  }

  const live = open as { signal: StrategySignal } | null
  return summarise(signals, [], warmup, live ? live.signal : null)
}

/** Variant 1: same entries and stop, a fixed 2 R target. */
export function analysePercentRTarget(candles: Candle[]): StrategyResult {
  return analysePercentR(candles, { ...PERCENT_R_SETTINGS, targetR: 2 })
}

/** Variant 2: the indicator's own strategy 4 — rejoin the trend at the triangle. */
export function analysePercentRReenter(candles: Candle[]): StrategyResult {
  return analysePercentR(candles, { ...PERCENT_R_SETTINGS, mode: 'reenter' })
}
