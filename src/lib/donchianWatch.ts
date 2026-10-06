import { atr, ema, highest, lowest } from './indicators/ta'
import { analyseDonchian, DONCHIAN_TREND_SETTINGS } from './indicators/donchianBreakout'
import { toCandles } from './signals'
import type { Candle as OkxCandle } from './types'

/**
 * Where each contract stands against the Donchian + EMA 200 preset on 4 h, for
 * the Screener's "qué vigilar" and the Claude snapshot. It runs the registered
 * preset itself, so a "señal nueva" here is the very signal Estrategias draws.
 *
 * The strategy takes one kind of breakout: the close beyond the last 20 candles'
 * high while above the EMA 200, or beyond their low while below it. So each
 * contract has one side the EMA allows — its *bias* — and one level that side is
 * waiting on. Three things are worth watching, in this order:
 *   · nueva      — the preset opened a position on one of the last two closed
 *                  candles: the measured entry is still close
 *   · rompiendo  — the candle in progress is already beyond the channel edge its
 *                  bias waits on: if it closes there, the preset enters (or turns)
 *   · cerca      — price within half an ATR of that edge: one candle could do it
 * The rest are in a trade, with its age, or out of one. Entering a trend late
 * was not measured, so it is shown as context and nothing more.
 */

export type DonchianStatus = 'nueva' | 'rompiendo' | 'cerca' | 'tendencia' | 'fuera' | 'corto'

export interface DonchianWatch {
  instId: string
  symbol: string
  status: DonchianStatus
  /** The side the EMA 200 allows today: above it only longs count, below it only shorts. */
  bias: 'long' | 'short' | null
  /** The open position's side, which can differ from the bias if price crossed the EMA since. */
  side: 'long' | 'short' | null
  /** Closed 4 h candles since the open position's entry. */
  age: number
  price: number
  ema: number
  /**
   * The edge the bias waits on: the 20-candle high for a long bias, the low for a
   * short one. NaN when a position on the bias side is already open — there is
   * nothing left to break, and the next high would only be read as one.
   */
  level: number
  /** Live price against that edge, as a fraction (negative: still short of it, for a long bias) and in ATRs. */
  distance: number
  distanceAtr: number
  entry?: number
  /** Where the stop stands now — the trail, once it has moved past the initial one. */
  stop?: number
  bars: number
  /** Candles the preset needs before it decides anything, when there are too few. */
  need?: number
}

const NEAR_ATR = 0.5
const FRESH = 1

export function watchDonchianTrend(rows: OkxCandle[], live: number, instId: string, symbol: string): DonchianWatch {
  const candles = toCandles(rows)
  const s = DONCHIAN_TREND_SETTINGS
  const result = analyseDonchian(candles, s)
  const base = { instId, symbol, bars: candles.length, price: live }
  if (candles.length <= result.warmup) {
    return {
      ...base,
      status: 'corto',
      bias: null,
      side: null,
      age: 0,
      ema: NaN,
      level: NaN,
      distance: NaN,
      distanceAtr: NaN,
      need: result.warmup,
    }
  }

  const close = candles.map((c) => c.close)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const last = candles.length - 1
  const line = ema(close, s.trendLen)[last]
  const unit = atr(high, low, close, s.atrLen)[last]
  // The channel the candle in progress is measured against: the last `channelLen`
  // closed candles, the newest included.
  const top = highest(high, s.channelLen)[last]
  const bottom = lowest(low, s.channelLen)[last]

  const price = live || candles[last].close
  const bias = price > line ? 'long' : 'short'
  const level = bias === 'long' ? top : bottom
  // Positive while price is still short of the edge, negative once past it.
  const toLevel = bias === 'long' ? level - price : price - level
  const open = result.active
  const side = open?.side ?? null
  const age = open ? last - open.index : 0
  // An open position on the bias side has nothing left to break: it is just in trend.
  const waiting = !(open && side === bias)

  let status: DonchianStatus
  if (open && age <= FRESH) status = 'nueva'
  else if (waiting && toLevel < 0) status = 'rompiendo'
  else if (waiting && toLevel / unit <= NEAR_ATR) status = 'cerca'
  else status = open ? 'tendencia' : 'fuera'

  return {
    ...base,
    price,
    status,
    bias,
    side,
    age,
    ema: line,
    level: waiting ? level : NaN,
    distance: waiting ? price / level - 1 : NaN,
    distanceAtr: waiting ? Math.abs(toLevel) / unit : NaN,
    entry: open?.entry,
    stop: open ? (open.stopNow ?? open.stop) : undefined,
  }
}

const RANK: Record<DonchianStatus, number> = { nueva: 0, rompiendo: 1, cerca: 2, tendencia: 3, fuera: 4, corto: 5 }

export function compareDonchianWatch(a: DonchianWatch, b: DonchianWatch): number {
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status]
  // A trade has no edge left to measure against: the newest first.
  if (a.status === 'tendencia' || a.status === 'nueva') return a.age - b.age
  // Contracts too short for the EMA have no distance at all.
  return (a.distanceAtr || 0) - (b.distanceAtr || 0)
}
