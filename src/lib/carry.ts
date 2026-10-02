import { useMemo } from 'react'
import { num } from './format'
import { usePortfolio, useSpotPrices } from './portfolio'
import {
  useFundingBoard,
  useFundingTrails,
  useInstruments,
  usePositions,
  useTickers,
  useTradeFee,
} from './queries'
import { MIN_LIQUID_VOLUME } from './markets'
import type { FundingRate, Instrument } from './types'

/**
 * Funding carry: hold a coin and short the same amount of its perpetual. The
 * price moves cancel; what is left is the funding the short collects.
 *
 * It is the one funding idea that survived measurement (`npm run funding`).
 * Fading extreme funding *loses* — the shorts lost 2.5 % a week, because a
 * crowded long keeps rising in the short run — and a long-short book ranked by
 * funding is noise. Carry is not a prediction, so it does not fail the way
 * those do; what it needs is a rule for when the funding is worth collecting,
 * and the measured one is plain: **in when the last 7 days paid more than 10 %
 * a year, out when they paid nothing.**
 *
 * The evidence below is what `npm run funding` printed and the script checks
 * it against this object, as the audit does for the strategies. Re-run it and
 * update these when the data changes.
 */
export const CARRY_RULE = { enter: 0.1, exit: 0, days: 7 }

/**
 * The rate OKX (and Binance) charge when the perpetual trades on top of the
 * spot: 0.01 % every 8 h, 10.95 % a year — the funding formula clamps the
 * premium term and leaves the interest term. Most X-Perps sit exactly there on
 * a quiet day, so the 10 % threshold is in practice "the funding is at its
 * normal level or above". It was measured at 5, 10, 20 and 30 %, and all four
 * held both halves; 10 % was chosen before measuring.
 */
export const BASE_FUNDING_APR = 0.0001 * 3 * 365

export const CARRY_EVIDENCE = {
  /** Binance USDT perpetuals since 2022, the rule, hedging coins already held. */
  ownApr: 0.1103,
  /** Same, buying the spot with a limit order at this account's fees. */
  spotLimitApr: 0.0917,
  halves: [0.1455, 0.0788] as [number, number],
  coins: 32,
  /** The same rule on the X-Perps, over the ~3 months OKX keeps. */
  xperpOwnApr: 0.1078,
  xperpSpotLimitApr: 0.0749,
  /** BTC's X-Perp under the rule over those months: the coin that paid least. */
  xperpBtcApr: -0.0763,
  /** Daily correlation between X-Perp and Binance funding over the overlap. */
  xperpBinanceCorrelation: 0.07,
  /** Monthly correlation with each shipped strategy. */
  correlation: { reversal: -0.15, donchian: 0.23, opening: -0.06 },
  /** What did not work: shorting the top tenth of funding, per 7-day trade. */
  contrarianShortWeekly: -0.0247,
}

const DAY = 86_400_000
const STABLES = new Set(['USDT', 'USDC', 'USDG', 'DAI', 'TUSD', 'USD', 'EUR'])

/** Settlements per day, from the gap between this period and the next. */
function periodsPerDay(fundingTime: string, nextFundingTime: string): number {
  const gap = num(nextFundingTime) - num(fundingTime)
  return gap > 0 ? DAY / gap : 3
}

/**
 * What the last `days` of settled funding paid, as a yearly rate, from the
 * short's side. Undefined when the history covers less than three days — a
 * contract that just listed has nothing to say yet.
 */
export function trailingApr(rows: FundingRate[] | undefined, now: number, days = CARRY_RULE.days) {
  if (!rows?.length) return undefined
  const from = now - days * DAY
  const inWindow = rows.filter((r) => num(r.fundingTime) > from && num(r.fundingTime) <= now)
  const oldest = Math.min(...rows.map((r) => num(r.fundingTime)))
  const covered = Math.min(days, (now - Math.max(oldest, from)) / DAY)
  if (covered < 3 || !inWindow.length) return undefined
  const sum = inWindow.reduce((s, r) => s + num(r.realizedRate ?? r.fundingRate), 0)
  return (sum * 365) / covered
}

export type CarryStatus = 'cubrir' | 'cobrando' | 'salir' | 'esperar' | 'pequena'

/** The rule, applied. `hedged` means a short on the contract already exists. */
export function carryStatus(apr: number | undefined, hedged: boolean): CarryStatus | undefined {
  if (apr === undefined) return undefined
  if (hedged) return apr <= CARRY_RULE.exit ? 'salir' : 'cobrando'
  return apr > CARRY_RULE.enter ? 'cubrir' : 'esperar'
}

export interface CarryContract {
  instId: string
  ccy: string
  inst: Instrument | undefined
  /** Live rate of the running period, as a yearly rate. */
  nowApr: number
  /** Last 7 days settled, as a yearly rate. */
  trailing: number | undefined
  volumeUsd: number
  /** Value of one contract at the last price. */
  contractUsd: number
}

export interface HoldingCarry extends CarryContract {
  held: number
  heldUsd: number
  /** Share of the portfolio, for leaving dust out. */
  weight: number
  /** Contracts that would hedge the holding, rounded down to the lot. */
  contracts: number
  /** Contracts currently short on this X-Perp. */
  hedged: number
  status: CarryStatus | undefined
  /** At the trailing rate, on the value held. */
  incomeUsd: number
  /** Days of funding that pay for opening and closing the short. */
  breakEvenDays: number | undefined
}

export interface SpotCarry extends CarryContract {
  spotPair: string | undefined
  /** Days of funding that pay for buying and selling the spot plus the short. */
  breakEvenDays: number | undefined
}

/** How many of the highest-paying contracts get their history fetched. */
const SCAN = 15

export function useCarry() {
  const board = useFundingBoard()
  const instruments = useInstruments('FUTURES')
  const tickers = useTickers('FUTURES')
  const spot = useSpotPrices()
  const portfolio = usePortfolio()
  const positions = usePositions()
  const futuresFee = useTradeFee('FUTURES')
  const spotFee = useTradeFee('SPOT')

  // OKX signs fees from the account's side: negative is charged.
  const taker = -num(futuresFee.data?.[0]?.taker) || 0.0005
  const spotMaker = -num(spotFee.data?.[0]?.maker) || 0.002
  const costs = { own: 2 * taker, spot: 2 * (spotMaker + taker), taker, spotMaker }

  /** The crypto X-Perps, with their live rate and volume. */
  const contracts = useMemo(() => {
    const instById = new Map((instruments.data ?? []).map((i) => [i.instId, i]))
    const tickById = new Map((tickers.data ?? []).map((t) => [t.instId, t]))
    const out: CarryContract[] = []
    for (const r of board.data ?? []) {
      if (!r.instId.includes('_UM_XPERP')) continue
      const inst = instById.get(r.instId)
      if (inst?.instCategory && inst.instCategory !== '1') continue
      const t = tickById.get(r.instId)
      const last = num(t?.last)
      out.push({
        instId: r.instId,
        ccy: r.instId.split('-')[0],
        inst,
        nowApr: num(r.fundingRate) * periodsPerDay(r.fundingTime, r.nextFundingTime) * 365,
        trailing: undefined,
        // volCcy24h is in the base currency on these linear contracts.
        volumeUsd: num(t?.volCcy24h) * last,
        contractUsd: num(inst?.ctVal) * last,
      })
    }
    return out
  }, [board.data, instruments.data, tickers.data])

  /** One X-Perp per coin: the most traded, when a coin has more than one. */
  const byCoin = useMemo(() => {
    const m = new Map<string, CarryContract>()
    for (const c of contracts) {
      const prev = m.get(c.ccy)
      if (!prev || c.volumeUsd > prev.volumeUsd) m.set(c.ccy, c)
    }
    return m
  }, [contracts])

  const shorts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of positions.data ?? []) {
      const pos = num(p.pos)
      if (pos < 0 && p.instId.includes('_UM_XPERP')) m.set(p.instId, -pos)
    }
    return m
  }, [positions.data])

  const holdingsWithContract = useMemo(
    () =>
      portfolio.holdings
        .filter((h) => !STABLES.has(h.ccy) && h.total > 0 && byCoin.has(h.ccy))
        .map((h) => ({ h, c: byCoin.get(h.ccy)! })),
    [portfolio.holdings, byCoin],
  )

  const scanned = useMemo(
    () =>
      [...byCoin.values()]
        .filter((c) => c.volumeUsd >= MIN_LIQUID_VOLUME)
        .sort((a, b) => b.nowApr - a.nowApr)
        .slice(0, SCAN),
    [byCoin],
  )

  // A holding smaller than one contract cannot be hedged, so its history is
  // not worth a request: the account had a dozen such coins worth cents.
  const wanted = useMemo(() => {
    const hedgeable = holdingsWithContract.filter(
      ({ h, c }) => h.total >= num(c.inst?.ctVal) * (num(c.inst?.minSz) || 1) || shorts.has(c.instId),
    )
    return [...new Set([...hedgeable.map((x) => x.c.instId), ...scanned.map((c) => c.instId)])].sort()
  }, [holdingsWithContract, scanned, shorts])
  const trails = useFundingTrails(wanted)

  const now = Date.now()
  const withTrail = (c: CarryContract): CarryContract => ({ ...c, trailing: trailingApr(trails.byInst[c.instId], now) })

  const holdings: HoldingCarry[] = holdingsWithContract
    .map(({ h, c }) => {
      const row = withTrail(c)
      const ctVal = num(c.inst?.ctVal)
      const lot = num(c.inst?.lotSz) || 1
      const contractsNeeded = ctVal > 0 ? Math.floor(h.total / ctVal / lot) * lot : 0
      const hedged = shorts.get(c.instId) ?? 0
      const tooSmall = contractsNeeded < (num(c.inst?.minSz) || 1)
      const status = tooSmall && !hedged ? 'pequena' : carryStatus(row.trailing, hedged > 0)
      const apr = row.trailing ?? 0
      return {
        ...row,
        held: h.total,
        heldUsd: h.usd,
        weight: h.weight,
        contracts: contractsNeeded,
        hedged,
        status,
        incomeUsd: apr > 0 ? h.usd * apr : 0,
        breakEvenDays: apr > 0 ? costs.own / (apr / 365) : undefined,
      } satisfies HoldingCarry
    })
    .sort((a, b) => b.heldUsd - a.heldUsd)

  const spotPairOf = (ccy: string) =>
    [`${ccy}-USDC`, `${ccy}-EUR`, `${ccy}-USDT`].find((p) => spot.has(p))

  const opportunities: SpotCarry[] = scanned
    .map((c) => {
      const row = withTrail(c)
      const apr = row.trailing ?? 0
      return {
        ...row,
        spotPair: spotPairOf(c.ccy),
        breakEvenDays: apr > 0 ? costs.spot / (apr / 365) : undefined,
      }
    })
    .filter((c) => (c.trailing ?? 0) > CARRY_RULE.enter)
    .sort((a, b) => (b.trailing ?? 0) - (a.trailing ?? 0))

  const liquid = contracts.filter((c) => c.volumeUsd >= MIN_LIQUID_VOLUME)
  const sortedNow = liquid.map((c) => c.nowApr).sort((a, b) => a - b)

  return {
    holdings,
    opportunities,
    board: {
      liquid: liquid.length,
      paying: liquid.filter((c) => c.nowApr > CARRY_RULE.enter).length,
      /** Paying clearly more than the base rate, not just sitting on it. */
      aboveBase: liquid.filter((c) => c.nowApr > BASE_FUNDING_APR * 1.1).length,
      negative: liquid.filter((c) => c.nowApr < 0).length,
      median: sortedNow.length ? sortedNow[Math.floor(sortedNow.length / 2)] : NaN,
    },
    costs,
    isLoading: board.isLoading || instruments.isLoading || tickers.isLoading || portfolio.isLoading,
    trailsPending: trails.pending,
    isFetching: board.isFetching,
    error: board.error ?? instruments.error ?? null,
  }
}

/**
 * Hedges whose funding has stopped paying, for the Resumen's notice. Lighter
 * than `useCarry`: it only needs the positions and holdings the Resumen already
 * loads, and the trail of the contracts actually shorted against a holding.
 */
export function useCarryExits() {
  const portfolio = usePortfolio()
  const positions = usePositions()
  const hedges = useMemo(() => {
    const held = new Set(portfolio.holdings.filter((h) => h.total > 0).map((h) => h.ccy))
    return (positions.data ?? [])
      .filter((p) => p.instId.includes('_UM_XPERP') && num(p.pos) < 0 && held.has(p.instId.split('-')[0]))
      .map((p) => p.instId)
      .sort()
  }, [portfolio.holdings, positions.data])
  const trails = useFundingTrails(hedges)
  const now = Date.now()
  return hedges
    .map((instId) => ({ instId, apr: trailingApr(trails.byInst[instId], now) }))
    .filter((x) => x.apr !== undefined && x.apr <= CARRY_RULE.exit)
}
