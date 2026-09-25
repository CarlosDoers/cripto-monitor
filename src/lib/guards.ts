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
  return algos.filter(
    (a) =>
      a.instId === position.instId &&
      // A one-way account reports posSide `net` on both sides, so an exact
      // match would drop every guard on it.
      (a.posSide === position.posSide || a.posSide === 'net' || position.posSide === 'net'),
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
