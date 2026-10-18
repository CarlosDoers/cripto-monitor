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

/**
 * The stop is 2 ATR, not 3. Measured on daily BTC/ETH/SOL this is +0.75 R per
 * trade against +0.50 R at 3 ATR, and it improves on every instrument
 * individually (BTC 0.13→0.24, ETH 0.16→0.31, SOL 1.25→1.80) as well as on the
 * out-of-sample half (0.19→0.34). A tighter stop cuts losers sooner without
 * touching the trail that lets the winners run.
 */
export const DONCHIAN_SETTINGS: DonchianSettings = {
  channelLen: 20,
  atrLen: 14,
  stopAtr: 2,
  trailAtr: 8,
  targetR: 0,
  trendLen: 0,
  feeRate: 0.001,
}

/**
 * The same breakout with a trend filter: long only above the EMA 200, short
 * only below it. The `trendLen` setting was already here (the old EMA 100 preset
 * failed on BTC, ETH and SOL daily); on 4 h over 30 coins it is the better way
 * to take the same breakouts. Entries wait for three lengths of history, like
 * every EMA the app draws, so the average has settled before it decides anything.
 */
export const DONCHIAN_TREND_SETTINGS: DonchianSettings = { ...DONCHIAN_SETTINGS, trendLen: 200 }

/**
 * What a long that arrives LATE is worth: the rule's own trade, entered `from`–`to` bars after its signal at that bar's close,
 * with the stop in force then and the trade's own exit, in R of the late entrant's own risk. One entry per trade, at the
 * bucket's first bar. `npm run late` measures it and `npm run late check` fails when these drift.
 */
export interface LateBucket {
  /** Ages, in bars of the strategy's timeframe, that the bucket stands for; `from` is the bar it was measured at. */
  from: number
  to: number
  n: number
  net: number
  halves: [number, number]
  withoutBest10: number
  /** Median distance from that late entry to its stop, as a share of the price: the stop of a late entrant is far. */
  riskPct: number
  /** 95 % by months (a random draw: not checked). */
  interval: [number, number]
}

/**
 * What `npm run ideas trend` measures for that preset — the figures the preset's
 * note and the Screener's help quote, and the ones that script checks and fails
 * on when they drift. Net R per trade after a 0.1 % round trip.
 */
export const DONCHIAN_TREND_EVIDENCE = {
  /** 30 coins, 4 h, 2022–2026. */
  board: {
    n: 3287,
    net: 0.36,
    halves: [0.48, 0.26] as [number, number],
    /** The same breakouts without the filter. */
    plain: 0.21,
    longs: 0.61,
    shorts: 0.12,
    /** Without its ten best trades; the trend followers live on a few. */
    withoutBest10: 0.19,
  },
  /**
   * Entering late, longs on 4 h over the 30 coins, 2022–2026 (`npm run late`). Every bucket clears the bar (≥ +0.1 R in both
   * halves), none has an interval clear of zero, and from three days on the mean without the ten best is zero or less.
   */
  late: {
    sample: '30 criptos, 4 h, 2022–2026, solo longs',
    buckets: [
      { from: 1, to: 6, n: 1547, net: 0.46, halves: [0.8, 0.12], withoutBest10: 0.13, riskPct: 0.044, interval: [-0.09, 1.13] },
      { from: 7, to: 18, n: 1175, net: 0.34, halves: [0.37, 0.32], withoutBest10: 0.0, riskPct: 0.057, interval: [-0.15, 0.89] },
      { from: 19, to: 42, n: 773, net: 0.15, halves: [0.18, 0.13], withoutBest10: -0.08, riskPct: 0.087, interval: [-0.18, 0.6] },
      { from: 43, to: 90, n: 490, net: 0.14, halves: [0.15, 0.13], withoutBest10: -0.06, riskPct: 0.117, interval: [-0.15, 0.58] },
    ] as LateBucket[],
  },
  /** The same rule on 14 coins in 2018–2021, a period nothing was tuned on. */
  old: { n: 1009, net: 1.07, plain: 0.46 },
  /** The same preset on 1 h over the 30 coins, 2022–2026: marginal, and it does not take twice the fee. */
  hourly: {
    n: 14892,
    net: 0.13,
    halves: [0.15, 0.11] as [number, number],
    plain: 0.02,
    doubleFee: 0.08,
    longs: 0.26,
    shorts: 0.01,
    withoutBest10: 0.08,
  },
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

  // An EMA carries its SMA seed for a long time; three lengths leave nothing of it.
  const warmup = Math.max(channelLen, atrLen, trendLen * 3) + 20
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
  // The filter is drawn, but off the price scale: a trend can run far above its
  // average, and an EMA 200 on the scale would flatten every candle.
  if (trend) overlays.push({ key: 'trend', label: `EMA ${trendLen}`, values: trend, colour: 'var(--series-2)', context: true })

  const live: Position | null = position
  // The trail has moved since the entry: say where the stop stands now.
  if (live && trailAtr) live.signal.stopNow = live.stopNow
  return summarise(signals, overlays, warmup, live ? live.signal : null)
}
