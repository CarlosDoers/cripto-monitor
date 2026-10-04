import { num } from './format'
import type { DcaBot, DcaPosition } from './types'

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
