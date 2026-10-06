import { atr } from './ta'
import { liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type StrategyResult } from './types'

/**
 * UT Bot Alerts (Yo_adriiiiaan, cleaned by QuantNomad) — one of the most used
 * buy/sell scripts on TradingView. An ATR trailing line follows price at
 * `key × ATR(10)`; a close through the line flips it, and the flip is the signal.
 *
 * Written as published (key 1, ATR 10, closes only): the line at the flip is the
 * stop and keeps trailing while the trade runs, and an opposite flip closes it
 * and is the next signal. With a trail of one ATR this is the tight-trail trend
 * follower the Donchian notes warn about — it is here to put a number on it.
 *
 * **Measured** (30 coins since 2022): +0.04 R on 4 h (16 366 trades), +0.02 R on the
 * daily at the UTC close and +0.07 R at OKX's.
 */

export interface UtBotSettings {
  key: number
  atrLen: number
  feeRate: number
}

export const UT_BOT_SETTINGS: UtBotSettings = { key: 1, atrLen: 10, feeRate: 0.001 }

export function analyseUtBot(candles: Candle[], s: UtBotSettings = UT_BOT_SETTINGS): StrategyResult {
  const n = candles.length
  const close = candles.map((c) => c.close)
  const unit = atr(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    close,
    s.atrLen,
  )

  // The trailing line, exactly as the script builds it (it starts from 0).
  const line = new Array<number>(n).fill(NaN)
  for (let i = 1; i < n; i++) {
    if (!(unit[i] > 0)) continue
    const loss = s.key * unit[i]
    const prev = Number.isFinite(line[i - 1]) ? line[i - 1] : 0
    if (close[i] > prev && close[i - 1] > prev) line[i] = Math.max(prev, close[i] - loss)
    else if (close[i] < prev && close[i - 1] < prev) line[i] = Math.min(prev, close[i] + loss)
    else line[i] = close[i] > prev ? close[i] - loss : close[i] + loss
  }

  const buy = (i: number) => close[i] > line[i] && close[i - 1] <= line[i - 1]
  const sell = (i: number) => close[i] < line[i] && close[i - 1] >= line[i - 1]

  const warmup = s.atrLen + 5
  const find = (i: number): Entry | null => {
    if (i < warmup || !Number.isFinite(line[i - 1])) return null
    const long = buy(i)
    if (!long && !sell(i)) return null
    return {
      index: i,
      side: long ? 'long' : 'short',
      entry: close[i],
      stop: line[i],
      note: `línea ATR ${s.key}×${s.atrLen}`,
    }
  }

  const signals = walk(candles, warmup, find, {
    feeRate: s.feeRate,
    exitOnClose: (i, side) => (side === 'long' ? sell(i) : buy(i)),
    trail: (i) => line[i],
  })
  return summarise(signals, [], warmup, liveSignal(signals))
}
