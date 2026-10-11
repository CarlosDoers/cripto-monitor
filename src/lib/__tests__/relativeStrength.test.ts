import { describe, expect, it } from 'vitest'
import { HIGH_WINDOW, MIN_NAMES, rankRelativeStrength, RELATIVE_STRENGTH_EVIDENCE, relativeStrength } from '../relativeStrength'
import type { Candle } from '../types'

const DAY = 86_400_000

/** One daily candle as OKX serves it: strings, finished unless `forming`. */
const row = (i: number, high: number, close: number, forming = false): Candle =>
  [String(i * DAY), String(close), String(high), String(close - 1), String(close), '10', '10', '10', forming ? '0' : '1'] as unknown as Candle

/** `n` flat candles at 100 whose highs are 101, with one chosen day's high replaced. */
function flat(n: number, spike?: { ago: number; high: number }, last = 100): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const ago = n - 1 - i
    return row(i, spike && spike.ago === ago ? spike.high : 101, i === n - 1 ? last : 100)
  })
}

describe('relativeStrength', () => {
  it('reads price against the highest high of the last 90 days and says how old that high is', () => {
    const r = relativeStrength(flat(120, { ago: 10, high: 125 }, 100), 100, 'X-USDT-SWAP', 'X')
    expect(r.high).toBe(125)
    expect(r.ratio).toBeCloseTo(0.8, 10)
    expect(r.below).toBeCloseTo(0.2, 10)
    expect(r.highAge).toBe(10)
    expect(r.short).toBe(false)
  })

  it('forgets a high older than 90 candles', () => {
    const r = relativeStrength(flat(120, { ago: HIGH_WINDOW, high: 500 }), 100, 'X', 'X')
    expect(r.high).toBe(101)
    // Every candle in the window ties at 101: the newest of them is the high's age.
    expect(r.highAge).toBe(0)
  })

  it('counts the forming candle and the live price: a new high is exactly 1', () => {
    const rows = flat(100)
    const forming = [...rows.slice(0, -1), row(99, 110, 108, true)]
    expect(relativeStrength(forming, 108, 'X', 'X').high).toBe(110)
    const up = relativeStrength(forming, 115, 'X', 'X')
    expect(up.ratio).toBe(1)
    expect(up.highAge).toBe(0)
  })

  it('uses the live price, not the last close, and falls back to the close without one', () => {
    const rows = flat(100, { ago: 5, high: 200 })
    expect(relativeStrength(rows, 150, 'X', 'X').ratio).toBeCloseTo(0.75, 10)
    expect(relativeStrength(rows, 0, 'X', 'X').ratio).toBeCloseTo(0.5, 10)
  })

  it('has nothing to say under 90 candles', () => {
    const r = relativeStrength(flat(HIGH_WINDOW - 1), 100, 'X', 'X')
    expect(r.short).toBe(true)
    expect(Number.isNaN(r.ratio)).toBe(true)
  })

  it('takes volatility from finished days only', () => {
    // Alternating 100 / 101 closes: every return is ±ln(1.01).
    const rows = Array.from({ length: 100 }, (_, i) => row(i, 102, i % 2 ? 101 : 100))
    const r = relativeStrength(rows, 100, 'X', 'X')
    expect(r.volatility).toBeCloseTo(Math.log(101 / 100), 3)
    // A forming candle that jumps changes nothing in it.
    const jump = [...rows.slice(0, -1), row(99, 300, 250, true)]
    expect(relativeStrength(jump, 100, 'X', 'X').volatility).toBeCloseTo(r.volatility, 2)
    expect(relativeStrength(flat(100), 100, 'X', 'X').volatility).toBe(0)
  })
})

describe('rankRelativeStrength', () => {
  const make = (ratios: (number | null)[]) =>
    ratios.map((q, i) =>
      q === null
        ? { instId: `S${i}`, symbol: `S${i}`, price: 1, high: NaN, ratio: NaN, below: NaN, highAge: NaN, bars: 50, volatility: NaN, short: true }
        : { instId: `S${i}`, symbol: `S${i}`, price: q, high: 1, ratio: q, below: 1 - q, highAge: 3, bars: 150, volatility: 0.04, short: false },
    )

  it('splits the ranked contracts in thirds, nearest the high first', () => {
    const r = rankRelativeStrength(make([0.5, 0.9, 0.6, 1, 0.7, 0.8, 0.95, 0.55, 0.65, 0.85, 0.75, 0.99]))
    expect(r.ranked).toBe(12)
    expect(r.k).toBe(4)
    expect(r.top.map((x) => x.ratio)).toEqual([1, 0.99, 0.95, 0.9])
    expect(r.bottom.map((x) => x.ratio)).toEqual([0.65, 0.6, 0.55, 0.5])
  })

  it('leaves out the contracts with too little history and names them', () => {
    const r = rankRelativeStrength(make([0.5, null, 0.9, 0.6, 1, 0.7, 0.8, 0.95, 0.55, 0.65, null]))
    expect(r.ranked).toBe(9)
    expect(r.short.map((x) => x.instId)).toEqual(['S1', 'S10'])
    expect(r.k).toBe(3)
  })

  it('does not rank fewer names than the measurement had', () => {
    const r = rankRelativeStrength(make(Array.from({ length: MIN_NAMES - 1 }, (_, i) => 1 - i / 20)))
    expect(r.k).toBe(0)
    expect(r.top).toEqual([])
    expect(r.bottom).toEqual([])
    expect(r.ranked).toBe(MIN_NAMES - 1)
  })

  it('breaks ties by symbol so the list does not shuffle between refreshes', () => {
    const r = rankRelativeStrength(make([0.9, 0.9, 0.9, 0.5, 0.5, 0.5, 0.7, 0.7, 0.7]))
    expect(r.top.map((x) => x.symbol)).toEqual(['S0', 'S1', 'S2'])
    expect(r.bottom.map((x) => x.symbol)).toEqual(['S3', 'S4', 'S5'])
  })
})

describe('the evidence the card quotes', () => {
  it('is internally consistent', () => {
    const e = RELATIVE_STRENGTH_EVIDENCE
    expect(e.halves.every((h) => h > 0)).toBe(true)
    expect(e.interval[0]).toBeLessThan(e.perWeek)
    expect(e.interval[1]).toBeGreaterThan(e.perWeek)
    expect(e.net).toBeLessThan(e.perWeek)
    expect(e.yearsPositive).toBeLessThanOrEqual(e.years)
    // The long leg alone does not beat holding BTC by enough to call it an edge: 39 against 36 a year.
    expect(e.longOnly.yearPct - e.longOnly.btcYearPct).toBeLessThan(5)
  })
})
