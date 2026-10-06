import { describe, expect, it } from 'vitest'
import { compareDonchianWatch, watchDonchianTrend, type DonchianWatch } from '../donchianWatch'
import { analyseDonchian, DONCHIAN_SETTINGS, DONCHIAN_TREND_SETTINGS } from '../indicators/donchianBreakout'
import { toCandles } from '../signals'
import type { Candle } from '../types'

const H4 = 4 * 3_600_000

/** One 4 h candle as OKX serves it: strings, confirmed. */
const row = (i: number, open: number, high: number, low: number, close: number): Candle =>
  [String(i * H4), String(open), String(high), String(low), String(close), '1', '1', '1', '1'] as unknown as Candle

/** `n` quiet candles around 100: range 99.5–100.5, so an ATR of exactly 1. */
const flat = (from: number, n: number) => Array.from({ length: n }, (_, k) => row(from + k, 100, 100.5, 99.5, 100))

const watch = (rows: Candle[], live = 0) => watchDonchianTrend(rows, live, 'TEST-USD_UM_XPERP-1', 'TEST')

describe('Donchian + EMA 200: the preset itself', () => {
  it('waits three lengths of EMA before deciding anything, and the plain Donchian does not', () => {
    const candles = toCandles(flat(0, 700))
    expect(analyseDonchian(candles, DONCHIAN_TREND_SETTINGS).warmup).toBe(3 * 200 + 20)
    expect(analyseDonchian(candles, DONCHIAN_SETTINGS).warmup).toBe(40)
  })

  it('draws the EMA 200 as context, off the price scale', () => {
    const lines = analyseDonchian(toCandles(flat(0, 700)), DONCHIAN_TREND_SETTINGS).overlays
    expect(lines.find((o) => o.key === 'trend')?.context).toBe(true)
    expect(analyseDonchian(toCandles(flat(0, 700)), DONCHIAN_SETTINGS).overlays.some((o) => o.key === 'trend')).toBe(false)
  })

  it('ignores a breakout against the EMA that the plain Donchian takes', () => {
    // A jump to 130 leaves the EMA far below; a later drop breaks the 20-candle low while still above it.
    const rows = [...flat(0, 600), ...Array.from({ length: 40 }, (_, k) => row(600 + k, 130, 130.5, 129.5, 130)), row(640, 130, 130, 119, 120)]
    const last = rows.length - 1
    const trend = analyseDonchian(toCandles(rows), DONCHIAN_TREND_SETTINGS).signals
    const plain = analyseDonchian(toCandles(rows), DONCHIAN_SETTINGS).signals
    expect(plain.some((s) => s.index === last && s.side === 'short')).toBe(true)
    expect(trend.some((s) => s.index === last && s.side === 'short')).toBe(false)
  })

  it('reports where the trailing stop stands once it has moved past the initial one', () => {
    // A breakout, then nine candles climbing three at a time: the 8 ATR trail overtakes the 2 ATR stop.
    const climb = Array.from({ length: 9 }, (_, k) => {
      const c = 105 + 3 * k
      return row(691 + k, c - 3, c + 0.5, c - 3.5, c)
    })
    const rows = [...flat(0, 690), row(690, 100, 102.5, 99.8, 102), ...climb]
    const open = analyseDonchian(toCandles(rows), DONCHIAN_TREND_SETTINGS).active
    expect(open?.side).toBe('long')
    expect(open?.stopNow).toBeGreaterThan(open!.stop)
    // A closed trade carries no live stop, and neither does a trade that does not trail.
    expect(analyseDonchian(toCandles(rows), { ...DONCHIAN_TREND_SETTINGS, trailAtr: 0 }).active?.stopNow).toBeUndefined()
  })
})

describe('watchDonchianTrend', () => {
  it('says so when there is too little history for the EMA to have settled', () => {
    const w = watch(flat(0, 100))
    expect(w.status).toBe('corto')
    expect(w.need).toBe(620)
    expect(w.bars).toBe(100)
  })

  it('"nueva": the preset opened on the last closed candle', () => {
    const w = watch([...flat(0, 699), row(699, 100, 102.5, 99.8, 102)])
    expect(w.status).toBe('nueva')
    expect(w.side).toBe('long')
    expect(w.bias).toBe('long')
    expect(w.age).toBe(0)
    expect(w.entry).toBe(102)
    expect(w.stop).toBeLessThan(102)
    // Already in: there is no edge left to break, so none is offered.
    expect(w.level).toBeNaN()
    expect(w.distanceAtr).toBeNaN()
  })

  it('"rompiendo": the candle in progress is already beyond the edge, and no position is open', () => {
    const w = watch(flat(0, 700), 101)
    expect(w.status).toBe('rompiendo')
    expect(w.side).toBeNull()
    expect(w.bias).toBe('long')
    expect(w.level).toBe(100.5)
    expect(w.distance).toBeCloseTo(101 / 100.5 - 1)
  })

  it('"rompiendo" below the EMA means the short edge', () => {
    const w = watch(flat(0, 700), 99)
    expect(w.status).toBe('rompiendo')
    expect(w.bias).toBe('short')
    expect(w.level).toBe(99.5)
  })

  it('"cerca": within half an ATR of the edge its bias waits on', () => {
    const w = watch(flat(0, 700), 100.3)
    expect(w.status).toBe('cerca')
    expect(w.distanceAtr).toBeCloseTo(0.2, 5)
  })

  it('"fuera": a long way from any edge and no position', () => {
    // One old spike keeps the 20-candle high far above price without being a breakout.
    const rows = [...flat(0, 690), row(690, 100, 110, 99.5, 100), ...flat(691, 9)]
    const w = watch(rows, 100.2)
    expect(w.status).toBe('fuera')
    expect(w.side).toBeNull()
    expect(w.distanceAtr).toBeGreaterThan(5)
  })

  it('"tendencia": in a trade for more than one candle, on the bias side', () => {
    const rows = [
      ...flat(0, 690),
      row(690, 100, 102.5, 99.8, 102),
      ...Array.from({ length: 9 }, (_, k) => row(691 + k, 102, 102.5, 101.5, 102)),
    ]
    const w = watch(rows)
    expect(w.status).toBe('tendencia')
    expect(w.side).toBe('long')
    expect(w.age).toBe(9)
    expect(w.level).toBeNaN()
  })

  it('a trade on the wrong side of the EMA still has an edge to watch: the one that would turn it', () => {
    // Long since 690, then the market slides below the EMA 200 and keeps the stop alive.
    const rows = [
      ...flat(0, 690),
      row(690, 100, 102.5, 99.8, 102),
      ...Array.from({ length: 9 }, (_, k) => row(691 + k, 102, 102.5, 101.5, 102)),
    ]
    const w = watch(rows, 99)
    expect(w.side).toBe('long')
    expect(w.bias).toBe('short')
    expect(w.level).toBe(Math.min(...toCandles(rows).slice(-20).map((c) => c.low)))
    expect(['rompiendo', 'cerca', 'tendencia']).toContain(w.status)
  })

  it('shows the current stop of an old trade, not its initial one', () => {
    const climb = Array.from({ length: 9 }, (_, k) => {
      const c = 105 + 3 * k
      return row(691 + k, c - 3, c + 0.5, c - 3.5, c)
    })
    const rows = [...flat(0, 690), row(690, 100, 102.5, 99.8, 102), ...climb]
    const open = analyseDonchian(toCandles(rows), DONCHIAN_TREND_SETTINGS).active!
    const w = watch(rows)
    expect(w.stop).toBe(open.stopNow)
    expect(w.stop).toBeGreaterThan(open.stop)
  })
})

describe('compareDonchianWatch', () => {
  const w = (status: DonchianWatch['status'], distanceAtr = 1, age = 0): DonchianWatch => ({
    instId: status,
    symbol: status,
    status,
    bias: 'long',
    side: null,
    age,
    price: 1,
    ema: 1,
    level: 1,
    distance: 0,
    distanceAtr,
    bars: 700,
  })

  it('puts what can still be acted on first, then the closest to the edge', () => {
    const rows = [w('fuera'), w('cerca', 0.4), w('tendencia', NaN, 9), w('nueva', NaN, 1), w('rompiendo'), w('cerca', 0.1), w('tendencia', NaN, 2), w('nueva', NaN, 0)]
    const order = rows
      .sort(compareDonchianWatch)
      .map((x) => `${x.status}${x.status === 'tendencia' || x.status === 'nueva' ? x.age : x.status === 'cerca' ? x.distanceAtr : ''}`)
    expect(order).toEqual(['nueva0', 'nueva1', 'rompiendo', 'cerca0.1', 'cerca0.4', 'tendencia2', 'tendencia9', 'fuera'])
  })
})
