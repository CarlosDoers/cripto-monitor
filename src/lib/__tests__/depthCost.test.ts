import { describe, expect, it } from 'vitest'
import { bookCost } from '../depthCost'
import type { BookLevel } from '../types'

const level = (px: number, sz: number): BookLevel => [String(px), String(sz), '0', '1']

// One share a contract. Mid 99.9, a 20 bp spread, and a little behind the touch.
const book = {
  asks: [level(100, 10), level(100.5, 10), level(101, 100)],
  bids: [level(99.8, 10), level(99.5, 10), level(99, 100)],
}

describe('walking an order book for the cost of a position', () => {
  it('reads the spread from the touch and the cost of a small order from the first level', () => {
    const c = bookCost(book, 500, 1)!
    expect(c.mid).toBeCloseTo(99.9, 10)
    expect(c.spreadBp).toBeCloseTo((0.2 / 99.9) * 10_000, 6)
    // 500 $ is five shares: all at 100, 0.1 over the mid on the way in and 0.1 under it on the way out.
    expect(c.buyBp).toBeCloseTo((0.1 / 99.9) * 10_000, 6)
    expect(c.sellBp).toBeCloseTo((0.1 / 99.9) * 10_000, 6)
  })

  it('walks on to the next level when the first one is not enough, and prices the average fill', () => {
    const c = bookCost(book, 1500, 1)!
    // 1 000 $ at 100 (ten shares), the other 500 $ at 100.5.
    const shares = 10 + 500 / 100.5
    const average = 1500 / shares
    expect(c.buyBp).toBeCloseTo(((average - 99.9) / 99.9) * 10_000, 6)
    expect(c.buyBp!).toBeGreaterThan(bookCost(book, 500, 1)!.buyBp!)
  })

  it('says nothing can be had when the levels hold less than the size, instead of pricing what is not there', () => {
    // The three levels hold 1 000 + 1 005 + 10 100 dollars on the buy side.
    expect(bookCost(book, 1_000_000, 1)!.buyBp).toBeNull()
    expect(bookCost(book, 1_000_000, 1)!.sellBp).toBeNull()
    // But the touch is still there to read.
    expect(bookCost(book, 1_000_000, 1)!.spreadBp).toBeGreaterThan(0)
  })

  it('reads sizes in contracts through what one contract is worth', () => {
    // 500 contracts of 0.001 are half a unit: 2 000 $ of gold at 4 000.
    const gold = { asks: [level(4000, 500)], bids: [level(3999, 500)] }
    expect(bookCost(gold, 1000, 0.001)!.buyBp).not.toBeNull()
    expect(bookCost(gold, 3000, 0.001)!.buyBp).toBeNull()
    expect(bookCost(gold, 3000, 1)!.buyBp).not.toBeNull()
  })

  it('has no cost for a book with no bid or no ask, or for a size or contract value that is not a number', () => {
    expect(bookCost({ asks: [], bids: [level(99, 1)] }, 100, 1)).toBeNull()
    expect(bookCost({ asks: [level(100, 1)], bids: [] }, 100, 1)).toBeNull()
    expect(bookCost({}, 100, 1)).toBeNull()
    expect(bookCost(book, 0, 1)).toBeNull()
    expect(bookCost(book, 100, 0)).toBeNull()
    expect(bookCost(book, 100, Number.NaN)).toBeNull()
  })

  it('skips a level with no size instead of dividing by it', () => {
    const gappy = { asks: [level(100, 0), level(100.2, 10)], bids: [level(99.8, 10)] }
    expect(bookCost(gappy, 500, 1)!.buyBp).not.toBeNull()
  })
})
