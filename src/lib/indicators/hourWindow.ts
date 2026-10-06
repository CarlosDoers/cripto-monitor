import { atr } from './ta'
import { barSpacing, liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type StrategyResult } from './types'

/**
 * A fixed daily window, the "seasonal" trade: Quantpedia's study of Gemini's
 * hourly bitcoin returns (2015–2022) found the hours from 21:00 to 23:00 UTC
 * the only consistently positive stretch of the day, and proposed the rule
 * below — buy at 21:00, sell at 23:00 — without counting costs.
 *
 * The study ends in early 2022; the cache starts in 2022, so this is mostly
 * data the finding never saw. Written as it was proposed: a long at the open of
 * the 21:00 UTC bar, out at the close of the 22:00 bar. The stop (2 ATR of the
 * hour before) exists only so a result can be priced in R. The Friday variant is
 * the one the same article calls the best day.
 *
 * **Measured** on BTC, ETH and SOL 1 h, 2022–2026: −0.05 R over 6 070 trades (hit
 * rate 50.0 %), and −0.05 R on Fridays alone (870). The window the study found
 * is not there after a 0.1 % round trip.
 */

export interface HourWindowSettings {
  entryHourUtc: number
  /** Bars held, the entry bar included. */
  holdBars: number
  stopAtr: number
  /** 0–6 as `getUTCDay` says; empty means every day. */
  days: number[]
  feeRate: number
}

export const HOUR_WINDOW_SETTINGS: HourWindowSettings = {
  entryHourUtc: 21,
  holdBars: 2,
  stopAtr: 2,
  days: [],
  feeRate: 0.001,
}

const HOUR_MS = 3_600_000

export function analyseHourWindow(candles: Candle[], s: HourWindowSettings = HOUR_WINDOW_SETTINGS): StrategyResult {
  if (barSpacing(candles) !== HOUR_MS) return summarise([], [], candles.length, null)

  const unit = atr(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    candles.map((c) => c.close),
    14,
  )
  const find = (i: number): Entry | null => {
    const at = new Date(candles[i].time)
    if (at.getUTCHours() !== s.entryHourUtc) return null
    if (s.days.length && !s.days.includes(at.getUTCDay())) return null
    if (!(unit[i - 1] > 0)) return null
    const entry = candles[i].open
    return {
      index: i,
      side: 'long',
      entry,
      stop: entry - s.stopAtr * unit[i - 1],
      maxBars: s.holdBars - 1,
      intrabar: true,
      note: `ventana ${s.entryHourUtc}:00 UTC`,
    }
  }

  const signals = walk(candles, 15, find, { feeRate: s.feeRate })
  return summarise(signals, [], 15, liveSignal(signals))
}

export const analyseHourWindowFriday = (c: Candle[]) => analyseHourWindow(c, { ...HOUR_WINDOW_SETTINGS, days: [5] })
