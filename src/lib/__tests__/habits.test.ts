import { describe, expect, it } from 'vitest'
import { analyseHabits, groupOf, habitLines, QUICK_MS } from '../habits'
import type { Trade } from '../performance'

const MIN = 60_000
let n = 0
/** A closed trade: opened `open` minutes from t0, held `held` minutes, with this PnL and leverage. */
const trade = (open: number, held: number, pnl: number, lever = 5): Trade => ({
  id: `t${n++}`,
  instId: 'ZEC-USD_UM_XPERP-310530',
  symbol: 'ZEC',
  direction: 'long',
  lever,
  openPx: 1,
  closePx: 1,
  size: 1,
  sizeUnit: 'cont.',
  pnl,
  grossPnl: pnl,
  pnlRatio: 0,
  fee: 0,
  fundingFee: 0,
  openedAt: 1_000_000 + open * MIN,
  closedAt: 1_000_000 + (open + held) * MIN,
  duration: held * MIN,
  isWin: pnl > 0,
  liquidated: false,
})

describe('groupOf', () => {
  it('counts wins and losses, leaves breakeven out of the win rate and flags a short sample', () => {
    const g = groupOf([trade(0, 10, 5), trade(20, 10, -3), trade(40, 10, 0)])
    expect(g).toMatchObject({ trades: 3, wins: 1, losses: 1, winRate: 0.5, pnl: 2, reliable: false })
    expect(g.avgPnl).toBeCloseTo(2 / 3, 10)
    expect(groupOf([]).avgPnl).toBe(0)
  })

  it('keeps one enormous loss from passing for a habit: the median and the mean without the worst stay where the rest of the trades are', () => {
    const g = groupOf([trade(0, 10, 4), trade(20, 10, 6), trade(40, 10, 5), trade(60, 10, 3), trade(80, 10, 7), trade(100, 10, -10_000)])
    expect(g.avgPnl).toBeLessThan(-1600)
    expect(g.medianPnl).toBe(4)
    expect(g.avgWithoutWorst).toBe(5)
    expect(groupOf([trade(0, 10, 3)]).avgWithoutWorst).toBe(3)
    expect(groupOf([]).avgWithoutWorst).toBe(0)
  })
})

describe('analyseHabits', () => {
  it('compares how long winners and losers are held, by median', () => {
    const t = [trade(0, 10, 1), trade(100, 20, 1), trade(200, 30, 1), trade(300, 100, -1), trade(500, 200, -1), trade(900, 300, -1)]
    const h = analyseHabits(t).holding!
    expect(h.winners).toBe(20 * MIN)
    expect(h.losers).toBe(200 * MIN)
    expect(h.ratio).toBe(10)
    expect(h.nWinners).toBe(3)
    expect(analyseHabits([trade(0, 10, 1)]).holding).toBeNull()
  })

  it('finds the trades opened within an hour of closing a loss, on any instrument', () => {
    const loss = trade(0, 30, -10)
    // Opens 20 minutes after the loss closed (at minute 30): quick. The next opens hours later: not.
    const quick = { ...trade(50, 10, 4), instId: 'NEAR-USD_UM_XPERP-310530', symbol: 'NEAR' }
    const slow = trade(60 + QUICK_MS / MIN + 5, 10, 2)
    const q = analyseHabits([loss, quick, slow]).quickAfterLoss!
    expect(q.quick.trades).toBe(1)
    expect(q.quick.pnl).toBe(4)
    expect(q.rest.trades).toBe(2)
  })

  it('does not count a trade opened while the loss was still open, nor itself', () => {
    const loss = trade(0, 100, -10)
    const during = trade(50, 10, 3)
    const h = analyseHabits([loss, during])
    expect(h.quickAfterLoss!.quick.trades).toBe(0)
  })

  it('finds what follows two losses in a row, whatever the gap', () => {
    const a = trade(0, 10, -1)
    const b = trade(20, 10, -1)
    const c = trade(1000, 10, 7)
    const after = analyseHabits([a, b, c]).afterTwoLosses!
    expect(after.after.trades).toBe(1)
    expect(after.after.pnl).toBe(7)
    // Only one loss before it: not "after two".
    expect(analyseHabits([trade(0, 10, 2), b, c]).afterTwoLosses!.after.trades).toBe(0)
  })

  it('splits by the leverage the position opened at, leaving out the buckets with nothing', () => {
    const t = [trade(0, 10, 1, 2), trade(20, 10, -1, 10), trade(40, 10, -4, 20), trade(60, 10, -2, 20)]
    const byLeverage = analyseHabits(t).byLeverage
    expect(byLeverage.map((b) => [b.key, b.group.trades])).toEqual([
      ['low', 1],
      ['mid', 1],
      ['high', 2],
    ])
    expect(analyseHabits([trade(0, 10, 1, 2)]).byLeverage.map((b) => b.key)).toEqual(['low'])
  })

  it('handles an account with nothing to compare', () => {
    const h = analyseHabits([])
    expect(h.holding).toBeNull()
    expect(h.quickAfterLoss).toBeNull()
    expect(h.byLeverage).toEqual([])
    expect(habitLines(h)).toEqual([])
  })
})

describe('habitLines', () => {
  it('says losers are held longer when they are, and calls a short sample short', () => {
    const many = Array.from({ length: 6 }, (_, i) => [trade(i * 1000, 10, 1), trade(i * 1000 + 100, 60, -1)]).flat()
    const lines = habitLines(analyseHabits(many))
    expect(lines.find((l) => l.key === 'holding')!.text).toContain('Mantienes las perdedoras 6,0 veces más que las ganadoras')
    const few = habitLines(analyseHabits([trade(0, 10, 1), trade(100, 60, -1)]))
    expect(few.find((l) => l.key === 'holding')!.text).toContain('Muestra corta')
  })

  it('reads what follows a quick re-entry only with a sample, and otherwise says how few there were', () => {
    // Six losses each followed within minutes by a trade: a sample.
    const rows: Trade[] = []
    for (let i = 0; i < 6; i++) rows.push(trade(i * 1000, 10, -5), trade(i * 1000 + 15, 10, -2))
    const quick = habitLines(analyseHabits(rows)).find((l) => l.key === 'quick')!.text
    expect(quick).toContain('6 veces')
    expect(quick).toContain('resultado medio')
    expect(quick).toContain('mediana')
    expect(quick).toContain('sin la peor')
    const one = habitLines(analyseHabits([trade(0, 10, -5), trade(15, 10, -2)])).find((l) => l.key === 'quick')!.text
    expect(one).toContain('solo 1 vez')
    expect(one).toContain('muestra corta')
  })
})
