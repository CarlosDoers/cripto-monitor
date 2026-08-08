import { useMemo } from 'react'
import { useClosedPositions } from './queries'
import { num } from './format'
import type { ClosedPosition } from './types'

/**
 * Trading statistics derived from closed positions.
 *
 * Every figure comes from OKX's own `realizedPnl`, which is already net of
 * trading fees and funding — nothing here is reconstructed from fills, so the
 * numbers match what actually hit the balance.
 *
 * Spot is deliberately absent: OKX reports `fillPnl: 0` on spot fills, so a
 * win rate there would have to be invented from a cost-basis model over a
 * truncated history. Better to show nothing than a plausible wrong number.
 */

export const PERIODS = [
  { key: '7d', label: '7 días', days: 7 },
  { key: '30d', label: '30 días', days: 30 },
  { key: '90d', label: '90 días', days: 90 },
  { key: 'all', label: 'Todo', days: 0 },
] as const

export type PeriodKey = (typeof PERIODS)[number]['key']

export interface Trade {
  id: string
  instId: string
  /** Instrument without OKX's contract suffix, e.g. `ZEC-USD_UM_XPERP-310530` → `ZEC`. */
  symbol: string
  direction: string
  lever: number
  openPx: number
  closePx: number
  size: number
  /** Net of fees and funding. */
  pnl: number
  grossPnl: number
  pnlRatio: number
  fee: number
  fundingFee: number
  closedAt: number
  openedAt: number
  /** Milliseconds held, or undefined when OKX did not report an open time. */
  duration?: number
  isWin: boolean
  liquidated: boolean
}

export interface GroupStats {
  key: string
  trades: number
  wins: number
  losses: number
  winRate: number
  pnl: number
}

export interface Performance {
  trades: Trade[]
  count: number
  wins: number
  losses: number
  /** 0–1. Breakeven trades are excluded from the denominator. */
  winRate: number
  grossProfit: number
  grossLoss: number
  netPnl: number
  grossPnl: number
  totalCosts: number
  /** Gross profit divided by gross loss. Infinity when there are no losses. */
  profitFactor: number
  avgWin: number
  avgLoss: number
  /** Expected PnL per trade. */
  expectancy: number
  best?: Trade
  worst?: Trade
  /** Positive = winning streak, negative = losing streak. */
  currentStreak: number
  longestWinStreak: number
  longestLossStreak: number
  avgDuration?: number
  byInstrument: GroupStats[]
  byDirection: GroupStats[]
  /** Cumulative net PnL after each trade, oldest first. */
  equityCurve: { t: number; value: number }[]
  liquidations: number
  firstTradeAt?: number
  lastTradeAt?: number
}

/** `ZEC-USD_UM_XPERP-310530` → `ZEC`, `BTC-USDT-SWAP` → `BTC`. */
export function symbolOf(instId: string): string {
  return instId.split('-')[0] ?? instId
}

function toTrade(p: ClosedPosition): Trade {
  const pnl = num(p.realizedPnl)
  const openedAt = num(p.cTime)
  const closedAt = num(p.uTime)
  const valid = openedAt > 0 && closedAt > openedAt

  return {
    id: p.posId,
    instId: p.instId,
    symbol: symbolOf(p.instId),
    direction: p.direction,
    lever: num(p.lever),
    openPx: num(p.openAvgPx),
    closePx: num(p.closeAvgPx),
    size: num(p.closeTotalPos),
    pnl,
    grossPnl: num(p.pnl),
    pnlRatio: num(p.pnlRatio),
    fee: num(p.fee),
    fundingFee: num(p.fundingFee),
    closedAt,
    openedAt,
    duration: valid ? closedAt - openedAt : undefined,
    isWin: pnl > 0,
    // 3 = liquidation, 4 = partial liquidation, 5 = ADL.
    liquidated: ['3', '4', '5'].includes(p.type),
  }
}

function group(trades: Trade[], keyOf: (t: Trade) => string): GroupStats[] {
  const map = new Map<string, GroupStats>()
  for (const t of trades) {
    const key = keyOf(t)
    let g = map.get(key)
    if (!g) {
      g = { key, trades: 0, wins: 0, losses: 0, winRate: 0, pnl: 0 }
      map.set(key, g)
    }
    g.trades++
    g.pnl += t.pnl
    if (t.pnl > 0) g.wins++
    else if (t.pnl < 0) g.losses++
  }
  for (const g of map.values()) {
    const decided = g.wins + g.losses
    g.winRate = decided > 0 ? g.wins / decided : 0
  }
  return [...map.values()].sort((a, b) => b.pnl - a.pnl)
}

export function computePerformance(positions: ClosedPosition[], days: number): Performance {
  const cutoff = days > 0 ? Date.now() - days * 86_400_000 : 0
  const trades = positions
    .map(toTrade)
    .filter((t) => t.closedAt >= cutoff)
    .sort((a, b) => a.closedAt - b.closedAt)

  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl < 0)

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const netPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const grossPnl = trades.reduce((s, t) => s + t.grossPnl, 0)
  const totalCosts = trades.reduce((s, t) => s + t.fee + t.fundingFee, 0)

  // Streaks, walking forward through time.
  let currentStreak = 0
  let longestWinStreak = 0
  let longestLossStreak = 0
  let run = 0
  for (const t of trades) {
    if (t.pnl > 0) run = run > 0 ? run + 1 : 1
    else if (t.pnl < 0) run = run < 0 ? run - 1 : -1
    else continue
    longestWinStreak = Math.max(longestWinStreak, run)
    longestLossStreak = Math.min(longestLossStreak, run)
    currentStreak = run
  }

  let cumulative = 0
  const equityCurve = trades.map((t) => {
    cumulative += t.pnl
    return { t: t.closedAt, value: cumulative }
  })

  const timed = trades.filter((t) => t.duration !== undefined)
  const decided = wins.length + losses.length

  return {
    trades,
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: decided > 0 ? wins.length / decided : 0,
    grossProfit,
    grossLoss,
    netPnl,
    grossPnl,
    totalCosts,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    expectancy: trades.length ? netPnl / trades.length : 0,
    best: trades.length ? trades.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : undefined,
    worst: trades.length ? trades.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : undefined,
    currentStreak,
    longestWinStreak,
    longestLossStreak,
    avgDuration: timed.length
      ? timed.reduce((s, t) => s + (t.duration ?? 0), 0) / timed.length
      : undefined,
    byInstrument: group(trades, (t) => t.symbol),
    byDirection: group(trades, (t) => t.direction),
    equityCurve,
    liquidations: trades.filter((t) => t.liquidated).length,
    firstTradeAt: trades[0]?.closedAt,
    lastTradeAt: trades.at(-1)?.closedAt,
  }
}

export function usePerformance(period: PeriodKey) {
  const query = useClosedPositions()
  const days = PERIODS.find((p) => p.key === period)?.days ?? 0

  const performance = useMemo(
    () => computePerformance(query.data?.positions ?? [], days),
    [query.data, days],
  )

  return {
    ...performance,
    /** Total closed positions fetched, before the period filter. */
    totalAvailable: query.data?.positions.length ?? 0,
    /** More history exists than was fetched — say so rather than imply totals. */
    truncated: query.data?.truncated ?? false,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  }
}
