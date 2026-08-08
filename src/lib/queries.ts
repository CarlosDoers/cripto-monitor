import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { okx, ApiError } from './api'
import type {
  AccountBalance,
  AccountConfig,
  AssetValuation,
  Bill,
  Candle,
  Fill,
  FundingBalance,
  Order,
  Position,
  Ticker,
} from './types'

/**
 * Polling cadence. Every tick is a serverless invocation, so these are tuned for
 * a personal monitor rather than a trading terminal — and TanStack Query pauses
 * intervals while the tab is in the background, so an idle tab costs nothing.
 */
const LIVE = 30_000
const SLOW = 300_000

type Options<T> = Omit<UseQueryOptions<T[], ApiError>, 'queryKey' | 'queryFn'>

function useOkx<T>(
  key: unknown[],
  path: string,
  params?: Record<string, string | number | undefined>,
  options?: Options<T> & { refetchInterval?: number },
) {
  return useQuery<T[], ApiError>({
    queryKey: key,
    queryFn: () => okx<T>(path, params),
    refetchInterval: LIVE,
    ...options,
  })
}

export function useBalance() {
  return useOkx<AccountBalance>(['balance'], '/api/v5/account/balance')
}

export function usePositions() {
  return useOkx<Position>(['positions'], '/api/v5/account/positions')
}

export function useFunding() {
  return useOkx<FundingBalance>(['funding'], '/api/v5/asset/balances')
}

export function useValuation() {
  return useOkx<AssetValuation>(['valuation'], '/api/v5/asset/asset-valuation', { ccy: 'USD' })
}

export function useAccountConfig() {
  return useOkx<AccountConfig>(['account-config'], '/api/v5/account/config', undefined, {
    refetchInterval: SLOW,
    staleTime: SLOW,
    retry: false,
  })
}

export function useTickers(instType = 'SPOT') {
  return useOkx<Ticker>(['tickers', instType], '/api/v5/market/tickers', { instType })
}

export function useOpenOrders() {
  return useOkx<Order>(['open-orders'], '/api/v5/trade/orders-pending', { limit: 100 })
}

export function useOrderHistory(instType = 'SPOT') {
  return useOkx<Order>(
    ['order-history', instType],
    '/api/v5/trade/orders-history-archive',
    { instType, limit: 100 },
    { refetchInterval: SLOW },
  )
}

export function useFills(instType = 'SPOT') {
  return useOkx<Fill>(
    ['fills', instType],
    '/api/v5/trade/fills-history',
    { instType, limit: 100 },
    { refetchInterval: SLOW },
  )
}

export function useBills() {
  return useOkx<Bill>(
    ['bills'],
    '/api/v5/account/bills',
    { limit: 100 },
    { refetchInterval: SLOW },
  )
}

/**
 * Recent candles for one instrument, used for the sparklines. Disabled when
 * there is no instId so callers can pass a maybe-undefined symbol.
 */
export function useCandles(instId: string | undefined, bar = '1H', limit = 48) {
  return useQuery<Candle[], ApiError>({
    queryKey: ['candles', instId, bar, limit],
    queryFn: () => okx<Candle>('/api/v5/market/candles', { instId: instId!, bar, limit }),
    enabled: Boolean(instId),
    // Shape context, not a live price — the tickers query already carries that.
    refetchInterval: SLOW,
    staleTime: SLOW,
    retry: false,
  })
}
