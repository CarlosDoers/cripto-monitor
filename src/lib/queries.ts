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
  DcaBot,
  DcaPosition,
  CalendarEvent,
  FundingRate,
  GridBot,
  IndexTicker,
  OrderBook,
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

/**
 * Recent funding settlements for a perp, newest first.
 *
 * `useFundingRate` answers what the next settlement costs; this answers what the
 * position has been paying. Both are needed: a rate of 0.01 % is cheap if it has
 * been flat and a warning if it has tripled over three days.
 *
 * Settled history never changes, so it sits on SLOW — one page of 100 covers a
 * month of eight-hour periods.
 */
export function useFundingHistory(instId: string | undefined, limit = 100) {
  return useQuery<FundingRate[], ApiError>({
    queryKey: ['funding-history', instId, limit],
    queryFn: () =>
      okx<FundingRate>('/api/v5/public/funding-rate-history', { instId: instId!, limit }),
    enabled: Boolean(instId),
    refetchInterval: SLOW,
    staleTime: SLOW,
  })
}

/** Historical candles never change, so they are fetched once and kept. */
const ARCHIVE = 6 * 60 * 60 * 1000

/**
 * Bar duration, used to compute every archive page's cursor up front. OKX caps
 * `history-candles` at 20 requests per 2 seconds, and chaining 40-odd pages off
 * each other's last timestamp both serialises them and trips that limit — the
 * view came back "Too Many Requests". Candles sit on a fixed grid, so the
 * cursors are arithmetic and the pages can go out in paced parallel batches.
 */
const BAR_MS: Record<string, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1H': 3_600_000,
  '2H': 7_200_000,
  '4H': 14_400_000,
  '6H': 21_600_000,
  '12H': 43_200_000,
  '1D': 86_400_000,
}

/** Ten requests, then wait out the rest of the second. Keeps under 20 per 2 s. */
const ARCHIVE_BATCH = 10
const ARCHIVE_BATCH_MS = 1_100

/**
 * Deep history, from `/market/history-candles`.
 *
 * `/market/candles` stops at roughly 1440 bars whatever you ask it, which on
 * 15 m is two weeks — less than the opening range needs just to warm up its
 * volume filter. This endpoint pages backwards without that ceiling.
 *
 * It costs one invocation per page, so it is only enabled for the strategies
 * that ask for it (`archiveBars`), and it never refetches: old candles are
 * immutable and the fresh tail already arrives via `useCandleHistory`.
 */
export function useCandleArchive(instId: string, bar: string, bars: number) {
  const pages = Math.ceil(bars / 100)
  const step = BAR_MS[bar] ?? 0
  return useQuery<Candle[], ApiError>({
    queryKey: ['candle-archive', instId, bar, pages],
    queryFn: async () => {
      const now = Date.now()
      const cursors = Array.from({ length: pages }, (_, page) => String(now - page * 100 * step))
      const all: Candle[] = []

      for (let i = 0; i < cursors.length; i += ARCHIVE_BATCH) {
        const started = Date.now()
        const responses = await Promise.all(
          cursors.slice(i, i + ARCHIVE_BATCH).map((after) =>
            okx<Candle>('/api/v5/market/history-candles', { instId, bar, limit: 100, after }),
          ),
        )
        for (const rows of responses) all.push(...rows)
        const rest = ARCHIVE_BATCH_MS - (Date.now() - started)
        if (i + ARCHIVE_BATCH < cursors.length && rest > 0) {
          await new Promise((done) => setTimeout(done, rest))
        }
      }

      // Pages computed from a grid overlap wherever a candle is missing.
      const seen = new Set<string>()
      return all
        .filter((c) => !seen.has(c[0]) && seen.add(c[0]))
        .sort((a, b) => Number(a[0]) - Number(b[0]))
    },
    enabled: Boolean(instId) && pages > 0 && step > 0,
    staleTime: ARCHIVE,
    gcTime: ARCHIVE,
    refetchInterval: false,
    // A rate limit is transient and blanks the whole view if it reaches it.
    retry: 3,
    retryDelay: (attempt) => 1_000 * 2 ** attempt,
  })
}

/**
 * Every running bot, both DCA families merged.
 *
 * `algoOrdType` is required and takes one family at a time, the same trap as
 * `ordType` on /trade/orders-algo-pending: ask for `contract_dca` alone and a
 * spot DCA bot is silently missing from the list. Both have to be fetched.
 *
 * The endpoint is `dca/ongoing-list`, not the `orders-algo-pending` every other
 * bot family uses, and it is absent from the published v5 docs — the path comes
 * from OKX's own agent-trade-kit.
 */
export function useDcaBots() {
  return useQuery<DcaBot[], ApiError>({
    queryKey: ['dca-bots'],
    queryFn: async () => {
      const families = await Promise.all(
        ['contract_dca', 'spot_dca'].map((algoOrdType) =>
          okx<DcaBot>('/api/v5/tradingBot/dca/ongoing-list', { algoOrdType }),
        ),
      )
      return families.flat()
    },
    refetchInterval: LIVE,
  })
}

/**
 * The position behind each bot: average price, take profit, liquidation, and
 * how many safety orders have fired.
 *
 * On the SLOW cadence deliberately. It costs one invocation per bot, and none
 * of what it adds moves between ticks — those numbers only change when a safety
 * order fills. Live PnL comes from the list above, which is one request for all
 * of them.
 */
export function useDcaPositions(bots: DcaBot[]) {
  const key = bots.map((b) => `${b.algoId}:${b.algoOrdType}`).sort()
  return useQuery<Record<string, DcaPosition>, ApiError>({
    queryKey: ['dca-positions', key],
    queryFn: async () => {
      const rows = await Promise.all(
        bots.map((b) =>
          okx<DcaPosition>('/api/v5/tradingBot/dca/position-details', {
            algoId: b.algoId,
            algoOrdType: b.algoOrdType,
          }),
        ),
      )
      return Object.fromEntries(
        rows.flat().filter((p) => p?.algoId).map((p) => [p.algoId, p]),
      )
    },
    enabled: bots.length > 0,
    refetchInterval: SLOW,
    staleTime: SLOW,
  })
}

/** Running grid bots, both flavours. Empty on this account, but they show up. */
export function useGridBots() {
  return useQuery<GridBot[], ApiError>({
    queryKey: ['grid-bots'],
    queryFn: async () => {
      const families = await Promise.all(
        ['grid', 'contract_grid'].map((algoOrdType) =>
          okx<GridBot>('/api/v5/tradingBot/grid/orders-algo-pending', { algoOrdType }),
        ),
      )
      return families.flat()
    },
    refetchInterval: LIVE,
  })
}

/** Bots that have stopped, so a finished run leaves a trace. */
export function useBotHistory() {
  return useQuery<{ dca: DcaBot[]; grid: GridBot[] }, ApiError>({
    queryKey: ['bot-history'],
    queryFn: async () => {
      const [contractDca, spotDca, grid, contractGrid] = await Promise.all([
        okx<DcaBot>('/api/v5/tradingBot/dca/history-list', { algoOrdType: 'contract_dca', limit: 50 }),
        okx<DcaBot>('/api/v5/tradingBot/dca/history-list', { algoOrdType: 'spot_dca', limit: 50 }),
        okx<GridBot>('/api/v5/tradingBot/grid/orders-algo-history', { algoOrdType: 'grid', limit: 50 }),
        okx<GridBot>('/api/v5/tradingBot/grid/orders-algo-history', { algoOrdType: 'contract_grid', limit: 50 }),
      ])
      return { dca: [...contractDca, ...spotDca], grid: [...grid, ...contractGrid] }
    },
    refetchInterval: SLOW,
  })
}

/**
 * Every spot index quoted in a currency, in one request.
 *
 * A derivative's premium over its index is real holding cost — a long bought at
 * a premium pays it back on convergence — and asking per contract would be 171
 * requests for the X-PERP board. `quoteCcy` returns the lot, so it is one.
 */
export function useIndexTickers(quoteCcy = 'USD') {
  return useOkx<IndexTicker>(['index-tickers', quoteCcy], '/api/v5/market/index-tickers', {
    quoteCcy,
  })
}

/**
 * Order book depth for one instrument.
 *
 * The ticker already gives the best bid and ask, so the spread needs no request.
 * What this adds is what sits *behind* the top of book, which is what decides
 * whether a position can actually be closed at the price on screen.
 *
 * One request per instrument, so only ever call it for something the user holds.
 */
export function useOrderBook(instId: string | undefined, sz = 50) {
  return useQuery<OrderBook[], ApiError>({
    queryKey: ['books', instId, sz],
    queryFn: () => okx<OrderBook>('/api/v5/market/books', { instId: instId!, sz }),
    enabled: Boolean(instId),
    refetchInterval: LIVE,
    staleTime: LIVE,
  })
}

/**
 * Scheduled macro releases, highest importance first.
 *
 * Context only. The endpoint serves roughly six weeks of past events and then
 * only future scheduled ones, which is nowhere near enough history to measure
 * whether they move anything — so nothing in the app may treat this as signal.
 */
export function useEconomicCalendar(importance = '3') {
  return useOkx<CalendarEvent>(
    ['economic-calendar', importance],
    '/api/v5/public/economic-calendar',
    { importance, limit: 100 },
    { refetchInterval: SLOW, staleTime: SLOW },
  )
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
