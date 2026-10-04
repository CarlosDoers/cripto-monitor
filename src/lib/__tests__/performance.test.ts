import { describe, expect, it } from 'vitest'
import { computePerformance } from '../performance'
import { closed } from './fixtures'

describe('computePerformance', () => {
  const rows = [
    closed({ posId: 'a', realizedPnl: '100', pnl: '110', fee: '-8', fundingFee: '-2', closedDaysAgo: 1 }),
    closed({ posId: 'a', realizedPnl: '-40', pnl: '-35', fee: '-5', fundingFee: '0', closedDaysAgo: 2 }),
    closed({ posId: 'b', realizedPnl: '60', pnl: '58', fee: '-3', fundingFee: '5', closedDaysAgo: 3 }),
    closed({ posId: 'c', realizedPnl: '500', pnl: '500', closedDaysAgo: 45 }),
  ]

  it('cuts the window on the close time', () => {
    expect(computePerformance(rows, 30).count).toBe(3)
    expect(computePerformance(rows, 0).count).toBe(4)
  })

  it('adds up: gross plus signed costs is the net', () => {
    const p = computePerformance(rows, 30)
    expect(p.netPnl).toBe(120)
    expect(p.grossPnl).toBe(133)
    // Funding a position collects is income, not a cost: costs stay signed.
    expect(p.totalCosts).toBe(-13)
    expect(p.grossPnl + p.totalCosts).toBe(p.netPnl)
  })

  // posId repeats across partial closes; React dropped the duplicates from the table.
  it('gives each trade a unique id even when posId repeats', () => {
    const ids = computePerformance(rows, 30).trades.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('computes win rate, profit factor and expectancy', () => {
    const p = computePerformance(rows, 30)
    expect(p.wins).toBe(2)
    expect(p.losses).toBe(1)
    expect(p.winRate).toBeCloseTo(2 / 3)
    expect(p.profitFactor).toBeCloseTo(160 / 40)
    expect(p.expectancy).toBeCloseTo(40)
  })

  it('walks streaks forward in time', () => {
    const p = computePerformance(rows, 30)
    // Oldest first: +60, −40, +100.
    expect(p.currentStreak).toBe(1)
    expect(p.longestLossStreak).toBe(-1)
  })

  it('reports an infinite profit factor with no losses rather than dividing by zero', () => {
    expect(computePerformance([rows[0]], 30).profitFactor).toBe(Infinity)
  })
})
