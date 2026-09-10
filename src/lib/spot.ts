import { num } from './format'
import type { Fill } from './types'

/**
 * Spot trading results, reconstructed — because OKX does not report them.
 *
 * `fillPnl` is `0` on every spot fill and `pnl` is `0` on every spot order, so
 * unlike derivatives there is no per-trade result to read. The only way to a
 * number is to match sells against the buys that preceded them and price the
 * difference. This does that with FIFO.
 *
 * **The honest half of this module is what it refuses to count.** A sell whose
 * coins arrived by deposit, airdrop or reward has no purchase price anywhere in
 * the API — they were acquired outside OKX. Pricing them at zero would invent a
 * profit; pricing them at market would invent a wash. So those proceeds are
 * counted separately as `uncoveredProceeds` and never enter the PnL, and any UI
 * showing the PnL has to show that figure beside it. On this account the split
 * was 537 US$ measurable against 5 888 US$ of sales that are not, which is
 * exactly why a bare "spot PnL" headline would mislead.
 */

export interface SpotPair {
  instId: string
  /** Currency the pair is priced in — the PnL below is denominated in it. */
  quote: string
  /** Realised on round trips this history can actually price. */
  realised: number
  /** Trading fees, as a positive cost. */
  fees: number
  /** Proceeds from sales this history could match against a buy. */
  coveredProceeds: number
  /** Proceeds from coins with no known purchase price. Never profit. */
  uncoveredProceeds: number
  /** Units sold that had no matching buy. */
  uncoveredSize: number
  sells: number
  buys: number
  lastTs: number
}

export interface SpotResult {
  pairs: SpotPair[]
  /** Net realised across dollar-quoted pairs, after fees. */
  netUsd: number
  grossUsd: number
  feesUsd: number
  /** Dollar proceeds this history cannot price. The caveat, quantified. */
  uncoveredUsd: number
  /** Dollar proceeds it can. */
  coveredUsd: number
  /**
   * Share of sale proceeds the PnL covers, 0–1. Below ~0.5 the headline
   * describes a minority of what the account actually sold, and the UI has to
   * say so next to the figure rather than under it.
   */
  coverage: number
  fillCount: number
  firstTs: number
  lastTs: number
}

/** Pairs quoted in a dollar stablecoin, the only ones the app can total up. */
export const DOLLAR_QUOTES = new Set(['USDT', 'USDC', 'USD', 'DAI'])

interface Lot {
  size: number
  price: number
}

export function computeSpot(fills: Fill[]): SpotResult {
  const ordered = [...fills].sort((a, b) => num(a.ts) - num(b.ts))
  const lots = new Map<string, Lot[]>()
  const pairs = new Map<string, SpotPair>()

  for (const fill of ordered) {
    const [base, quote] = fill.instId.split('-')
    if (!base || !quote) continue

    const size = num(fill.fillSz)
    const price = num(fill.fillPx)
    if (!(size > 0) || !(price > 0)) continue

    const pair =
      pairs.get(fill.instId) ??
      {
        instId: fill.instId,
        quote,
        realised: 0,
        fees: 0,
        coveredProceeds: 0,
        uncoveredProceeds: 0,
        uncoveredSize: 0,
        sells: 0,
        buys: 0,
        lastTs: 0,
      }
    pairs.set(fill.instId, pair)
    pair.lastTs = Math.max(pair.lastTs, num(fill.ts))

    // OKX signs fees from the account's point of view: negative means charged.
    // A buy is normally charged in the base currency and a sell in the quote,
    // so the base ones are converted at the fill price to keep one unit.
    const feeRaw = -num(fill.fee)
    const feeInBase = fill.feeCcy === base
    pair.fees += feeInBase ? feeRaw * price : feeRaw

    const queue = lots.get(fill.instId) ?? []
    lots.set(fill.instId, queue)

    if (fill.side === 'buy') {
      // The fee on a buy comes out of the coins received, so the lot is what
      // actually landed — not what was matched.
      queue.push({ size: feeInBase ? size - feeRaw : size, price })
      pair.buys++
      continue
    }

    pair.sells++
    let remaining = size
    while (remaining > 1e-12 && queue.length > 0) {
      const lot = queue[0]
      const taken = Math.min(remaining, lot.size)
      pair.realised += taken * (price - lot.price)
      pair.coveredProceeds += taken * price
      lot.size -= taken
      remaining -= taken
      if (lot.size <= 1e-12) queue.shift()
    }
    // Nothing left to match against: these coins came from somewhere this API
    // cannot see. Their proceeds are real, their cost is unknown.
    if (remaining > 1e-12) {
      pair.uncoveredProceeds += remaining * price
      pair.uncoveredSize += remaining
    }
  }

  const list = [...pairs.values()].sort((a, b) => b.lastTs - a.lastTs)
  const dollar = list.filter((p) => DOLLAR_QUOTES.has(p.quote))

  const grossUsd = dollar.reduce((sum, p) => sum + p.realised, 0)
  const feesUsd = dollar.reduce((sum, p) => sum + p.fees, 0)
  const uncoveredUsd = dollar.reduce((sum, p) => sum + p.uncoveredProceeds, 0)

  // Coverage in money, not in pairs: what fraction of everything sold this
  // history could actually put a purchase price on.
  const coveredUsd = dollar.reduce((sum, p) => sum + p.coveredProceeds, 0)
  const soldUsd = coveredUsd + uncoveredUsd
  const times = ordered.map((f) => num(f.ts)).filter((t) => t > 0)

  return {
    pairs: list,
    grossUsd,
    feesUsd,
    netUsd: grossUsd - feesUsd,
    uncoveredUsd,
    coveredUsd,
    coverage: soldUsd > 0 ? coveredUsd / soldUsd : 0,
    fillCount: ordered.length,
    firstTs: times.length ? Math.min(...times) : 0,
    lastTs: times.length ? Math.max(...times) : 0,
  }
}
