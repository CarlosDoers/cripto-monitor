import { aggregate } from './scalpPullback'
import { atr, ema } from './ta'
import { barSpacing, liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type SignalSide, type StrategyResult } from './types'

/**
 * "Mi estrategia definitiva de trading para 2026" (Fede Esses, video of
 * 2026-10-11): a Smart Money setup on the first hour and a half of New York's
 * open — in his case Nasdaq and S&P 500 futures — that he says works in any
 * market, crypto included.
 *
 * What he says, in his three words: **toma de liquidez, IFVG y objetivo claro**.
 *
 * - *Toma de liquidez*: "una falla en el desplazamiento por debajo de un
 *   mínimo": price reaches a low and does not close below it (a sweep).
 * - *IFVG*: a fair value gap — three candles where the third does not overlap
 *   the first — that price *invalidates* by closing through it; the entry is
 *   that close, in the direction of the inversion.
 * - *Objetivo claro*: an area price has not yet reached; his examples are 1 : 1
 *   and 1 : 1.3.
 *
 * Three models, same ingredients: (1) the open itself manipulates and gives the
 * entry; (2) it expands and then a retracement gives a continuation; (3) it
 * expands without a good continuation and a retracement is taken. One trade a
 * day (one per session if both are traded), 0.5–0.7 % risk, the stop moved to
 * break even at the first minor extreme. 09:30–11:00 New York, or the Asian
 * session 20:00–21:30 New York.
 *
 * What is written here is model 1 and the sweep that opens models 2 and 3, as a
 * rule, and it is mine where he is loose — fixed before any result:
 *
 * 1. Liquidity: the high and the low of the three hours before the window.
 * 2. A sweep inside the window: a 1 m candle takes out one of them and closes
 *    back inside. A sweep of the low looks for longs, of the high for shorts.
 * 3. The gap: the most recent fair value gap of the opposite colour formed up to
 *    the sweep and no more than 30 candles before the entry (a sweep of the low
 *    leaves a bearish gap behind it).
 * 4. The inversion: the first 1 m close beyond that gap, the other way.
 *    Entry there, inside the window.
 * 5. Stop beyond the sweep's extreme plus a tenth of an ATR. Target the other
 *    reference extreme (the liquidity on the opposite side); with less than 1 R
 *    to it there is no trade, and the next inversion in the window is awaited.
 * 6. One trade per window; closed at market after three hours.
 *
 * He moves the stop to break even and "uses judgement" on the day's conditions
 * and the higher-timeframe trend: neither can be written exactly. The 1 h trend
 * is offered as a switch.
 *
 * **Measured** (2026-10-11, `npm run ideas ifvg`, BTC and ETH, 24 months of 1 m):
 * as described 503 trades, hit rate 29.0 %, **−0.04 R gross and −0.37 R net**
 * (interval by months [−0.49, −0.24], halves −0.28 / −0.44); the fee takes 0.33 R
 * a trade, and −0.12 R is what is left with every fill a maker. A fixed 1 R
 * target: 49.2 %, −0.02 R gross, −0.32 net. With the 1 h trend: 193 trades,
 * +0.04 gross, −0.30 net. The Asian session: 421 trades, **+0.11 R gross** (BTC
 * +0.16, ETH +0.08) and −0.33 net, −0.11 all-maker — the only positive cell of
 * five, not distinguishable from zero. Without the gap (the sweep alone) −0.05 R
 * gross and −0.56 net: what the inversion adds is a later entry, so a wider
 * stop and 0.30 R of fee instead of 0.51 — geometry, not signal. Not registered.
 */

export interface SweepIfvgSettings {
  /** New York minute of the day the window opens and closes: 570 is 09:30. */
  windowFrom: number
  windowTo: number
  /** Minutes before the window whose extremes are the liquidity. */
  refMinutes: number
  /**
   * Require the inverted gap. Off, the entry is the close of the sweep candle
   * itself: what the gap adds is then the difference.
   */
  gap: boolean
  /** The gap must have formed no more than this many candles before the inversion. */
  gapAge: number
  stopBufferAtr: number
  /** `liquidity`: the other reference extreme. `rr`: a fixed multiple of the risk. */
  target: 'liquidity' | 'rr'
  rr: number
  /** With `liquidity`, the least reward-to-risk that is still a trade. */
  minRR: number
  /** Minutes a trade may run. */
  maxBars: number
  /** Only in the direction of the 1 h EMA 50 (above and rising, below and falling). */
  trend: boolean
  feeRate: number
}

export const SWEEP_IFVG_SETTINGS: SweepIfvgSettings = {
  windowFrom: 570,
  windowTo: 660,
  refMinutes: 180,
  gap: true,
  gapAge: 30,
  stopBufferAtr: 0.1,
  target: 'liquidity',
  rr: 1,
  minRR: 1,
  maxBars: 180,
  trend: false,
  feeRate: 0.001,
}

const MINUTE = 60_000
const DAY = 86_400_000

/** New York's offset from UTC in minutes on the UTC day starting at `dayStart`: −240 or −300. */
const offsetCache = new Map<number, number>()
function nyOffset(dayStart: number): number {
  let o = offsetCache.get(dayStart)
  if (o === undefined) {
    // At 12:00 UTC the New York clock reads 7 or 8, and the change is at 07:00 UTC on its day.
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(
        new Date(dayStart + 12 * 3_600_000),
      ),
    )
    o = (hour - 12) * 60
    offsetCache.set(dayStart, o)
  }
  return o
}

/** Minute of the New York day and day of the week (0 = Sunday) of a timestamp. */
export function nyClock(ms: number): { minute: number; dow: number } {
  const dayStart = Math.floor(ms / DAY) * DAY
  const local = ms + nyOffset(dayStart) * MINUTE
  const m = Math.floor(local / MINUTE)
  const minute = ((m % 1440) + 1440) % 1440
  const dow = (Math.floor(local / DAY) + 4) % 7 // 1970-01-01 was a Thursday
  return { minute, dow }
}

export function sweepIfvgEntries(candles: Candle[], s: SweepIfvgSettings = SWEEP_IFVG_SETTINGS): (Entry | null)[] {
  const n = candles.length
  const out: (Entry | null)[] = new Array(n).fill(null)
  if (barSpacing(candles) !== MINUTE) return out

  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const close = candles.map((c) => c.close)
  const a = atr(high, low, close, 14)

  // The 1 h bias, from hourly bars complete by each minute's close.
  let bias60: (i: number) => 0 | 1 | -1 = () => 0
  if (s.trend) {
    const h1 = aggregate(candles, 60 * MINUTE)
    const c60 = h1.bars.map((b) => b.close)
    const line = ema(c60, 50)
    let done = 0
    const memo = new Int8Array(n)
    for (let i = 0; i < n; i++) {
      const closesAt = candles[i].time + MINUTE
      while (done < h1.ends.length && h1.ends[done] <= closesAt) done++
      const j = done - 1
      if (j < 53 || !Number.isFinite(line[j]) || !Number.isFinite(line[j - 3])) memo[i] = 0
      else memo[i] = c60[j] > line[j] && line[j] > line[j - 3] ? 1 : c60[j] < line[j] && line[j] < line[j - 3] ? -1 : 0
    }
    bias60 = (i) => memo[i] as 0 | 1 | -1
  }

  const length = s.windowTo - s.windowFrom
  // Sunday evening to Thursday evening for the session that opens after 18:00, Monday to Friday otherwise.
  const evening = s.windowFrom >= 1080
  const dayOk = (dow: number) => (evening ? dow <= 4 : dow >= 1 && dow <= 5)

  let state: {
    end: number
    refHigh: number
    refLow: number
    sweep: { dir: 1 | -1; idx: number; extreme: number } | null
    done: boolean
  } | null = null

  for (let i = 0; i < n; i++) {
    const { minute, dow } = nyClock(candles[i].time)
    if (minute === s.windowFrom && dayOk(dow) && i >= s.refMinutes) {
      // The reference must be a whole run of minutes: a hole makes the day unusable.
      if (candles[i].time - candles[i - s.refMinutes].time !== s.refMinutes * MINUTE) {
        state = null
        continue
      }
      let hi = -Infinity
      let lo = Infinity
      for (let k = i - s.refMinutes; k < i; k++) {
        hi = Math.max(hi, high[k])
        lo = Math.min(lo, low[k])
      }
      state = { end: i + length, refHigh: hi, refLow: lo, sweep: null, done: false }
    }
    if (!state || state.done || i >= state.end) continue

    if (!state.sweep) {
      const up = high[i] > state.refHigh && close[i] <= state.refHigh
      const down = low[i] < state.refLow && close[i] >= state.refLow
      if (up === down) continue // nothing, or both at once
      state.sweep = up ? { dir: -1, idx: i, extreme: high[i] } : { dir: 1, idx: i, extreme: low[i] }
    } else if (state.sweep.dir === 1) {
      state.sweep.extreme = Math.min(state.sweep.extreme, low[i])
    } else {
      state.sweep.extreme = Math.max(state.sweep.extreme, high[i])
    }
    const sw = state.sweep
    if (!Number.isFinite(a[i]) || !(a[i] > 0)) continue
    if (s.trend && bias60(i) !== sw.dir) continue

    // The most recent gap of the opposite colour formed up to the sweep, not yet inverted.
    let gap: number | null = null
    if (!s.gap) {
      // The sweep alone: enter at its own close.
      if (i !== sw.idx) continue
      gap = sw.dir === 1 ? close[i] - 1 : close[i] + 1
    }
    for (let k = s.gap ? Math.min(i, sw.idx) : -1; k >= Math.max(2, i - s.gapAge); k--) {
      const bearish = sw.dir === 1
      const edge = bearish ? low[k - 2] : high[k - 2] // the far edge, the one a close must pass
      const near = bearish ? high[k] : low[k]
      if (bearish ? !(edge > near) : !(edge < near)) continue
      let invalidated = false
      for (let j = k + 1; j < i; j++) {
        if (bearish ? close[j] > edge : close[j] < edge) {
          invalidated = true
          break
        }
      }
      if (invalidated) continue
      gap = edge
      break
    }
    if (gap === null) continue
    if (sw.dir === 1 ? !(close[i] > gap) : !(close[i] < gap)) continue

    const side: SignalSide = sw.dir === 1 ? 'long' : 'short'
    const entry = close[i]
    const stop = sw.dir === 1 ? sw.extreme - s.stopBufferAtr * a[i] : sw.extreme + s.stopBufferAtr * a[i]
    const risk = Math.abs(entry - stop)
    if (!(risk > 0) || (sw.dir === 1 ? stop >= entry : stop <= entry)) continue
    let target: number
    if (s.target === 'rr') {
      target = sw.dir === 1 ? entry + s.rr * risk : entry - s.rr * risk
    } else {
      target = sw.dir === 1 ? state.refHigh : state.refLow
      // No room to the liquidity on the other side is no trade; wait for the next inversion.
      if ((sw.dir === 1 ? target - entry : entry - target) < s.minRR * risk) continue
    }
    out[i] = { index: i, side, entry, stop, target, maxBars: s.maxBars }
    state.done = true
  }
  return out
}

/** Warm-up: three hours for the liquidity reference and the ATR. */
const WARMUP = 240

export function analyseSweepIfvg(candles: Candle[], s: SweepIfvgSettings = SWEEP_IFVG_SETTINGS): StrategyResult {
  const entries = sweepIfvgEntries(candles, s)
  const signals = walk(candles, WARMUP, (i) => entries[i], { feeRate: s.feeRate })
  return summarise(signals, [], WARMUP, liveSignal(signals))
}
