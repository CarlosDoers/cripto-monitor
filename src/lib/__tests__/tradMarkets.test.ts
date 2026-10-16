import { describe, expect, it } from 'vitest'
import { quote } from '../format'
import { tradOffered, TRAD_TRACK, trackLabel, entryTags, REFERENCE } from '../ledger'
import type { LedgerEntry } from '../ledgerModel'
import {
  compareTradWatch,
  isTradTrack,
  liquidityVerdict,
  liveTradContracts,
  thinReasons,
  tradDisplay,
  tradFollowed,
  tradKindNote,
  tradSymbolByOkx,
  TRAD_LIQUIDITY,
  TRAD_TRACK_KEY,
  TRAD_TREND_EVIDENCE,
  TRAD_UNIVERSE,
  watchTradTrend,
} from '../tradMarkets'
import type { Candle } from '../indicators/types'
import { US_CLOSE_MS } from '../yahoo'

const DAY = 86_400_000
const start = Date.UTC(2023, 0, 2)

/** Sessions at weekday dates from `start`, each from a (open, high, low, close) rule over its index. */
function series(n: number, bar: (i: number) => [number, number, number, number]): Candle[] {
  const out: Candle[] = []
  for (let i = 0, d = start; out.length < n; d += DAY) {
    const wd = new Date(d).getUTCDay()
    if (wd === 0 || wd === 6) continue
    const [open, high, low, close] = bar(out.length)
    out.push({ time: d, open, high, low, close, vol: 1000, confirmed: true })
    i++
  }
  return out
}

const flat = (): [number, number, number, number] => [100, 100.5, 99.5, 100]
const N = 700
const SPY = TRAD_UNIVERSE.find((s) => s.okx === 'SPY')!

describe('the table of contracts', () => {
  it('names each OKX ticker once, with the symbol that follows it', () => {
    const okx = TRAD_UNIVERSE.map((s) => s.okx)
    expect(new Set(okx).size).toBe(okx.length)
    expect(tradSymbolByOkx('XAU')).toMatchObject({ yahoo: 'GLD', kind: 'commodity' })
    expect(tradSymbolByOkx('CL')).toMatchObject({ yahoo: 'USO' })
    expect(tradSymbolByOkx('AAPL')).toMatchObject({ yahoo: 'AAPL', kind: 'stock' })
    // QQQ is the Nasdaq 100 already; the index contract would alert twice.
    expect(tradSymbolByOkx('US100')).toBeUndefined()
  })

  it('follows every kind but the one that measured without an edge', () => {
    expect(tradFollowed('index')).toBe(true)
    expect(tradFollowed('commodity')).toBe(true)
    expect(tradFollowed('stock')).toBe(true)
    expect(tradFollowed('leveraged')).toBe(false)
    expect(TRAD_UNIVERSE.filter((s) => s.kind === 'leveraged').map((s) => s.okx)).toContain('SOXL')
  })

  it('lists only what is live on OKX, from the catalogue', () => {
    const live = liveTradContracts([
      { instId: 'AAPL-USD_UM_XPERP-310613', state: 'live', instCategory: '3' },
      { instId: 'XAU-USD_UM_XPERP-310502', state: 'live', instCategory: '4' },
      // A dated gold future is not the perpetual.
      { instId: 'XAU-USD_UM-261030', state: 'live', instCategory: '4' },
      { instId: 'TSLA-USD_UM_XPERP-310613', state: 'preopen', instCategory: '3' },
      // A crypto coin with the ticker of a stock is not it.
      { instId: 'MU-USD_UM_XPERP-1', state: 'live', instCategory: '1' },
      { instId: 'SPY-USD_UM_XPERP-310613', state: 'live', instCategory: '3' },
    ])
    expect(live.map((c) => `${c.sym.okx}:${c.instId}`).sort()).toEqual([
      'AAPL:AAPL-USD_UM_XPERP-310613',
      'SPY:SPY-USD_UM_XPERP-310613',
      'XAU:XAU-USD_UM_XPERP-310502',
    ])
  })

  it('writes a name where the ticker says nothing', () => {
    expect(tradDisplay(tradSymbolByOkx('XAU')!)).toBe('XAU (oro)')
    expect(tradDisplay(tradSymbolByOkx('BZ')!)).toBe('BZ (petróleo Brent)')
    expect(tradDisplay(tradSymbolByOkx('SPY')!)).toBe('SPY')
    expect(tradDisplay(tradSymbolByOkx('AAPL')!)).toBe('AAPL')
  })

  it('says for every kind what is and is not known, from the measured figures', () => {
    expect(tradKindNote('index')).toContain('Medido en')
    expect(tradKindNote('index')).toContain('frente a')
    // The basket is twenty ETFs and OKX lists four of them: the note says so instead of letting 20 stand for what can be bought.
    expect(tradKindNote('index')).toContain('OKX lista cuatro')
    expect(tradKindNote('index')).toContain('SPY, QQQ, EWY, EWZ')
    expect(tradKindNote('commodity')).toContain('Cuatro series')
    expect(tradKindNote('stock')).toContain('supervivientes')
    expect(tradKindNote('leveraged')).toContain('no se sigue')
  })
})

describe('where a contract stands', () => {
  it('has too little history', () => {
    const w = watchTradTrend(series(300, flat), SPY, 'SPY-USD_UM_XPERP-1')
    expect(w).toMatchObject({ status: 'corto', bars: 300 })
    expect(w.need).toBeGreaterThan(300)
  })

  it('is a new signal when the last session breaks the 20-day high above the EMA 200', () => {
    const c = series(N, (i) => (i < N - 1 ? flat() : [100, 103.5, 99.8, 103]))
    const w = watchTradTrend(c, SPY, 'SPY-USD_UM_XPERP-1')
    expect(w).toMatchObject({ status: 'nueva', age: 0, entry: 103, above: true, kind: 'index', okx: 'SPY', yahoo: 'SPY' })
    expect(w.asOf).toBe(c.at(-1)!.time + US_CLOSE_MS)
    expect(w.entryAt).toBe(w.asOf)
    // A long that is open has nothing left to break.
    expect(w.level).toBeUndefined()
    expect(w.stop).toBeLessThan(103)
  })

  it('is in trend when the breakout is older and the trailing stop has not been hit', () => {
    const c = series(N, (i) => {
      if (i < N - 12) return flat()
      const base = 103 + (i - (N - 12)) * 0.4
      return [base - 0.3, base + 0.3, base - 0.5, base]
    })
    const w = watchTradTrend(c, SPY, 'SPY-USD_UM_XPERP-1')
    expect(w.status).toBe('tendencia')
    expect(w.age).toBeGreaterThan(1)
    expect(w.stop).toBeDefined()
  })

  it('is close when it sits just under the 20-day high with no long open', () => {
    const c = series(N, (i) => (i < N - 1 ? flat() : [100, 100.4, 100, 100.25]))
    const w = watchTradTrend(c, SPY, 'SPY-USD_UM_XPERP-1')
    expect(w.status).toBe('cerca')
    expect(w.level).toBeCloseTo(100.5, 5)
    expect(w.distanceAtr).toBeLessThanOrEqual(0.5)
    expect(w.distance).toBeLessThan(0)
  })

  it('has no position under its EMA 200, and says a short is not followed', () => {
    const c = series(N, (i) => {
      if (i < N - 60) return flat()
      // Each close is under the previous 20-bar low, and far under the EMA 200 within a few sessions.
      const p = 100 - (i - (N - 60)) * 1.2
      return [p + 0.2, p + 0.5, p - 0.5, p]
    })
    const w = watchTradTrend(c, SPY, 'SPY-USD_UM_XPERP-1')
    expect(w.status).toBe('fuera')
    expect(w.above).toBe(false)
    expect(w.stop).toBeUndefined()
    expect(w.shortOpen).toBe(true)
  })

  it('puts the urgent first, and the better-evidenced kind within a status', () => {
    const row = (okx: string, kind: 'index' | 'stock' | 'commodity', status: 'nueva' | 'cerca' | 'tendencia' | 'fuera' | 'corto', extra = {}) => ({
      yahoo: okx, okx, instId: okx, kind, status, bars: 700, asOf: 0, price: 1, ...extra,
    })
    const sorted = [
      row('NVDA', 'stock', 'tendencia', { age: 5 }),
      row('AAPL', 'stock', 'cerca', { distanceAtr: 0.4 }),
      row('XAU', 'commodity', 'nueva', { age: 0 }),
      row('SPY', 'index', 'cerca', { distanceAtr: 0.45 }),
      row('MSFT', 'stock', 'nueva', { age: 1 }),
    ].sort(compareTradWatch)
    expect(sorted.map((r) => r.okx)).toEqual(['XAU', 'MSFT', 'SPY', 'AAPL', 'NVDA'])
  })
})

describe('the evidence and the track', () => {
  it('is offered only while its own measurement clears the same bar as every other bar', () => {
    expect(tradOffered()).toBe(true)
    const e = TRAD_TREND_EVIDENCE.index
    expect(Math.min(...e.halves)).toBeGreaterThanOrEqual(0.1)
    expect(e.net - e.random).toBeGreaterThanOrEqual(0.05)
    expect(e.withoutBest10).toBeGreaterThan(0)
  })

  it('clears the same bar on the four ETFs OKX actually lists, not only on the basket of twenty', () => {
    const o = TRAD_TREND_EVIDENCE.okxIndex
    const basket = TRAD_TREND_EVIDENCE.index
    expect(o.n).toBeLessThan(basket.n)
    expect(Math.min(...o.halves)).toBeGreaterThanOrEqual(0.1)
    expect(o.net - o.random).toBeGreaterThanOrEqual(0.05)
    expect(o.withoutBest10).toBeGreaterThan(0)
    // What stays thin is said in the figures: the last years are a few dozen trades, and two of the four go negative without their best ten.
    expect(o.recent.n).toBeLessThan(100)
    expect(o.recent.withoutBest10).toBeLessThan(0)
    expect(o.ewyEwzWithoutBest10).toBeLessThan(0)
  })

  it('is a daily long-only track on its own clock, and reads its reference from the same figures', () => {
    expect(TRAD_TRACK).toMatchObject({ key: TRAD_TRACK_KEY, market: 'trad', bar: '1D', sides: ['long'], closeMs: US_CLOSE_MS })
    expect(isTradTrack(TRAD_TRACK_KEY)).toBe(true)
    expect(isTradTrack('donchian/trend@4H')).toBe(false)
    expect(isTradTrack(undefined)).toBe(false)
    expect(trackLabel(TRAD_TRACK_KEY)).toBe('Tendencia diaria · bolsa, ETF y oro')
    expect(REFERENCE[TRAD_TRACK_KEY]).toMatchObject({ net: TRAD_TREND_EVIDENCE.index.net, n: TRAD_TREND_EVIDENCE.index.n, shorts: TRAD_TREND_EVIDENCE.indexShorts })
  })

  it('does not hang the crypto tags on an equity: they did not replicate there', () => {
    const e = { track: TRAD_TRACK_KEY, side: 'long', volume: 3, btcAbove: true, weekend: false } as LedgerEntry
    expect(entryTags(e)).toEqual([])
  })

  it('says the leveraged ETFs, the commodities and the stocks are not the reference', () => {
    const t = TRAD_TREND_EVIDENCE
    // The reference is the index ETFs; the others are why each note exists.
    expect(t.leveraged.net).toBeLessThan(0.15)
    expect(t.commodity.withoutBest10).toBeLessThan(0)
    expect(t.stocks.net).toBeGreaterThan(t.index.net)
  })
})

describe('quote', () => {
  it('prints a price to the cent in es-ES, and a sub-dollar price to four decimals', () => {
    expect(quote(100.6143)).toBe('100,61')
    expect(quote(1234.5)).toBe('1234,50')
    expect(quote(0.4231)).toBe('0,4231')
  })
})

describe('liquidity', () => {
  it('calls a contract thin by its volume or its spread, and an empty book thin too', () => {
    // What OKX showed on 2026-10-16: SPY and QQQ workable, EWY and EWZ not.
    expect(thinReasons(158_000, 6.3)).toEqual([])
    expect(thinReasons(421_000, 7.6)).toEqual([])
    expect(thinReasons(32_000, 28.3)).toEqual(['horquilla ancha', 'poco volumen'])
    expect(thinReasons(0, 57.4)).toEqual(['horquilla ancha', 'poco volumen'])
    expect(thinReasons(7_000_000, 0.2)).toEqual([])
    // A wide spread on a busy day, and a tight one on a quiet day, each say their own reason.
    expect(thinReasons(5_000_000, 40)).toEqual(['horquilla ancha'])
    expect(thinReasons(40_000, 5)).toEqual(['poco volumen'])
    // No bid or no ask: the spread is NaN.
    expect(thinReasons(500_000, Number.NaN)).toEqual(['sin libro'])
    expect(thinReasons(Number.NaN, 5)).toEqual(['poco volumen'])
  })

  it('lets the usual size through a book that costs a tenth of an R, and says what it costs', () => {
    // SPY on 2026-10-16: about 10 bp over the mid either way for 5 000 $, behind a stop 1.7 % away.
    const v = liquidityVerdict({ mid: 773, spreadBp: 6.3, buyBp: 9.7, sellBp: 9.7 }, 0.0169)
    expect(v.block).toBe(false)
    expect(v.costR).toBeCloseTo((19.4 / 10_000) / 0.0169, 6)
    expect(v.line).toContain(`${new Intl.NumberFormat('es-ES').format(TRAD_LIQUIDITY.refUsd)} $`)
    expect(v.line).toContain('9,7 pb (0,10\u00a0%)')
    expect(v.line).toContain('0,11 R')
    expect(v.line).toContain('Horquilla 6,3 pb')
    // Said once, plainly: it is the spread only, the fees come on top.
    expect(v.line).toContain('sin contar comisiones')
  })

  it('does not announce a book that costs more than the cap, and a wider stop makes the same book cheaper in R', () => {
    // EWZ: 60 bp each way behind a 5.9 % stop is 0.2 R.
    const ewz = { mid: 41.8, spreadBp: 57, buyBp: 59.8, sellBp: 59.8 }
    expect(liquidityVerdict(ewz, 0.0588).block).toBe(true)
    expect(liquidityVerdict(ewz, 0.0588).costR).toBeCloseTo(0.2034, 3)
    // The same book behind a 20 % stop costs 0.06 R: the cost is the book against the trade's own risk.
    expect(liquidityVerdict(ewz, 0.2).block).toBe(false)
    // The cap is the caller's.
    expect(liquidityVerdict(ewz, 0.0588, 0.25).block).toBe(false)
    expect(liquidityVerdict(ewz, 0.0588, 0.1).block).toBe(true)
  })

  it('blocks a book that cannot take the size at all, or has no touch, unless the gate is off — and still says why', () => {
    const none = liquidityVerdict({ mid: 100, spreadBp: 20, buyBp: null, sellBp: 30 }, 0.02)
    expect(none.block).toBe(true)
    expect(none.costR).toBeNull()
    expect(none.line).toContain('no admite')
    const empty = liquidityVerdict(null, 0.02)
    expect(empty.block).toBe(true)
    expect(empty.line).toContain('no tiene ahora compra y venta')
    // Gate off (a cap of 0): everything is announced, with the line.
    expect(liquidityVerdict({ mid: 100, spreadBp: 20, buyBp: null, sellBp: null }, 0.02, 0).block).toBe(false)
    expect(liquidityVerdict(null, 0.02, 0).block).toBe(false)
    expect(liquidityVerdict({ mid: 41.8, spreadBp: 57, buyBp: 59.8, sellBp: 59.8 }, 0.0588, 0).block).toBe(false)
  })

  it('leaves out the R figure when the trade has no risk to measure it against, without blocking on a guess', () => {
    const v = liquidityVerdict({ mid: 100, spreadBp: 6, buyBp: 5, sellBp: 5 }, 0)
    expect(v.costR).toBeNull()
    expect(v.block).toBe(false)
    expect(v.line).not.toContain(' R de horquilla')
  })

  it('keeps its thresholds where the measurement put them', () => {
    // 100 k$ a day makes a 5 000 $ position 5 % of it; 25 bp is about what the median equity perpetual quotes; 0.15 R is half of
    // what the ETFs' trend earned over a random long.
    expect(TRAD_LIQUIDITY).toEqual({ refUsd: 5_000, minVolumeUsd: 100_000, maxSpreadBp: 25, maxCostR: 0.15 })
    expect(TRAD_LIQUIDITY.refUsd / TRAD_LIQUIDITY.minVolumeUsd).toBeLessThanOrEqual(0.05)
  })
})
