import { num } from './format'
import type { Fill } from './types'

/**
 * What the account actually paid in fees, as opposed to what its fee tier says.
 *
 * The tier gives two numbers — maker and taker — but the figure that decides
 * whether a backtest applies is the *mix*: an account that rests its orders in
 * the book pays close to the maker rate, and one that crosses the spread pays
 * taker. OKX marks each fill with `execType` (`M`/`T`), so the mix is measured
 * rather than assumed.
 *
 * The weighting deliberately avoids the contract multiplier. A fill's notional
 * is not `size × price` — that misses `ctVal`, which differs per contract — but
 * it *is* `fee / rate`, because the rate is a fraction of the notional and the
 * rate for that fill is known from `execType`. So the volume-weighted cost comes
 * out exactly, with no per-instrument metadata and no risk of mixing contract
 * sizes.
 */
export interface FeeMix {
  /** Fills that carried a fee. */
  fills: number
  maker: number
  taker: number
  /** Volume-weighted cost per side, as a fraction of notional. */
  effectiveRate: number
  /** Total paid, in the fee currency. */
  paid: number
}

export function feeMix(fills: Fill[], makerRate: number, takerRate: number): FeeMix | undefined {
  if (makerRate <= 0 || takerRate <= 0) return undefined

  let paid = 0
  let notional = 0
  let maker = 0
  let taker = 0

  for (const fill of fills) {
    const fee = Math.abs(num(fill.fee))
    // A zero-fee fill carries no information about the rate it was charged at.
    if (fee === 0) continue
    const isMaker = fill.execType === 'M'
    paid += fee
    notional += fee / (isMaker ? makerRate : takerRate)
    if (isMaker) maker++
    else taker++
  }

  if (notional === 0) return undefined
  return { fills: maker + taker, maker, taker, effectiveRate: paid / notional, paid }
}
