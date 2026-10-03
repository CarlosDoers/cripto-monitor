import { useEffect, useMemo } from 'react'
import { useBalance, useFunding, useTickers, useValuation } from './queries'
import { num } from './format'
import { setUsdToEur } from './currency'
import { buildPortfolio } from './portfolioCore'
export { priceOf } from './portfolioCore'

/**
 * Feeds the euro rate to the formatters, from OKX's own USDC-EUR price so the
 * figures match what its app shows instead of drifting against a fixed rate.
 *
 * Mounted once at the root, never inside a view. It used to be a side effect of
 * `usePortfolio()`, so only the views that price the portfolio ever loaded the
 * rate: opened on Rendimiento with euros selected, the rate stayed unknown and
 * every figure fell back to dollars while the switch still read "€". The
 * ticker strip fetches the same query on every screen, so this costs no request.
 */
export function useEurRate() {
  const tickers = useTickers('SPOT')
  useEffect(() => {
    const byId = new Map((tickers.data ?? []).map((t) => [t.instId, t]))
    const eur = num(byId.get('USDC-EUR')?.last) || num(byId.get('USDT-EUR')?.last)
    if (eur > 0) setUsdToEur(eur)
  }, [tickers.data])
}

/**
 * Spot tickers keyed by instrument, for anything that needs to put a dollar
 * value on a currency — a deposit in XLM says nothing until it is priced.
 */
export function useSpotPrices() {
  const tickers = useTickers('SPOT')
  return useMemo(
    () => new Map((tickers.data ?? []).map((t) => [t.instId, t])),
    [tickers.data],
  )
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

  const core = useMemo(
    () =>
      buildPortfolio({
        balance: balance.data,
        funding: funding.data,
        tickers: tickers.data,
        valuation: valuation.data,
      }),
    [balance.data, funding.data, tickers.data, valuation.data],
  )
  const { holdings, totalUsd, netWorth, change24h, freeMargin, isolatedEq } = core

  return {
    /** Deployable margin. Near zero means no room to defend a position. */
    freeMargin,
    isolatedEq,
    holdings,
    /** Sum of the priced holdings (trading + funding wallets). */
    totalUsd,
    /** Everything OKX values across all wallets, Earn included. */
    netWorth,
    change24h,
    tradingEq: core.tradingEq,
    isLoading: balance.isLoading || funding.isLoading || tickers.isLoading,
    isFetching:
      balance.isFetching || funding.isFetching || tickers.isFetching || valuation.isFetching,
    error: balance.error ?? funding.error ?? tickers.error,
  }
}
