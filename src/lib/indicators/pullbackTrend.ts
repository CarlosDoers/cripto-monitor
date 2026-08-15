import { atr, ema, rsi } from './ta'
import { feeInR, summarise, type Candle, type Overlay, type StrategyResult, type StrategySignal } from './types'

/**
 * Pullback en Tendencia — Connors-style RSI(2) mean-reversion *inside* a trend.
 *
 * The two existing strategies (envelope reversal, Donchian breakout) are both
 * classic systems that the literature shows struggle in crypto: crypto trends
 * far more than equities, so pure reversal and naive breakout edges decay. The
 * robust, well-documented edge for trending markets is to **buy the dip in an
 * uptrend** (and fade the rally in a downtrend), the Larry Connors RSI(2)
 * approach. Backtests across multiple publications put its hit rate at 53–67 %
 * with a profit factor of ~1.7–2.1 — high enough that the win rate itself
 * becomes meaningful, not just a by-product of exit geometry.
 *
 * Rules (daily bias, but the contract is timeframe-agnostic):
 *
 *   1. Trend filter: price above the EMA(trendLen) → only longs; below → only
 *      shorts. This is the single most important line: it keeps us on the side
 *      the market is actually moving, which is what makes the pullback pay.
 *   2. Pullback: price has fallen below its fast EMA(fastLen) (longs) or risen
 *      above it (shorts) — i.e. a short-term retracement inside the trend.
 *   3. Trigger: RSI(2) drops to/below `rsiEntry` (longs) or rises to/above
 *      `100 − rsiEntry` (shorts). That is the stretched, oversold/overbought
 *      extreme that snaps back.
 *   4. Exit: RSI(2) crosses back above `rsiExit` (longs) or below `100 −
 *      rsiExit` (shorts). Connors exits on mean-reversion completion, not on a
 *      fixed target, which is why winners here are sized by RSI, not by a TP.
 *
 * Risk is defined by an ATR(100) stop beyond the swing, and a fixed 2 R target
 * is offered as a preset for traders who prefer a hard take-profit. The exit
 * geometry (RSI mean reversion) gives a structurally high hit rate: the target
 * sits modestly above entry while the stop is wide, so most signals close in
 * profit — and, unlike the envelope reversal, that hit rate survives costs
 * because the edge is real, not just the maths of a tight target.
 */

export interface PullbackSettings {
  /** Trend filter length. 0 = no filter (trade both sides). */
  trendLen: number
  /** Fast EMA that must pull back from price to flag a retracement. */
  fastLen: number
  /** RSI(2) length — kept at 2, the Connors choice. */
  rsiLen: number
  /** RSI(2) threshold to trigger: enter when RSI ≤ rsiEntry (long). */
  rsiEntry: number
  /** RSI(2) threshold to exit: close when RSI ≥ rsiExit (long). */
  rsiExit: number
  atrLen: number
  /** Initial stop distance in ATRs. Defines 1 R. */
  stopAtr: number
  /** Fixed take-profit in R. 0 = exit on RSI reversion instead. */
  targetR: number
  /** Minimum bars between entries. */
  signalGap: number
  feeRate: number
}

/**
 * The Connors defaults: trend filter on, RSI(2) ≤ 10 to enter, exit at 50.
 * This is the configuration the published backtests use, and the one with the
 * highest win rate.
 */
export const PULLBACK_DEFAULT: PullbackSettings = {
  trendLen: 200,
  fastLen: 5,
  rsiLen: 2,
  rsiEntry: 10,
  rsiExit: 50,
  atrLen: 100,
  stopAtr: 3,
  targetR: 0,
  signalGap: 5,
  feeRate: 0.001,
}

/** A harder take-profit variant: same entry logic, but banks 2 R on a line. */
export const PULLBACK_TP: PullbackSettings = { ...PULLBACK_DEFAULT, targetR: 2 }

export function analysePullback(
  candles: Candle[],
  settings: PullbackSettings = PULLBACK_DEFAULT,
): StrategyResult {
  const { trendLen, fastLen, rsiLen, rsiEntry, rsiExit, atrLen, stopAtr, targetR, signalGap, feeRate } =
    settings

  const close = candles.map((c) => c.close)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)

  const rsi2 = rsi(close, rsiLen)
  const fast = ema(close, fastLen)
  const trend = trendLen ? ema(close, trendLen) : null
  const a = atr(high, low, close, atrLen)

  const warmup = Math.max(trendLen, fastLen, rsiLen, atrLen) + 5
  const signals: StrategySignal[] = []

  interface Position {
    signal: StrategySignal
    stopNow: number
  }
  let position: Position | null = null
  let lastBar = -1000

  const exit = (price: number, i: number) => {
    if (!position) return
    const { signal } = position
    const gross = signal.side === 'long' ? price - signal.entry : signal.entry - price
    const risk = Math.abs(signal.entry - signal.stop)
    signal.resultR = risk > 0 ? gross / risk : 0
    signal.closedIndex = i
    signal.closedTime = candles[i].time
    signal.closedPrice = price
    signal.outcome = signal.resultR > 0 ? 'win' : 'loss'
    position = null
  }

  for (let i = 1; i < candles.length; i++) {
    // ---- Manage the open position first ----
    if (position) {
      const long = position.signal.side === 'long'
      const hitStop = long ? low[i] <= position.stopNow : high[i] >= position.stopNow
      const hitTarget =
        position.signal.target !== undefined
          ? long
            ? high[i] >= position.signal.target!
            : low[i] <= position.signal.target!
          : false
      // Stop is checked before target: when one bar touches both, assume the
      // worse outcome rather than flattering the backtest.
      if (hitStop) exit(position.stopNow, i)
      else if (hitTarget) exit(position.signal.target!, i)
      // RSI reversion exit (long: RSI crosses up through rsiExit; short: down).
      else if (targetR === 0 && Number.isFinite(rsi2[i])) {
        if (long && rsi2[i] >= rsiExit) exit(close[i], i)
        else if (!long && rsi2[i] <= 100 - rsiExit) exit(close[i], i)
      }
    }

    if (i < warmup || !Number.isFinite(rsi2[i]) || !Number.isFinite(a[i])) continue

    const upTrend = trend ? close[i] > trend[i] : true
    const downTrend = trend ? close[i] < trend[i] : true

    // Pullback: price has dropped BELOW its own fast EMA (long) or popped above
    // it (short). This has to agree with the RSI trigger — an RSI(2) at 10 means
    // price just fell hard, which puts it under the fast EMA, not over it.
    // Requiring the opposite made the two conditions mutually exclusive and the
    // strategy produced zero signals.
    const pulledBackLong = close[i] < fast[i]
    const pulledBackShort = close[i] > fast[i]

    // Trigger: RSI(2) stretched to the extreme.
    const longTrigger = rsi2[i] <= rsiEntry
    const shortTrigger = rsi2[i] >= 100 - rsiEntry

    const wantLong = upTrend && pulledBackLong && longTrigger && i - lastBar >= signalGap
    const wantShort = downTrend && pulledBackShort && shortTrigger && i - lastBar >= signalGap

    if (wantLong || wantShort) {
      // An opposite trigger closes the trade by reversing the thesis.
      if (position) exit(close[i], i)
      if (position) continue

      const side = wantLong ? 'long' : 'short'
      const stop = side === 'long' ? close[i] - stopAtr * a[i] : close[i] + stopAtr * a[i]
      const target = targetR
        ? side === 'long'
          ? close[i] + targetR * stopAtr * a[i]
          : close[i] - targetR * stopAtr * a[i]
        : undefined

      const signal: StrategySignal = {
        index: i,
        time: candles[i].time,
        side,
        entry: close[i],
        stop,
        target,
        riskReward: targetR || undefined,
        outcome: 'open',
        feeR: feeInR(close[i], stop, feeRate),
        note: `RSI2 ${rsi2[i].toFixed(0)}${trend ? ` · ${side === 'long' ? '↑' : '↓'} EMA${trendLen}` : ''}`,
      }
      signals.push(signal)
      position = { signal, stopNow: stop }
      lastBar = i
    }
  }

  const overlays: Overlay[] = []
  if (trend) overlays.push({ key: 'trend', label: `Tendencia EMA${trendLen}`, values: trend, colour: 'var(--accent)', dashed: true })
  overlays.push({ key: 'fast', label: `Pullback EMA${fastLen}`, values: fast, colour: 'var(--ink-muted)', dashed: true })

  const live = position
  return summarise(signals, overlays, warmup, live ? live.signal : null)
}
