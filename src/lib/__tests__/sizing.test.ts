import { describe, expect, it } from 'vitest'
import { parseTyped, sizePosition, type SizingInput } from '../sizing'

// ZEC X-Perp as listed: 0,01 ZEC a contract, lots of 1.
const zec: SizingInput = {
  equity: 14_730,
  riskShare: 0.01,
  entry: 1300,
  stop: 1235,
  ctVal: 0.01,
  ctType: 'linear',
  lotSz: 1,
  minSz: 1,
  leverage: 5,
  freeMargin: 2.13,
  feeRate: 0.001,
}

describe('sizePosition', () => {
  it('turns 1 % of the account into contracts, rounding down', () => {
    const s = sizePosition(zec)!
    // 147,30 US$ of risk / (65 × 0,01) = 226,6 → 226 contracts.
    expect(s.size).toBe(226)
    expect(s.riskUsd).toBeCloseTo(226 * 0.65)
    expect(s.riskUsd).toBeLessThanOrEqual(147.3)
    expect(s.side).toBe('long')
  })

  it('prices notional, margin and exposure', () => {
    const s = sizePosition(zec)!
    expect(s.notionalUsd).toBeCloseTo(226 * 0.01 * 1300)
    expect(s.margin).toBeCloseTo(s.notionalUsd / 5)
    expect(s.exposure).toBeCloseTo(s.notionalUsd / 14_730)
  })

  it('says when the free margin cannot carry it', () => {
    expect(sizePosition(zec)!.marginShort).toBe(true)
    expect(sizePosition({ ...zec, freeMargin: 10_000 })!.marginShort).toBe(false)
  })

  it('reads a stop above entry as a short', () => {
    expect(sizePosition({ ...zec, stop: 1365 })!.side).toBe('short')
  })

  it('costs the fee in R: a tight stop makes the round trip expensive', () => {
    expect(sizePosition(zec)!.feeR).toBeCloseTo(0.001 / (65 / 1300))
    expect(sizePosition({ ...zec, stop: 1298.7 })!.feeR).toBeCloseTo(1, 1)
  })

  it('flags a risk too small for one contract', () => {
    const s = sizePosition({ ...zec, equity: 50, riskShare: 0.001 })!
    expect(s.size).toBe(0)
    expect(s.tooSmall).toBe(true)
  })

  it('handles spot in coins and inverse contracts in dollars', () => {
    expect(sizePosition({ ...zec, ctType: 'spot', ctVal: 1, lotSz: 0.0001 })!.size).toBeCloseTo(2.2661, 4)
    // 100 US$ a contract, stop 5 % away: 5 US$ of risk each.
    const inv = sizePosition({ ...zec, ctType: 'inverse', ctVal: 100, entry: 100, stop: 95 })!
    expect(inv.riskPerUnit).toBeCloseTo(5)
    expect(inv.size).toBe(29)
  })

  it('refuses nonsense rather than divide by zero', () => {
    expect(sizePosition({ ...zec, stop: 1300 })).toBeNull()
    expect(sizePosition({ ...zec, equity: 0 })).toBeNull()
  })
})


describe('parseTyped', () => {
  it('reads Spanish and plain decimals alike', () => {
    expect(parseTyped('1312,5')).toBe(1312.5)
    expect(parseTyped('84.604,5')).toBe(84604.5)
    expect(parseTyped('84604.5')).toBe(84604.5)
    expect(parseTyped(' 1,5667 ')).toBe(1.5667)
  })
})
