import { describe, expect, it } from 'vitest'
import { aggregate, analyseScalpPullback, SCALP_SETTINGS, scalpEntries } from '../indicators/scalpPullback'
import type { Candle } from '../indicators/types'

const MIN = 60_000
const T0 = Date.UTC(2026, 0, 5, 0, 0) // a Monday, on the hour

/** A seeded 1 m series with drifting regimes, so the hourly and 5 m trends line up now and then. */
function series(n: number, seed = 7, mirror = false): Candle[] {
  let s = seed
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const out: Candle[] = []
  let price = 1000
  let drift = 0
  for (let i = 0; i < n; i++) {
    if (i % 900 === 0) drift = (rnd() - 0.5) * 0.5
    const open = price
    const close = open + drift + (rnd() - 0.5) * 0.9
    const high = Math.max(open, close) + rnd() * 0.25
    const low = Math.min(open, close) - rnd() * 0.25
    price = close
    const c: Candle = { time: T0 + i * MIN, open, high, low, close, confirmed: true, vol: 1 }
    out.push(
      mirror ? { ...c, open: 2000 - open, close: 2000 - close, high: 2000 - low, low: 2000 - high } : c,
    )
  }
  return out
}

describe('aggregate: higher timeframes are built on the clock', () => {
  it('groups 1 m bars into 5 m and 1 h bars aligned to :00, and carries the extremes', () => {
    const c = series(180)
    const m5 = aggregate(c, 5 * MIN)
    expect(m5.bars).toHaveLength(36)
    expect(m5.bars[0].time).toBe(T0)
    expect(m5.ends[0]).toBe(T0 + 5 * MIN)
    expect(m5.bars[0].high).toBe(Math.max(...c.slice(0, 5).map((x) => x.high)))
    expect(m5.bars[0].close).toBe(c[4].close)
    const h = aggregate(c, 60 * MIN)
    expect(h.bars).toHaveLength(3)
    expect(h.bars[1].open).toBe(c[60].open)
    expect(h.bars[1].low).toBe(Math.min(...c.slice(60, 120).map((x) => x.low)))
  })
})

describe('the scalping setup', () => {
  const c = series(40_000)
  const result = analyseScalpPullback(c)

  it('fires on both sides over a long enough series, so the other tests are not vacuous', () => {
    const sides = new Set(result.signals.map((x) => x.side))
    expect(result.signals.length).toBeGreaterThan(20)
    expect(sides.has('long') && sides.has('short')).toBe(true)
  })

  it('puts the stop beyond the entry and the target on the other side, on every trade', () => {
    for (const x of result.signals) {
      const long = x.side === 'long'
      expect(long ? x.stop < x.entry : x.stop > x.entry).toBe(true)
      expect(long ? x.target! > x.entry : x.target! < x.entry).toBe(true)
    }
  })

  it('never uses a bar it has not seen: the entry at i is the same on the series cut at i', () => {
    const full = scalpEntries(c)
    const hits = full.map((e, i) => (e ? i : -1)).filter((i) => i >= 0)
    expect(hits.length).toBeGreaterThan(5)
    // Cut the series at a handful of its own entries and ask again.
    for (const i of hits.filter((_, k) => k % Math.ceil(hits.length / 6) === 0)) {
      const cut = scalpEntries(c.slice(0, i + 1))[i]
      expect(cut, `bar ${i}`).toEqual(full[i])
    }
  })

  it('is symmetric: the price-mirrored series gives the mirrored trades', () => {
    // Without a fee. The cost is a percentage of price, and the mirror (2000 − p) changes the
    // level, so the kit's "costs more than 1 R: not a trade" filter would drop different
    // trades on each side — a property of money, not of the rule.
    const free = { ...SCALP_SETTINGS, feeRate: 0 }
    const plain = analyseScalpPullback(c, free)
    const mirrored = analyseScalpPullback(series(40_000, 7, true), free)
    expect(plain.signals.length).toBeGreaterThan(50)
    expect(mirrored.signals.length).toBe(plain.signals.length)
    plain.signals.forEach((x, k) => {
      const m = mirrored.signals[k]
      expect(m.index).toBe(x.index)
      expect(m.side).toBe(x.side === 'long' ? 'short' : 'long')
      expect(m.resultR).toBeCloseTo(x.resultR!, 6)
    })
  })

  it('does nothing on another timeframe instead of computing nonsense', () => {
    const fiveMinute = c.map((x, i) => ({ ...x, time: T0 + i * 5 * MIN }))
    expect(analyseScalpPullback(fiveMinute).signals).toHaveLength(0)
  })
})

describe('the limit-order reading (an order resting at the 1 m EMA)', () => {
  // Free of fees: a stop a quarter of an ATR from the average costs 8 R or more on this
  // series, and the kit rightly refuses every one of those. That is a result, not a bug.
  const settings = { ...SCALP_SETTINGS, entry: 'limitEma' as const, feeRate: 0 }
  const c = series(40_000)

  it('fires on both sides and fills inside its own bar, as a limit order', () => {
    const r = analyseScalpPullback(c, settings)
    expect(r.signals.length).toBeGreaterThan(50)
    expect(new Set(r.signals.map((x) => x.side)).size).toBe(2)
    for (const x of r.signals) {
      const bar = c[x.index]
      // A fill the bar actually traded through, at the level or at the open if it gapped past it.
      expect(x.entry).toBeGreaterThanOrEqual(bar.low)
      expect(x.entry).toBeLessThanOrEqual(bar.high)
    }
  })

  it('never uses a bar it has not seen', () => {
    const full = scalpEntries(c, settings)
    const hits = full.map((e, i) => (e ? i : -1)).filter((i) => i >= 0)
    expect(hits.length).toBeGreaterThan(5)
    for (const i of hits.filter((_, k) => k % Math.ceil(hits.length / 6) === 0)) {
      expect(scalpEntries(c.slice(0, i + 1), settings)[i], `bar ${i}`).toEqual(full[i])
    }
  })

  it('is symmetric', () => {
    const plain = analyseScalpPullback(c, settings)
    const mirrored = analyseScalpPullback(series(40_000, 7, true), settings)
    expect(plain.signals.length).toBeGreaterThan(50)
    expect(mirrored.signals.length).toBe(plain.signals.length)
    plain.signals.forEach((x, k) => {
      expect(mirrored.signals[k].side).toBe(x.side === 'long' ? 'short' : 'long')
      expect(mirrored.signals[k].resultR).toBeCloseTo(x.resultR!, 6)
    })
  })
})
