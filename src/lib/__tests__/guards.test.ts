import { describe, expect, it } from 'vitest'
import { guardsFor, hasStop, isShort, stopCoverage } from '../guards'
import { algo, position } from './fixtures'

describe('isShort', () => {
  it('reads the sign of pos on a one-way account, where posSide is always net', () => {
    expect(isShort(position({ posSide: 'net', pos: '-5' }))).toBe(true)
    expect(isShort(position({ posSide: 'net', pos: '5' }))).toBe(false)
  })
  it('trusts posSide in hedge mode', () => {
    expect(isShort(position({ posSide: 'short', pos: '5' }))).toBe(true)
  })
})

describe('guardsFor', () => {
  const long = position({ pos: '10' })
  const short = position({ pos: '-10' })

  it('counts a sell stop on a long', () => {
    expect(hasStop(guardsFor(long, [algo({ side: 'sell', slTriggerPx: '90' })]))).toBe(true)
  })

  // The 2026-10 audit: a conditional buy on a long adds to it, it does not protect it.
  it('ignores an order on the same side as the position', () => {
    expect(hasStop(guardsFor(long, [algo({ side: 'buy', slTriggerPx: '120' })]))).toBe(false)
  })

  it('counts a buy stop on a short', () => {
    expect(hasStop(guardsFor(short, [algo({ side: 'buy', slTriggerPx: '120' })]))).toBe(true)
  })

  it('ignores other instruments', () => {
    expect(guardsFor(long, [algo({ instId: 'BTC-USDT-SWAP', slTriggerPx: '90' })])).toHaveLength(0)
  })
})

describe('stopCoverage', () => {
  const pos = position({ pos: '4718' })

  it('is 0 without a stop', () => {
    expect(stopCoverage(pos, [algo({ tpTriggerPx: '150' })])).toBe(0)
  })
  it('is 1 for a TP/SL on the whole position', () => {
    expect(stopCoverage(pos, [algo({ slTriggerPx: '90', closeFraction: '1' })])).toBe(1)
  })
  it('measures a stop sized for part of the position', () => {
    expect(stopCoverage(pos, [algo({ slTriggerPx: '90', sz: '100' })])).toBeCloseTo(100 / 4718)
  })
  it('adds up several stops, capped at the whole position', () => {
    expect(stopCoverage(pos, [algo({ slTriggerPx: '90', sz: '3000' }), algo({ slTriggerPx: '85', sz: '3000' })])).toBe(1)
  })
  it('treats an order with no size as full rather than raise a false alarm', () => {
    expect(stopCoverage(pos, [algo({ slTriggerPx: '90', sz: '' })])).toBe(1)
  })
})
