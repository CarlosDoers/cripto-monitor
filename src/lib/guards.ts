import { num } from '../lib/format'
import type { AlgoOrder, Position } from '../lib/types'

/**
 * Which protective orders cover a position.
 *
 * A stop-loss is a conditional order in a book of its own, so
 * `/account/positions` cannot answer this and an app that reads only that
 * endpoint shows a protected position and a bare one identically.
 */
export function guardsFor(position: Position, algos: AlgoOrder[]): AlgoOrder[] {
  // Only an order on the closing side protects: a sell for a long, a buy for a
  // short. On a one-way account a conditional *buy* with a trigger on a long is
  // a stop-entry that adds to it, and it used to count as the position's stop
  // and silence the "sin stop" warning.
  const closing = isShort(position) ? 'buy' : 'sell'
  return algos.filter(
    (a) =>
      a.instId === position.instId &&
      // A one-way account reports posSide `net` on both sides, so an exact
      // match would drop every guard on it.
      (a.posSide === position.posSide || a.posSide === 'net' || position.posSide === 'net') &&
      (!a.side || a.side === closing),
  )
}

export function stopOf(guards: AlgoOrder[]): AlgoOrder | undefined {
  return guards.find((g) => num(g.slTriggerPx) > 0)
}

export function targetOf(guards: AlgoOrder[]): AlgoOrder | undefined {
  return guards.find((g) => num(g.tpTriggerPx) > 0)
}

export function hasStop(guards: AlgoOrder[]): boolean {
  return stopOf(guards) !== undefined
}

/**
 * How much of the position its stops would close, 0 to 1. A TP/SL set on the
 * whole position carries `closeFraction: 1` and no size; a conditional order
 * carries its size in the position's own unit (contracts, or coins on margin).
 * A stop for 100 of 4 718 contracts used to count as protection for all of them.
 * With neither field the coverage is unknowable, and it is taken as full rather
 * than raising an alarm the data does not support.
 */
export function stopCoverage(position: Position, guards: AlgoOrder[]): number {
  const stops = guards.filter((g) => num(g.slTriggerPx) > 0)
  if (stops.length === 0) return 0
  if (stops.some((g) => g.closeFraction === '1' || !(num(g.sz) > 0))) return 1
  const size = Math.abs(num(position.pos))
  if (!(size > 0)) return 1
  return Math.min(1, stops.reduce((sum, g) => sum + num(g.sz), 0) / size)
}

/** Under this share covered, a stop is reported as partial. */
export const PARTIAL_STOP = 0.99

/**
 * Whether a position is short.
 *
 * `posSide` only says `long`/`short` on a hedge-mode account. In one-way mode
 * — which is what this account uses — OKX reports `net` on every position and
 * the direction lives in the *sign of the size*. Reading `posSide === 'short'`
 * alone labels every one-way short as a long, which then flips the funding
 * sign as well: this account was shown paying funding on a short that is
 * actually collecting it.
 */
export function isShort(position: Position): boolean {
  if (position.posSide === 'short') return true
  if (position.posSide === 'long') return false
  return num(position.pos) < 0
}

/** Under this distance to liquidation a position is flagged as in danger. */
export const LIQ_DANGER = 0.1
/** Under this one it is worth watching. */
export const LIQ_WATCH = 0.25

/**
 * How far the mark price is from liquidation, as a fraction of the mark.
 * Null when OKX gives no liquidation price (spot-like rows, cross margin with
 * room to spare). Shared by Resumen and Posiciones so the two can never colour
 * the same position differently.
 */
export function liquidationDistance(position: Position): number | null {
  const liq = num(position.liqPx)
  const mark = num(position.markPx)
  return liq > 0 && mark > 0 ? Math.abs(mark - liq) / mark : null
}

/**
 * A position's size and the unit it is in. Derivatives count **contracts**,
 * whose value differs per instrument — 449 on ZEC X-Perp is not 449 ZEC — and
 * margin positions count coins. The sign of `pos` is the direction on a one-way
 * account, which `isShort()` already reports, so the size is always positive.
 */
export function positionSize(position: Position): { amount: number; unit: string } {
  const amount = Math.abs(num(position.pos))
  if (position.instType === 'MARGIN') {
    return { amount, unit: position.posCcy || position.instId.split('-')[0] }
  }
  return { amount, unit: amount === 1 ? 'contrato' : 'contratos' }
}
