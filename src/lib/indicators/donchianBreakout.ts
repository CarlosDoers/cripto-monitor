import { atr, highest, lowest } from './ta'
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
  /** Chandelier trail distance from the best price reached, in ATRs. */
  trailAtr: number
  feeRate: number
}

export const DONCHIAN_SETTINGS: DonchianSettings = {
  channelLen: 20,
  atrLen: 14,
  stopAtr: 3,
  trailAtr: 8,
  feeRate: 0.001,
}

/** Slower variant: fewer, longer trades. */
const DONCHIAN_SLOW: DonchianSettings = { ...DONCHIAN_SETTINGS, channelLen: 55 }

export const DONCHIAN_PRESETS = [
  { key: 'fast', label: 'Rápida (20)', settings: DONCHIAN_SETTINGS },
  { key: 'slow', label: 'Lenta (55)', settings: DONCHIAN_SLOW },
]

export function analyseDonchian(
  candles: Candle[],
  settings: DonchianSettings = DONCHIAN_SETTINGS,
): StrategyResult {
  const { channelLen, atrLen, stopAtr, trailAtr, feeRate } = settings

  const close = candles.map((c) => c.close)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)

  const a = atr(high, low, close, atrLen)
  const upper = highest(high, channelLen)
  const lower = lowest(low, channelLen)

  const warmup = Math.max(channelLen, atrLen) + 20
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
      if (position.signal.side === 'long') {
        position.peak = Math.max(position.peak, high[i])
        position.stopNow = Math.max(position.stopNow, position.peak - trailAtr * a[i])
        if (low[i] <= position.stopNow) exit(position.stopNow, i)
      } else {
        position.peak = Math.min(position.peak, low[i])
        position.stopNow = Math.min(position.stopNow, position.peak + trailAtr * a[i])
        if (high[i] >= position.stopNow) exit(position.stopNow, i)
      }
    }

    if (i < warmup || !Number.isFinite(a[i]) || !Number.isFinite(upper[i - 1])) continue

    // ---- Look for a breakout of the previous bar's channel ----
    const long = close[i] > upper[i - 1]
    const short = close[i] < lower[i - 1]
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
      outcome: 'open',
      feeR: feeInR(close[i], stop, feeRate),
      note: `ruptura de ${channelLen}`,
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
