import { describe, expect, it } from 'vitest'
import { analyseKlingerScalp, KLINGER_SETTINGS, klinger, klingerEntries } from '../indicators/klingerScalp'
import type { Candle } from '../indicators/types'

const STEP = 300_000
const T0 = Date.UTC(2026, 0, 5)

function series(n: number, seed = 3, mirror = false): Candle[] {
  let s = seed
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const out: Candle[] = []
  let price = 1000
  let drift = 0
  for (let i = 0; i < n; i++) {
    if (i % 120 === 0) drift = (rnd() - 0.5) * 1.2
    const open = price
    const close = open + drift + (rnd() - 0.5) * 2
    const high = Math.max(open, close) + rnd() * 0.8
    const low = Math.min(open, close) - rnd() * 0.8
    price = close
    const vol = 50 + rnd() * 100
    const c: Candle = { time: T0 + i * STEP, open, high, low, close, confirmed: true, vol }
    out.push(mirror ? { ...c, open: 2000 - open, close: 2000 - close, high: 2000 - low, low: 2000 - high } : c)
  }
  return out
}

describe('klinger', () => {
  it('signs the volume by the change of the typical price', () => {
    // Rising bars on growing volume: the fast average of the signed volume sits above the slow one.
    const rising: Candle[] = Array.from({ length: 300 }, (_, i) => ({
      time: T0 + i * STEP, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, confirmed: true, vol: 10 + i,
    }))
    const up = klinger(rising, 35, 50, 16)
    expect(up.kvo.at(-1)!).toBeGreaterThan(0)
    expect(up.sig.at(-1)!).toBeGreaterThan(0)
    // The same volume on falling bars is signed negative.
    const falling = rising.map((c, i) => ({ ...c, open: 400 - i, high: 401 - i, low: 399 - i, close: 400.5 - i }))
    const down = klinger(falling, 35, 50, 16)
    expect(down.kvo.at(-1)!).toBeLessThan(0)
    expect(down.sig.at(-1)!).toBeLessThan(0)
  })
})

describe('the Klinger scalp rule', () => {
  const c = series(20_000)
  const free = { ...KLINGER_SETTINGS, feeRate: 0 }

  it('fires on both sides with a real swing stop beyond the entry and a 1.5 R target', () => {
    const r = analyseKlingerScalp(c, free)
    expect(r.signals.length).toBeGreaterThan(30)
    expect(new Set(r.signals.map((x) => x.side)).size).toBe(2)
    for (const x of r.signals) {
      const long = x.side === 'long'
      expect(long ? x.stop < x.entry : x.stop > x.entry).toBe(true)
      expect(Math.abs(x.target! - x.entry) / Math.abs(x.entry - x.stop)).toBeCloseTo(1.5, 6)
    }
  })

  it('enters only on the first bar the conditions hold', () => {
    const e = klingerEntries(c, free)
    const hits = e.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
    expect(hits.length).toBeGreaterThan(30)
    // Two entries on consecutive bars would mean it re-fired while the conditions kept holding.
    for (let k = 1; k < hits.length; k++) {
      if (hits[k] === hits[k - 1] + 1) expect(e[hits[k]]!.side).not.toBe(e[hits[k - 1]]!.side)
    }
  })

  it('the Klinger conditions only remove entries from the colour-run control', () => {
    const withKvo = klingerEntries(c, free).filter(Boolean).length
    const control = klingerEntries(c, { ...free, kvo: false }).filter(Boolean).length
    expect(control).toBeGreaterThan(withKvo)
  })

  it('never uses a bar it has not seen', () => {
    const full = klingerEntries(c, free)
    const hits = full.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
    for (const i of hits.filter((_, k) => k % Math.ceil(hits.length / 8) === 0)) {
      expect(klingerEntries(c.slice(0, i + 1), free)[i], `bar ${i}`).toEqual(full[i])
    }
  })

  it('is symmetric: the price-mirrored series gives the mirrored trades', () => {
    const plain = analyseKlingerScalp(c, free)
    const mirrored = analyseKlingerScalp(series(20_000, 3, true), free)
    expect(mirrored.signals.length).toBe(plain.signals.length)
    plain.signals.forEach((x, k) => {
      expect(mirrored.signals[k].index).toBe(x.index)
      expect(mirrored.signals[k].side).toBe(x.side === 'long' ? 'short' : 'long')
      expect(mirrored.signals[k].outcome).toBe(x.outcome)
      // The last trade can still be open, and an open trade has no result yet.
      if (x.resultR !== undefined) expect(mirrored.signals[k].resultR).toBeCloseTo(x.resultR, 6)
    })
  })
})
