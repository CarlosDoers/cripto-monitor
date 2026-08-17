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
