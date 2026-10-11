import { num } from './format'
import type { Candle as Row } from './types'

/**
 * How near each contract is to its high of the last 90 days — the one factor
 * of the 2026-10-11 literature search that held up once the coins that died
 * were put back in (`npm run research survivor`; the finding is in CLAUDE.md).
 *
 * What was measured: every Sunday, the 30 pairs with the most dollar volume of
 * the previous 30 days; long the third whose close is nearest its 90-day high,
 * short the third farthest, a week, equal weight. This file computes the
 * ranking and nothing else: no stop, no target, no entry. It is context, and
 * the card that shows it says what the measurement is and what it is not.
 */

/** Daily candles the high is taken over. 20 to 365 days all gave the same sign. */
export const HIGH_WINDOW = 90
/** The measurement split the universe in thirds, and needed at least nine names to do it. */
export const MIN_NAMES = 9
/** Standard deviation of daily returns over this many finished days. */
const VOL_WINDOW = 30

/**
 * Every figure the card quotes. Binance spot, USDT pairs, 2018-01 → 2026-09:
 * 581 pairs with at least 120 days (186 stopped trading before the end), each
 * Sunday the 30 with most dollar volume over the previous 30 days, a pair that
 * stops trading closed at its last price, 425 weeks with at least nine names, 0.05 %
 * a side on the turnover. `npm run research survivor` prints them and exits
 * non-zero when they drift (the data are fetched with
 * `node scripts/fetch-binance-daily.mjs`).
 */
export const RELATIVE_STRENGTH_EVIDENCE = {
  weeks: 425,
  pairs: 581,
  dead: 186,
  years: 9,
  /** Long-short, top third minus bottom third, % a week. */
  perWeek: 1.69,
  t: 5.0,
  /** Share of weeks that were positive. */
  positive: 0.63,
  yearsPositive: 9,
  halves: [1.91, 1.47],
  withoutBest10: 1.25,
  interval: [1.02, 2.38],
  net: 1.64,
  /** What the perpetuals' funding takes from the long-short, % a week (Binance, 2022 →). */
  funding: -0.09,
  /** The same sign from the 20-day to the 365-day high. */
  windows: [1.32, 1.97],
  /** Long the top third only, minus the whole universe, % a week. */
  longOnly: { perWeek: 0.84, t: 4.5, yearPct: 39, btcYearPct: 36, universeYearPct: -12, drawdownPct: -84 },
  /** Long-short % a week with BTC above / below its 200-day average on the Sunday. */
  regime: { above: 0.66, aboveT: 1.4, below: 2.55, belowT: 5.3 },
  /** Random baskets of 16 names that had traded for years and still do: the 10th, 50th and 90th percentile. */
  survivors: [-0.65, -0.08, 0.63],
  /** Inside a single age band of coins, % a week, the smallest and the largest of four. */
  withinAge: [0.16, 0.52],
  /** Long the oldest third, short the newest: % a week and t. */
  age: { perWeek: 1.11, t: 2.9 },
  portfolio: { yearPct: 50, sharpe: 1.75, drawdownPct: -22, worstWeekPct: -11 },
  /** Days of daily history an X-Perp has: the board was listed on 2026-03-30. */
  xperpDays: 185,
} as const

export interface RelativeStrength {
  instId: string
  symbol: string
  price: number
  /** The highest high of the last 90 daily candles, today's still-forming one and the live price included. */
  high: number
  /** Price over that high: 1 is a new high. */
  ratio: number
  /** The same as a fraction below the high, 0 at a high. */
  below: number
  /** Days since the high was set; 0 is today. */
  highAge: number
  /** Daily candles on record: how long the contract has traded, up to what the board fetches. */
  bars: number
  /** Standard deviation of the last 30 finished days' returns; NaN with fewer than 31 closes. */
  volatility: number
  /** Fewer than 90 candles: there is no 90-day high to be near. */
  short: boolean
}

/**
 * `rows` are OKX's daily candles, oldest first, the last one possibly still
 * forming; `live` completes it. The high includes today's candle and the live
 * price, so a contract printing a new high reads exactly 1; volatility uses
 * finished days only, like every other figure in the Screener that needs a
 * closed candle.
 */
export function relativeStrength(rows: Row[], live: number, instId: string, symbol: string): RelativeStrength {
  const candles = rows.map((r) => ({
    high: num(r[2]),
    close: num(r[4]),
    done: r[8] === '1',
  }))
  const bars = candles.length
  const price = live > 0 ? live : (candles.at(-1)?.close ?? NaN)
  const base = { instId, symbol, price, bars }
  if (bars < HIGH_WINDOW || !(price > 0)) {
    return { ...base, high: NaN, ratio: NaN, below: NaN, highAge: NaN, volatility: NaN, short: true }
  }

  const window = candles.slice(-HIGH_WINDOW)
  let high = -Infinity
  let at = 0
  window.forEach((c, i) => {
    // A later bar that ties an earlier one counts as the high: the newest of them is the age.
    if (c.high >= high) {
      high = c.high
      at = i
    }
  })
  let highAge = HIGH_WINDOW - 1 - at
  if (price >= high) {
    high = price
    highAge = 0
  }

  const closes = candles.filter((c) => c.done).map((c) => c.close)
  const returns = closes.slice(-(VOL_WINDOW + 1)).map((c, i, a) => (i ? Math.log(c / a[i - 1]) : NaN)).slice(1)
  let volatility = NaN
  if (returns.length === VOL_WINDOW) {
    const m = returns.reduce((s, x) => s + x, 0) / returns.length
    volatility = Math.sqrt(returns.reduce((s, x) => s + (x - m) ** 2, 0) / returns.length)
  }

  const ratio = price / high
  return { ...base, high, ratio, below: 1 - ratio, highAge, volatility, short: false }
}

export interface Ranking {
  /** The third nearest its high, nearest first. */
  top: RelativeStrength[]
  /** The third farthest from it, farthest last. */
  bottom: RelativeStrength[]
  /** Contracts that were ranked. */
  ranked: number
  /** How many sit in each third; 0 when fewer than nine could be ranked. */
  k: number
  /** Contracts left out for having fewer than 90 candles. */
  short: RelativeStrength[]
}

export function rankRelativeStrength(list: RelativeStrength[]): Ranking {
  const ranked = list
    .filter((x) => !x.short && Number.isFinite(x.ratio))
    .sort((a, b) => b.ratio - a.ratio || a.symbol.localeCompare(b.symbol))
  const k = ranked.length >= MIN_NAMES ? Math.floor(ranked.length / 3) : 0
  return {
    top: ranked.slice(0, k),
    bottom: k ? ranked.slice(ranked.length - k) : [],
    ranked: ranked.length,
    k,
    short: list.filter((x) => x.short),
  }
}
