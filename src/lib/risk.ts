/**
 * How far the account falls before it recovers, and how far it could.
 *
 * Rendimiento said how much was made and nothing about the road there: a
 * +4.000 US$ month that dipped 2.500 US$ on the way reads the same as one that
 * never looked back. The drawdown is what decides whether a bad run is normal
 * for this way of trading or a sign that something changed, and it is the
 * number a position size has to survive.
 *
 * Two answers, kept apart because they answer different questions:
 *
 * - `drawdowns()` — what actually happened, on the realised curve in dollars.
 *   Dollars and not percent: deposits arrived along the way, so a percentage
 *   would need the equity at every instant and would jump at each deposit.
 * - `simulate()` — what this way of trading produces by chance. The period's
 *   own trades are resampled with replacement into thousands of alternative
 *   runs of the same length, and each run's worst drop and longest losing
 *   streak are recorded. The idea and the drawdown definitions follow
 *   QuantStats (`montecarlo_drawdown`, `drawdown_details`, Apache-2.0,
 *   github.com/ranaroussi/quantstats); the code is written for this app.
 *
 * The simulation assumes trades are independent draws from the same process.
 * They are not quite — a position closed in parts yields several correlated
 * rows, and a regime can change — so it describes the past process, not a
 * forecast, and the UI says so.
 */

export interface CurvePoint {
  t: number
  value: number
}

export interface Drawdown {
  /** Dollars below the running peak at the trough (positive number). */
  depth: number
  peakAt: number
  troughAt: number
  /** When the curve got back to the peak; undefined while still under it. */
  recoveredAt?: number
  /** Trades from the peak to the trough. One means a single loss was the whole episode. */
  trades: number
  /** Index of the trough trade in the curve. */
  troughIndex: number
}

export interface DrawdownReport {
  /** The deepest episode, or null on a curve that never fell. */
  max: Drawdown | null
  /** Dollars below the running peak now (0 at a new high). */
  current: number
  /** Start of the current episode, when under water. */
  currentSince?: number
  /** Distance below the running peak after each trade, ≤ 0. */
  underwater: CurvePoint[]
  /** Every episode deeper than zero, deepest first. */
  episodes: Drawdown[]
}

/**
 * Peak-to-trough episodes on a cumulative curve. The account starts at zero
 * before the first trade, so a first trade that loses is already a drawdown.
 */
export function drawdowns(curve: CurvePoint[]): DrawdownReport {
  const underwater: CurvePoint[] = []
  const episodes: Drawdown[] = []
  let peak = 0
  let peakAt = curve[0]?.t ?? 0
  let peakIndex = -1
  let open: Drawdown | null = null

  for (const [i, p] of curve.entries()) {
    if (p.value >= peak) {
      if (open) {
        open.recoveredAt = p.t
        episodes.push(open)
        open = null
      }
      peak = p.value
      peakAt = p.t
      peakIndex = i
    } else {
      const depth = peak - p.value
      if (!open) open = { depth, peakAt, troughAt: p.t, trades: i - peakIndex, troughIndex: i }
      else if (depth > open.depth) {
        open.depth = depth
        open.troughAt = p.t
        open.trades = i - peakIndex
        open.troughIndex = i
      }
    }
    underwater.push({ t: p.t, value: Math.min(0, p.value - peak) })
  }
  if (open) episodes.push(open)
  episodes.sort((a, b) => b.depth - a.depth)

  const last = curve.at(-1)
  return {
    max: episodes[0] ?? null,
    current: last ? Math.max(0, peak - last.value) : 0,
    currentSince: open ? open.peakAt : undefined,
    underwater,
    episodes,
  }
}

/** Below this many trades a resample mostly echoes a handful of outcomes. */
export const MIN_SIMULATION = 30

export interface Simulation {
  runs: number
  /** Trades per simulated run — the same count as the period. */
  length: number
  /** Worst drop of a typical run. */
  drawdownMedian: number
  /** Worst drop exceeded by one run in twenty. */
  drawdown95: number
  /**
   * Where the real worst drop sits among the simulated ones (0–1), ties
   * counted as half. Ties are common, not a corner case: when the worst drop
   * is one large loss, every run that draws that trade among wins reproduces
   * it to the cent.
   */
  realRank: number
  /** Share of runs whose worst drop was strictly larger than the real one. */
  worseShare: number
  /** Share of runs that end below zero. */
  lossProbability: number
  /** Longest losing streak of a typical run, and of the worst one in twenty. */
  streakMedian: number
  streak95: number
  /** Total result of a typical run and of the fifth percentile. */
  totalMedian: number
  total5: number
}

/**
 * mulberry32: small, fast, and seedable. Seeded from the data so the same
 * trades always print the same figures — a figure that moved on every
 * refetch would read as news.
 */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedOf(values: number[]): number {
  let h = 2166136261
  for (const v of values) {
    h ^= Math.round(v * 100)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[i]
}

/** One run's worst drop and longest losing streak, from zero. Breakeven trades do not break a streak, as in `computePerformance`. */
export function pathStats(pnls: ArrayLike<number>): { drawdown: number; streak: number; total: number } {
  let value = 0
  let peak = 0
  let drawdown = 0
  let run = 0
  let streak = 0
  for (let i = 0; i < pnls.length; i++) {
    const x = pnls[i]
    value += x
    if (value > peak) peak = value
    else if (peak - value > drawdown) drawdown = peak - value
    if (x < 0) {
      run++
      if (run > streak) streak = run
    } else if (x > 0) run = 0
  }
  return { drawdown, streak, total: value }
}

export function simulate(pnls: number[], runs = 5000): Simulation | null {
  const n = pnls.length
  if (n < MIN_SIMULATION) return null
  const random = rng(seedOf(pnls))
  const real = pathStats(pnls)

  const dds: number[] = new Array(runs)
  const streaks: number[] = new Array(runs)
  const totals: number[] = new Array(runs)
  const path = new Float64Array(n)
  let below = 0
  let equal = 0
  let above = 0
  let losing = 0
  for (let r = 0; r < runs; r++) {
    for (let i = 0; i < n; i++) path[i] = pnls[Math.floor(random() * n)]
    const s = pathStats(path)
    dds[r] = s.drawdown
    streaks[r] = s.streak
    totals[r] = s.total
    const diff = s.drawdown - real.drawdown
    if (Math.abs(diff) < 0.005) equal++
    else if (diff < 0) below++
    else above++
    if (s.total < 0) losing++
  }
  dds.sort((a, b) => a - b)
  streaks.sort((a, b) => a - b)
  totals.sort((a, b) => a - b)

  return {
    runs,
    length: n,
    drawdownMedian: quantile(dds, 0.5),
    drawdown95: quantile(dds, 0.95),
    realRank: (below + equal / 2) / runs,
    worseShare: above / runs,
    lossProbability: losing / runs,
    streakMedian: quantile(streaks, 0.5),
    streak95: quantile(streaks, 0.95),
    totalMedian: quantile(totals, 0.5),
    total5: quantile(totals, 0.05),
  }
}
