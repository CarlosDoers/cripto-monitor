import { describe, expect, it } from 'vitest'
import { analyseSweepIfvg, nyClock, SWEEP_IFVG_SETTINGS, sweepIfvgEntries } from '../indicators/sweepIfvg'
import type { Candle } from '../indicators/types'

const MIN = 60_000
// A winter Monday: New York is UTC−5, so 09:30 there is 14:30 UTC.
const MONDAY = Date.UTC(2026, 0, 12)
const OPEN = 14 * 60 + 30

/** A flat day with the 3 h before the open spanning 99 → 104, then whatever `patch` puts in the window. */
function day(patch: Record<number, [number, number, number, number]>, mirror = false): Candle[] {
  const out: Candle[] = []
  for (let m = 0; m < 1440; m++) {
    let [o, h, l, c] = patch[m] ?? [101.5, 101.7, 101.3, 101.5]
    if (m === OPEN - 170) h = 104 // the liquidity above
    if (m === OPEN - 160) l = 99 // and below
    if (mirror) [o, h, l, c] = [200 - o, 200 - l, 200 - h, 200 - c]
    out.push({ time: MONDAY + m * MIN, open: o, high: h, low: l, close: c, confirmed: true })
  }
  return out
}

// A sell-side sweep with a bearish gap behind it, then the close that inverts the gap.
const LONG_SCENARIO: Record<number, [number, number, number, number]> = {
  [OPEN + 1]: [101.5, 101.7, 100.0, 100.2], // k−2: its low is the gap's far edge
  [OPEN + 2]: [100.2, 100.2, 99.1, 99.2], // k−1: the drop
  [OPEN + 3]: [99.2, 99.5, 99.0, 99.2], // k: high 99.5 < 100.0, a bearish gap [99.5, 100.0]
  // Price stays down here: flat bars at 101.5 would leave a newer gap behind them.
  [OPEN + 4]: [99.2, 99.4, 99.0, 99.2],
  [OPEN + 5]: [99.2, 99.4, 99.0, 99.2],
  [OPEN + 6]: [99.2, 99.4, 98.5, 99.1], // the sweep: below 99, closes back above it
  [OPEN + 7]: [99.1, 99.4, 99.0, 99.3],
  [OPEN + 8]: [99.3, 100.4, 99.2, 100.3], // closes above 100.0: the gap is inverted
}

describe('nyClock', () => {
  it('reads New York time across daylight saving', () => {
    // 14:30 UTC in January is 09:30; in July, 13:30 UTC is 09:30.
    expect(nyClock(Date.UTC(2026, 0, 12, 14, 30))).toEqual({ minute: 570, dow: 1 })
    expect(nyClock(Date.UTC(2026, 6, 13, 13, 30))).toEqual({ minute: 570, dow: 1 })
    // 02:30 UTC on a Tuesday is Monday 21:30 in New York.
    expect(nyClock(Date.UTC(2026, 0, 13, 2, 30))).toEqual({ minute: 1290, dow: 1 })
  })
})

describe('the sweep + inverted gap setup', () => {
  it('buys the close that inverts a bearish gap after the low was swept, targeting the high', () => {
    const e = sweepIfvgEntries(day(LONG_SCENARIO))
    const hits = e.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
    expect(hits).toEqual([OPEN + 8])
    const x = e[OPEN + 8]!
    expect(x.side).toBe('long')
    expect(x.entry).toBe(100.3)
    expect(x.target).toBe(104)
    // Beyond the sweep's extreme (98.5), a tenth of an ATR below it.
    expect(x.stop).toBeLessThan(98.5)
    expect(x.stop).toBeGreaterThan(98.0)
  })

  it('does not enter on the sweep alone, or on the gap alone', () => {
    const noInversion = { ...LONG_SCENARIO }
    delete noInversion[OPEN + 8]
    expect(sweepIfvgEntries(day(noInversion)).filter(Boolean)).toHaveLength(0)
    const noSweep = { ...LONG_SCENARIO }
    delete noSweep[OPEN + 6]
    expect(sweepIfvgEntries(day(noSweep)).filter(Boolean)).toHaveLength(0)
  })

  it('skips an inversion with less than 1 R to the liquidity, and takes it with a fixed target', () => {
    // A reference high only slightly above the entry leaves less than 1 R.
    const near = day(LONG_SCENARIO).map((c, m) => (m === OPEN - 170 ? { ...c, high: 101.0 } : c))
    expect(sweepIfvgEntries(near).filter(Boolean)).toHaveLength(0)
    const fixed = sweepIfvgEntries(near, { ...SWEEP_IFVG_SETTINGS, target: 'rr', rr: 1 })
    expect(fixed[OPEN + 8]).toBeTruthy()
  })

  it('enters on the sweep candle itself when the gap is not asked for', () => {
    const e = sweepIfvgEntries(day(LONG_SCENARIO), { ...SWEEP_IFVG_SETTINGS, gap: false })
    const hits = e.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
    expect(hits).toEqual([OPEN + 6])
    expect(e[OPEN + 6]!.entry).toBe(99.1)
    expect(e[OPEN + 6]!.side).toBe('long')
  })

  it('is the mirror on the other side', () => {
    const e = sweepIfvgEntries(day(LONG_SCENARIO, true))
    const x = e[OPEN + 8]!
    expect(x.side).toBe('short')
    expect(x.entry).toBeCloseTo(99.7, 9)
    expect(x.target).toBe(96)
    expect(x.stop).toBeGreaterThan(101.5)
  })

  it('only looks inside the window: the same pattern at 12:00 New York is nothing', () => {
    const shift = 150
    const late: Record<number, [number, number, number, number]> = {}
    for (const [k, v] of Object.entries(LONG_SCENARIO)) late[Number(k) + shift] = v
    expect(sweepIfvgEntries(day(late)).filter(Boolean)).toHaveLength(0)
  })
})

describe('over a long random series', () => {
  // 60 days of 1 m bars from a Monday, drifting between regimes.
  function series(seed = 5, mirror = false): Candle[] {
    let s = seed
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
    const out: Candle[] = []
    let price = 1000
    let drift = 0
    for (let i = 0; i < 86_400; i++) {
      if (i % 300 === 0) drift = (rnd() - 0.5) * 0.4
      const open = price
      const close = open + drift + (rnd() - 0.5) * 0.9
      const high = Math.max(open, close) + rnd() * 0.25
      const low = Math.min(open, close) - rnd() * 0.25
      price = close
      const c: Candle = { time: MONDAY + i * MIN, open, high, low, close, confirmed: true }
      out.push(mirror ? { ...c, open: 2000 - open, close: 2000 - close, high: 2000 - low, low: 2000 - high } : c)
    }
    return out
  }
  const c = series()
  const free = { ...SWEEP_IFVG_SETTINGS, feeRate: 0 }

  it('fires on both sides, at most once a day, and only inside the window', () => {
    const e = sweepIfvgEntries(c, free)
    const hits = e.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
    expect(hits.length).toBeGreaterThan(5)
    expect(new Set(hits.map((i) => e[i]!.side)).size).toBe(2)
    const days = hits.map((i) => Math.floor(c[i].time / 86_400_000))
    expect(new Set(days).size).toBe(days.length)
    for (const i of hits) {
      const { minute, dow } = nyClock(c[i].time)
      expect(minute).toBeGreaterThanOrEqual(570)
      expect(minute).toBeLessThan(660)
      expect(dow).toBeGreaterThanOrEqual(1)
      expect(dow).toBeLessThanOrEqual(5)
    }
  })

  it('never uses a bar it has not seen', () => {
    const full = sweepIfvgEntries(c, free)
    const hits = full.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
    for (const i of hits) {
      expect(sweepIfvgEntries(c.slice(0, i + 1), free)[i], `bar ${i}`).toEqual(full[i])
    }
  })

  it('is symmetric: the price-mirrored series gives the mirrored trades', () => {
    const plain = analyseSweepIfvg(c, free)
    const mirrored = analyseSweepIfvg(series(5, true), free)
    expect(plain.signals.length).toBeGreaterThan(5)
    expect(mirrored.signals.length).toBe(plain.signals.length)
    plain.signals.forEach((x, k) => {
      expect(mirrored.signals[k].index).toBe(x.index)
      expect(mirrored.signals[k].side).toBe(x.side === 'long' ? 'short' : 'long')
      expect(mirrored.signals[k].resultR).toBeCloseTo(x.resultR!, 6)
    })
  })

  it('does nothing on another timeframe', () => {
    const hourly = c.map((x, i) => ({ ...x, time: MONDAY + i * 3_600_000 }))
    expect(sweepIfvgEntries(hourly, free).filter(Boolean)).toHaveLength(0)
  })
})
