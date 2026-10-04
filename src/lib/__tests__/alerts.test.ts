import { describe, expect, it } from 'vitest'
import { accountAlerts, type AlertInput } from '../alerts'
import { liquidationRoom } from '../bots'
import { instTypeOf } from '../instruments'
import type { AccountBalance } from '../types'
import { algo, dcaBot, dcaPosition, position } from './fixtures'

/** es-ES puts a no-break space before %; compare as plain text. */
const plain = (s: string | undefined) => (s ?? '').replace(/\u00a0/g, ' ')

const base: AlertInput = {
  account: { mgnRatio: '' } as AccountBalance,
  positions: [],
  algos: [],
  dcaBots: [],
  dcaPositions: {},
  netWorth: 10_000,
  freeMargin: 5_000,
  carryExits: [],
}

describe('accountAlerts', () => {
  it('is quiet on a healthy account', () => {
    const a = accountAlerts(base)
    expect(a.alerts).toHaveLength(0)
    expect(a.alarm).toBe(false)
  })

  it('flags a position with no stop', () => {
    const a = accountAlerts({ ...base, positions: [position({ pos: '5' })] })
    expect(a.unprotected).toHaveLength(1)
    expect(a.alerts.map((x) => x.key)).toContain('stop')
  })

  it('claims nothing about stops while they are still loading', () => {
    expect(accountAlerts({ ...base, positions: [position({ pos: '5' })], algos: undefined }).unprotected).toHaveLength(0)
  })

  it('flags a stop that covers only part of the position', () => {
    const a = accountAlerts({
      ...base,
      positions: [position({ pos: '4718' })],
      algos: [algo({ slTriggerPx: '1200', sz: '100' })],
    })
    expect(a.unprotected).toHaveLength(0)
    expect(a.partial).toHaveLength(1)
    expect(plain(a.alerts.find((x) => x.key.startsWith('partial'))?.text)).toContain('cubre solo el 2 %')
    expect(a.alarm).toBe(true)
  })

  // With every position isolated the account ratio is empty; it once printed as "100 %".
  it('falls back to the worst position margin ratio', () => {
    const a = accountAlerts({
      ...base,
      positions: [position({ pos: '1', mgnRatio: '7.4' }), position({ pos: '1', mgnRatio: '2.1', instId: 'X' })],
      algos: [algo({ slTriggerPx: '1', closeFraction: '1' }), algo({ instId: 'X', slTriggerPx: '1', closeFraction: '1' })],
    })
    expect(a.marginRatio).toBe(2.1)
    expect(a.atRisk).toBe(true)
  })

  it('flags exhausted free margin only when something is open', () => {
    expect(accountAlerts({ ...base, freeMargin: 2 }).locked).toBe(true)
    expect(accountAlerts({ ...base, freeMargin: 2 }).alerts).toHaveLength(0)
    const withPosition = accountAlerts({
      ...base,
      freeMargin: 2,
      positions: [position({ pos: '1' })],
      algos: [algo({ slTriggerPx: '1', closeFraction: '1' })],
    })
    expect(withPosition.alerts.map((x) => x.key)).toContain('free')
  })

  it('measures a dry bot from the live price when it has one', () => {
    const bot = dcaBot({})
    const pos = dcaPosition({ fillSafetyOrds: '8', avgPx: '2000', liqPx: '1720' })
    const fromAvg = accountAlerts({ ...base, dcaBots: [bot], dcaPositions: { b1: pos } })
    expect(plain(fromAvg.alerts[0].text)).toContain('14 % del precio medio')
    const fromMark = accountAlerts({ ...base, dcaBots: [bot], dcaPositions: { b1: pos }, marks: { 'ETH-USDT-SWAP': 1800 } })
    expect(plain(fromMark.alerts[0].text)).toContain('4 % del precio actual')
  })
})

describe('bots', () => {
  it('liquidationRoom: from the mark when given, the average otherwise', () => {
    const pos = dcaPosition({ avgPx: '2000', liqPx: '1720' })
    expect(liquidationRoom(pos)).toBeCloseTo(0.14)
    expect(liquidationRoom(pos, 1800)).toBeCloseTo(80 / 1800)
    expect(liquidationRoom(undefined)).toBeNull()
  })
  it('instTypeOf picks the ticker list that prices the instrument', () => {
    expect(instTypeOf('ETH-USDT-SWAP')).toBe('SWAP')
    expect(instTypeOf('ZEC-USD_UM_XPERP-310530')).toBe('FUTURES')
    expect(instTypeOf('BTC-USDT-261225')).toBe('FUTURES')
    expect(instTypeOf('SOL-USDC')).toBe('SPOT')
  })
})
