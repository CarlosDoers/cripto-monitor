import { describe, expect, it } from 'vitest'
import { resolveTrade, walk, type Entry } from '../indicators/tradeKit'
import { analyseNr7 } from '../indicators/narrowRange'
import { analyseOpeningRange, OPENING_RANGE_SETTINGS } from '../indicators/openingRange'
import type { Candle } from '../indicators/types'

/** A candle on a daily grid; `confirmed` is always true here. */
const bar = (i: number, open: number, high: number, low: number, close: number): Candle => ({
  time: i * 86_400_000,
  open,
  high,
  low,
  close,
  confirmed: true,
})

const opts = { feeRate: 0.001 }
const long = (over: Partial<Entry> = {}): Entry => ({ index: 0, side: 'long', entry: 100, stop: 90, ...over })

describe('resolveTrade — the rules every first run of a candidate looked better without', () => {
  it('checks the stop before the target when one bar touches both', () => {
    const candles = [bar(0, 100, 100, 100, 100), bar(1, 100, 125, 85, 110)]
    const s = resolveTrade(candles, long({ target: 120 }), opts)
    expect(s.outcome).toBe('loss')
    expect(s.resultR).toBe(-1)
  })

  it('fills a gap through the stop at the open, not at the stop', () => {
    const candles = [bar(0, 100, 100, 100, 100), bar(1, 80, 82, 78, 81)]
    const s = resolveTrade(candles, long(), opts)
    expect(s.closedPrice).toBe(80)
    expect(s.resultR).toBe(-2)
  })

  it('leaves the last trade open when the data ends before its window does', () => {
    const candles = [bar(0, 100, 100, 100, 100), bar(1, 100, 105, 99, 104)]
    const s = resolveTrade(candles, long({ maxBars: 5 }), opts)
    expect(s.outcome).toBe('open')
    expect(s.resultR).toBeUndefined()
  })

  it('closes at the close of the last allowed bar', () => {
    const candles = [bar(0, 100, 100, 100, 100), bar(1, 100, 104, 99, 103), bar(2, 103, 108, 101, 106)]
    const s = resolveTrade(candles, long({ maxBars: 2 }), opts)
    expect(s.closedIndex).toBe(2)
    expect(s.resultR).toBeCloseTo(0.6)
  })

  it('resolves the entry bar of a stop order: it can hit its own stop', () => {
    const candles = [bar(0, 100, 100, 100, 100), bar(1, 100, 112, 88, 110)]
    const s = resolveTrade(candles, long({ index: 1, intrabar: true, target: 120 }), opts)
    expect(s.outcome).toBe('loss')
    // On the entry bar the open came before the fill, so no gap can improve or worsen it.
    expect(s.closedPrice).toBe(90)
  })

  it('does not credit a limit order its target on the bar that filled it', () => {
    // The bar reaches the target (120) and the limit (100): the high may well have come first.
    const candles = [bar(0, 110, 110, 110, 110), bar(1, 110, 121, 99, 118), bar(2, 118, 119, 112, 115)]
    const limit = long({ index: 1, intrabar: true, limitFill: true, target: 120, maxBars: 1 })
    const s = resolveTrade(candles, limit, opts)
    expect(s.closedIndex).toBe(2)
    expect(s.resultR).toBeCloseTo(1.5) // out at the close of the next bar, not a +2 R win on the fill bar

    // The same order as a plain stop order does take the target on its own bar.
    const stopOrder = resolveTrade(candles, { ...limit, limitFill: false }, opts)
    expect(stopOrder.closedIndex).toBe(1)
    expect(stopOrder.resultR).toBe(2)
  })

  it('never lets a trailing stop move against the trade', () => {
    const candles = [bar(0, 100, 100, 100, 100), bar(1, 100, 110, 99, 109), bar(2, 109, 109, 95, 96)]
    // The trail first offers 105, then 80: the stop must stay at 105 and be hit on bar 2.
    const levels = [0, 105, 80]
    const s = resolveTrade(candles, long(), { ...opts, trail: (i) => levels[i] })
    expect(s.closedIndex).toBe(2)
    expect(s.closedPrice).toBe(105)
  })
})

describe('walk', () => {
  it('skips a stop too close for the fee to be paid', () => {
    const candles = Array.from({ length: 10 }, (_, i) => bar(i, 100, 101, 99, 100))
    // A 0.05 % stop against a 0.1 % round trip costs 2 R.
    const find = (i: number): Entry | null => (i === 3 ? { index: 3, side: 'long', entry: 100, stop: 99.95 } : null)
    expect(walk(candles, 1, find, opts)).toHaveLength(0)
  })

  it('runs one position at a time', () => {
    const candles = Array.from({ length: 12 }, (_, i) => bar(i, 100, 101, 99, 100))
    let proposals = 0
    const find = (i: number): Entry | null => {
      proposals++
      return { index: i, side: 'long', entry: 100, stop: 90, maxBars: 3 }
    }
    const signals = walk(candles, 1, find, opts)
    // Each trade closes three bars after its entry and the search resumes the bar after.
    expect(signals.map((s) => s.index)).toEqual([1, 5, 9])
    expect(proposals).toBe(3)
  })
})

describe('a bar that reaches both stop orders is a loss, not a skipped day', () => {
  it('NR7 counts it', () => {
    // Bars 0–6 are wide, bar 7 is the narrowest of seven, bar 8 breaks out both ways.
    const candles = [
      ...Array.from({ length: 7 }, (_, i) => bar(i, 100, 106, 94, 100)),
      bar(7, 100, 102, 98, 100),
      bar(8, 100, 104, 96, 100),
      bar(9, 100, 100, 100, 100),
    ]
    const result = analyseNr7(candles)
    expect(result.signals).toHaveLength(1)
    expect(result.signals[0].outcome).toBe('loss')
    expect(result.signals[0].resultR).toBe(-1)
  })

  it('the opening range counts the day as a loss by default, and drops it only when told to', () => {
    // 2026-01-12 is a Monday in winter: the New York open is 14:30 UTC. The range is built from the
    // two 15 m candles from 14:30; the third reaches both of its ends.
    const T = Date.UTC(2026, 0, 12, 14, 30)
    const m = 900_000
    const candles: Candle[] = []
    for (let i = -8; i < 40; i++) {
      const t = T + i * m
      const inRange = i === 0 || i === 1
      candles.push({
        time: t,
        open: 100,
        high: inRange ? 101 : 100.2,
        low: inRange ? 99 : 99.8,
        close: 100,
        confirmed: true,
        vol: 1,
      })
    }
    // The candle right after the range spans both ends.
    candles[10] = { ...candles[10], high: 102, low: 98 }

    // Counted since 2026-10-10: dropping these days read +0.25 R where the honest count is +0.22.
    const counted = analyseOpeningRange(candles).signals
    const dropped = analyseOpeningRange(candles, { ...OPENING_RANGE_SETTINGS, doubleTouchLoss: false }).signals
    expect(dropped).toHaveLength(0)
    expect(counted).toHaveLength(1)
    expect(counted[0].outcome).toBe('loss')
    expect(counted[0].resultR).toBeLessThanOrEqual(-1)
  })
})
