import { useMemo } from 'react'
import { useBalance, useFunding, useTickers, useValuation } from './queries'
import { num } from './format'
import { setUsdToEur } from './currency'
import type { Holding, Ticker } from './types'

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'USD'])

function priceOf(ccy: string, tickers: Map<string, Ticker>): number | undefined {
  if (STABLES.has(ccy)) return 1
  const t = tickers.get(`${ccy}-USDT`) ?? tickers.get(`${ccy}-USDC`)
  return t ? num(t.last) : undefined
}

function change24hOf(ccy: string, tickers: Map<string, Ticker>): number | undefined {
  if (STABLES.has(ccy)) return 0
  const t = tickers.get(`${ccy}-USDT`) ?? tickers.get(`${ccy}-USDC`)
  if (!t) return undefined
  const open = num(t.open24h)
  if (open === 0) return undefined
  return (num(t.last) - open) / open
}

/**
 * The portfolio as a single list, merging the trading and funding accounts and
 * pricing everything in USD. OKX gives a USD equity per currency on the trading
 * side (`eqUsd`); the funding side has no valuation, so it is priced off the
 * spot tickers.
 */
export function usePortfolio() {
  const balance = useBalance()
  const funding = useFunding()
  const tickers = useTickers('SPOT')
  const valuation = useValuation()

  const tickerMap = useMemo(() => {
    const map = new Map<string, Ticker>()
    for (const t of tickers.data ?? []) map.set(t.instId, t)
    // OKX's own USDC-EUR price, so the euro figures here match the ones its app
    // shows instead of drifting against a hardcoded rate.
    const eur = num(map.get('USDC-EUR')?.last) || num(map.get('USDT-EUR')?.last)
    if (eur > 0) setUsdToEur(eur)
    return map
  }, [tickers.data])

  const holdings = useMemo<Holding[]>(() => {
    const byCcy = new Map<string, Holding>()

    const upsert = (ccy: string): Holding => {
      let entry = byCcy.get(ccy)
      if (!entry) {
        entry = { ccy, trading: 0, funding: 0, total: 0, usd: 0, weight: 0 }
        byCcy.set(ccy, entry)
      }
      return entry
    }

    for (const detail of balance.data?.[0]?.details ?? []) {
      const entry = upsert(detail.ccy)
      const amount = num(detail.eq) || num(detail.cashBal)
      entry.trading += amount
      // Trust OKX's own valuation when it provides one.
      entry.usd += num(detail.eqUsd)
      const upl = num(detail.spotUpl)
      if (upl !== 0) entry.upl = (entry.upl ?? 0) + upl
    }

    for (const item of funding.data ?? []) {
      const entry = upsert(item.ccy)
      entry.funding += num(item.bal)
    }

    const holdingList: Holding[] = []
    for (const entry of byCcy.values()) {
      entry.total = entry.trading + entry.funding
      entry.price = priceOf(entry.ccy, tickerMap)
      entry.change24h = change24hOf(entry.ccy, tickerMap)

      // Price the funding side ourselves, and the trading side too if OKX
      // returned no eqUsd for it.
      const fundingUsd = entry.price !== undefined ? entry.funding * entry.price : 0
      if (entry.usd === 0 && entry.price !== undefined) {
        entry.usd = entry.total * entry.price
      } else {
        entry.usd += fundingUsd
      }

      // Dust below a cent is noise, not a holding.
      if (entry.total !== 0 || entry.usd >= 0.01) holdingList.push(entry)
    }

    const totalUsd = holdingList.reduce((sum, h) => sum + h.usd, 0)
    for (const h of holdingList) h.weight = totalUsd > 0 ? h.usd / totalUsd : 0

    return holdingList.sort((a, b) => b.usd - a.usd)
  }, [balance.data, funding.data, tickerMap])

  const totalUsd = useMemo(() => holdings.reduce((sum, h) => sum + h.usd, 0), [holdings])

  /** Portfolio-weighted 24h move, ignoring assets with no ticker. */
  const change24h = useMemo(() => {
    let priced = 0
    let weighted = 0
    for (const h of holdings) {
      if (h.change24h === undefined) continue
      priced += h.usd
      weighted += h.usd * h.change24h
    }
    return priced > 0 ? weighted / priced : undefined
  }, [holdings])

  // asset-valuation covers every wallet including Earn, so it is the honest
  // headline figure; the priced holdings are the fallback when it is missing.
  // Both views read this same number so they can never disagree.
  const reported = num(valuation.data?.[0]?.totalBal)
  const netWorth = reported > 0 ? reported : totalUsd

  return {
    holdings,
    /** Sum of the priced holdings (trading + funding wallets). */
    totalUsd,
    /** Everything OKX values across all wallets, Earn included. */
    netWorth,
    change24h,
    tradingEq: num(balance.data?.[0]?.totalEq),
    isLoading: balance.isLoading || funding.isLoading || tickers.isLoading,
    isFetching:
      balance.isFetching || funding.isFetching || tickers.isFetching || valuation.isFetching,
    error: balance.error ?? funding.error ?? tickers.error,
  }
}
