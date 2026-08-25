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
