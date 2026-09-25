import { atr } from './ta'
import type { Candle } from './types'

/**
 * Support and resistance, by pivot clustering.
 *
 * The technique is the standard one and deliberately not clever: find swing
 * pivots (a bar whose high is the highest of the `pivot` bars each side, and the
 * mirror for lows), then merge pivots that sit within a tolerance of each other
 * into one level. A level's strength is how many separate swings landed on it.
 *
 * **The tolerance is measured in ATRs, not percent, and that is what makes this
 * timeframe-aware.** Two pivots 0.3 % apart are the same level on a daily chart
 * and two different levels on 15 m. Scaling the merge distance by the volatility
 * the timeframe actually has means the same code gives a handful of major levels
 * on the daily and a denser ladder on 15 m, without a table of per-timeframe
 * constants that would drift.
 *
 * `upTo` exists so the research script can build levels from history alone and
 * then test them on bars the detector never saw. Without it every measurement
 * would be circular: a level fitted to the whole series is guaranteed to look
 * respected.
 */

export interface Level {
  price: number
  /** Relative to the latest close, so a broken resistance becomes support. */
  kind: 'soporte' | 'resistencia'
  /** Separate swings that landed within tolerance of this price. */
  touches: number
  /** Bar index of the most recent touch. */
  lastIndex: number
  /** 0–1, combining touches and how recent the last one is. */
  strength: number
}

export interface LevelSettings {
  /** Bars either side a swing must exceed to count as a pivot. */
  pivot: number
  /** Merge pivots closer than this many ATRs. */
  tolAtr: number
  atrLen: number
  minTouches: number
  maxLevels: number
}

export const LEVEL_SETTINGS: LevelSettings = {
  pivot: 3,
  tolAtr: 0.75,
  atrLen: 14,
  minTouches: 2,
  maxLevels: 6,
}

export interface Pivot {
  price: number
  index: number
}

/** Swing highs and lows. A pivot needs `pivot` bars each side, so the last ones never qualify. */
export function pivots(candles: Candle[], span: number): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = []
  const lows: Pivot[] = []
  for (let i = span; i < candles.length - span; i++) {
    let isHigh = true
    let isLow = true
    for (let k = i - span; k <= i + span; k++) {
      if (k === i) continue
      if (candles[k].high >= candles[i].high) isHigh = false
      if (candles[k].low <= candles[i].low) isLow = false
      if (!isHigh && !isLow) break
    }
    if (isHigh) highs.push({ price: candles[i].high, index: i })
    if (isLow) lows.push({ price: candles[i].low, index: i })
  }
  return { highs, lows }
}

export function findLevels(
  candles: Candle[],
  settings: LevelSettings = LEVEL_SETTINGS,
  upTo?: number,
): Level[] {
  const end = upTo ?? candles.length
  const view = candles.slice(0, end)
  const { pivot, tolAtr, atrLen, minTouches, maxLevels } = settings
  if (view.length < pivot * 2 + atrLen + 5) return []

  const a = atr(
    view.map((c) => c.high),
    view.map((c) => c.low),
    view.map((c) => c.close),
    atrLen,
  )
  const lastAtr = [...a].reverse().find((v) => Number.isFinite(v) && v > 0)
  if (!lastAtr) return []
  const tol = lastAtr * tolAtr

  const { highs, lows } = pivots(view, pivot)
  // Highs and lows cluster together on purpose: a level that acted as both is
  // the strongest kind, and keeping them apart would split its touch count.
  const all = [...highs, ...lows].sort((p, q) => p.price - q.price)

  const clusters: Pivot[][] = []
  for (const p of all) {
    const current = clusters[clusters.length - 1]
    if (current && p.price - current[0].price <= tol) current.push(p)
    else clusters.push([p])
  }

  const last = view[view.length - 1].close
  const levels = clusters
    .filter((c) => c.length >= minTouches)
    .map((c) => {
      const lastIndex = Math.max(...c.map((p) => p.index))
      // Recent touches matter more, but an old level that held four times is not
      // noise either — hence a blend rather than a cutoff.
      const recency = 1 - (view.length - 1 - lastIndex) / view.length
      const weight = Math.min(1, c.length / 5)
      return {
        price: c.reduce((sum, p) => sum + p.price, 0) / c.length,
        kind: (c.reduce((sum, p) => sum + p.price, 0) / c.length >= last
          ? 'resistencia'
          : 'soporte') as Level['kind'],
        touches: c.length,
        lastIndex,
        strength: weight * 0.7 + recency * 0.3,
      }
    })

  return levels
    .sort((x, y) => y.strength - x.strength)
    .slice(0, maxLevels)
    .sort((x, y) => x.price - y.price)
}
