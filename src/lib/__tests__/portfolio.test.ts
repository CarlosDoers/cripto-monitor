import { describe, expect, it } from 'vitest'
import { buildPortfolio, change24hOf, priceOf } from '../portfolioCore'
import type { AccountBalance, AssetValuation, FundingBalance } from '../types'
import { ticker } from './fixtures'

const tickers = new Map(
  [ticker('SOL-USDT', 120, 100), ticker('USDC-EUR', 0.88, 0.9), ticker('BTC-USDC', 80_000)].map((t) => [t.instId, t]),
)

describe('priceOf', () => {
  it('prices a coin off its stable pair', () => {
    expect(priceOf('SOL', tickers)).toBe(120)
    expect(priceOf('BTC', tickers)).toBe(80_000)
  })
  it('prices stables at one', () => {
    expect(priceOf('USDC', tickers)).toBe(1)
  })
  // A euro balance used to be listed at 0 US$: fiat is the quote side of its pair.
  it('prices fiat by inverting the pair it is quoted in', () => {
    expect(priceOf('EUR', tickers)).toBeCloseTo(1 / 0.88)
  })
  it('knows nothing it has no pair for', () => {
    expect(priceOf('NOPE', tickers)).toBeUndefined()
  })
})

describe('change24hOf', () => {
  it('is the pair move for a coin', () => {
    expect(change24hOf('SOL', tickers)).toBeCloseTo(0.2)
  })
  it('flips the move for an inverted pair: fewer euros per dollar is a stronger euro', () => {
    expect(change24hOf('EUR', tickers)).toBeCloseTo(0.9 / 0.88 - 1)
  })
})

describe('buildPortfolio', () => {
  const balance = [
    {
      totalEq: '1000',
      mgnRatio: '',
      details: [{ ccy: 'USDC', eq: '1000', eqUsd: '1000', cashBal: '1000', availEq: '', availBal: '12', isoEq: '988' }],
    },
  ] as unknown as AccountBalance[]
  const funding = [{ ccy: 'SOL', bal: '2' }, { ccy: 'EUR', bal: '100' }] as FundingBalance[]

  it('prices both wallets, the funding side included', () => {
    const p = buildPortfolio({ balance, funding, tickers: [...tickers.values()], valuation: undefined })
    const byCcy = Object.fromEntries(p.holdings.map((h) => [h.ccy, h.usd]))
    expect(byCcy.USDC).toBe(1000)
    expect(byCcy.SOL).toBe(240)
    expect(byCcy.EUR).toBeCloseTo(100 / 0.88)
  })

  // With isolated margin OKX leaves availEq empty; reading it as 0 hid 12 US$ of free margin, or invented it.
  it('sums free margin per currency, falling back to availBal', () => {
    const p = buildPortfolio({ balance, funding: [], tickers: [], valuation: undefined })
    expect(p.freeMargin).toBe(12)
    expect(p.isolatedEq).toBe(988)
  })

  it('takes net worth from asset-valuation when it is there', () => {
    const valuation = [{ totalBal: '5000' }] as AssetValuation[]
    expect(buildPortfolio({ balance, funding, tickers: [...tickers.values()], valuation }).netWorth).toBe(5000)
    expect(buildPortfolio({ balance, funding: [], tickers: [], valuation: undefined }).netWorth).toBe(1000)
  })
})
