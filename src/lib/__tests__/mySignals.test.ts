import { describe, expect, it } from 'vitest'
import { analyseDonchian, DONCHIAN_TREND_SETTINGS } from '../indicators/donchianBreakout'
import type { Candle } from '../indicators/types'
import type { Trade } from '../performance'
import { alignWithRule, RULE_BAR_MS, RULE_WARMUP, stanceAt } from '../mySignals'

const H4 = RULE_BAR_MS
const candle = (i: number, close: number): Candle => ({ time: i * H4, open: close, high: close + 0.5, low: close - 0.5, close, vol: 10, confirmed: true })

/** Flat at 100 for 700 candles, a breakout upward that keeps climbing: the rule opens a long on candle 700 and holds it. */
const climbing = (): Candle[] => [
  ...Array.from({ length: 700 }, (_, i) => candle(i, 100)),
  ...Array.from({ length: 60 }, (_, k) => candle(700 + k, 102 + k * 1.5)),
]

const trade = (instId: string, direction: string, openedAt: number, pnl: number): Trade => ({
  id: `${instId}-${openedAt}-${direction}`,
  instId,
  symbol: instId.split('-')[0],
  direction,
  lever: 5,
  openPx: 1,
  closePx: 1,
  size: 1,
  sizeUnit: 'cont.',
  pnl,
  grossPnl: pnl,
  pnlRatio: 0,
  fee: 0,
  fundingFee: 0,
  openedAt,
  closedAt: openedAt + 3_600_000,
  duration: 3_600_000,
  isWin: pnl > 0,
  liquidated: false,
})

describe('stanceAt', () => {
  const candles = climbing()
  const result = analyseDonchian(candles, DONCHIAN_TREND_SETTINGS)
  const signals = result.signals

  it('has the long the test is built around', () => {
    expect(signals[0]).toMatchObject({ side: 'long', index: 700 })
    expect(signals[0].outcome).toBe('open')
  })

  it('is with the rule for a trade in its direction after the signal candle closed, against it for the opposite, and none before', () => {
    const entry = signals[0].time + H4
    expect(stanceAt(signals, 'long', entry + 5 * H4)).toBe('with')
    expect(stanceAt(signals, 'short', entry + 5 * H4)).toBe('against')
    expect(stanceAt(signals, 'long', entry - 1)).toBe('none')
    expect(stanceAt([], 'long', entry)).toBe('none')
  })

  it('stops counting a position that has closed, resolving the candle that closed it towards none', () => {
    const closed = [{ ...signals[0], outcome: 'loss' as const, closedTime: signals[0].time + 10 * H4 }]
    const entry = signals[0].time + H4
    expect(stanceAt(closed, 'long', entry + 5 * H4)).toBe('with')
    expect(stanceAt(closed, 'long', closed[0].closedTime! + 1)).toBe('none')
  })
})

describe('alignWithRule', () => {
  const candles = climbing()
  const entry = candles[700].time + H4
  const id = 'ZEC-USD_UM_XPERP-310530'

  it('places each trade against the rule on its own contract and sums each group', () => {
    const trades = [
      trade(id, 'long', entry + 4 * H4, 10),
      trade(id, 'long', entry + 8 * H4, -2),
      trade(id, 'short', entry + 12 * H4, -7),
      trade(id, 'long', entry - 2 * H4, 1),
    ]
    const a = alignWithRule(trades, { [id]: candles })
    expect(a.groups.with).toMatchObject({ trades: 2, pnl: 8 })
    expect(a.groups.against).toMatchObject({ trades: 1, pnl: -7 })
    expect(a.groups.none).toMatchObject({ trades: 1, pnl: 1 })
    expect(a.placed).toBe(4)
    expect(a.unplaced).toBe(0)
    expect(a.contracts).toBe(1)
  })

  it('leaves out trades with no candles, with too little history, or opened before the rule had warmed up', () => {
    const early = candles[RULE_WARMUP].time // before the first candle the rule can signal on
    const trades = [trade('NEAR-USD_UM_XPERP-310530', 'long', entry + H4, 1), trade(id, 'long', early, 1), trade(id, 'long', entry + 4 * H4, 1)]
    const a = alignWithRule(trades, { [id]: candles, 'SHORT-1': candles.slice(0, 100) })
    expect(a.placed).toBe(1)
    expect(a.unplaced).toBe(2)
    expect(alignWithRule(trades, { [id]: candles.slice(0, 100) }).placed).toBe(0)
  })
})
