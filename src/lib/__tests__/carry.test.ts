import { describe, expect, it } from 'vitest'
import {
  GOLD_CARRY_EVIDENCE as G,
  HEDGE_COINS,
  heldUnderlyings,
  isCarryContract,
  scanSet,
  TOKENISED,
  underlyingOf,
  type CarryContract,
} from '../carry'
import { MIN_LIQUID_VOLUME } from '../markets'

const contract = (ccy: string, nowApr: number, volumeUsd = MIN_LIQUID_VOLUME * 5): CarryContract => ({
  instId: `${ccy}-USD_UM_XPERP-310404`,
  ccy,
  inst: undefined,
  nowApr,
  trailing: undefined,
  volumeUsd,
  contractUsd: 10,
})

describe('which contracts get their funding history read', () => {
  const crowd = Array.from({ length: 20 }, (_, i) => contract(`C${i}`, 0.11 + i / 1000))

  it('takes the ones paying most right now, and no more than the top', () => {
    const picked = scanSet(new Map(crowd.map((c) => [c.ccy, c])), 15)
    expect(picked).toHaveLength(15)
    expect(picked[0].ccy).toBe('C19')
    expect(picked.map((c) => c.ccy)).not.toContain('C0')
  })

  it('always adds gold, even when twenty contracts pay more than it does right now', () => {
    const gold = contract('XAU', 0.0)
    const picked = scanSet(new Map([...crowd, gold].map((c) => [c.ccy, c])), 15)
    expect(picked).toHaveLength(16)
    expect(picked.at(-1)?.ccy).toBe('XAU')
  })

  it('does not list gold twice when it is already among the top', () => {
    const gold = contract('XAU', 0.5)
    const picked = scanSet(new Map([...crowd, gold].map((c) => [c.ccy, c])), 15)
    expect(picked.filter((c) => c.ccy === 'XAU')).toHaveLength(1)
    expect(picked[0].ccy).toBe('XAU')
  })

  it('leaves gold out when it is too thin to trade, and when it is not listed at all', () => {
    const thin = contract('XAU', 0.2, MIN_LIQUID_VOLUME / 10)
    expect(scanSet(new Map([...crowd, thin].map((c) => [c.ccy, c])), 15).map((c) => c.ccy)).not.toContain('XAU')
    expect(scanSet(new Map(crowd.map((c) => [c.ccy, c])), 15)).toHaveLength(15)
  })

  it('keeps gold even while the funding board is unreadable', () => {
    // No board, no live rate (NaN): nothing can be ranked, but gold's history is still worth reading.
    const blind = [contract('BTC', NaN), contract('XAU', NaN)]
    expect(scanSet(new Map(blind.map((c) => [c.ccy, c]))).map((c) => c.ccy)).toEqual(['XAU'])
  })
})

describe('gold as a carry', () => {
  it('knows which coins stand for which perpetual', () => {
    expect(underlyingOf('PAXG')).toBe('XAU')
    expect(underlyingOf('XAUT')).toBe('XAU')
    expect(underlyingOf('BTC')).toBe('BTC')
    // Every token is a hedge of something that lists its spot pair, and the other way round.
    for (const [token, under] of Object.entries(TOKENISED)) expect(HEDGE_COINS[under]).toContain(token)
  })

  it('offers a crypto coin\'s contract and gold\'s, and no other commodity or stock', () => {
    expect(isCarryContract('BTC', '1')).toBe(true)
    expect(isCarryContract('BTC', undefined)).toBe(true)
    expect(isCarryContract('XAU', '4')).toBe(true)
    // Silver pays more and has no token on OKX; oil pays the longs; a stock has no spot to hold.
    expect(isCarryContract('XAG', '4')).toBe(false)
    expect(isCarryContract('CL', '4')).toBe(false)
    expect(isCarryContract('AAPL', '3')).toBe(false)
  })

  it('reads a short on XAU as a hedge when what is held is a token of gold', () => {
    const held = heldUnderlyings(['SOL', 'PAXG', 'USDC'])
    expect(held.has('XAU')).toBe(true)
    // The coins themselves stay: a short on SOL against SOL is as before.
    expect(held.has('SOL')).toBe(true)
    expect(held.has('PAXG')).toBe(true)
    expect(heldUnderlyings(['BTC']).has('XAU')).toBe(false)
    expect(heldUnderlyings([]).size).toBe(0)
  })

  it('quotes figures that agree with one another', () => {
    // The yearly figures are the 95-day ones scaled, and a week's range brackets the mean.
    expect(G.ruleMarketApr).toBeCloseTo((G.ruleMarket * 365) / G.days, 2)
    expect(G.ruleLimitApr).toBeCloseTo((G.ruleLimit * 365) / G.days, 2)
    expect(G.ruleLimit).toBeGreaterThan(G.ruleMarket)
    expect(G.weeklyRange[0]).toBeLessThan(G.fundingApr)
    expect(G.weeklyRange[1]).toBeGreaterThan(G.fundingApr)
    expect(G.weeksAbove10 + G.weeksNegative).toBeLessThanOrEqual(G.weeks)
    // Silver pays more than gold and the oils pay the long: the reason the page offers only gold.
    expect(G.silverApr).toBeGreaterThan(G.fundingApr)
    expect(G.wtiApr).toBeLessThan(0)
    expect(G.brentApr).toBeLessThan(0)
  })
})
