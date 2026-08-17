import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { okx, ApiError } from './api'
import type {
  AccountBalance,
  AccountConfig,
  AlgoOrder,
  AssetValuation,
  Bill,
  Candle,
  ClosedPosition,
  FundingRate,
  Instrument,
  OpenInterest,
  Fill,
  FundingBalance,
  Order,
  Position,
  Ticker,
  TradeFee,
  Transfer,
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

/** OKX hard-caps a page at 100; this bounds how many pages we chase. */
const MAX_PAGES = 5
const PAGE_SIZE = 100

export interface ClosedPositionsResult {
  positions: ClosedPosition[]
  /** True when the account has more history than MAX_PAGES could fetch. */
  truncated: boolean
}

/**
 * Every closed position, paginated.
 *
 * Without this the statistics would silently stop at 100 trades and start
 * lying — a win rate over "all time" that quietly means "the last 100".
 * `after` asks OKX for records older than the given close time.
 */
export function useClosedPositions() {
  return useQuery<ClosedPositionsResult, ApiError>({
    queryKey: ['positions-history'],
    queryFn: async () => {
      const positions: ClosedPosition[] = []
      let after: string | undefined

      for (let page = 0; page < MAX_PAGES; page++) {
        const batch = await okx<ClosedPosition>('/api/v5/account/positions-history', {
          limit: PAGE_SIZE,
          after,
        })
        positions.push(...batch)
        if (batch.length < PAGE_SIZE) return { positions, truncated: false }

        after = batch.reduce(
          (oldest, row) => (Number(row.uTime) < Number(oldest) ? row.uTime : oldest),
          batch[0].uTime,
        )
      }

      return { positions, truncated: true }
    },
    refetchInterval: SLOW,
  })
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

/** OKX returns at most 300 candles per request. */
const CANDLE_PAGE = 300

/**
 * A long candle history, paginated. The indicator needs a few hundred bars just
 * to warm up its 100-period ATR, so a single page would leave almost nothing to
 * analyse.
 *
 * Only confirmed candles are kept: the in-progress one changes under your feet,
 * and a signal computed on it can vanish when it closes.
 */
export function useCandleHistory(instId: string, bar: string, pages = 4) {
  return useQuery<Candle[], ApiError>({
    queryKey: ['candle-history', instId, bar, pages],
    queryFn: async () => {
      const all: Candle[] = []
      let after: string | undefined

      for (let page = 0; page < pages; page++) {
        const batch = await okx<Candle>('/api/v5/market/candles', {
          instId,
          bar,
          limit: CANDLE_PAGE,
          after,
        })
        if (batch.length === 0) break
        all.push(...batch)
        after = batch[batch.length - 1][0]
        if (batch.length < CANDLE_PAGE) break
      }

      // OKX returns newest-first; analysis walks forward through time.
      return all.sort((a, b) => Number(a[0]) - Number(b[0]))
    },
    enabled: Boolean(instId),
    refetchInterval: LIVE,
    staleTime: LIVE,
  })
}

/** Open interest across a product type — half of any liquidity picture. */
export function useOpenInterest(instType: string) {
  return useOkx<OpenInterest>(['open-interest', instType], '/api/v5/public/open-interest', {
    instType,
  })
}

const DAY = 24 * 60 * 60 * 1000

/** Tradable instruments of one product type, for the signal instrument picker. */
export function useInstruments(instType: string) {
  return useOkx<Instrument>(
    ['instruments', instType],
    '/api/v5/public/instruments',
    { instType },
    // The catalogue barely changes; refetching it hourly would be pure waste.
    { refetchInterval: DAY, staleTime: DAY },
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

/**
 * The account's real maker/taker rates.
 *
 * Every expectancy figure in Señales is quoted net of an assumed 0.1 % round
 * trip. This is what decides whether that assumption holds for this account,
 * so it is worth a request even though it almost never changes.
 */
export function useTradeFee(instType = 'SWAP') {
  return useOkx<TradeFee>(
    ['trade-fee', instType],
    '/api/v5/account/trade-fee',
    { instType },
    { refetchInterval: DAY, staleTime: DAY, retry: false },
  )
}

/**
 * Live stop-loss and take-profit orders.
 *
 * OKX splits conditional orders across order types and requires `ordType` on
 * the request, so a single call cannot see them all — `conditional` covers a
 * lone stop or target and `oco` covers the pair. Without both, a position that
 * *is* protected can still look bare.
 */
export function useAlgoOrders() {
  return useQuery<AlgoOrder[], ApiError>({
    queryKey: ['algo-orders'],
    queryFn: async () => {
      const [conditional, oco] = await Promise.all([
        okx<AlgoOrder>('/api/v5/trade/orders-algo-pending', { ordType: 'conditional', limit: 100 }),
        okx<AlgoOrder>('/api/v5/trade/orders-algo-pending', { ordType: 'oco', limit: 100 }),
      ])
      return [...conditional, ...oco]
    },
    refetchInterval: LIVE,
  })
}

/**
 * Funding rate for one perpetual. Enabled only for perps: asking about a spot
 * pair is an error, not an empty result.
 */
export function useFundingRate(instId: string | undefined) {
  const isPerp = Boolean(instId && (instId.includes('SWAP') || instId.includes('XPERP')))
  return useQuery<FundingRate[], ApiError>({
    queryKey: ['funding-rate', instId],
    queryFn: () => okx<FundingRate>('/api/v5/public/funding-rate', { instId: instId! }),
    enabled: isPerp,
    refetchInterval: SLOW,
    staleTime: SLOW,
    retry: false,
  })
}

export interface TransferHistory {
  deposits: Transfer[]
  withdrawals: Transfer[]
}

/**
 * Money moved in and out of the account.
 *
 * Needed to read the portfolio honestly: a balance that grew because of a
 * deposit is not the same as one that grew from trading, and nothing else in
 * the app can tell them apart.
 */
export function useTransfers() {
  return useQuery<TransferHistory, ApiError>({
    queryKey: ['transfers'],
    queryFn: async () => {
      const [deposits, withdrawals] = await Promise.all([
        okx<Transfer>('/api/v5/asset/deposit-history', { limit: 100 }),
        okx<Transfer>('/api/v5/asset/withdrawal-history', { limit: 100 }),
      ])
      return { deposits, withdrawals }
    },
    refetchInterval: SLOW,
  })
}
