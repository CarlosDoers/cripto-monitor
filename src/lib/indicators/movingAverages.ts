import { atr, ema } from './ta'
import type { Candle, Overlay } from './types'

/**
 * EMA 50 and EMA 200 for the Análisis tab, and the reading a trader takes from
 * them: which side of the 200 price is on, whether the 200 is rising, and which
 * way the 50 last crossed it.
 *
 * Context, like the levels. `npm run ma` tests the EMA as dynamic support and
 * resistance against a copy of itself shifted by a random amount: about +1 pp
 * on 15 m for both lengths, consistent across seeds but no larger than what the
 * pivot levels managed there, and a sign that flips with the seed on 1 h, 4 h
 * and the daily. Nothing to trade on, and the chart says so.
 *
 * `ta.ema` seeds with an SMA of its first `length` bars. With the ~1 200 bars
 * the view fetches, what is left of that seed at the last bar is around
 * e^-9 — so the values match TradingView's. With only a few hundred bars it
 * still carries some of it, which is why each average waits for `SEED_FACTOR`
 * times its length.
 */

export const FAST = 50
export const SLOW = 200

/**
 * Bars required, as a multiple of the length. Two lengths past its seed an EMA
 * keeps e^-4 ≈ 2 % of whatever the seed got wrong; any shorter and it is still
 * visibly its seed — better absent than wrong.
 */
export const SEED_FACTOR = 3

/** Bars back used to judge the slope of the slow average. */
const SLOPE_BARS = 10

/**
 * A move of the 200 smaller than this many ATRs over `SLOPE_BARS` reads as
 * flat. In ATRs so that "flat" means the same thing on 15 m and on the daily.
 */
const FLAT_ATR = 0.5

export interface MaReading {
  fast: number
  /** NaN when there is not enough history for a trustworthy 200. */
  slow: number
  /** Close relative to the 200, as a fraction. */
  vsSlow: number
  slope: 'sube' | 'baja' | 'plana'
  /** Which average is on top now. */
  fastAbove: boolean
  /** Time of the last candle where the 50 crossed the 200, if any is on record. */
  crossTime: number | null
}

export interface MovingAverages {
  overlays: Overlay[]
  reading: MaReading | null
}

export function movingAverages(candles: Candle[]): MovingAverages {
  const closes = candles.map((c) => c.close)
  const fastEnough = candles.length >= FAST * SEED_FACTOR
  const slowEnough = candles.length >= SLOW * SEED_FACTOR
  const fast = fastEnough ? ema(closes, FAST) : closes.map(() => NaN)
  const slow = slowEnough ? ema(closes, SLOW) : closes.map(() => NaN)

  const overlays: Overlay[] = []
  if (fastEnough) {
    overlays.push({
      key: 'ema50',
      label: `EMA ${FAST}`,
      values: fast,
      colour: 'var(--series-1)',
      context: true,
    })
  }
  if (slowEnough) {
    overlays.push({
      key: 'ema200',
      label: `EMA ${SLOW}`,
      values: slow,
      colour: 'var(--series-2)',
      context: true,
    })
  }

  const last = candles.length - 1
  if (!slowEnough || !Number.isFinite(slow[last]) || !Number.isFinite(fast[last])) {
    return { overlays, reading: null }
  }

  const a = atr(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    closes,
    14,
  )
  const unit = a[last]
  const change = slow[last] - slow[last - SLOPE_BARS]
  const slope =
    Number.isFinite(unit) && Math.abs(change) < unit * FLAT_ATR ? 'plana' : change > 0 ? 'sube' : 'baja'

  const fastAbove = fast[last] > slow[last]
  let crossTime: number | null = null
  for (let i = last; i > 0; i--) {
    if (!Number.isFinite(slow[i - 1]) || !Number.isFinite(fast[i - 1])) break
    if (fast[i - 1] > slow[i - 1] !== fastAbove) {
      crossTime = candles[i].time
      break
    }
  }

  return {
    overlays,
    reading: {
      fast: fast[last],
      slow: slow[last],
      vsSlow: closes[last] / slow[last] - 1,
      slope,
      fastAbove,
      crossTime,
    },
  }
}
