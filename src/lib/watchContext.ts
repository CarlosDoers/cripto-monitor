import { closesAtWeekend, contextTags, type BtcRegime, type ContextTag } from './entryContext'
import { REFERENCE } from './ledger'
import { trackKey } from './entryContext'
import type { SignalSide } from './indicators/types'

/**
 * The context a "qué vigilar" row carries: what was true when the entry on the
 * table (or the position already open) was made. Built from the same
 * `contextTags` the ledger and the notifications use, so a tag on the card is
 * the tag on the signal it becomes.
 */

export interface RowContextInput {
  status: string
  /** The entry on the table (`nueva`) or forming (`rompiendo`, `cerca`, `cruzando`). */
  next: SignalSide | null
  /** The open position's side. */
  side: SignalSide | null
  entryAt?: number
  volume?: number
}

/**
 * Entries and open positions carry what their candle closed with; a forming
 * entry carries BTC's regime now and says its candle's volume is not yet
 * comparable. Nothing for a contract that is only waiting.
 */
export function rowContext(
  w: RowContextInput,
  regime: BtcRegime | null,
  strategy: string,
  preset: string,
  bar: string,
): ContextTag[] {
  const key = trackKey(strategy, preset, bar)
  const forming = w.status === 'rompiendo' || w.status === 'cruzando' || w.status === 'cerca'
  if (forming && w.next) {
    return contextTags({ btcAbove: regime?.latest.above ?? null, weekend: false }, w.next, key, { volumePending: true })
  }
  if ((w.status === 'nueva' || w.status === 'tendencia') && w.side && w.entryAt !== undefined) {
    return contextTags(
      { btcAbove: regime ? regime.aboveAt(w.entryAt) : null, volume: w.volume, weekend: closesAtWeekend(w.entryAt) },
      w.side,
      key,
    )
  }
  return []
}

/** What the strategy measured for a side, for the badge's tooltip: a short is a small edge, said where it is read. */
export function sideNote(strategy: string, preset: string, bar: string, side: SignalSide): string | undefined {
  const ref = REFERENCE[trackKey(strategy, preset, bar)]
  if (!ref) return undefined
  const fmt = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2).replace('.', ',')} R`
  return side === 'long'
    ? `Los longs de esta estrategia midieron ${fmt(ref.longs)} por operación (${ref.sample}).`
    : `Los shorts de esta estrategia midieron ${fmt(ref.shorts)} por operación, frente a ${fmt(ref.longs)} de los longs (${ref.sample}): una ventaja pequeña.`
}
