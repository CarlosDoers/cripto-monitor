import { describe, expect, it } from 'vitest'
import { analyseRsiZoneReversal, RSI_ZONE_SETTINGS, rsiZoneEntries } from '../indicators/rsiZoneReversal'
import type { Candle } from '../indicators/types'

const HOUR = 3_600_000
const T0 = Date.UTC(2026, 0, 5)

/** A seeded series that swings between regimes, so the RSI reaches both extremes and levels form. */
function series(n: number, seed = 11, mirror = false): Candle[] {
  let s = seed
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const out: Candle[] = []
  let price = 1000
  let drift = 0
  for (let i = 0; i < n; i++) {
    if (i % 60 === 0) drift = (rnd() - 0.5) * 2.4
    const open = price
    const close = open + drift + (rnd() - 0.5) * 3
    const high = Math.max(open, close) + rnd() * 1.2
    const low = Math.min(open, close) - rnd() * 1.2
    price = close
    const c: Candle = { time: T0 + i * HOUR, open, high, low, close, confirmed: true }
    out.push(mirror ? { ...c, open: 2000 - open, close: 2000 - close, high: 2000 - low, low: 2000 - high } : c)
  }
  return out
}

describe('the RSI + level + reversal candle setup', () => {
  const c = series(30_000)
  const free = { ...RSI_ZONE_SETTINGS, feeRate: 0 }

  it('fires on both sides, with the stop beyond the entry and the target on the other side', () => {
    const r = analyseRsiZoneReversal(c, free)
    expect(r.signals.length).toBeGreaterThan(30)
    expect(new Set(r.signals.map((x) => x.side)).size).toBe(2)
    for (const x of r.signals) {
      const long = x.side === 'long'
      expect(long ? x.stop < x.entry : x.stop > x.entry).toBe(true)
      expect(long ? x.target! > x.entry : x.target! < x.entry).toBe(true)
      // The 2 R of the video.
      expect(Math.abs(x.target! - x.entry) / Math.abs(x.entry - x.stop)).toBeCloseTo(2, 6)
    }
  })

  it('needs all three conditions: switching one off can only add setups, never remove one', () => {
    const all = rsiZoneEntries(c, free).filter(Boolean).length
    for (const off of ['rsi', 'zone', 'candle'] as const) {
      const looser = rsiZoneEntries(c, { ...free, need: { ...free.need, [off]: false } }).filter(Boolean).length
      expect(looser, `without ${off}`).toBeGreaterThanOrEqual(all)
    }
    expect(rsiZoneEntries(c, { ...free, need: { rsi: false, zone: false, candle: false } }).filter(Boolean)).toHaveLength(0)
  })

  it('never uses a bar it has not seen: the entry at i is the same on the series cut at i', () => {
    const full = rsiZoneEntries(c, free)
    const hits = full.map((e, i) => (e ? i : -1)).filter((i) => i >= 0)
    expect(hits.length).toBeGreaterThan(10)
    for (const i of hits.filter((_, k) => k % Math.ceil(hits.length / 8) === 0)) {
      expect(rsiZoneEntries(c.slice(0, i + 1), free)[i], `bar ${i}`).toEqual(full[i])
    }
  })

  it('is symmetric in the RSI and the candle: the price-mirrored series gives the mirrored trades', () => {
    // Without the level condition. `findLevels` clusters pivots greedily from the lowest price up,
    // so on a mirrored series its groups can fall differently: a property of the shared detector
    // (it also draws the chart), not of this rule, and not worth changing here.
    const noZone = { ...free, need: { rsi: true, zone: false, candle: true } }
    const plain = analyseRsiZoneReversal(c, noZone)
    const mirrored = analyseRsiZoneReversal(series(30_000, 11, true), noZone)
    expect(plain.signals.length).toBeGreaterThan(30)
    expect(mirrored.signals.length).toBe(plain.signals.length)
    plain.signals.forEach((x, k) => {
      const m = mirrored.signals[k]
      expect(m.index).toBe(x.index)
      expect(m.side).toBe(x.side === 'long' ? 'short' : 'long')
      expect(m.resultR).toBeCloseTo(x.resultR!, 6)
    })
  })

  it('has nothing to say on a series too short for its level detector', () => {
    expect(analyseRsiZoneReversal(c.slice(0, 300), free).signals).toHaveLength(0)
  })
})
