import { describe, expect, it } from 'vitest'
import { MEASURED_COINS, measuredContracts } from '../opportunities'

const c = (symbol: string, volumeUsd: number, instId = `${symbol}-${volumeUsd}`) => ({ symbol, volumeUsd, instId })

describe('measuredContracts: the reversal is only offered where it was measured', () => {
  it('is BTC, ETH and SOL, the coins its edge was measured on', () => {
    expect(MEASURED_COINS).toEqual(['BTC', 'ETH', 'SOL'])
  })

  it('leaves out every other coin, however liquid', () => {
    // DOGE is where the panel used to show a tile next to "+0,43 R por señal": on the other
    // 26 coins of the board the same rule measured −0,03 R.
    const picked = measuredContracts([c('DOGE', 900), c('BTC', 500), c('XRP', 800), c('SOL', 100), c('ETH', 300)])
    expect(picked.map((x) => x.symbol)).toEqual(['BTC', 'ETH', 'SOL'])
  })

  it('keeps one contract per coin, the most traded', () => {
    const picked = measuredContracts([c('ETH', 50, 'ETH-old'), c('ETH', 400, 'ETH-main'), c('BTC', 10)])
    expect(picked.map((x) => x.instId)).toEqual(['ETH-main', 'BTC-10'])
  })

  it('is empty when none of them is on the board', () => {
    expect(measuredContracts([c('DOGE', 900)])).toEqual([])
  })
})
