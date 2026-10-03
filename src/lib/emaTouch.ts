import { atr, ema } from './indicators/ta'
import { SEED_FACTOR } from './indicators/movingAverages'
import { analyseSmc } from './indicators/smc'
import { ratio, share } from './format'
import type { Candle as OkxCandle } from './types'

/**
 * Which contracts have touched a daily EMA, how, and with what around it.
 *
 * A touch is a daily candle whose range contains that day's EMA — low at or
 * under it, high at or over it — the way it looks on a TradingView chart. The
 * day still forming counts too, with the live price as its close and as a
 * possible new high or low, so "tocando hoy" means what the chart shows now.
 *
 * Each touch carries the three confirmations people use, as information:
 * the internal SMC structure before it, the touch candle's volume against its
 * 20-day mean, and whether the candle closed back on the side it came from.
 *
 * **None of them makes the EMA more trustworthy, and that was measured.**
 * `npm run ematouch` (3 383 first touches of the daily EMA 25, 30 coins since
 * 2022, outcome read from the next bar) compares each filter with the same
 * filter applied to copies of the EMA shifted by ±0.5–1.5 ATR. Structure in
 * favour: 49.1 % against 49.3 % for the copies. High volume makes touches
 * *worse* (46.5 %): it comes with breaks. All three together reach 71.4 % —
 * and the copies 72.9 %. What lifts the rate is the filter (a strong candle,
 * with volume, with the trend, closing away from the line), which any line
 * following price shows just as well. `EMA_TOUCH_EVIDENCE` carries these to
 * the card's "?", and the script fails if they drift.
 */
export const EMA_TOUCH_EVIDENCE = {
  length: 25,
  coins: 30,
  since: 2022,
  touches: 3383,
  rejection: 0.506,
  decoy: 0.535,
  favour: { rejection: 0.491, decoy: 0.493 },
  highVolume: { rejection: 0.465, decoy: 0.483 },
  all3: { n: 259, rejection: 0.714, decoy: 0.729 },
  /**
   * Traded (`emaTouchTrade.ts`): enter at the close of a touch candle that
   * holds, stop at its wick, 2 R target — mean net R per trade on the same 30
   * coins. The best variant, out on a close back across the EMA, makes +0.28 R
   * only through five trades of +48 to +109 R; without them, +0.01.
   */
  trade: { n: 1540, netR: -0.05, emaExitNetR: 0.28, emaExitWithoutTop5: 0.01 },
}

/** Volume at or above this multiple of its 20-day mean counts as high. */
export const HIGH_VOLUME = 1.5
const VOL_LOOKBACK = 20

/** How far back a touch is still reported. */
export const LOOKBACK = 10
/** Bars over which the slope is judged, and the move under which it is flat. */
const SLOPE_BARS = 10
const FLAT_ATR = 0.5

export interface EmaTouch {
  instId: string
  symbol: string
  price: number
  ema: number
  /** Price relative to the EMA, as a fraction. */
  distance: number
  /** Candles back to the latest touch: 0 is today's, still forming. Null if none in `LOOKBACK`. */
  ago: number | null
  /** Which side the previous close was on: where the touch came from. */
  from: 'arriba' | 'abajo' | null
  /** The touching candle closed on the other side of the EMA from the one before. */
  crossed: boolean
  slope: 'sube' | 'baja' | 'plana'
  /** Internal SMC trend on the candle before the touch (or now, with no touch). */
  structure: 'alcista' | 'bajista' | null
  /** The structure points the way the touch came from: up for a touch from above. */
  favour: boolean | null
  /** Touch candle's volume over its 20-day mean. */
  volume: number
  /** Today's candle is still trading, so its volume is not comparable yet. */
  volumePartial: boolean
  /** The touch candle closed on the side it came from. Provisional for today's. */
  held: boolean | null
  /** Not enough daily history for an EMA of this length to be trusted. */
  short: boolean
  bars: number
}

export function analyseEmaTouch(
  rows: OkxCandle[],
  length: number,
  live: number,
  instId: string,
  symbol: string,
): EmaTouch {
  const sorted = [...rows].sort((a, b) => Number(a[0]) - Number(b[0]))
  const high = sorted.map((r) => Number(r[2]))
  const low = sorted.map((r) => Number(r[3]))
  const close = sorted.map((r) => Number(r[4]))
  const last = sorted.length - 1
  // The forming day, brought up to the live price: the board's candles can be
  // up to an hour old, the price is not.
  if (last >= 0 && sorted[last][8] !== '1' && live > 0) {
    close[last] = live
    high[last] = Math.max(high[last], live)
    low[last] = Math.min(low[last], live)
  }

  const base = { instId, symbol, price: live || close[last], bars: sorted.length }
  const none = { structure: null, favour: null, volume: NaN, volumePartial: false, held: null }
  if (sorted.length < length * SEED_FACTOR) {
    return { ...base, ...none, ema: NaN, distance: NaN, ago: null, from: null, crossed: false, slope: 'plana', short: true }
  }

  const line = ema(close, length)
  const touches = (i: number) => low[i] <= line[i] && line[i] <= high[i]
  let ago: number | null = null
  for (let k = 0; k <= LOOKBACK && last - k > 0; k++) {
    if (touches(last - k)) {
      ago = k
      break
    }
  }
  let from: EmaTouch['from'] = null
  let crossed = false
  if (ago !== null) {
    const i = last - ago
    const before = close[i - 1] > line[i - 1]
    from = before ? 'arriba' : 'abajo'
    crossed = close[i] > line[i] !== before
  }

  // Structure from finished candles only: the forming one could still break.
  const forming = sorted[last][8] !== '1'
  const finished = sorted.slice(0, forming ? last : last + 1).map((r) => ({
    time: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    confirmed: true,
  }))
  const trend = analyseSmc(finished).internalTrendSeries
  const at = ago !== null ? last - ago - 1 : finished.length - 1
  const t = trend[Math.min(at, trend.length - 1)]
  const structure = t === 1 ? 'alcista' : t === -1 ? 'bajista' : null
  const favour = from && structure ? (from === 'arriba') === (structure === 'alcista') : null

  const vol = sorted.map((r) => Number(r[5]))
  let volume = NaN
  if (ago !== null) {
    const i = last - ago
    let sum = 0
    let n = 0
    for (let k = Math.max(0, i - VOL_LOOKBACK); k < i; k++) {
      sum += vol[k]
      n++
    }
    volume = n && sum > 0 ? vol[i] / (sum / n) : NaN
  }

  const a = atr(high, low, close, 14)
  const change = line[last] - line[last - SLOPE_BARS]
  const slope =
    Number.isFinite(a[last]) && Math.abs(change) < a[last] * FLAT_ATR ? 'plana' : change > 0 ? 'sube' : 'baja'

  const price = base.price
  return {
    ...base,
    ema: line[last],
    distance: price / line[last] - 1,
    ago,
    from,
    crossed,
    slope,
    structure,
    favour,
    volume,
    volumePartial: ago === 0 && forming,
    held: ago === null ? null : !crossed,
    short: false,
  }
}

/** Touching today first, then the most recent touch, then the nearest to the EMA. */
export function compareTouches(a: EmaTouch, b: EmaTouch): number {
  if (a.short !== b.short) return a.short ? 1 : -1
  const ra = a.ago ?? Infinity
  const rb = b.ago ?? Infinity
  if (ra !== rb) return ra - rb
  return Math.abs(a.distance) - Math.abs(b.distance)
}

/** The measured verdict on EMA touches, in one sentence, for the Claude snapshot. */
export function emaTouchSummary() {
  const e = EMA_TOUCH_EVIDENCE
  const p = (x: number) => share(x, 0)
  return {
    length: e.length,
    text: `tras tocarla el precio rebota el ${p(e.rejection)} de las veces y una línea cualquiera el ${p(e.decoy)}; con estructura, volumen y vela a favor, ${p(e.all3.rejection)} frente a ${p(e.all3.decoy)}; operado, ${e.trade.netR < 0 ? '−' : '+'}${ratio(Math.abs(e.trade.netR))} R por operación`,
  }
}
