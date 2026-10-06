import { num } from './format'
import type { DcaBot, DcaPosition, GridBot, GridSubOrder } from './types'

/**
 * A DCA bot is a martingale. It opens with `initOrdAmt` and then averages down
 * with up to `maxSafetyOrds` further orders, each `volMult` times the last, as
 * price moves `pxSteps` against it.
 *
 * That makes the interesting number not the PnL but **how many safety orders it
 * has already spent**. A bot showing a small loss with eight of nine orders gone
 * is in far more trouble than one showing a bigger loss with none used, because
 * the first has nothing left to average with and the next move down goes
 * straight to the liquidation price. The reverse also happens: a bot can show a
 * healthy profit after a bounce while sitting at seven of nine.
 *
 * Shared by the Bots view and the Resumen so both warn at exactly the same
 * point — a threshold copied into each would drift the first time one changed.
 */

/** At or beyond this share of safety orders spent, the bot is nearly dry. */
export const NEARLY_DRY = 0.75

export function fuelUsed(bot: DcaBot, position: DcaPosition | undefined): number {
  const max = num(bot.maxSafetyOrds)
  if (!max) return 0
  return Math.min(1, num(position?.fillSafetyOrds) / max)
}

/**
 * How far price has to move to liquidate, as a fraction of the price it is
 * measured from: the live price when it is known, the bot's average otherwise.
 *
 * It used to be the average always. A martingale that has averaged down sits
 * *below* its average, so measured from there the room read 14 % while the
 * price was perhaps 4 % from liquidation — the one number that understated the
 * risk in a warning meant to state it.
 */
export function liquidationRoom(position: DcaPosition | undefined, mark?: number): number | null {
  const liq = num(position?.liqPx)
  const from = mark && mark > 0 ? mark : num(position?.avgPx)
  if (!liq || !from) return null
  return Math.abs(from - liq) / from
}

// ── grid bots ─────────────────────────────────────────────────────────────────
//
// A grid places a buy and a sell at every level between `minPx` and `maxPx` and
// earns one step each time price crosses a level and comes back: an
// arbitrage. It makes money while price wanders *inside* the range. Outside it
// stops trading: a long grid that falls below its floor holds a full long and
// has nothing left to buy with, and one that breaks above its ceiling has sold
// everything and sits idle. On contracts it also carries leverage and a
// liquidation price, so the range and the liquidation are read together.

/** Where price sits in the range: 0 at the floor, 1 at the ceiling, outside below 0 or above 1. */
export function rangePosition(min: number, max: number, price: number): number | null {
  if (!(max > min) || !(price > 0)) return null
  return (price - min) / (max - min)
}

export type GridPlace = 'debajo' | 'dentro' | 'encima'

export function gridPlace(bot: GridBot, price: number): GridPlace | null {
  const at = rangePosition(num(bot.minPx), num(bot.maxPx), price)
  if (at === null) return null
  return at < 0 ? 'debajo' : at > 1 ? 'encima' : 'dentro'
}

/**
 * The distance between two levels, as a fraction of price around the middle
 * of the range. Arithmetic grids (`runType` 1) space levels by the same price
 * step, geometric ones (2) by the same ratio.
 */
export function gridStep(bot: GridBot): number | null {
  const min = num(bot.minPx)
  const max = num(bot.maxPx)
  const n = num(bot.gridNum)
  if (!(max > min) || !(min > 0) || !(n > 0)) return null
  if (bot.runType === '2') return (max / min) ** (1 / n) - 1
  return (max - min) / n / ((max + min) / 2)
}

/**
 * What one arbitrage keeps after paying a fee on each leg. Grid orders rest on
 * the book, so they pay the maker rate. A step thinner than two fees loses on
 * every round trip however often price obliges.
 */
export function netPerArbitrage(step: number, makerFee: number): number {
  return step - 2 * makerFee
}

/** How far price has to move to liquidate the grid, from the live price. */
export function gridLiquidationRoom(bot: GridBot, mark: number | undefined): number | null {
  const liq = num(bot.liqPx)
  if (!(liq > 0) || !(mark && mark > 0)) return null
  return Math.abs(mark - liq) / mark
}

/** The resting order each side of price: the next level the grid buys at and sells at. */
export function nextLevels(orders: GridSubOrder[], price: number): { buy?: number; sell?: number } {
  let buy: number | undefined
  let sell: number | undefined
  for (const o of orders) {
    const px = num(o.px)
    if (o.side === 'buy' && px <= price && (buy === undefined || px > buy)) buy = px
    if (o.side === 'sell' && px >= price && (sell === undefined || px < sell)) sell = px
  }
  return { buy, sell }
}

/** Fees paid against what the arbitrages made: how much of the grid's work the exchange keeps. */
export function feeShareOfGrid(bot: GridBot): number | null {
  const fee = -num(bot.fee)
  const grid = num(bot.gridProfit)
  return fee > 0 && grid > 0 ? fee / grid : null
}
