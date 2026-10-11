import { describe, expect, it } from 'vitest'
import { analyseFibPhases, FIB_PHASE_SETTINGS, fibPhaseEntries } from '../indicators/fibPhases'
import type { Candle } from '../indicators/types'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 0, 5)

/** Candles through a list of closes, each opening at the last close, with a small wick. */
function path(closes: number[], mirror = false): Candle[] {
  const out: Candle[] = []
  let prev = closes[0]
  closes.forEach((close, i) => {
    const open = prev
    // Unequal wicks: a bar that opens on the last close would otherwise tie its neighbour's
    // extreme exactly, and a swing point needs a strict one.
    const high = Math.max(open, close) + 0.2 + ((i * 37) % 11) * 0.03
    const low = Math.min(open, close) - 0.2 - ((i * 53) % 13) * 0.03
    prev = close
    const c: Candle = { time: T0 + i * DAY, open, high, low, close, confirmed: true }
    out.push(mirror ? { ...c, open: 230 - open, close: 230 - close, high: 230 - low, low: 230 - high } : c)
  })
  return out
}

/** 110 → 100 (phase 1's low at bar 40), 100 → 130 (its high at bar 60), then `after`. */
function phaseOne(after: number[]): number[] {
  const down = Array.from({ length: 40 }, (_, i) => 110 - i * (10 / 39))
  const up = Array.from({ length: 21 }, (_, i) => 100 + i * 1.5)
  return [...down, ...up, ...after]
}

// A shallow correction (to ~120) that takes eight bars and breaks the high: event 2.
const SHALLOW = [126, 122, 120, 123, 126, 129, 131, 133]
// A deep one (to 110) that turns: event 1.
const DEEP = [125, 120, 115, 112, 110, 111, 112.5, 114, 116]

describe('the phases and levels method', () => {
  it('event 2: two closes above phase 1’s high after a shallow correction', () => {
    const e = fibPhaseEntries(path(phaseOne(SHALLOW)))
    const hits = e.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
    // Closes 131 and 133 are bars 67 and 68: the second is the entry.
    expect(hits).toEqual([68])
    const x = e[68]!
    expect(x.side).toBe('long')
    expect(x.entry).toBe(133)
    // Target: phase 1's high plus half of its range, from the candles' own extremes.
    const candles = path(phaseOne(SHALLOW))
    const H = Math.max(...candles.slice(55, 65).map((b) => b.high))
    const L = Math.min(...candles.slice(35, 45).map((b) => b.low))
    expect(x.target!).toBeCloseTo(H + 0.5 * (H - L), 6)
    // Stop at half the distance to the target.
    expect(x.entry - x.stop).toBeCloseTo((x.target! - x.entry) / 2, 6)
    expect(x.note).toBe('evento 2')
  })

  it('tranches share one stop: the target moves, the stop is sized from the 50 % projection', () => {
    const candles = path(phaseOne(SHALLOW))
    const at = (extension: number) =>
      fibPhaseEntries(candles, { ...FIB_PHASE_SETTINGS, extension, stopExtension: 0.5 })[68]!
    const [near, mid, far] = [at(0.25), at(0.5), at(1)]
    expect(near.stop).toBeCloseTo(mid.stop, 9)
    expect(far.stop).toBeCloseTo(mid.stop, 9)
    expect(near.target!).toBeLessThan(mid.target!)
    expect(far.target!).toBeGreaterThan(mid.target!)
    // Without the fixed sizing the stop follows the target, as before.
    const own = fibPhaseEntries(candles, { ...FIB_PHASE_SETTINGS, extension: 1 })[68]!
    expect(own.entry - own.stop).toBeCloseTo((own.target! - own.entry) / 2, 6)
  })

  it('event 1: a swing low above phase 1’s low after a deep retracement', () => {
    const e = fibPhaseEntries(path(phaseOne(DEEP)))
    const hits = e.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
    expect(hits.length).toBe(1)
    const x = e[hits[0]]!
    expect(x.side).toBe('long')
    expect(x.note).toBe('evento 1')
    // The entry is the bar that confirms the correction's low: three bars after it.
    const candles = path(phaseOne(DEEP))
    const lows = candles.slice(61).map((b) => b.low)
    const lowBar = 61 + lows.indexOf(Math.min(...lows))
    expect(hits[0]).toBe(lowBar + 3)
    expect(x.stop).toBeLessThan(x.entry)
    expect(x.target!).toBeGreaterThan(x.entry)
  })

  it('does nothing when the correction takes longer than half of phase 1', () => {
    // Phase 1 lasted 20 bars: a correction of eleven or more is a lateral.
    const slow = [128, 126, 124, 122, 120, 121, 122, 124, 126, 128, 129, 131, 133]
    expect(fibPhaseEntries(path(phaseOne(slow))).filter(Boolean)).toHaveLength(0)
    // With the time rule off it is a trade.
    const off = fibPhaseEntries(path(phaseOne(slow)), { ...FIB_PHASE_SETTINGS, timeRatio: 0 })
    expect(off.filter(Boolean).length).toBeGreaterThan(0)
  })

  it('does nothing when the correction takes out phase 1’s low', () => {
    const broken = [120, 110, 98, 100, 104, 108, 112, 118, 124, 130, 133]
    expect(fibPhaseEntries(path(phaseOne(broken))).filter(Boolean)).toHaveLength(0)
  })

  it('is the mirror image for a short', () => {
    const e = fibPhaseEntries(path(phaseOne(SHALLOW), true))
    const x = e[68]!
    expect(x.side).toBe('short')
    expect(x.entry).toBe(230 - 133)
    expect(x.stop).toBeGreaterThan(x.entry)
    expect(x.target!).toBeLessThan(x.entry)
  })
})

describe('over a long random series', () => {
  function series(seed = 9, mirror = false): Candle[] {
    let s = seed
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
    const closes: number[] = []
    let price = 1000
    let drift = 0
    for (let i = 0; i < 6000; i++) {
      if (i % 40 === 0) drift = (rnd() - 0.5) * 6
      price += drift + (rnd() - 0.5) * 8
      closes.push(price)
    }
    return path(closes, false).map((c) =>
      mirror ? { ...c, open: 4000 - c.open, close: 4000 - c.close, high: 4000 - c.low, low: 4000 - c.high } : c,
    )
  }
  const c = series()
  const free = { ...FIB_PHASE_SETTINGS, feeRate: 0 }

  it('fires on both sides and on both events', () => {
    const e = fibPhaseEntries(c, free).filter(Boolean)
    expect(e.length).toBeGreaterThan(20)
    expect(new Set(e.map((x) => x!.side)).size).toBe(2)
    expect(new Set(e.map((x) => x!.note)).size).toBe(2)
  })

  it('never uses a bar it has not seen', () => {
    const full = fibPhaseEntries(c, free)
    const hits = full.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
    expect(hits.length).toBeGreaterThan(10)
    for (const i of hits.filter((_, k) => k % Math.ceil(hits.length / 12) === 0)) {
      expect(fibPhaseEntries(c.slice(0, i + 1), free)[i], `bar ${i}`).toEqual(full[i])
    }
  })

  it('is symmetric: the price-mirrored series gives the mirrored trades', () => {
    const plain = analyseFibPhases(c, free)
    const mirrored = analyseFibPhases(series(9, true), free)
    expect(mirrored.signals.length).toBe(plain.signals.length)
    plain.signals.forEach((x, k) => {
      expect(mirrored.signals[k].index).toBe(x.index)
      expect(mirrored.signals[k].side).toBe(x.side === 'long' ? 'short' : 'long')
      expect(mirrored.signals[k].outcome).toBe(x.outcome)
      if (x.resultR !== undefined) expect(mirrored.signals[k].resultR).toBeCloseTo(x.resultR, 6)
    })
  })
})

describe('the two-tranche exit', () => {
  const tranches = { ...FIB_PHASE_SETTINGS, exit: 'tranches' as const, extension: 1, stopExtension: 0.5, firstExtension: 0.5 }
  const run = (after: number[], mirror = false) => analyseFibPhases(path(phaseOne([...SHALLOW, ...after]), mirror), tranches).signals[0]
  const geometry = () => {
    const candles = path(phaseOne(SHALLOW))
    const H = Math.max(...candles.slice(55, 65).map((b) => b.high))
    const L = Math.min(...candles.slice(35, 45).map((b) => b.low))
    const first = H + 0.5 * (H - L)
    return { H, L, first, risk: (first - 133) / 2 }
  }

  it('sizes one stop for both halves from the 50 % projection', () => {
    const s = run([137, 141, 146, 148, 140, 134, 128])
    const g = geometry()
    expect(s.entry).toBe(133)
    expect(s.entry - s.stop).toBeCloseTo(g.risk, 6)
    expect(s.target!).toBeCloseTo(g.H + (g.H - g.L), 6)
  })

  it('moves the stop to the entry once the first half is out', () => {
    const s = run([137, 141, 146, 148, 140, 134, 128])
    // First half +2 R at the 50 % projection, the runner stopped at break-even.
    expect(s.closedPrice).toBeCloseTo(133, 6)
    expect(s.resultR).toBeCloseTo(1, 6)
  })

  it('follows the latest swing low once the last high is broken', () => {
    const s = run([137, 141, 146, 149, 152, 155, 151, 148, 146, 148, 151, 154, 158, 150, 140])
    // Not the break-even, and not the 100 % target either.
    expect(s.closedPrice!).toBeGreaterThan(144.5)
    expect(s.closedPrice!).toBeLessThan(146.5)
    expect(s.resultR!).toBeGreaterThan(1.8)
  })

  it('loses both halves at the stop when the first target never comes', () => {
    const s = run([130, 126, 120])
    expect(s.resultR!).toBeCloseTo(-1, 6)
    expect(s.outcome).toBe('loss')
  })

  it('takes both targets when price runs straight through', () => {
    const s = run([140, 150, 165])
    expect(s.closedPrice).toBeCloseTo(s.target!, 6)
    expect(s.resultR!).toBeGreaterThan(2)
  })

  it('is symmetric for a short', () => {
    const up = run([137, 141, 146, 149, 152, 155, 151, 148, 146, 148, 151, 154, 158, 150, 140])
    const down = run([137, 141, 146, 149, 152, 155, 151, 148, 146, 148, 151, 154, 158, 150, 140], true)
    expect(down.side).toBe('short')
    expect(down.resultR!).toBeCloseTo(up.resultR!, 6)
  })

  it('leaves the fixed exit untouched', () => {
    const candles = path(phaseOne(SHALLOW))
    expect(analyseFibPhases(candles).signals).toEqual(analyseFibPhases(candles, { ...FIB_PHASE_SETTINGS, exit: 'fixed' }).signals)
  })
})
