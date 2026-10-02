import { atr, ema } from './ta'
import { feeInR, summarise, type Candle, type StrategyResult, type StrategySignal } from './types'

/**
 * SuperTrend AI (Clustering) [LuxAlgo] — TradingView, ported for measurement.
 *
 * Nine SuperTrends run side by side, factors 1 to 5 in steps of 0.5 over a
 * 10-bar ATR. Each keeps a running score: an EMA (memory 10) of the price
 * change signed by which side of its line price was on. Every bar, k-means
 * splits the nine scores into three clusters, and the final SuperTrend uses
 * the mean factor of the best one. The "AI" is that clustering. The label on
 * each flip prints a 0–10 score: the best cluster's mean performance over the
 * average absolute bar move.
 *
 * Traded the way it is drawn: long when the trend flips up, short when it flips
 * down, out and reversed on the next flip. The initial stop is the trailing
 * line at entry, which defines 1 R; the line then trails, and the trade also
 * closes if a bar touches it — the trend only flips on a close beyond it, so
 * without that a gap through the line would cost far more than 1 R before the
 * close confirmed it.
 *
 * Two departures, both forced. The Pine only clusters the last 10 000 bars, a
 * TradingView performance limit; here every bar is clustered. And the k-means
 * keeps an empty cluster's centroid out of the distances, where the Pine would
 * carry `na`.
 */

export interface SupertrendAiSettings {
  atrLen: number
  minMult: number
  maxMult: number
  step: number
  perfAlpha: number
  /** 2 = best cluster, 1 = average, 0 = worst. */
  fromCluster: 0 | 1 | 2
  /** Only take flips whose label score is at least this (0–10). 0 = all. */
  minScore: number
  /** A fixed factor instead of the clustering: the plain SuperTrend control. */
  fixedFactor: number
  feeRate: number
}

export const SUPERTREND_AI_SETTINGS: SupertrendAiSettings = {
  atrLen: 10,
  minMult: 1,
  maxMult: 5,
  step: 0.5,
  perfAlpha: 10,
  fromCluster: 2,
  minScore: 0,
  fixedFactor: 0,
  feeRate: 0.001,
}

/** `array.percentile_linear_interpolation` */
function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b)
  const rank = (p / 100) * (s.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  return s[lo] + (s[hi] - s[lo]) * (rank - lo)
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

function kmeans(perf: number[], factors: number[], maxIter = 1000) {
  let centroids = [percentile(perf, 25), percentile(perf, 50), percentile(perf, 75)]
  let perfClusters: number[][] = [[], [], []]
  let factorClusters: number[][] = [[], [], []]
  for (let it = 0; it <= maxIter; it++) {
    perfClusters = [[], [], []]
    factorClusters = [[], [], []]
    perf.forEach((v, i) => {
      let best = 0
      let bestDist = Infinity
      centroids.forEach((c, k) => {
        const d = Number.isFinite(c) ? Math.abs(v - c) : Infinity
        if (d < bestDist) {
          bestDist = d
          best = k
        }
      })
      perfClusters[best].push(v)
      factorClusters[best].push(factors[i])
    })
    const next = perfClusters.map(avg)
    if (next.every((c, k) => c === centroids[k])) break
    centroids = next
  }
  return { perfClusters, factorClusters }
}

interface Band {
  upper: number
  lower: number
  output: number
  perf: number
  trend: number
}

export function analyseSupertrendAi(
  candles: Candle[],
  settings: SupertrendAiSettings = SUPERTREND_AI_SETTINGS,
): StrategyResult {
  const { atrLen, minMult, maxMult, step, perfAlpha, fromCluster, minScore, fixedFactor, feeRate } =
    settings
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const close = candles.map((c) => c.close)
  const a = atr(high, low, close, atrLen)
  const absMove = close.map((c, i) => (i ? Math.abs(c - close[i - 1]) : 0))
  const den = ema(absMove, Math.trunc(perfAlpha))

  const factors: number[] = []
  for (let i = 0; i <= Math.trunc((maxMult - minMult) / step); i++) factors.push(minMult + i * step)

  const start = a.findIndex(Number.isFinite)
  const warmup = Math.max(start, 0) + 50
  const signals: StrategySignal[] = []
  if (start < 0) return summarise(signals, [], warmup, null)

  const hl2 = (i: number) => (high[i] + low[i]) / 2
  const bands: Band[] = factors.map(() => ({
    upper: hl2(start),
    lower: hl2(start),
    output: NaN,
    perf: 0,
    trend: 0,
  }))

  let targetFactor = fixedFactor || NaN
  let upper = hl2(start)
  let lower = hl2(start)
  let os = 0
  let prevOs = 0
  let ts = NaN
  let open: { signal: StrategySignal; risk: number; stopNow: number } | null = null

  const exit = (price: number, i: number) => {
    if (!open) return
    const { signal, risk } = open
    const gross = signal.side === 'long' ? price - signal.entry : signal.entry - price
    signal.resultR = gross / risk
    signal.outcome = signal.resultR > 0 ? 'win' : 'loss'
    signal.closedIndex = i
    signal.closedTime = candles[i].time
    signal.closedPrice = price
    open = null
  }

  for (let i = start + 1; i < candles.length; i++) {
    // A touch of the trailing line, before anything this bar computes.
    if (open) {
      const long = open.signal.side === 'long'
      if (long ? low[i] <= open.stopNow : high[i] >= open.stopNow) exit(open.stopNow, i)
    }

    // ---- The nine SuperTrends, in the Pine's order ----
    if (!fixedFactor) {
      bands.forEach((b, k) => {
        const up = hl2(i) + a[i] * factors[k]
        const dn = hl2(i) - a[i] * factors[k]
        b.trend = close[i] > b.upper ? 1 : close[i] < b.lower ? 0 : b.trend
        b.upper = close[i - 1] < b.upper ? Math.min(up, b.upper) : up
        b.lower = close[i - 1] > b.lower ? Math.max(dn, b.lower) : dn
        const diff = Number.isFinite(b.output) ? Math.sign(close[i - 1] - b.output) : 0
        b.perf += (2 / (perfAlpha + 1)) * ((close[i] - close[i - 1]) * diff - b.perf)
        b.output = b.trend === 1 ? b.lower : b.upper
      })
    }

    let score = NaN
    if (!fixedFactor) {
      const { perfClusters, factorClusters } = kmeans(
        bands.map((b) => b.perf),
        factors,
      )
      const f = avg(factorClusters[fromCluster])
      if (Number.isFinite(f)) targetFactor = f
      const p = avg(perfClusters[fromCluster])
      score = Number.isFinite(den[i]) && den[i] > 0 ? Math.max(Number.isFinite(p) ? p : 0, 0) / den[i] : NaN
    }
    if (!Number.isFinite(targetFactor)) continue

    // ---- The SuperTrend on the chosen factor ----
    const up = hl2(i) + a[i] * targetFactor
    const dn = hl2(i) - a[i] * targetFactor
    upper = close[i - 1] < upper ? Math.min(up, upper) : up
    lower = close[i - 1] > lower ? Math.max(dn, lower) : dn
    prevOs = os
    os = close[i] > upper ? 1 : close[i] < lower ? 0 : os
    ts = os ? lower : upper

    if (open) {
      // Trail with the line; it only ever moves in the trade's favour.
      open.stopNow = open.signal.side === 'long' ? Math.max(open.stopNow, ts) : Math.min(open.stopNow, ts)
    }

    if (os === prevOs) continue
    const side: 'long' | 'short' = os > prevOs ? 'long' : 'short'
    // A flip always ends the trade in progress, whatever its score.
    if (open) exit(close[i], i)
    if (i < warmup) continue
    if (minScore > 0 && !(Math.trunc(score * 10) >= minScore)) continue

    const entry = close[i]
    const stop = ts
    const risk = side === 'long' ? entry - stop : stop - entry
    if (!(risk > 0)) continue

    const signal: StrategySignal = {
      index: i,
      time: candles[i].time,
      side,
      entry,
      stop,
      outcome: 'open',
      feeR: feeInR(entry, stop, feeRate),
      note: fixedFactor
        ? `SuperTrend ${fixedFactor}`
        : `factor ${targetFactor.toFixed(1)} · puntuación ${Math.trunc(score * 10)}`,
    }
    signals.push(signal)
    open = { signal, risk, stopNow: stop }
  }

  const live = open as { signal: StrategySignal } | null
  return summarise(signals, [], warmup, live ? live.signal : null)
}

/** Variant: only the flips the indicator labels 5 or more out of 10. */
export function analyseSupertrendAiScored(candles: Candle[]): StrategyResult {
  return analyseSupertrendAi(candles, { ...SUPERTREND_AI_SETTINGS, minScore: 5 })
}

/** Control: a plain SuperTrend at the classic factor 3, no clustering. */
export function analyseSupertrendPlain(candles: Candle[]): StrategyResult {
  return analyseSupertrendAi(candles, { ...SUPERTREND_AI_SETTINGS, fixedFactor: 3 })
}
