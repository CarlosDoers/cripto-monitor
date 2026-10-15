/**
 * What a trade of each strategy was worth at each age, in the history it was
 * measured on: the net R after a round trip, marked to the close of that bar
 * while still open and final once closed, with the spread of it.
 *
 * It is what makes a young ledger readable. A trend follower cuts its losers
 * fast and lets the winners run, so the trades that have closed after a month
 * are mostly the losers and their mean (−1 R) says nothing about the strategy:
 * the winners are still open. Compared with this curve, each live trade is
 * measured against what the history's trades were worth *at that same age* —
 * closed or not — and what is left is a deviation that can be read.
 *
 * 30 crypto X-Perps (BTC, ETH and SOL for the reversal), the candles of the
 * boards `npm run improve curves` reads, 2022–2026. `npm run improve evidence`
 * measures them again and exits non-zero on drift. Ages are in bars of the
 * track's own timeframe; past the last one the curve stays flat, which is where
 * every strategy's had settled.
 */
export interface AgeCurve {
  /** Ages in bars, ascending. */
  bars: number[]
  /** Mean net R of a trade at that age. */
  mean: number[]
  /** Standard deviation of it across trades. */
  sd: number[]
}

export const AGE_CURVES: Record<string, AgeCurve> = {
  'donchian/fast@4H': {
    bars: [0, 1, 2, 3, 4, 6, 8, 12, 18, 24, 36, 48, 72, 96, 144, 192, 288, 384, 576, 864, 1152, 1728, 2400],
    mean: [-0.021, 0.011, 0.014, 0.029, 0.038, 0.028, 0.048, 0.08, 0.105, 0.144, 0.207, 0.177, 0.192, 0.175, 0.197, 0.218, 0.166, 0.165, 0.184, 0.187, 0.197, 0.212, 0.234],
    sd: [0.01, 0.41, 0.53, 0.63, 0.72, 0.89, 1.04, 1.28, 1.56, 1.84, 2.13, 2.27, 2.6, 2.78, 3.02, 3.36, 3.02, 3.02, 3.06, 3.09, 3.12, 3.19, 3.34],
  },
  'donchian/trend@4H': {
    bars: [0, 1, 2, 3, 4, 6, 8, 12, 18, 24, 36, 48, 72, 96, 144, 192, 288, 384, 576, 864, 1152, 1728, 2400],
    mean: [-0.022, 0.019, 0.024, 0.041, 0.054, 0.075, 0.093, 0.13, 0.167, 0.211, 0.281, 0.262, 0.282, 0.274, 0.362, 0.431, 0.318, 0.314, 0.334, 0.333, 0.372, 0.389, 0.412],
    sd: [0.01, 0.46, 0.58, 0.66, 0.74, 0.94, 1.09, 1.35, 1.74, 2.07, 2.39, 2.54, 2.94, 3.14, 4.06, 5.06, 4.21, 4.19, 4.21, 4.26, 4.35, 4.49, 4.69],
  },
  'ema200/base@4H': {
    bars: [0, 1, 2, 3, 4, 6, 8, 12, 18, 24, 36, 48, 72, 96, 144, 192, 288, 384, 576, 864, 1152, 1728, 2400],
    mean: [-0.023, -0.007, -0.001, 0, 0.012, 0.024, 0.034, 0.054, 0.086, 0.123, 0.128, 0.136, 0.154, 0.164, 0.204, 0.25, 0.197, 0.204, 0.205, 0.206, 0.227, 0.235, 0.244],
    sd: [0.01, 0.38, 0.49, 0.55, 0.62, 0.74, 0.83, 1.01, 1.25, 1.51, 1.66, 1.81, 2.07, 2.27, 3.02, 3.72, 3.38, 3.6, 3.41, 3.46, 3.54, 3.67, 3.8],
  },
  'donchian/trend@1H': {
    bars: [0, 1, 2, 3, 4, 6, 8, 12, 18, 24, 36, 48, 72, 96, 144, 192, 288, 384, 576, 864, 1152, 1728, 2400],
    mean: [-0.048, -0.045, -0.047, -0.048, -0.038, -0.027, -0.017, 0, 0.029, 0.019, 0.046, 0.07, 0.107, 0.117, 0.138, 0.134, 0.147, 0.143, 0.126, 0.13, 0.133, 0.113, 0.127],
    sd: [0.03, 0.44, 0.58, 0.68, 0.78, 0.92, 1.03, 1.21, 1.4, 1.57, 1.86, 2.13, 2.54, 2.76, 3.1, 3.25, 3.5, 3.59, 3.48, 3.49, 3.5, 3.4, 3.44],
  },
  'reversal/tuned@1D': {
    bars: [0, 1, 2, 3, 4, 6, 8, 12, 18, 24, 36, 48, 72, 96, 144, 192, 288, 384],
    mean: [-0.023, -0.028, 0.016, 0.023, 0.093, 0.106, 0.173, 0.23, 0.306, 0.335, 0.362, 0.388, 0.405, 0.405, 0.389, 0.382, 0.372, 0.407],
    sd: [0.01, 0.68, 0.99, 1.17, 1.26, 1.35, 1.51, 1.66, 1.73, 1.75, 1.76, 1.79, 1.79, 1.79, 1.8, 1.8, 1.75, 1.79],
  },
}

/** Linear interpolation on the curve's grid; flat before the first age and after the last. */
function interpolate(bars: number[], values: number[], age: number): number {
  if (age <= bars[0]) return values[0]
  const last = bars.length - 1
  if (age >= bars[last]) return values[last]
  let hi = 1
  while (bars[hi] < age) hi++
  const t = (age - bars[hi - 1]) / (bars[hi] - bars[hi - 1])
  return values[hi - 1] + t * (values[hi] - values[hi - 1])
}

/**
 * What the history's trades of `track` were worth at `age` bars, and how much
 * they differed. Null for a track with no curve measured.
 */
export function expectedAt(track: string, age: number): { mean: number; sd: number } | null {
  const c = AGE_CURVES[track]
  if (!c) return null
  return { mean: interpolate(c.bars, c.mean, age), sd: interpolate(c.bars, c.sd, age) }
}

/**
 * How many times wider than independent noise the band has to be to mean what it
 * says. Signals fired the same day on twenty contracts share one market, so a
 * mean of n of them moves as if it were far fewer: the statistic was replayed on
 * the history itself — every window of 7 to 60 days, all the entries that began
 * in it, read at its end as the view reads a ledger — and its z-scores were
 * found to spread 2.2 to 2.5 times what independence says (`npm run improve
 * calibrate`; 95 % of them fall inside 1.96 × this). The reversal fires about
 * once a week on three contracts and has little to share: 1.1.
 */
export const NOISE_INFLATION: Record<string, number> = {
  'donchian/fast@4H': 2.4,
  'donchian/trend@4H': 2.4,
  'ema200/base@4H': 2.3,
  'donchian/trend@1H': 2.1,
  'reversal/tuned@1D': 1.1,
}

/** The factor for a track; a strategy that was never calibrated gets the trend followers' typical one. */
export const inflationOf = (track: string): number => NOISE_INFLATION[track] ?? 2.3
