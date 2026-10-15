import { describe, expect, it } from 'vitest'
import { btcRegime, REGIME_BAR_MS } from '../entryContext'
import type { Candle } from '../indicators/types'
import { rowContext, sideNote } from '../watchContext'

const H4 = REGIME_BAR_MS
const btc = (): Candle[] => [
  ...Array.from({ length: 700 }, (_, i) => ({ time: i * H4, open: 100, high: 100.5, low: 99.5, close: 100, vol: 10, confirmed: true })),
  ...Array.from({ length: 40 }, (_, k) => {
    const c = 100 + 2 * (k + 1)
    return { time: (700 + k) * H4, open: c, high: c + 0.5, low: c - 0.5, close: c, vol: 10, confirmed: true }
  }),
]
const regime = btcRegime(btc())

describe('the context of a watch row', () => {
  it('gives an entry what its own candle closed with', () => {
    const tags = rowContext(
      { status: 'nueva', next: 'long', side: 'long', entryAt: 720 * H4, volume: 2.4 },
      regime,
      'donchian',
      'trend',
      '4H',
    )
    expect(tags.map((t) => t.label)).toEqual(['BTC sobre su EMA 200', 'Volumen 2,4×'])
  })

  it('reads BTC at the entry, not now: a position that began before BTC turned says what it began under', () => {
    // At candle 650 BTC was flat at its EMA, i.e. not above it; now it is.
    const tags = rowContext({ status: 'tendencia', next: null, side: 'long', entryAt: 650 * H4, volume: 1 }, regime, 'donchian', 'trend', '4H')
    expect(tags[0].label).toBe('BTC bajo su EMA 200')
    expect(tags[0].tone).toBe('warn')
  })

  it('gives an entry that is forming BTC now and says its volume is not comparable yet', () => {
    const tags = rowContext({ status: 'rompiendo', next: 'long', side: null }, regime, 'donchian', 'trend', '4H')
    expect(tags.map((t) => t.label)).toEqual(['BTC sobre su EMA 200', 'Volumen: vela en curso'])
  })

  it('has nothing to say about a contract that is only waiting, or without BTC', () => {
    expect(rowContext({ status: 'fuera', next: null, side: null }, regime, 'donchian', 'trend', '4H')).toEqual([])
    expect(rowContext({ status: 'corto', next: null, side: null }, regime, 'donchian', 'trend', '4H')).toEqual([])
    const noBtc = rowContext({ status: 'nueva', next: 'short', side: 'short', entryAt: 720 * H4, volume: 1.2 }, null, 'ema200', 'base', '4H')
    expect(noBtc.map((t) => t.key)).toEqual(['volume'])
  })

  it('marks a weekend close on a position the card is showing', () => {
    // Candle that closes on Saturday 2026-10-10 00:00 UTC.
    const sat = Date.UTC(2026, 9, 10, 0)
    const tags = rowContext({ status: 'nueva', next: 'long', side: 'long', entryAt: sat, volume: 2 }, null, 'donchian', 'trend', '4H')
    expect(tags.find((t) => t.key === 'weekend')?.tone).toBe('warn')
  })
})

describe('what is said of a side', () => {
  it('calls a short a small edge, with the long beside it', () => {
    const short = sideNote('donchian', 'trend', '4H', 'short')!
    expect(short).toContain('+0,12 R')
    expect(short).toContain('+0,61 R')
    expect(short).toContain('ventaja pequeña')
    expect(sideNote('donchian', 'trend', '4H', 'long')).toContain('+0,61 R')
  })

  it('says nothing for a strategy and bar that were not measured', () => {
    expect(sideNote('ema200', 'base', '1H', 'long')).toBeUndefined()
  })
})
