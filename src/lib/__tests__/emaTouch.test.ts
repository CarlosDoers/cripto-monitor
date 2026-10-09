import { describe, expect, it } from 'vitest'
import { analyseEmaTouch, compareTouches, countSides, dayLabel, priorText, touchesWithin, touchStory } from '../emaTouch'
import { ema } from '../indicators/ta'
import type { Candle } from '../types'

const DAY = 86_400_000

/** One daily candle as OKX serves it: strings, confirmed unless `forming`. */
const row = (i: number, open: number, high: number, low: number, close: number, forming = false): Candle =>
  [String(i * DAY), String(open), String(high), String(low), String(close), '10', '10', '10', forming ? '0' : '1'] as unknown as Candle

/**
 * A steady climb of 2 a day, so the EMA 25 trails about 24 below the close and
 * no candle (±0.5) touches it — until a test lowers one candle's low onto it.
 * Returns the rows and the EMA the analysis will see.
 */
function climb(n: number, touchDaysAgo: number[] = []) {
  const closes = Array.from({ length: n }, (_, i) => 100 + 2 * i)
  const line = ema(closes, 25)
  const rows = closes.map((c, i) => {
    const ago = n - 1 - i
    // A low a little under the EMA, a high well above: the range holds the line.
    const low = touchDaysAgo.includes(ago) ? line[i] - 1 : c - 0.5
    return row(i, c - 1, c + 0.5, low, c)
  })
  return { rows, line }
}

/**
 * The mirror: a steady fall of 2 a day, so the EMA sits about 24 above the
 * close and the previous close is below it — a touch comes from below.
 */
function fall(n: number, touchDaysAgo: number[] = []) {
  const closes = Array.from({ length: n }, (_, i) => 1000 - 2 * i)
  const line = ema(closes, 25)
  return closes.map((c, i) => {
    const ago = n - 1 - i
    const high = touchDaysAgo.includes(ago) ? line[i] + 1 : c + 0.5
    return row(i, c + 1, high, c - 0.5, c)
  })
}

const look = (rows: Candle[], live = 0) => analyseEmaTouch(rows, 25, live, 'TEST-USD_UM_XPERP-1', 'TEST')

describe('analyseEmaTouch: which days touched', () => {
  it('lists every touching day, newest first, and the latest is `ago`', () => {
    const t = look(climb(120, [0, 2]).rows)
    expect(t.days).toEqual([0, 2])
    expect(t.ago).toBe(0)
    expect(t.from).toBe('arriba')
  })

  it('has no touch when price stays clear of the line', () => {
    const t = look(climb(120).rows)
    expect(t.days).toEqual([])
    expect(t.ago).toBeNull()
  })

  it('says it has too little history rather than guessing an EMA', () => {
    const t = look(climb(60).rows)
    expect(t.short).toBe(true)
    expect(t.days).toEqual([])
  })

  it('counts today\'s forming candle at the live price', () => {
    const { rows } = climb(120)
    // The forming candle is the last row; the live price drops onto the line.
    rows[119] = row(119, 337, 339, 337, 338, true)
    const before = ema(rows.slice(0, 119).map((r) => Number(r[4])), 25).at(-1)!
    const t = look(rows, before - 3)
    expect(t.ago).toBe(0)
    expect(t.volumePartial).toBe(true)
    // Without a live price the forming candle is what OKX last said: well clear of the line.
    expect(look(rows).days).toEqual([])
  })
})

describe('touchesWithin: the window the card looks at', () => {
  const t = look(climb(120, [0, 2, 5]).rows)

  it('3 is today, yesterday and the day before', () => {
    expect(touchesWithin(t, 3)).toEqual([0, 2])
  })

  it('a touch five days back is outside the last 3 candles but inside 10', () => {
    const old = look(climb(120, [5]).rows)
    expect(old.ago).toBe(5)
    expect(touchesWithin(old, 3)).toEqual([])
    expect(touchesWithin(old, 10)).toEqual([5])
  })

  it('the window is exact: a touch three days back is the fourth candle, not the third', () => {
    const edge = look(climb(120, [3]).rows)
    expect(touchesWithin(edge, 3)).toEqual([])
    expect(touchesWithin(edge, 4)).toEqual([3])
  })

  it('narrows to today alone', () => {
    expect(touchesWithin(t, 1)).toEqual([0])
  })
})

describe('dayLabel and compareTouches', () => {
  it('names the days the way they are said', () => {
    expect([0, 1, 2, 4].map(dayLabel)).toEqual(['hoy', 'ayer', 'anteayer', 'hace 4 días'])
  })

  it('puts today first, then the most recent touch, then the nearest to the line, and short history last', () => {
    const a = look(climb(120, [2]).rows)
    const b = look(climb(120, [0]).rows)
    const c = look(climb(120).rows)
    const d = look(climb(40).rows)
    expect([d, c, a, b].sort(compareTouches)).toEqual([b, a, c, d])
  })
})

describe('how long it had stayed away before the touch', () => {
  it('counts the clear candles before a lone touch, up to the earlier touch', () => {
    // Touched ten days ago and again today: nine candles in between stayed clear.
    const t = look(climb(120, [0, 10]).rows)
    expect(t.run).toBe(1)
    expect(t.away).toBe(9)
    expect(t.awayOpen).toBe(false)
    expect(priorText(t)).toBe('antes 9 días sin tocarla')
  })

  it('says "al menos" when the history ends before an earlier touch turns up', () => {
    // 120 bars, the EMA 25 settled from bar 75: 45 candles are all it can see.
    const t = look(climb(120, [0]).rows)
    expect(t.away).toBe(45)
    expect(t.awayOpen).toBe(true)
    expect(priorText(t)).toBe('antes al menos 45 días sin tocarla')
  })

  it('does not trust a touch from before the EMA had settled', () => {
    // 69 days back the EMA 25 exists but still carries its seed: that touch is not evidence of anything.
    const t = look(climb(120, [0, 69]).rows)
    expect(t.awayOpen).toBe(true)
    expect(t.away).toBe(45)
  })

  it('reads a run of touching candles as price hugging the line', () => {
    // Touched today, yesterday and the day before, and nine days of distance before that.
    const t = look(climb(120, [0, 1, 2, 12]).rows)
    expect(t.run).toBe(3)
    expect(t.away).toBe(9)
    expect(priorText(t)).toBe('3 velas seguidas en ella, antes 9 días sin tocarla')
  })

  it('does not say twice what the sentence has already listed', () => {
    const t = look(climb(120, [0, 1, 2, 12]).rows)
    // Three days named, a run of three: the run adds nothing.
    expect(touchStory(t, 3)).toBe('tocó hoy, ayer, anteayer · el último toque vino desde arriba · de momento aguanta · antes 9 días sin tocarla')
    // Over ten days the same touches are named and the run is still three.
    expect(priorText(t, 3)).toBe('antes 9 días sin tocarla')
    // But a run that began before the window is news: yesterday and the day before are named, five candles long.
    const long = look(climb(120, [1, 2, 3, 4, 5, 15]).rows)
    expect(touchStory(long, 3)).toContain('5 velas seguidas en ella, antes 9 días sin tocarla')
  })

  it('measures from the latest touch, not from today', () => {
    // The last touch was 4 days ago; the run is that one candle and the gap before it is what counts.
    const t = look(climb(120, [4, 20]).rows)
    expect(t.ago).toBe(4)
    expect(t.run).toBe(1)
    expect(t.away).toBe(15)
  })

  it('uses the singular for a single day', () => {
    expect(priorText(look(climb(120, [0, 2]).rows))).toBe('antes 1 día sin tocarla')
  })

  it('has nothing to say with no touch, or with no history before it', () => {
    const none = look(climb(120).rows)
    expect(none.run).toBe(0)
    expect(none.away).toBeNull()
    expect(priorText(none)).toBe('')
    // Exactly 75 bars: the touch is the first candle the EMA can be trusted on.
    const edge = look(climb(75, [0]).rows)
    expect(edge.away).toBe(0)
    expect(edge.awayOpen).toBe(true)
    expect(priorText(edge)).toBe('')
  })
})

describe('countSides: which way the price was coming from', () => {
  it('reads the previous close against the line: above for a climb, below for a fall', () => {
    const up = look(climb(120, [0]).rows)
    const down = look(fall(120, [0]))
    expect(up.from).toBe('arriba')
    expect(down.from).toBe('abajo')
    expect(countSides([up, up, down])).toEqual({ arriba: 2, abajo: 1 })
  })

  it('counts nothing for contracts with no touch', () => {
    expect(countSides([look(climb(120).rows), look(climb(40).rows)])).toEqual({ arriba: 0, abajo: 0 })
  })
})
