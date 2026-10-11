import { atr, ema } from './ta'
import { barSpacing, liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type SignalSide, type StrategyResult } from './types'

/**
 * The scalping method of the "Trading en directo — cómo gano 7.544,72 $
 * arriesgando 3 k" video (Alex Ruiz, 2026-10-11), written down as mechanically
 * as the video allows and measured, not shipped.
 *
 * What he says he does — three charts, EMA 50 on each:
 *
 * - **1 h: direction.** Whether the next two or three hourly candles go up or
 *   down, from price action: a support broken after the EMA 50 rejected price,
 *   lower highs and lower lows.
 * - **5 m: structure in that direction.** Impulse → pullback → continuation
 *   (his setup 1, three of his four trades); a turn at support or resistance
 *   (setup 2) or a technical pattern (setup 3, his double bottom).
 * - **1 m: the trigger.** The same impulse → pullback → continuation, entered
 *   the moment price "starts to continue", stop "above the EMA 50 but close to
 *   price", take profit "halfway", no ambitious ratios. Trades last 4–20 minutes
 *   and he claims a 53–54 % hit rate.
 *
 * What is written here is setup 1 only, because it is the only one a rule can
 * hold (setups 2 and 3 are "I see a double bottom"), and the reading is mine —
 * every parameter below was fixed before any result was seen:
 *
 * 1. 1 h bias: the last completed hourly close is on one side of the hourly
 *    EMA 50 and the average slopes that way over three hours.
 * 2. 5 m trend: the same on the 5 m chart.
 * 3. 1 m structure: alternating swing points (two bars each side). A short
 *    needs lower high and lower low — A > C and B < B0 — and the pullback high
 *    C must reach within `zoneAtr` ATR of the 1 m EMA 50 (the "rejection").
 * 4. Entry at the close of the bar that confirms C: price has turned.
 * 5. Stop above C or above the EMA 50, whichever is higher, plus a tenth of an
 *    ATR. Target 1 R ("ratios ajustados"), out after 30 minutes if neither.
 * 6. Long is the exact mirror. One position at a time, no session filter.
 *
 * He also keeps an economic calendar and stops trading when the market "has no
 * structure": neither can be written, and the video does not say what it is.
 *
 * Only 1 m candles: the 5 m and 1 h charts are built from them, so a 5 m bar is
 * used only once its last minute has closed.
 *
 * **Measured** (2026-10-11, BTC and ETH, 24 months of 1 m, 2.1 M bars,
 * `npm run scalp`): as described, 8 251 trades (5.7 a day), hit rate 50.7 %,
 * **+0.02 R gross and −0.57 R net** at the 0.1 % taker round trip, halves
 * −0.54 / −0.61, both coins negative. −0.50 R at the account's measured 0.066 %
 * mix and −0.40 R with every fill a maker (0.04 %). The median stop is 0.17 %
 * of price, so one round trip costs 0.59 R and 53 % of the setups cost more
 * than 1 R, which the kit refuses. Four changes, all reported: the target
 * halfway to the impulse's extreme hits 68 % and measures −0.02 R gross (the
 * geometry, not a signal); 07–16 UTC +0.04 R gross, −0.55 net; without the 1 h
 * and 5 m bias +0.00 R, so the multi-timeframe alignment adds +0.02 R; and the
 * limit order at the 1 m EMA −0.09 to −0.42 R *gross* depending on how close
 * "close" is, since fading the pullback at the average does worse than
 * following its turn. What would have to be true to make it pay is a round trip
 * under half a basis point. Not registered, and not worth watching live.
 */

export interface ScalpSettings {
  emaLen: number
  /** Bars each side that make a swing point on the 1 m chart. */
  pivot: number
  atrLen: number
  /** How close the pullback high must get to the 1 m EMA, in ATRs. */
  zoneAtr: number
  /** Stop buffer beyond the pullback or the EMA, in ATRs. */
  stopBufferAtr: number
  /** Bars over which an EMA's slope is judged, on the 5 m and 1 h charts. */
  slopeBars: number
  /**
   * `rr`: a fixed multiple of the risk. `half`: halfway from entry to the
   * impulse's extreme, which he calls "a medio camino".
   */
  target: 'rr' | 'half'
  rr: number
  /** Minutes held before closing at market. */
  maxBars: number
  /** UTC hours [from, to) the setup may start in. Undefined: all day. */
  hoursUtc?: [number, number]
  /**
   * `confirm`: enter at the close of the bar that confirms the pullback has
   * turned. `limitEma`: a limit order resting at the 1 m EMA, filled when the
   * pullback reaches it — what he says he would rather do ("entrar en limit …
   * el stop por encima de la media móvil, pero cercano al precio").
   */
  entry: 'confirm' | 'limitEma'
  /** `limitEma`: the stop's distance beyond the EMA, in ATRs. */
  limitBufferAtr: number
  /**
   * Require the 1 h and 5 m bias. Off, the side is whatever the 1 m structure
   * says: what the multi-timeframe alignment adds is then the difference.
   */
  bias: boolean
  feeRate: number
}

export const SCALP_SETTINGS: ScalpSettings = {
  emaLen: 50,
  pivot: 2,
  atrLen: 14,
  zoneAtr: 0.5,
  stopBufferAtr: 0.1,
  slopeBars: 3,
  target: 'rr',
  rr: 1,
  maxBars: 30,
  entry: 'confirm',
  limitBufferAtr: 0.25,
  bias: true,
  feeRate: 0.001,
}

const MINUTE = 60_000

/** A higher timeframe built from 1 m bars, with the time each bar is complete. */
export interface Aggregated {
  bars: Candle[]
  /** When bar j is complete: its open plus the period. */
  ends: number[]
}

/** Groups 1 m candles by the clock: a 5 m bar is minutes :00–:04, a 1 h bar :00–:59. */
export function aggregate(candles: Candle[], period: number): Aggregated {
  const bars: Candle[] = []
  const ends: number[] = []
  let key = -1
  for (const c of candles) {
    const k = Math.floor(c.time / period)
    if (k !== key) {
      key = k
      bars.push({ time: k * period, open: c.open, high: c.high, low: c.low, close: c.close, confirmed: true, vol: c.vol ?? 0 })
      ends.push(k * period + period)
    } else {
      const b = bars[bars.length - 1]
      b.high = Math.max(b.high, c.high)
      b.low = Math.min(b.low, c.low)
      b.close = c.close
      b.vol = (b.vol ?? 0) + (c.vol ?? 0)
    }
  }
  return { bars, ends }
}

/** +1 above a rising EMA, −1 below a falling one, 0 otherwise or without history. */
function bias(close: number[], line: number[], upTo: number, slopeBars: number): 1 | -1 | 0 {
  const j = upTo - 1
  if (j - slopeBars < 0) return 0
  const e = line[j]
  const before = line[j - slopeBars]
  if (!Number.isFinite(e) || !Number.isFinite(before)) return 0
  if (close[j] > e && e > before) return 1
  if (close[j] < e && e < before) return -1
  return 0
}

interface Pivot {
  idx: number
  price: number
  high: boolean
}

/**
 * The entry each 1 m bar would propose, in order, whatever the trade state —
 * the kit then walks them one position at a time. Everything at bar `i` uses
 * bars up to `i` and higher-timeframe bars completed by `i`'s close.
 */
export function scalpEntries(candles: Candle[], s: ScalpSettings = SCALP_SETTINGS): (Entry | null)[] {
  const n = candles.length
  const out: (Entry | null)[] = new Array(n).fill(null)
  if (barSpacing(candles) !== MINUTE) return out

  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const close = candles.map((c) => c.close)
  const line1 = ema(close, s.emaLen)
  const a1 = atr(high, low, close, s.atrLen)

  const m5 = aggregate(candles, 5 * MINUTE)
  const h1 = aggregate(candles, 60 * MINUTE)
  const c5 = m5.bars.map((b) => b.close)
  const c60 = h1.bars.map((b) => b.close)
  const line5 = ema(c5, s.emaLen)
  const line60 = ema(c60, s.emaLen)

  let done5 = 0
  let done60 = 0
  const pivs: Pivot[] = []
  const k = s.pivot

  for (let i = 0; i < n; i++) {
    const closesAt = candles[i].time + MINUTE
    while (done5 < m5.ends.length && m5.ends[done5] <= closesAt) done5++
    while (done60 < h1.ends.length && h1.ends[done60] <= closesAt) done60++

    if (s.entry === 'limitEma') {
      // A limit at the previous bar's EMA, filled when this bar reaches it.
      if (i < 1 || !Number.isFinite(a1[i - 1]) || !Number.isFinite(line1[i - 1])) continue
      if (s.hoursUtc) {
        const hour = new Date(candles[i].time).getUTCHours()
        if (hour < s.hoursUtc[0] || hour >= s.hoursUtc[1]) continue
      }
      const L = line1[i - 1]
      const t60 = bias(c60, line60, done60, s.slopeBars)
      const t5 = bias(c5, line5, done5, s.slopeBars)
      const dir = s.bias ? (t60 !== 0 && t5 === t60 ? t60 : 0) : close[i - 1] < L ? -1 : 1
      if (dir === 0) continue
      const gap = 0.5 * a1[i - 1]
      // The pullback comes from the trend's side of the average, not hugging it.
      if (dir < 0 ? !(close[i - 1] < L - gap && high[i] >= L) : !(close[i - 1] > L + gap && low[i] <= L)) continue
      const fill = dir < 0 ? Math.max(L, candles[i].open) : Math.min(L, candles[i].open)
      const stop = dir < 0 ? L + s.limitBufferAtr * a1[i - 1] : L - s.limitBufferAtr * a1[i - 1]
      const risk = Math.abs(stop - fill)
      if (!(risk > 0) || (dir < 0 ? stop <= fill : stop >= fill)) continue
      const target = dir < 0 ? fill - s.rr * risk : fill + s.rr * risk
      out[i] = { index: i, side: dir < 0 ? 'short' : 'long', entry: fill, stop, target, maxBars: s.maxBars, intrabar: true, limitFill: true }
      continue
    }

    // A swing point is known k bars after it happened.
    const p = i - k
    let event: Pivot | null = null
    if (p - k >= 0) {
      let isHigh = true
      let isLow = true
      for (let d = 1; d <= k; d++) {
        if (!(high[p] > high[p - d]) || !(high[p] >= high[p + d])) isHigh = false
        if (!(low[p] < low[p - d]) || !(low[p] <= low[p + d])) isLow = false
      }
      // A bar that is both (an outside bar) says nothing about direction.
      const piv: Pivot | null = isHigh && !isLow ? { idx: p, price: high[p], high: true } : isLow && !isHigh ? { idx: p, price: low[p], high: false } : null
      if (piv) {
        const last = pivs[pivs.length - 1]
        if (!last || last.high !== piv.high) {
          pivs.push(piv)
          event = piv
        } else if (piv.high ? piv.price > last.price : piv.price < last.price) {
          // The same kind of swing, further out: the pullback extended.
          pivs[pivs.length - 1] = piv
          event = piv
        }
        if (pivs.length > 6) pivs.shift()
      }
    }
    if (!event || pivs.length < 4 || !Number.isFinite(a1[i]) || !Number.isFinite(line1[i])) continue

    if (s.hoursUtc) {
      const hour = new Date(candles[i].time).getUTCHours()
      if (hour < s.hoursUtc[0] || hour >= s.hoursUtc[1]) continue
    }

    let side: SignalSide
    if (s.bias) {
      const b60 = bias(c60, line60, done60, s.slopeBars)
      const b5 = bias(c5, line5, done5, s.slopeBars)
      if (b60 === 0 || b5 !== b60) continue
      side = b60 < 0 ? 'short' : 'long'
      // Short: the pullback is a swing high. Long: a swing low.
      if (event.high !== (side === 'short')) continue
    } else {
      side = event.high ? 'short' : 'long'
    }

    const n_ = pivs.length
    const C = pivs[n_ - 1]
    const B = pivs[n_ - 2]
    const A = pivs[n_ - 3]
    const B0 = pivs[n_ - 4]
    const lower = side === 'short'
    // Impulse → pullback in a trend: a lower high after a lower low (short), mirrored for a long.
    if (lower ? !(C.price < A.price && B.price < B0.price) : !(C.price > A.price && B.price > B0.price)) continue
    // The pullback reached the EMA zone.
    const zone = s.zoneAtr * a1[C.idx]
    const eC = line1[C.idx]
    if (lower ? C.price < eC - zone : C.price > eC + zone) continue

    const entry = close[i]
    const buffer = s.stopBufferAtr * a1[i]
    const stop = lower ? Math.max(C.price, line1[i]) + buffer : Math.min(C.price, line1[i]) - buffer
    const risk = Math.abs(stop - entry)
    if (!(risk > 0) || (lower ? stop <= entry : stop >= entry)) continue

    let target: number
    if (s.target === 'rr') {
      target = lower ? entry - s.rr * risk : entry + s.rr * risk
    } else {
      // Halfway to the impulse's extreme; no room left to it is no trade.
      if (lower ? !(B.price < entry) : !(B.price > entry)) continue
      target = entry + (B.price - entry) / 2
    }
    out[i] = { index: i, side, entry, stop, target, maxBars: s.maxBars }
  }
  return out
}

/** Warm-up: three hourly EMA lengths, so the 1 h average has settled (`SEED_FACTOR`). */
export const SCALP_WARMUP = 3 * 50 * 60

export function analyseScalpPullback(candles: Candle[], s: ScalpSettings = SCALP_SETTINGS): StrategyResult {
  const entries = scalpEntries(candles, s)
  const signals = walk(candles, SCALP_WARMUP, (i) => entries[i], { feeRate: s.feeRate })
  return summarise(signals, [], SCALP_WARMUP, liveSignal(signals))
}
