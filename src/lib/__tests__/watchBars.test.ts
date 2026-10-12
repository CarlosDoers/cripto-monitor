import { describe, expect, it } from 'vitest'
import { barChoice, spanText } from '../watchBars'
import type { StrategyBacktest } from '../indicators/registry'

/** Only the fields the choice reads; the rest of a profile is not its business. */
const profile = (byTimeframe: Record<string, number>, halves: Record<string, [number, number]> = {}) =>
  ({ byTimeframe, halves }) as unknown as StrategyBacktest

describe('spanText', () => {
  it('counts a 4 h candle as four hours and a 1 h candle as one', () => {
    expect(spanText(2, '4H')).toBe('8 h')
    expect(spanText(2, '1H')).toBe('2 h')
  })

  it('switches to days at 48 hours, whichever the candle', () => {
    expect(spanText(11, '4H')).toBe('44 h')
    expect(spanText(12, '4H')).toBe('2 días')
    expect(spanText(47, '1H')).toBe('47 h')
    expect(spanText(72, '1H')).toBe('3 días')
  })
})

describe('barChoice', () => {
  it('offers a bar that clears the bar in both halves', () => {
    const c = barChoice(profile({ '1H': 0.15 }, { '1H': [0.14, 0.14] }), '1H')
    expect(c.allowed).toBe(true)
  })

  it('blocks a bar under the tradable threshold and says it is the commission', () => {
    const c = barChoice(profile({ '1H': 0.07 }, { '1H': [0.07, 0.07] }), '1H')
    expect(c.allowed).toBe(false)
    expect(c.title).toMatch(/comisiones/)
  })

  it('blocks a bar whose average clears the bar but one half does not', () => {
    const c = barChoice(profile({ '1H': 0.2 }, { '1H': [0.4, 0.02] }), '1H')
    expect(c.allowed).toBe(false)
    expect(c.title).toMatch(/mitades/)
  })

  it('blocks a bar the strategy was never measured on', () => {
    expect(barChoice(profile({}), '1H').allowed).toBe(false)
  })
})
