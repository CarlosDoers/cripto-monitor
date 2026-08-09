import { atr, ema, highest, lowest, rsi } from './ta'

/**
 * Reversal Trap Probability Bands — port of the BigBeluga TradingView indicator.
 *
 * The idea: price pokes outside a wide ATR envelope and closes back inside. That
 * failed breakout is read as a trap, and the reversal is traded back toward the
 * envelope's baseline.
 *
 *   - poke below the lower band, close back inside  → LONG
 *   - poke above the upper band, close back inside  → SHORT
 *
 * (The original calls these "bull trap" and "bear trap"; that naming is the
 * opposite of common usage, so this port says long/short instead.)
 *
 * Two details decide whether the port matches the original bar for bar:
 *
 *   1. The trap counter is read *before* it is updated — Pine's
 *      `close_above_envelope_count[1]` is the previous bar's value.
 *   2. `close[1] < upper_band` compares the previous close against the *current*
 *      bar's band, not the previous bar's.
 *
 * Only confirmed candles are fed in: a signal on a still-forming candle can
 * vanish when that candle closes.
 */

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  confirmed: boolean
}

export interface TrapSettings {
  /** EMA/ATR length for the envelope. */
  envelopeLen: number
  /** How far the bands sit from the baseline, in ATRs. */
  multiplier: number
  /** Max candles allowed outside the band before a reversal is disqualified. */
  trapWindow: number
  /** Cooldown in bars between signals. */
  signalGap: number
  rsiLen: number
  /** ATR(100) multiple added beyond the structural level for the stop. */
  stopMult: number
  /**
   * Round-trip trading cost as a fraction of notional (0.001 = 0.1 %).
   *
   * This is not cosmetic. A cost of 0.1 % against a stop sitting 0.25 % away is
   * 0.4 R per trade — on short timeframes it turns a positive edge negative.
   */
  feeRate: number
}

/** The indicator as published by BigBeluga. */
export const ORIGINAL_SETTINGS: TrapSettings = {
  envelopeLen: 55,
  multiplier: 4,
  trapWindow: 10,
  signalGap: 10,
  rsiLen: 20,
  stopMult: 0.5,
  feeRate: 0.001,
}

/**
 * Narrower bands and a tighter stop. Swept across 10 instruments and 4
 * timeframes (~5 700 signals), then re-checked on the half of the history it
 * was never tuned on, where it held up. It turns 4 of 10 instruments profitable
 * into 8 of 10.
 */
export const TUNED_SETTINGS: TrapSettings = {
  ...ORIGINAL_SETTINGS,
  multiplier: 2.5,
  stopMult: 0.25,
}

export const DEFAULT_SETTINGS = TUNED_SETTINGS

export type SignalSide = 'long' | 'short'
export type SignalOutcome = 'win' | 'loss' | 'open'

export interface Signal {
  index: number
  time: number
  side: SignalSide
  entry: number
  target: number
  stop: number
  rsi: number
  /** RSI decile, 0–10. */
  bucket: number
  /** Historical hit rate for this side+bucket at the moment of firing, or null. */
  priorRate: number | null
  priorSample: number
  outcome: SignalOutcome
  /** Bar index where it hit target or stop. */
  closedIndex?: number
  closedTime?: number
  /** Reward-to-risk implied by target and stop. */
  riskReward: number
  /**
   * Round-trip cost expressed in R. Small when the stop is far from entry,
   * crushing when it is close — which is why short timeframes suffer most.
   */
  feeR: number
}

export interface BucketStats {
  bucket: number
  total: number
  wins: number
  rate: number
}

export interface TrapAnalysis {
  /** Per-candle band values, aligned with the input candles (NaN while warming). */
  basis: number[]
  upper: number[]
  lower: number[]
  rsiSeries: number[]
  signals: Signal[]
  /** The still-running signal, if any. */
  active: Signal | null
  longBuckets: BucketStats[]
  shortBuckets: BucketStats[]
  wins: number
  losses: number
  open: number
  /** Wins over decided signals, 0–1. */
  winRate: number
  /** Mean reward-to-risk of the signals, as sized by target and stop. */
  avgRiskReward: number
  /**
   * Expected result per signal in R (one R = the distance to the stop).
   *
   * This is the number that decides whether the setup is worth taking. A 30 %
   * win rate at 3R is profitable; a 60 % win rate at 0.5R is not — the win rate
   * alone cannot tell you which one you have.
   */
  expectancyR: number
  /** Cumulative R across resolved signals. */
  totalR: number
  /** Expectancy after trading costs — the figure that decides if it is worth it. */
  expectancyNetR: number
  /** Mean round-trip cost in R. */
  avgFeeR: number
  /** Bars needed before the first signal can appear. */
  warmup: number
}

/** One round trip, priced in R: cost / (distance to the stop). */
function feeInR(entry: number, stop: number, feeRate: number): number {
  const risk = Math.abs(entry - stop) / entry
  return risk > 0 ? feeRate / risk : 0
}

const emptyBuckets = (): BucketStats[] =>
  Array.from({ length: 11 }, (_, bucket) => ({ bucket, total: 0, wins: 0, rate: 0 }))

export function analyseTraps(
  candles: Candle[],
  settings: TrapSettings = DEFAULT_SETTINGS,
): TrapAnalysis {
  const { envelopeLen, multiplier, trapWindow, signalGap, rsiLen, stopMult, feeRate } = settings

  const close = candles.map((c) => c.close)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)

  const basis = ema(close, envelopeLen)
  const vola = atr(high, low, close, envelopeLen)
  const rsiSeries = rsi(close, rsiLen)
  const atr100 = atr(high, low, close, 100)
  const low2 = lowest(low, 2)
  const high2 = highest(high, 2)

  const upper = basis.map((b, i) => b + multiplier * vola[i])
  const lower = basis.map((b, i) => b - multiplier * vola[i])

  const longBuckets = emptyBuckets()
  const shortBuckets = emptyBuckets()
  const signals: Signal[] = []

  let aboveCount = 0
  let belowCount = 0
  let lastSignalBar = -1000
  let activeLong: Signal | null = null
  let activeShort: Signal | null = null

  const warmup = Math.max(envelopeLen, rsiLen, 100)

  for (let i = 1; i < candles.length; i++) {
    const bandsReady = Number.isFinite(upper[i]) && Number.isFinite(upper[i - 1])

    // ---- 1. Detect traps, reading the counters from the previous bar ----
    let rawShort = false
    let rawLong = false

    if (bandsReady) {
      if (close[i] < upper[i]) {
        const withinWindow = aboveCount <= trapWindow
        if (high[i] > upper[i] && close[i - 1] < upper[i] && withinWindow) rawShort = true
        else if (close[i - 1] > upper[i] && withinWindow) rawShort = true
      }
      if (close[i] > lower[i]) {
        const withinWindow = belowCount <= trapWindow
        if (low[i] < lower[i] && close[i - 1] > lower[i] && withinWindow) rawLong = true
        else if (close[i - 1] < lower[i] && withinWindow) rawLong = true
      }
    }

    // ---- 2. Update the counters, after the check above ----
    if (bandsReady && high[i] > upper[i]) aboveCount += 1
    else aboveCount = 0
    if (bandsReady && low[i] < lower[i]) belowCount += 1
    else belowCount = 0

    // ---- 3. Cooldown, shared between both directions ----
    const canFire = i - lastSignalBar >= signalGap && i >= warmup
    const longTrap = rawLong && canFire
    const shortTrap = rawShort && canFire
    if (longTrap || shortTrap) lastSignalBar = i

    const bucket = Math.max(0, Math.min(10, Math.round(rsiSeries[i] / 10)))
    const pad = atr100[i] * stopMult

    // ---- 4. Open positions ----
    if (longTrap && !activeLong) {
      const prior = longBuckets[bucket]
      const target = basis[i]
      const stop = low2[i] - pad
      const signal: Signal = {
        index: i,
        time: candles[i].time,
        side: 'long',
        entry: close[i],
        target,
        stop,
        rsi: rsiSeries[i],
        bucket,
        priorRate: prior.total > 0 ? prior.wins / prior.total : null,
        priorSample: prior.total,
        outcome: 'open',
        riskReward: Math.abs(target - close[i]) / Math.max(Math.abs(close[i] - stop), 1e-9),
        feeR: feeInR(close[i], stop, feeRate),
      }
      signals.push(signal)
      activeLong = signal
    }

    if (shortTrap && !activeShort) {
      const prior = shortBuckets[bucket]
      const target = basis[i]
      const stop = high2[i] + pad
      const signal: Signal = {
        index: i,
        time: candles[i].time,
        side: 'short',
        entry: close[i],
        target,
        stop,
        rsi: rsiSeries[i],
        bucket,
        priorRate: prior.total > 0 ? prior.wins / prior.total : null,
        priorSample: prior.total,
        outcome: 'open',
        riskReward: Math.abs(close[i] - target) / Math.max(Math.abs(stop - close[i]), 1e-9),
        feeR: feeInR(close[i], stop, feeRate),
      }
      signals.push(signal)
      activeShort = signal
    }

    // ---- 5. Resolve open positions (never on the firing bar or the next) ----
    const settled = i - lastSignalBar > 1

    if (activeLong && settled) {
      if (high[i] >= activeLong.target) {
        const b = longBuckets[activeLong.bucket]
        b.total += 1
        b.wins += 1
        activeLong.outcome = 'win'
        activeLong.closedIndex = i
        activeLong.closedTime = candles[i].time
        activeLong = null
      } else if (low[i] < activeLong.stop) {
        longBuckets[activeLong.bucket].total += 1
        activeLong.outcome = 'loss'
        activeLong.closedIndex = i
        activeLong.closedTime = candles[i].time
        activeLong = null
      }
    }

    if (activeShort && settled) {
      if (low[i] <= activeShort.target) {
        const b = shortBuckets[activeShort.bucket]
        b.total += 1
        b.wins += 1
        activeShort.outcome = 'win'
        activeShort.closedIndex = i
        activeShort.closedTime = candles[i].time
        activeShort = null
      } else if (high[i] > activeShort.stop) {
        shortBuckets[activeShort.bucket].total += 1
        activeShort.outcome = 'loss'
        activeShort.closedIndex = i
        activeShort.closedTime = candles[i].time
        activeShort = null
      }
    }
  }

  for (const list of [longBuckets, shortBuckets]) {
    for (const b of list) b.rate = b.total > 0 ? b.wins / b.total : 0
  }

  const wins = signals.filter((s) => s.outcome === 'win').length
  const losses = signals.filter((s) => s.outcome === 'loss').length
  const open = signals.filter((s) => s.outcome === 'open').length

  const resolved = signals.filter((s) => s.outcome !== 'open')
  // A win banks its reward-to-risk; a loss costs exactly 1R by definition.
  const totalR = resolved.reduce((sum, s) => sum + (s.outcome === 'win' ? s.riskReward : -1), 0)
  const rrValues = signals.map((s) => s.riskReward).filter(Number.isFinite)
  const feeValues = signals.map((s) => s.feeR).filter(Number.isFinite)
  const avgFeeR = feeValues.length ? feeValues.reduce((a, b) => a + b, 0) / feeValues.length : 0
  const expectancyR = resolved.length ? totalR / resolved.length : 0

  return {
    avgRiskReward: rrValues.length ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length : 0,
    expectancyR,
    expectancyNetR: expectancyR - avgFeeR,
    avgFeeR,
    totalR,
    basis,
    upper,
    lower,
    rsiSeries,
    signals,
    active: activeLong ?? activeShort,
    longBuckets,
    shortBuckets,
    wins,
    losses,
    open,
    winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    warmup,
  }
}
