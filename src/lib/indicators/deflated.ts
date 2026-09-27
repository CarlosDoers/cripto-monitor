/**
 * Would this edge survive the search that found it?
 *
 * A strategy chosen as the best of many variants looks better than it is: the
 * maximum of N noisy measurements is biased upwards even when every variant is
 * worthless. This project has already met the effect by name — 164 of 648
 * opening-range configurations cleared both halves, exactly the rate chance
 * produces — and until now could only describe it. These are the two
 * statistics that put a number on it, from Bailey & López de Prado:
 *
 * - **Probabilistic Sharpe Ratio** (2012): the probability that the true
 *   per-trade Sharpe exceeds a benchmark, given how many trades there are and
 *   how skewed and fat-tailed they are. Trend followers — few large winners —
 *   need more trades for the same confidence, and this is where that shows.
 * - **Deflated Sharpe Ratio** (2014): the same probability with the benchmark
 *   raised to the Sharpe the best of N worthless trials would reach by luck.
 *
 * Written from the papers, not from a library (the Python implementations are
 * AGPL). The Sharpe here is per trade, on net R, so it is comparable across
 * strategies whatever their holding period.
 *
 * Two approximations, both stated where the figures are printed: the variance
 * of Sharpe across trials is taken as the null's, 1/(n−1), because the sweeps
 * that produced the shipped strategies did not keep every variant's result;
 * and trades on different instruments on the same day are not independent, so
 * n overstates the information — the probabilities are upper bounds.
 */

const EULER = 0.5772156649015329

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2)
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2
}

/** Inverse standard normal CDF (Acklam's rational approximation, error < 1.2e-9). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const low = 0.02425
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - low) return -normInv(1 - p)
  const q = p - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

export interface Moments {
  n: number
  mean: number
  sd: number
  /** Third standardised moment. */
  skew: number
  /** Fourth standardised moment, not excess: 3 for a normal. */
  kurtosis: number
}

export function moments(xs: number[]): Moments {
  const n = xs.length
  const mean = xs.reduce((s, x) => s + x, 0) / n
  let m2 = 0
  let m3 = 0
  let m4 = 0
  for (const x of xs) {
    const d = x - mean
    m2 += d * d
    m3 += d * d * d
    m4 += d * d * d * d
  }
  m2 /= n
  m3 /= n
  m4 /= n
  const sd = Math.sqrt(m2)
  return { n, mean, sd, skew: sd > 0 ? m3 / sd ** 3 : 0, kurtosis: sd > 0 ? m4 / sd ** 4 : 3 }
}

/** P(true per-trade Sharpe > benchmark). */
export function probabilisticSharpe(m: Moments, benchmark = 0): number {
  if (m.n < 3 || !(m.sd > 0)) return NaN
  const sr = m.mean / m.sd
  const denom = 1 - m.skew * sr + ((m.kurtosis - 1) / 4) * sr * sr
  if (!(denom > 0)) return NaN
  return normCdf(((sr - benchmark) * Math.sqrt(m.n - 1)) / Math.sqrt(denom))
}

/** The Sharpe the best of `trials` worthless variants reaches by luck. */
export function expectedMaxSharpe(trials: number, n: number): number {
  if (trials <= 1 || n < 2) return 0
  const z = (1 - EULER) * normInv(1 - 1 / trials) + EULER * normInv(1 - 1 / (trials * Math.E))
  return z / Math.sqrt(n - 1)
}

export interface Deflation {
  /** Per-trade Sharpe of net R. */
  sharpe: number
  /** Probability the edge is real if this were the only variant ever tried. */
  psr: number
  /** The same after `trials` variants. */
  dsr: number
  /** The largest number of variants after which the edge would still clear 95 %. */
  survives: number
}

/** Confidence the gate asks for. */
export const DSR_LEVEL = 0.95

export function deflate(netR: number[], trials = 1): Deflation {
  const m = moments(netR)
  const psr = probabilisticSharpe(m)
  const dsr = probabilisticSharpe(m, expectedMaxSharpe(trials, m.n))
  // Largest N that still clears the level: double until it fails, then
  // bisect the last step, so `survives` agrees with `dsr` at any N.
  const clears = (k: number) => probabilisticSharpe(m, expectedMaxSharpe(k, m.n)) >= DSR_LEVEL
  let survives = 0
  if (psr >= DSR_LEVEL) {
    let lo = 1
    let hi = 2
    while (hi <= 1e6 && clears(hi)) {
      lo = hi
      hi *= 2
    }
    if (hi > 1e6) survives = lo
    else {
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2)
        if (clears(mid)) lo = mid
        else hi = mid
      }
      survives = lo
    }
  }
  return { sharpe: m.sd > 0 ? m.mean / m.sd : NaN, psr, dsr, survives }
}
