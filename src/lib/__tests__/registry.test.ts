import { describe, expect, it } from 'vitest'
import {
  blockReason,
  EVIDENCE_REFRESH_DAYS,
  evidenceAge,
  MEASURED_THROUGH,
  profileOf,
  STRATEGIES,
  strategyByKey,
  tradableTimeframes,
} from '../indicators/registry'
import type { Candle } from '../indicators/types'

const bars = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({
    time: i * 14_400_000,
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    confirmed: true,
  }))

describe('the Donchian and its two presets', () => {
  const donchian = strategyByKey('donchian')

  it('keeps the plain breakout first, so nothing that opens it by default changes', () => {
    expect(donchian.presets.map((p) => p.key)).toEqual(['fast', 'trend'])
  })

  it('runs each preset as itself: the trend one waits for its EMA, the plain one does not', () => {
    expect(donchian.run(bars(700), 'fast').warmup).toBe(40)
    expect(donchian.run(bars(700), 'trend').warmup).toBe(620)
    // The trend preset draws the EMA it filters by; the plain one has no such line.
    expect(donchian.run(bars(700), 'trend').overlays.some((o) => o.key === 'trend')).toBe(true)
    expect(donchian.run(bars(700), 'fast').overlays.some((o) => o.key === 'trend')).toBe(false)
  })

  it('gives each preset the profile it was measured with', () => {
    const plain = profileOf(donchian, 'fast')
    const trend = profileOf(donchian, 'trend')
    expect(trend).not.toBe(plain)
    expect(trend.nativeTimeframe).toBe('4H')
    // Offered where measured, derived from the figures and never listed: 4 h and, marginally, 1 h.
    expect(tradableTimeframes(plain)).toEqual(['4H'])
    expect(tradableTimeframes(trend)).toEqual(['4H', '1H'])
    // The daily clears the average on a handful of trades and fails one half, so it is unstable, not costly.
    expect(blockReason(trend, '1D')).toBe('unstable')
    expect(blockReason(trend, '15m')).toBe('cost')
  })

  it('asks for deep history only for the preset whose average needs it', () => {
    expect(donchian.presets.find((p) => p.key === 'trend')?.archiveBars).toBe(1800)
    expect(donchian.presets.find((p) => p.key === 'fast')?.archiveBars).toBeUndefined()
    expect(donchian.archiveBars).toBeUndefined()
  })
})

describe('every preset declares what the audit compares', () => {
  it('has a profile, a native timeframe it is measured on and a confidence', () => {
    for (const strategy of STRATEGIES) {
      for (const preset of strategy.presets) {
        const profile = profileOf(strategy, preset.key)
        expect(Object.keys(profile.byTimeframe), `${strategy.key}/${preset.key}`).toEqual(['15m', '1H', '4H', '1D'])
        expect(profile.sampleSize).toBeGreaterThan(0)
        expect(['reasonable', 'weak']).toContain(profile.confidence)
      }
    }
  })

  it('runs every preset without throwing on a quiet series', () => {
    for (const strategy of STRATEGIES) {
      for (const preset of strategy.presets) {
        expect(() => strategy.run(bars(900), preset.key), `${strategy.key}/${preset.key}`).not.toThrow()
      }
    }
  })
})

describe('the age of the measured figures', () => {
  const through = Date.parse(`${MEASURED_THROUGH}T00:00:00Z`)
  const day = 86_400_000

  it('is silent for five weeks and then says the monthly refresh is due', () => {
    expect(evidenceAge(through + 3 * day)).toEqual({ days: 3, stale: false })
    expect(evidenceAge(through + EVIDENCE_REFRESH_DAYS * day).stale).toBe(false)
    expect(evidenceAge(through + (EVIDENCE_REFRESH_DAYS + 1) * day)).toEqual({ days: EVIDENCE_REFRESH_DAYS + 1, stale: true })
  })

  it('never reads a negative age, for a clock behind the data', () => {
    expect(evidenceAge(through - 10 * day)).toEqual({ days: 0, stale: false })
  })
})
