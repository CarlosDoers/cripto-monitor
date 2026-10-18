import { describe, expect, it } from 'vitest'
import { DONCHIAN_TREND_EVIDENCE } from '../indicators/donchianBreakout'
import { lateBucket, lateSentence, lateSummary } from '../lateEntry'
import { TRAD_TREND_EVIDENCE } from '../tradMarkets'

const crypto = DONCHIAN_TREND_EVIDENCE.late.buckets
const daily = TRAD_TREND_EVIDENCE.late.buckets

describe('the late-entry profile', () => {
  it('has buckets that follow one another from the first bar with no gap and no overlap', () => {
    for (const buckets of [crypto, daily]) {
      expect(buckets[0].from).toBe(1)
      buckets.forEach((b, i) => {
        expect(b.to).toBeGreaterThanOrEqual(b.from)
        if (i > 0) expect(b.from).toBe(buckets[i - 1].to + 1)
      })
    }
  })

  it('says what the figures say: the mean falls with age, the stop moves away, and the best trades are what is left', () => {
    for (const buckets of [crypto, daily]) {
      for (let i = 1; i < buckets.length; i++) {
        expect(buckets[i].net).toBeLessThanOrEqual(buckets[i - 1].net + 0.02)
        expect(buckets[i].riskPct).toBeGreaterThan(buckets[i - 1].riskPct - 0.001)
      }
      for (const b of buckets) expect(b.withoutBest10).toBeLessThan(b.net)
    }
    // The crypto profile: no interval clear of zero, and nothing left without the ten best from three days on.
    for (const b of crypto) expect(b.interval[0]).toBeLessThan(0)
    expect(crypto.filter((b) => b.from >= 7).every((b) => b.withoutBest10 <= 0.01)).toBe(true)
    // The daily ETF profile holds with intervals clear of zero for the first fifteen sessions.
    expect(daily.filter((b) => b.to <= 15).every((b) => b.interval[0] > 0)).toBe(true)
  })
})

describe('lateBucket', () => {
  it('finds the bucket an age falls in, and nothing for the measured entry itself or for what was never measured', () => {
    expect(lateBucket(0, crypto)).toBeNull()
    expect(lateBucket(1, crypto)?.from).toBe(1)
    expect(lateBucket(6, crypto)?.from).toBe(1)
    expect(lateBucket(7, crypto)?.from).toBe(7)
    expect(lateBucket(90, crypto)?.from).toBe(43)
    expect(lateBucket(91, crypto)).toBeNull()
    expect(lateBucket(1, daily)?.to).toBe(1)
    expect(lateBucket(30, daily)?.from).toBe(16)
    expect(lateBucket(31, daily)).toBeNull()
  })
})

describe('the sentences', () => {
  it('puts the headline figure first, then what is left without the best ten and how far the stop is', () => {
    const b = crypto[1]
    const text = lateSentence(b)
    expect(text).toContain('entrar a esta edad midió +0,34 R')
    expect(text).toContain('sin las diez mejores')
    expect(text).toMatch(/stop a un 6\s?% del precio/)
  })

  it('summarises a whole profile in a line', () => {
    const line = lateSummary(crypto, (b) => `${b.from}–${b.to} velas`)
    expect(line).toContain('1–6 velas +0,46')
    expect(line).toContain('43–90 velas +0,14')
    expect(line).toContain('sin las diez mejores operaciones +0,13 / +0,00 / −0,08 / −0,06')
  })
})
