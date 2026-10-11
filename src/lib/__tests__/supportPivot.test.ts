import { describe, expect, it } from 'vitest'
import { analyseSupportPivot, SUPPORT_PIVOT_SETTINGS, supportPivotEntries } from '../indicators/supportPivot'
import type { Candle } from '../indicators/types'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 0, 5)

function series(n: number, seed = 13, mirror = false): Candle[] {
  let s = seed
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const out: Candle[] = []
  let price = 1000
  let drift = 0
  for (let i = 0; i < n; i++) {
    if (i % 30 === 0) drift = (rnd() - 0.5) * 8
    const open = price
    const close = open + drift + (rnd() - 0.5) * 12
    const high = Math.max(open, close) + rnd() * 5
    const low = Math.min(open, close) - rnd() * 5
    price = close
    const c: Candle = { time: T0 + i * DAY, open, high, low, close, confirmed: true }
    out.push(mirror ? { ...c, open: 4000 - open, close: 4000 - close, high: 4000 - low, low: 4000 - high } : c)
  }
  return out
}

describe('the confirmed swing low at a support', () => {
  const c = series(5000)
  const free = { ...SUPPORT_PIVOT_SETTINGS, feeRate: 0 }

  it('fires on both sides, a swing five bars old, with the stop beyond its extreme and a 2 R target', () => {
    const e = supportPivotEntries(c, free)
    const hits = e.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
    expect(hits.length).toBeGreaterThan(15)
    expect(new Set(hits.map((i) => e[i]!.side)).size).toBe(2)
    for (const i of hits) {
      const x = e[i]!
      const p = i - 5
      if (x.side === 'long') {
        // The swing low is the lowest of the eleven bars, and the stop sits under it.
        expect(c[p].low).toBe(Math.min(...c.slice(p - 5, p + 6).map((b) => b.low)))
        expect(x.stop).toBeLessThan(c[p].low)
      } else {
        expect(c[p].high).toBe(Math.max(...c.slice(p - 5, p + 6).map((b) => b.high)))
        expect(x.stop).toBeGreaterThan(c[p].high)
      }
      expect(Math.abs(x.target! - x.entry) / Math.abs(x.entry - x.stop)).toBeCloseTo(2, 6)
    }
  })

  it('the control (every confirmed swing) contains every trade at a level', () => {
    const at = supportPivotEntries(c, free)
    const any = supportPivotEntries(c, { ...free, needLevel: false })
    at.forEach((x, i) => {
      if (x) expect(any[i]).toEqual(x)
    })
    expect(any.filter(Boolean).length).toBeGreaterThan(at.filter(Boolean).length)
  })

  it('never uses a bar it has not seen', () => {
    const full = supportPivotEntries(c, free)
    // From the point at which the cut series is itself long enough to be analysed (warm-up + 10).
    const hits = full.map((x, i) => (x ? i : -1)).filter((i) => i >= 430)
    expect(hits.length).toBeGreaterThan(10)
    for (const i of hits.filter((_, k) => k % Math.ceil(hits.length / 10) === 0)) {
      expect(supportPivotEntries(c.slice(0, i + 1), free)[i], `bar ${i}`).toEqual(full[i])
    }
  })

  it('is symmetric in the swing point: the mirrored series gives the mirrored trades', () => {
    // The control, without levels: `findLevels` clusters from the lowest price up, so on a
    // mirrored series its groups can fall differently (a property of the shared detector).
    const control = { ...free, needLevel: false }
    const plain = analyseSupportPivot(c, control)
    const mirrored = analyseSupportPivot(series(5000, 13, true), control)
    expect(mirrored.signals.length).toBe(plain.signals.length)
    plain.signals.forEach((x, k) => {
      expect(mirrored.signals[k].index).toBe(x.index)
      expect(mirrored.signals[k].side).toBe(x.side === 'long' ? 'short' : 'long')
      expect(mirrored.signals[k].outcome).toBe(x.outcome)
      if (x.resultR !== undefined) expect(mirrored.signals[k].resultR).toBeCloseTo(x.resultR, 6)
    })
  })
})
