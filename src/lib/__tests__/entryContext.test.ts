import { describe, expect, it } from 'vitest'
import {
  btcRegime,
  closesAtWeekend,
  contextTags,
  CONTEXT_EVIDENCE,
  entryContext,
  HIGH_VOLUME,
  REGIME_BAR_MS,
  regimeReading,
  volumeRatio,
  withRegime,
} from '../entryContext'
import type { Candle } from '../indicators/types'

const H4 = REGIME_BAR_MS

const candle = (i: number, close: number, vol = 10): Candle => ({
  time: i * H4,
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  vol,
  confirmed: true,
})

/** 700 candles at 100, then a climb: BTC settles and ends above its EMA. */
const climbing = () => [
  ...Array.from({ length: 700 }, (_, i) => candle(i, 100)),
  ...Array.from({ length: 40 }, (_, k) => candle(700 + k, 100 + 2 * (k + 1))),
]

describe('volumeRatio', () => {
  it('is the candle against the mean of the twenty before it, itself excluded', () => {
    const c = Array.from({ length: 30 }, (_, i) => candle(i, 100, i === 25 ? 45 : 10))
    expect(volumeRatio(c, 25)).toBeCloseTo(4.5)
    // The heavy candle is in the next candle's window, not its own.
    expect(volumeRatio(c, 26)).toBeCloseTo(10 / ((19 * 10 + 45) / 20))
  })

  it('says nothing when it has too little history, a missing volume or an all-zero window', () => {
    const c = Array.from({ length: 30 }, (_, i) => candle(i, 100))
    expect(volumeRatio(c, 19)).toBeNaN()
    expect(volumeRatio(c, 99)).toBeNaN()
    expect(volumeRatio(c.map((x) => ({ ...x, vol: 0 })), 25)).toBeNaN()
    expect(volumeRatio(c.map((x, i) => (i === 10 ? { ...x, vol: undefined } : x)), 25)).toBeNaN()
  })
})

describe('btcRegime', () => {
  it('reads the side of the EMA 200 on the last candle that had closed', () => {
    const r = btcRegime(climbing())
    expect(r.latest.above).toBe(true)
    // 700 flat candles: not above. The first candle that climbs closes above the average.
    expect(r.aboveAt(700 * H4)).toBe(false)
    expect(r.aboveAt(701 * H4)).toBe(true)
    // Between closes it is still the previous candle that counts.
    expect(r.aboveAt(701 * H4 - 1)).toBe(false)
  })

  it('does not decide before the average has settled', () => {
    const r = btcRegime(climbing())
    expect(r.aboveAt(300 * H4)).toBeNull()
    expect(r.aboveAt(0)).toBeNull()
    expect(btcRegime(climbing().slice(0, 100)).latest.above).toBeNull()
  })

  it('says since when BTC has been on that side, and nothing when it cannot know', () => {
    const r = btcRegime(climbing())
    // The climb starts with candle 700, which closes at 701 candle-widths.
    expect(r.since).toBe(701 * H4)
    // A series that never leaves its side from the first settled candle has no start date to give.
    expect(btcRegime(Array.from({ length: 800 }, (_, i) => candle(i, 100 + i))).since).toBeNull()
  })

  it('ignores a candle still forming', () => {
    const c = climbing()
    c.push({ ...candle(740, 10), confirmed: false })
    expect(btcRegime(c).latest.above).toBe(true)
  })
})

describe('the entry context', () => {
  const regime = btcRegime(climbing())

  it('carries volume, BTC regime and the weekend of the candle the entry closed on', () => {
    const c = climbing().map((x, i) => (i === 720 ? { ...x, vol: 30 } : x))
    const ctx = entryContext(c, 720, H4, regime)
    expect(ctx.volume).toBeCloseTo(3)
    expect(ctx.btcAbove).toBe(true)
    expect(typeof ctx.weekend).toBe('boolean')
  })

  it('has no regime without BTC candles', () => {
    expect(entryContext(climbing(), 720, H4, null).btcAbove).toBeNull()
  })

  it('judges the weekend by the instant the candle closes', () => {
    // 2026-10-10 is a Saturday. The 20:00 candle of a Friday closes at Saturday 00:00: weekend.
    expect(closesAtWeekend(Date.UTC(2026, 9, 10, 0))).toBe(true)
    expect(closesAtWeekend(Date.UTC(2026, 9, 10, 23, 59))).toBe(true)
    expect(closesAtWeekend(Date.UTC(2026, 9, 11, 12))).toBe(true)
    // …and the Sunday 20:00 candle closes on Monday 00:00: not.
    expect(closesAtWeekend(Date.UTC(2026, 9, 12, 0))).toBe(false)
    expect(closesAtWeekend(Date.UTC(2026, 9, 9, 12))).toBe(false)
  })

  it('goes with the regime when a long has BTC above or a short has it below', () => {
    expect(withRegime('long', true)).toBe(true)
    expect(withRegime('long', false)).toBe(false)
    expect(withRegime('short', false)).toBe(true)
    expect(withRegime('short', true)).toBe(false)
    expect(withRegime('long', null)).toBeNull()
  })
})

describe('contextTags', () => {
  const key = 'donchian/trend@4H'

  it('quotes what was measured for a long, and warns on the side that measured worse', () => {
    const [btc, vol] = contextTags({ btcAbove: false, volume: 0.8, weekend: false }, 'long', key)
    expect(btc).toMatchObject({ key: 'btc', label: 'BTC bajo su EMA 200', tone: 'warn' })
    expect(btc.note).toContain('+0,74 R')
    expect(btc.note).toContain('+0,13 R')
    expect(vol).toMatchObject({ key: 'volume', label: 'Volumen 0,8×', tone: 'warn' })
    expect(vol.note).toContain('+0,51 R')
  })

  it('does not colour BTC for a short: the regime separated nothing there', () => {
    const [btc] = contextTags({ btcAbove: true, volume: NaN, weekend: false }, 'short', key)
    expect(btc.tone).toBe('neutral')
    expect(btc.note).toContain('no separó nada')
  })

  it('keeps a heavy candle neutral and marks a weekend close', () => {
    const tags = contextTags({ volume: HIGH_VOLUME + 1, weekend: true }, 'long', key)
    expect(tags.find((t) => t.key === 'volume')?.tone).toBe('neutral')
    expect(tags.find((t) => t.key === 'weekend')?.tone).toBe('warn')
  })

  it('says a candle in progress is not comparable instead of printing its partial volume', () => {
    const [vol] = contextTags({ volume: 0.2 }, 'long', key, { volumePending: true })
    expect(vol.label).toBe('Volumen: vela en curso')
    expect(vol.tone).toBe('neutral')
  })

  it('states the facts without a verdict for a strategy that was not measured', () => {
    const tags = contextTags({ btcAbove: false, volume: 0.5, weekend: true }, 'long', 'reversal/tuned@1D')
    expect(tags.map((t) => t.tone)).toEqual(['neutral', 'neutral', 'neutral'])
  })
})

describe('regimeReading', () => {
  const now = 740 * H4

  it('says which side BTC is on, how far, and since when, with the figures the tags quote', () => {
    const r = regimeReading(btcRegime(climbing()), now)!
    expect(r.above).toBe(true)
    expect(r.distance).toBeGreaterThan(0)
    // The climb began at candle 700: a few days before `now`, counted in whole days.
    expect(r.days).toBeGreaterThanOrEqual(0)
    expect(r.days).toBeLessThanOrEqual(7)
    const ev = CONTEXT_EVIDENCE['donchian/trend@4H']
    expect(r.longsAbove).toBe(ev.longs.with)
    expect(r.longsBelow).toBe(ev.longs.without)
    expect(r.sample).toBe(ev.sample)
  })

  it('reads below the average as below, with a negative distance', () => {
    const falling = [
      ...Array.from({ length: 700 }, (_, i) => candle(i, 100)),
      ...Array.from({ length: 40 }, (_, k) => candle(700 + k, 100 - 1.5 * (k + 1))),
    ]
    const r = regimeReading(btcRegime(falling), now)!
    expect(r.above).toBe(false)
    expect(r.distance).toBeLessThan(0)
  })

  it('does not know the day the run began when it is older than the history read, and says how much it does cover', () => {
    const old = Array.from({ length: 1500 }, (_, i) => candle(i, 100 + i))
    const r = regimeReading(btcRegime(old), 1500 * H4)!
    expect(r.days).toBeNull()
    // 1 500 candles less the 600 the EMA needs to settle, at six a day.
    expect(r.atLeastDays).toBe(150)
  })

  it('says nothing until the average has settled, or without candles', () => {
    expect(regimeReading(btcRegime(climbing().slice(0, 100)), now)).toBeNull()
    expect(regimeReading(null, now)).toBeNull()
  })
})
