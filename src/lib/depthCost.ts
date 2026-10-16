import type { BookLevel } from './types'

/**
 * What it costs to get a position into, or out of, a book — the thing a ticker's spread does not say. The best bid and
 * the best ask are one level each: a spread of 6 bp with 200 dollars behind it is a spread of 6 bp for 200 dollars, and a
 * 5 000-dollar order walks on from there. So the book is walked for the size a trade would actually be.
 */
export interface BookCost {
  mid: number
  /** Ask less bid, in basis points of the mid. */
  spreadBp: number
  /** Buying the size at market: how far over the mid the average fill lands, in basis points. Null when the levels given hold less. */
  buyBp: number | null
  /** Selling it at market: how far under the mid. Null when the levels given hold less. */
  sellBp: number | null
}

/**
 * The average price of filling `usd` of notional against `levels`, best first, or null when they hold less than that.
 * A level's size is in contracts, and `ctVal` is what one contract is worth in the base asset (0.001 oz of gold, one share).
 */
function walk(levels: BookLevel[], usd: number, ctVal: number): number | null {
  let left = usd
  let spent = 0
  let qty = 0
  for (const [px, sz] of levels) {
    const price = Number(px)
    const size = Number(sz) * ctVal
    if (!(price > 0) || !(size > 0)) continue
    const take = Math.min(size, left / price)
    spent += take * price
    qty += take
    left -= take * price
    if (left <= 1e-9) return spent / qty
  }
  return null
}

/**
 * The cost of buying and of selling `usd` at market against a book, from the mid. Null for a book with no bid or no ask:
 * there is nothing to cross.
 */
export function bookCost(book: { asks?: BookLevel[]; bids?: BookLevel[] }, usd: number, ctVal: number): BookCost | null {
  const asks = book.asks ?? []
  const bids = book.bids ?? []
  const ask = Number(asks[0]?.[0])
  const bid = Number(bids[0]?.[0])
  if (!(ask > 0) || !(bid > 0) || !(usd > 0) || !(ctVal > 0)) return null
  const mid = (ask + bid) / 2
  const buy = walk(asks, usd, ctVal)
  const sell = walk(bids, usd, ctVal)
  return {
    mid,
    spreadBp: ((ask - bid) / mid) * 10_000,
    buyBp: buy === null ? null : ((buy - mid) / mid) * 10_000,
    sellBp: sell === null ? null : ((mid - sell) / mid) * 10_000,
  }
}
