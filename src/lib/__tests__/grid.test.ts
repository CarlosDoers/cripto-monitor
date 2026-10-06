import { describe, expect, it } from 'vitest'
import { feeShareOfGrid, gridLiquidationRoom, gridPlace, gridStep, nextLevels, netPerArbitrage, rangePosition } from '../bots'
import type { GridBot, GridSubOrder } from '../types'

// The NEAR bot as OKX listed it on 2026-10-06.
const near = {
  algoId: 'n',
  instId: 'NEAR-USD_UM_XPERP-310613',
  minPx: '4.298',
  maxPx: '5.254',
  gridNum: '200',
  runType: '1',
  liqPx: '4.236',
  gridProfit: '3.0657636',
  fee: '-2.2688928',
} as GridBot

const order = (side: 'buy' | 'sell', px: number) => ({ side, px: String(px) }) as GridSubOrder

describe('grid bots', () => {
  it('places price in the range', () => {
    expect(rangePosition(4.298, 5.254, 5.144)).toBeCloseTo(0.885, 3)
    expect(gridPlace(near, 5.144)).toBe('dentro')
    expect(gridPlace(near, 4.2)).toBe('debajo')
    expect(gridPlace(near, 5.3)).toBe('encima')
  })

  it('measures the step between levels, arithmetic and geometric', () => {
    // (5.254 − 4.298) / 200 = 0.00478 on a mid of 4.776: 0.1 %.
    expect(gridStep(near)!).toBeCloseTo(0.001, 4)
    const geo = { ...near, runType: '2', minPx: '100', maxPx: '200', gridNum: '10' } as GridBot
    expect((1 + gridStep(geo)!) ** 10).toBeCloseTo(2)
  })

  it('keeps the step minus two maker fees per arbitrage', () => {
    expect(netPerArbitrage(0.001, 0.0002)).toBeCloseTo(0.0006)
    expect(netPerArbitrage(0.0003, 0.0002)).toBeLessThan(0)
  })

  it('measures liquidation from the live price', () => {
    expect(gridLiquidationRoom(near, 5.144)).toBeCloseTo((5.144 - 4.236) / 5.144)
    expect(gridLiquidationRoom(near, undefined)).toBeNull()
    expect(gridLiquidationRoom({ ...near, liqPx: '' }, 5)).toBeNull()
  })

  it('finds the next buy below and the next sell above', () => {
    const orders = [order('buy', 5.139), order('buy', 5.134), order('sell', 5.149), order('sell', 5.154)]
    expect(nextLevels(orders, 5.144)).toEqual({ buy: 5.139, sell: 5.149 })
  })

  it('compares fees with what the arbitrages made', () => {
    expect(feeShareOfGrid(near)!).toBeCloseTo(2.2688928 / 3.0657636)
    expect(feeShareOfGrid({ ...near, gridProfit: '0' })).toBeNull()
  })
})
