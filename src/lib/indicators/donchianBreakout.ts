import { atr, ema, highest, lowest } from './ta'
import { feeInR, summarise, type Candle, type Overlay, type StrategyResult, type StrategySignal } from './types'

/**
 * Donchian channel breakout — the Turtle system, in its classic form.
 *
 * Enter when price closes beyond the highest high (or lowest low) of the last N
 * bars; ride it with a wide chandelier trailing stop. Time-series momentum is
 * one of the best-documented anomalies in markets, and the evidence is stronger
 * in crypto than in most asset classes.
 *
 * **The exit is the strategy.** A narrow trail destroys it: on the same data,
 * trailing at 3.5 ATR yields −0.19 R per trade while 8 ATR yields +0.91 R. Win
 * rate stays around 40 % either way — the difference is entirely in how far the
 * winners are allowed to run. Do not "tighten it up" without re-running the
 * backtest.
 *
 * Deliberately complementary to the reversal indicator: one needs trends, the
 * other needs chop, and they rarely suffer at the same time.
 */

export interface DonchianSettings {
  /** Lookback for the breakout level. */
  channelLen: number
  atrLen: number
  /** Initial stop distance, in ATRs. Defines 1 R. */
  stopAtr: number
  /** Chandelier trail distance from the best price reached, in ATRs. 0 = off. */
  trailAtr: number
  /** Fixed target in R. 0 = ride the trail instead. */
  targetR: number
  /** Only take breakouts aligned with this EMA. 0 = no filter. */
  trendLen: number
  feeRate: number
}

export const DONCHIAN_SETTINGS: DonchianSettings = {
  channelLen: 20,
  atrLen: 14,
  stopAtr: 3,
  trailAtr: 8,
  targetR: 0,
  trendLen: 0,
  feeRate: 0.001,
}

/** Slower variant: fewer, longer trades. */
export const DONCHIAN_SLOW: DonchianSettings = { ...DONCHIAN_SETTINGS, channelLen: 55 }

/**
 * Higher hit rate, smaller edge. A 55-bar breakout filtered by the EMA(200),
 * with a tight stop and a fixed 1.5 R target instead of a trail.
 *
 * On four years of daily BTC/ETH/SOL this lifts the hit rate from ~40 % to 53 %
 * while expectancy drops from ~0.47 R to 0.31 R — the classic trade. It is
 * offered because a higher hit rate is easier to sit through, not because it
 * makes more money. **Daily only**: on shorter timeframes it is negative.
 */
export const DONCHIAN_ACCURATE: DonchianSettings = {
  ...DONCHIAN_SETTINGS,
  channelLen: 55,
  stopAtr: 1.5,
  trailAtr: 0,
  targetR: 1.5,
  trendLen: 200,
}

export function analyseDonchian(
  candles: Candle[],
  settings: DonchianSettings = DONCHIAN_SETTINGS,
): StrategyResult {
  const { channelLen, atrLen, stopAtr, trailAtr, targetR, trendLen, feeRate } = settings

  const close = candles.map((c) => c.close)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)

  const a = atr(high, low, close, atrLen)
  const upper = highest(high, channelLen)
  const lower = lowest(low, channelLen)
  const trend = trendLen ? ema(close, trendLen) : null

  const warmup = Math.max(channelLen, atrLen, trendLen) + 20
  const signals: StrategySignal[] = []

  /** Tracks the live trade; `signal` is the same object stored in `signals`. */
  interface Position {
    signal: StrategySignal
    risk: number
    /** Best price reached since entry — what the chandelier trails from. */
    peak: number
    stopNow: number
  }
  let position: Position | null = null

  const exit = (price: number, i: number) => {
    if (!position) return
    const { signal, risk } = position
    const gross = signal.side === 'long' ? price - signal.entry : signal.entry - price
    signal.resultR = gross / risk
    signal.outcome = signal.resultR > 0 ? 'win' : 'loss'
    signal.closedIndex = i
    signal.closedTime = candles[i].time
    signal.closedPrice = price
    position = null
  }

  for (let i = 1; i < candles.length; i++) {
    // ---- Manage the open position first ----
    if (position) {
      const { signal: sig } = position
      const long = sig.side === 'long'
      // Stop is checked before target: when one bar touches both, assume the
      // worse outcome rather than flattering the backtest.
      const hitStop = long ? low[i] <= position.stopNow : high[i] >= position.stopNow
      const hitTarget = sig.target
        ? long ? high[i] >= sig.target : low[i] <= sig.target
        : false

      if (hitStop) exit(position.stopNow, i)
      else if (hitTarget) exit(sig.target!, i)
      else if (trailAtr) {
        if (long) {
          position.peak = Math.max(position.peak, high[i])
          position.stopNow = Math.max(position.stopNow, position.peak - trailAtr * a[i])
        } else {
          position.peak = Math.min(position.peak, low[i])
          position.stopNow = Math.min(position.stopNow, position.peak + trailAtr * a[i])
        }
      }
    }

    if (i < warmup || !Number.isFinite(a[i]) || !Number.isFinite(upper[i - 1])) continue

    // ---- Look for a breakout of the previous bar's channel ----
    // With a trend filter, only breakouts going the same way as the EMA count.
    const aligned = trend ? { up: close[i] > trend[i], down: close[i] < trend[i] } : { up: true, down: true }
    const long = close[i] > upper[i - 1] && aligned.up
    const short = close[i] < lower[i - 1] && aligned.down
    if (!long && !short) continue

    // A breakout the other way ends the trade even if the trail was not hit:
    // the trend that justified the position has reversed.
    if (position) {
      const opposite = position.signal.side === 'long' ? short : long
      if (opposite) exit(close[i], i)
    }
    if (position) continue

    const side = long ? 'long' : 'short'
    const stop = long ? close[i] - stopAtr * a[i] : close[i] + stopAtr * a[i]
    const risk = Math.abs(close[i] - stop)
    if (risk <= 0) continue

    const signal: StrategySignal = {
      index: i,
      time: candles[i].time,
      side,
      entry: close[i],
      stop,
      target: targetR ? (long ? close[i] + targetR * risk : close[i] - targetR * risk) : undefined,
      riskReward: targetR || undefined,
      outcome: 'open',
      feeR: feeInR(close[i], stop, feeRate),
      note: `ruptura de ${channelLen}${trendLen ? ` · EMA${trendLen}` : ''}`,
    }
    signals.push(signal)
    position = { signal, risk, peak: long ? high[i] : low[i], stopNow: stop }
  }

  const overlays: Overlay[] = [
    { key: 'upper', label: `Máximo ${channelLen}`, values: upper, colour: 'var(--good)' },
    { key: 'lower', label: `Mínimo ${channelLen}`, values: lower, colour: 'var(--critical)', fillTo: 'upper' },
  ]

  const live: Position | null = position
  return summarise(signals, overlays, warmup, live ? live.signal : null)
}
