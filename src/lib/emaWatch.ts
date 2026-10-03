import { atr } from './indicators/ta'
import { analyseEmaCross, EMA_CROSS_SETTINGS } from './indicators/emaCross'
import { toCandles } from './signals'
import type { Candle as OkxCandle } from './types'

/**
 * Where each contract stands against the EMA 200 strategy on 4 h, for the
 * Screener's "qué vigilar" button. It runs the registered strategy itself, so
 * a "señal nueva" here is the very signal Estrategias draws.
 *
 * Three things are worth watching, in this order:
 *   · nueva     — the strategy opened a position on one of the last two closed
 *                 candles: the measured entry is still close
 *   · cruzando  — the candle in progress is on the other side of the EMA: if it
 *                 closes there, the strategy turns
 *   · cerca     — price within half an ATR of the EMA: one candle could cross
 * The rest are in a trend, with its age. Entering a trend late was not measured,
 * so it is shown as context and nothing more.
 */

export type WatchStatus = 'nueva' | 'cruzando' | 'cerca' | 'tendencia' | 'fuera' | 'corto'

export interface EmaWatch {
  instId: string
  symbol: string
  status: WatchStatus
  side: 'long' | 'short' | null
  /** Closed 4 h candles since the open position's entry. */
  age: number
  price: number
  ema: number
  /** Live price against the EMA, as a fraction and in ATRs. */
  distance: number
  distanceAtr: number
  entry?: number
  stop?: number
  bars: number
}

const NEAR_ATR = 0.5
const FRESH = 1

export function watchEmaCross(rows: OkxCandle[], live: number, instId: string, symbol: string): EmaWatch {
  const candles = toCandles(rows)
  const base = { instId, symbol, bars: candles.length, price: live }
  if (candles.length < EMA_CROSS_SETTINGS.length * 3) {
    return { ...base, status: 'corto', side: null, age: 0, ema: NaN, distance: NaN, distanceAtr: NaN }
  }
  const r = analyseEmaCross(candles)
  const line = r.overlays[0].values
  const last = candles.length - 1
  const ema = line[last]
  const unit = atr(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    candles.map((c) => c.close),
    14,
  )[last]
  const price = live || candles[last].close
  const distance = price / ema - 1
  const distanceAtr = Math.abs(price - ema) / unit
  const open = r.active
  const side = open?.side ?? null
  const age = open ? last - open.index : 0
  const liveAbove = price > ema

  let status: WatchStatus
  if (open && age <= FRESH) status = 'nueva'
  else if (open && liveAbove !== (side === 'long')) status = 'cruzando'
  else if (distanceAtr <= NEAR_ATR) status = 'cerca'
  else status = open ? 'tendencia' : 'fuera'

  return { ...base, price, status, side, age, ema, distance, distanceAtr, entry: open?.entry, stop: open?.stop }
}

const RANK: Record<WatchStatus, number> = { nueva: 0, cruzando: 1, cerca: 2, tendencia: 3, fuera: 4, corto: 5 }

export function compareWatch(a: EmaWatch, b: EmaWatch): number {
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status]
  if (a.status === 'tendencia') return a.age - b.age
  return a.distanceAtr - b.distanceAtr
}
