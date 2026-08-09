/**
 * The contract every strategy implements, so the Señales view can render any of
 * them without knowing which one it is.
 *
 * Signals are always priced in **R** — one R is the distance from entry to the
 * initial stop. That is what makes a mean-reversion setup with a fixed target
 * comparable to a trend setup whose winners run for 40 R.
 */

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  confirmed: boolean
}

export type SignalSide = 'long' | 'short'
export type SignalOutcome = 'win' | 'loss' | 'open'

export interface StrategySignal {
  index: number
  time: number
  side: SignalSide
  entry: number
  /** Initial stop. Defines 1 R. */
  stop: number
  /** Fixed target, when the strategy has one. Trailing exits leave it undefined. */
  target?: number
  outcome: SignalOutcome
  /** Realised result in R once resolved. */
  resultR?: number
  closedIndex?: number
  closedTime?: number
  closedPrice?: number
  /** Round-trip cost in R: cost / (stop distance). */
  feeR: number
  /** Reward-to-risk at entry, only meaningful with a fixed target. */
  riskReward?: number
  /** Free-form context shown in the table, e.g. RSI at entry. */
  note?: string
}

/** A line drawn on the price chart. */
export interface Overlay {
  key: string
  label: string
  values: number[]
  colour: string
  dashed?: boolean
  /** Fill the area down to this other overlay. */
  fillTo?: string
}

export interface StrategyResult {
  signals: StrategySignal[]
  active: StrategySignal | null
  overlays: Overlay[]
  wins: number
  losses: number
  open: number
  winRate: number
  /** Mean realised R before costs. */
  expectancyR: number
  expectancyNetR: number
  avgFeeR: number
  totalR: number
  /** Mean R of the winners — how much the good trades actually pay. */
  avgWinR: number
  warmup: number
}

export function summarise(
  signals: StrategySignal[],
  overlays: Overlay[],
  warmup: number,
  active: StrategySignal | null,
): StrategyResult {
  const resolved = signals.filter((s) => s.outcome !== 'open')
  const wins = resolved.filter((s) => s.outcome === 'win')
  const totalR = resolved.reduce((sum, s) => sum + (s.resultR ?? 0), 0)
  const netTotal = resolved.reduce((sum, s) => sum + (s.resultR ?? 0) - s.feeR, 0)
  const fees = signals.map((s) => s.feeR).filter(Number.isFinite)

  return {
    signals,
    active,
    overlays,
    wins: wins.length,
    losses: resolved.length - wins.length,
    open: signals.length - resolved.length,
    winRate: resolved.length ? wins.length / resolved.length : 0,
    expectancyR: resolved.length ? totalR / resolved.length : 0,
    expectancyNetR: resolved.length ? netTotal / resolved.length : 0,
    avgFeeR: fees.length ? fees.reduce((a, b) => a + b, 0) / fees.length : 0,
    totalR,
    avgWinR: wins.length ? wins.reduce((s, w) => s + (w.resultR ?? 0), 0) / wins.length : 0,
    warmup,
  }
}

/** Cost of one round trip expressed in R. */
export function feeInR(entry: number, stop: number, feeRate: number): number {
  const risk = Math.abs(entry - stop) / entry
  return risk > 0 ? feeRate / risk : 0
}
