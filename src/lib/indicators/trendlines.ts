import { atr } from './ta'
import { pivots } from './levels'
import type { Candle } from './types'

/**
 * Trendlines: the straight diagonal lines a trader draws by hand, joining two
 * swing lows under a market (support) or two swing highs over it (resistance).
 *
 * Same honesty rule as `levels.ts`: these are *description*, not prediction.
 * `npm run trendlines` measures them walk-forward against a parallel line at a
 * random distance, and the chart labels them as context for that reason.
 *
 * The detector is the manual procedure made mechanical:
 *
 * 1. Candidate lines join two pivots of the same kind at least `minGap` bars
 *    apart — two pivots side by side define a slope out of noise.
 * 2. A line is **alive** only if no candle has *closed* beyond it since its
 *    first anchor. Wicks are allowed through by `breakAtr`: a support that a
 *    wick pierced and price reclaimed is exactly what a hand-drawn line keeps.
 * 3. Its strength is how many swings of that kind landed within `tolAtr` of it.
 *    Two anchors always fit, so three touches is what makes it a line anyone
 *    would draw rather than one that happens to exist.
 *
 * The tolerances are in ATRs for the same reason as the horizontal levels: the
 * same code gives sensible lines on 15 m and on the daily without per-timeframe
 * constants.
 */

export interface Trendline {
  kind: 'soporte' | 'resistencia'
  /** First anchor: bar index into the candles passed in, and its price. */
  i1: number
  p1: number
  /** Second anchor. */
  i2: number
  p2: number
  /** Price change per bar. */
  slope: number
  /** Swings of the same kind within tolerance, anchors included. */
  touches: number
  /** Index of the most recent touch. */
  lastIndex: number
}

export interface TrendlineSettings {
  pivot: number
  atrLen: number
  /** A swing this close to the line counts as a touch. */
  tolAtr: number
  /** A close further than this beyond the line kills it. */
  breakAtr: number
  /** Minimum bars between the two anchors. */
  minGap: number
  /** Only the most recent pivots of each kind are tried as anchors. */
  recentPivots: number
  /**
   * Lines returned per side. One: with two, the runner-up was almost always the
   * same line from a neighbouring anchor, fanning out from the winner.
   */
  perSide: number
}

export const TRENDLINE_SETTINGS: TrendlineSettings = {
  pivot: 3,
  atrLen: 14,
  tolAtr: 0.35,
  breakAtr: 0.15,
  minGap: 8,
  recentPivots: 14,
  perSide: 1,
}

/** Where a line sits at bar `i`. */
export function lineAt(line: Pick<Trendline, 'i1' | 'p1' | 'slope'>, i: number): number {
  return line.p1 + line.slope * (i - line.i1)
}

export function findTrendlines(
  candles: Candle[],
  settings: TrendlineSettings = TRENDLINE_SETTINGS,
): Trendline[] {
  const { pivot, atrLen, tolAtr, breakAtr, minGap, recentPivots, perSide } = settings
  if (candles.length < pivot * 2 + atrLen + minGap) return []

  const a = atr(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    candles.map((c) => c.close),
    atrLen,
  )
  const unit = [...a].reverse().find((v) => Number.isFinite(v) && v > 0)
  if (!unit) return []
  const tol = unit * tolAtr
  const slack = unit * breakAtr
  const last = candles.length - 1

  const { highs, lows } = pivots(candles, pivot)

  const side = (kind: Trendline['kind']): Trendline[] => {
    const support = kind === 'soporte'
    const points = (support ? lows : highs).slice(-recentPivots)
    const found: Trendline[] = []

    for (let x = 0; x < points.length; x++) {
      for (let z = x + 1; z < points.length; z++) {
        const p = points[x]
        const q = points[z]
        if (q.index - p.index < minGap) continue
        const slope = (q.price - p.price) / (q.index - p.index)
        const line = { i1: p.index, p1: p.price, slope }

        // Alive: nothing has closed through it since the first anchor. A
        // support the market has already fallen below is not support any more.
        let alive = true
        for (let k = p.index; k <= last; k++) {
          const v = lineAt(line, k)
          if (support ? candles[k].close < v - slack : candles[k].close > v + slack) {
            alive = false
            break
          }
        }
        if (!alive) continue

        // Price must still be on the right side of it — a support projected
        // above the market is a line nobody would call support.
        const now = lineAt(line, last)
        if (!(now > 0) || (support ? now > candles[last].close : now < candles[last].close)) continue

        let touches = 0
        let lastIndex = q.index
        for (const r of points.slice(x)) {
          if (Math.abs(r.price - lineAt(line, r.index)) <= tol) {
            touches++
            lastIndex = Math.max(lastIndex, r.index)
          }
        }
        found.push({ kind, i1: p.index, p1: p.price, i2: q.index, p2: q.price, slope, touches, lastIndex })
      }
    }

    // More touches first, then the line touched most recently: of two lines
    // that fit equally well, the one price is still trading against matters.
    found.sort((l, m) => m.touches - l.touches || m.lastIndex - l.lastIndex)

    // Drop near-duplicates: two lines that sit within tolerance of each other
    // both at their start and now are the same line drawn twice.
    const kept: Trendline[] = []
    for (const l of found) {
      const dup = kept.some(
        (k) =>
          Math.abs(lineAt(k, l.i1) - l.p1) <= tol * 2 && Math.abs(lineAt(k, last) - lineAt(l, last)) <= tol * 2,
      )
      if (!dup) kept.push(l)
      if (kept.length === perSide) break
    }
    return kept
  }

  return [...side('soporte'), ...side('resistencia')]
}
