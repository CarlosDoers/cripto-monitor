/**
 * How big a trade can be for the risk you choose — the question the app warns
 * about everywhere and answered nowhere.
 *
 * Measured the day it was written, this account held 68 691 US$ of notional on
 * 14 730 US$ of net worth (4,7×), two positions without a stop and 2 US$ free.
 * Every strategy figure is in R, the distance from entry to stop; this turns an
 * R into contracts: risk ÷ (stop distance × contract value), rounded *down* to
 * the lot so the rounding never adds risk.
 */

export interface SizingInput {
  /** What the account is worth; the risk is a share of it. */
  equity: number
  /** 0.01 = risk 1 % of the equity if the stop is hit. */
  riskShare: number
  entry: number
  stop: number
  /** Contract value in its own currency (coins for linear, dollars for inverse). 1 on spot. */
  ctVal: number
  ctType: 'linear' | 'inverse' | 'spot'
  lotSz: number
  minSz: number
  leverage: number
  freeMargin: number
  /** Round trip, as a fraction of notional (0.001 = 0.1 %). */
  feeRate: number
}

export interface Sizing {
  side: 'long' | 'short'
  /** Contracts (coins on spot), rounded down to the lot. */
  size: number
  /** What hitting the stop costs at that size, after rounding. */
  riskUsd: number
  /** What one contract loses at the stop. */
  riskPerUnit: number
  notionalUsd: number
  /** Margin the position ties up at the chosen leverage. */
  margin: number
  /** Notional against equity: 4,7 means a 1 % move is 4,7 % of the account. */
  exposure: number
  /** The round trip in R: above ~0,3 R the fee eats a measured edge. */
  feeR: number
  /** Not even the minimum size fits the risk. */
  tooSmall: boolean
  /** The free margin cannot carry it. */
  marginShort: boolean
}

export function sizePosition(i: SizingInput): Sizing | null {
  const distance = Math.abs(i.entry - i.stop)
  if (!(i.entry > 0) || !(i.stop > 0) || !(distance > 0) || !(i.equity > 0) || !(i.ctVal > 0)) return null
  const side = i.stop < i.entry ? 'long' : 'short'

  // What one unit loses between entry and stop, in dollars.
  const riskPerUnit =
    i.ctType === 'inverse' ? (i.ctVal * distance) / i.entry : i.ctType === 'spot' ? distance : distance * i.ctVal
  // What one unit is worth at entry.
  const unitValue = i.ctType === 'inverse' ? i.ctVal : i.ctType === 'spot' ? i.entry : i.ctVal * i.entry

  const lot = i.lotSz > 0 ? i.lotSz : 1
  const budget = i.equity * i.riskShare
  // Floating point turns 3.0000000000000004 lots into 3; a tiny epsilon keeps an exact fit.
  const size = Math.floor(budget / riskPerUnit / lot + 1e-9) * lot
  const notionalUsd = size * unitValue
  const margin = i.leverage > 0 ? notionalUsd / i.leverage : notionalUsd

  return {
    side,
    size,
    riskUsd: size * riskPerUnit,
    riskPerUnit,
    notionalUsd,
    margin,
    exposure: notionalUsd / i.equity,
    feeR: i.feeRate / (distance / i.entry),
    tooSmall: size < (i.minSz > 0 ? i.minSz : lot),
    marginShort: margin > i.freeMargin,
  }
}

/**
 * A number typed the Spanish way ("84.604,5") or the other ("84604.5"). With a
 * comma present the dots are thousands; without one, a dot is the decimal.
 */
export const parseTyped = (text: string) => {
  const t = text.replace(/\s/g, '')
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
}
