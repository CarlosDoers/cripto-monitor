import { num } from './format'
import type { AccountBalance, AssetValuation, BalanceDetail, FundingBalance, Holding, Ticker } from './types'

/**
 * The portfolio from raw OKX responses — no React, so the same arithmetic
 * serves the app (`usePortfolio`), the "Copiar para Claude" snapshot and the
 * claude.ai connector, and the three can never disagree about a number.
 */

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'USD'])

export function priceOf(ccy: string, tickers: Map<string, Ticker>): number | undefined {
  if (STABLES.has(ccy)) return 1
  const t = tickers.get(`${ccy}-USDT`) ?? tickers.get(`${ccy}-USDC`)
  return t ? num(t.last) : undefined
}

export function change24hOf(ccy: string, tickers: Map<string, Ticker>): number | undefined {
  if (STABLES.has(ccy)) return 0
  const t = tickers.get(`${ccy}-USDT`) ?? tickers.get(`${ccy}-USDC`)
  if (!t) return undefined
  const open = num(t.open24h)
  if (open === 0) return undefined
  return (num(t.last) - open) / open
}

export interface PortfolioCore {
  holdings: Holding[]
  totalUsd: number
  netWorth: number
  change24h: number | undefined
  freeMargin: number
  isolatedEq: number
  tradingEq: number
}

export function buildPortfolio(raw: {
  balance: AccountBalance[] | undefined
  funding: FundingBalance[] | undefined
  tickers: Ticker[] | undefined
  valuation: AssetValuation[] | undefined
}): PortfolioCore {
  const tickerMap = new Map<string, Ticker>()
  for (const t of raw.tickers ?? []) tickerMap.set(t.instId, t)

  const byCcy = new Map<string, Holding>()
  const upsert = (ccy: string): Holding => {
    let entry = byCcy.get(ccy)
    if (!entry) {
      entry = { ccy, trading: 0, funding: 0, total: 0, usd: 0, weight: 0 }
      byCcy.set(ccy, entry)
    }
    return entry
  }

  for (const detail of raw.balance?.[0]?.details ?? []) {
    const entry = upsert(detail.ccy)
    const amount = num(detail.eq) || num(detail.cashBal)
    entry.trading += amount
    // Trust OKX's own valuation when it provides one.
    entry.usd += num(detail.eqUsd)
    const upl = num(detail.spotUpl)
    if (upl !== 0) entry.upl = (entry.upl ?? 0) + upl
  }
  for (const item of raw.funding ?? []) upsert(item.ccy).funding += num(item.bal)

  const holdings: Holding[] = []
  for (const entry of byCcy.values()) {
    entry.total = entry.trading + entry.funding
    entry.price = priceOf(entry.ccy, tickerMap)
    entry.change24h = change24hOf(entry.ccy, tickerMap)
    // Price the funding side ourselves, and the trading side too if OKX
    // returned no eqUsd for it.
    const fundingUsd = entry.price !== undefined ? entry.funding * entry.price : 0
    if (entry.usd === 0 && entry.price !== undefined) entry.usd = entry.total * entry.price
    else entry.usd += fundingUsd
    // Dust below a cent is noise, not a holding.
    if (entry.total !== 0 || entry.usd >= 0.01) holdings.push(entry)
  }
  const totalUsd = holdings.reduce((sum, h) => sum + h.usd, 0)
  for (const h of holdings) h.weight = totalUsd > 0 ? h.usd / totalUsd : 0
  holdings.sort((a, b) => b.usd - a.usd)

  /** Portfolio-weighted 24h move, ignoring assets with no ticker. */
  let priced = 0
  let weighted = 0
  for (const h of holdings) {
    if (h.change24h === undefined) continue
    priced += h.usd
    weighted += h.usd * h.change24h
  }

  // asset-valuation covers every wallet including Earn, so it is the honest
  // headline figure; the priced holdings are the fallback when it is missing.
  const reported = num(raw.valuation?.[0]?.totalBal)

  /**
   * Margin the account can still deploy, summed per currency: with every
   * position on isolated margin OKX leaves the account-level `availEq` empty,
   * and `num()` would turn that into a reassuring-looking 0.
   */
  const details = raw.balance?.[0]?.details ?? []
  // Every figure in `details` is in its own currency; OKX has already priced the
  // equity, so that ratio is the exchange rate.
  const inUsd = (d: BalanceDetail, field: keyof BalanceDetail) => {
    const eq = num(d.eq)
    return eq > 0 ? num(d[field] as string) * (num(d.eqUsd) / eq) : 0
  }

  return {
    holdings,
    totalUsd,
    netWorth: reported > 0 ? reported : totalUsd,
    change24h: priced > 0 ? weighted / priced : undefined,
    freeMargin: details.reduce((sum, d) => sum + inUsd(d, d.availEq ? 'availEq' : 'availBal'), 0),
    isolatedEq: details.reduce((sum, d) => sum + inUsd(d, 'isoEq'), 0),
    tradingEq: num(raw.balance?.[0]?.totalEq),
  }
}
