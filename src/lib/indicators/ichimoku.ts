import { atr, highest, lowest } from './ta'
import { liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type StrategyResult } from './types'

/**
 * Ichimoku Kinko Hyo (Goichi Hosoda), at the 9 / 26 / 52 it was written for —
 * one of the most requested systems on TradingView, so one worth a number.
 *
 * Long needs the three things the book asks for at once: price above the cloud
 * (the two spans as they were drawn 26 bars ago), the conversion line above the
 * base line, and the close above the close 26 bars back (the lagging span clear
 * of price). The signal is the first bar all three hold; shorts are the mirror.
 * The stop is 2 ATR, like the project's other trend entries, and the exit is the
 * base line (Kijun): a close back through it.
 *
 * **Measured** (30 coins since 2022): 4 h +0.13 R over 8 270 trades (second half
 * +0.09) and daily +0.20 R over 1 305 (halves +0.35 / +0.11). The daily clears
 * `try` but not the review: its ten best trades are +221 R of +264 R, it earns
 * nothing with BTC under its 200-day mean (+0.00 against +0.34), shorts make
 * +0.03, and its monthly results correlate +0.90 with the EMA 200 cross. In
 * 2018–2021 it measures +0.80 R, which says more about that bull market than
 * about Ichimoku.
 */

export interface IchimokuSettings {
  conversion: number
  base: number
  spanB: number
  /** How far the cloud is drawn ahead, and the lagging span behind. */
  shift: number
  stopAtr: number
  feeRate: number
}

export const ICHIMOKU_SETTINGS: IchimokuSettings = {
  conversion: 9,
  base: 26,
  spanB: 52,
  shift: 26,
  stopAtr: 2,
  feeRate: 0.001,
}

export function analyseIchimoku(candles: Candle[], s: IchimokuSettings = ICHIMOKU_SETTINGS): StrategyResult {
  const close = candles.map((c) => c.close)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)

  const mid = (len: number) => {
    const h = highest(high, len)
    const l = lowest(low, len)
    return h.map((x, i) => (x + l[i]) / 2)
  }
  const conversion = mid(s.conversion)
  const base = mid(s.base)
  const spanB = mid(s.spanB)
  const unit = atr(high, low, close, 14)

  const warmup = s.spanB + s.shift + 2
  /** The cloud under bar `i`: the spans computed `shift` bars earlier. */
  const cloud = (i: number) => {
    const a = (conversion[i - s.shift] + base[i - s.shift]) / 2
    const b = spanB[i - s.shift]
    return { top: Math.max(a, b), bottom: Math.min(a, b) }
  }
  const state = (i: number): 1 | -1 | 0 => {
    if (i < warmup) return 0
    const c = cloud(i)
    if (close[i] > c.top && conversion[i] > base[i] && close[i] > close[i - s.shift]) return 1
    if (close[i] < c.bottom && conversion[i] < base[i] && close[i] < close[i - s.shift]) return -1
    return 0
  }

  const find = (i: number): Entry | null => {
    const now = state(i)
    if (now === 0 || now === state(i - 1) || !(unit[i] > 0)) return null
    const long = now === 1
    const entry = close[i]
    return {
      index: i,
      side: long ? 'long' : 'short',
      entry,
      stop: long ? entry - s.stopAtr * unit[i] : entry + s.stopAtr * unit[i],
      note: `${long ? 'sobre' : 'bajo'} la nube`,
    }
  }

  const signals = walk(candles, warmup, find, {
    feeRate: s.feeRate,
    exitOnClose: (i, side) => (side === 'long' ? close[i] < base[i] : close[i] > base[i]),
  })
  return summarise(signals, [], warmup, liveSignal(signals))
}
