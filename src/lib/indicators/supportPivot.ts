import { findLevels, LEVEL_SETTINGS, pivots as swingPoints, type LevelSettings } from './levels'
import { atr } from './ta'
import { liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type SignalSide, type StrategyResult } from './types'

/**
 * "Cómo negociar caídas a soportes con la acción del precio" — a live session
 * (Esteban Pérez, CreceTrader, 2026-10-11) whose thesis is that buying a fall to
 * a support, which most people want to do, is a mistake unless it is done with a
 * plan: "yo no compro soportes así como así", "al menos un 33 % de las
 * operaciones únicamente salen bien", "es regalar dinero por la calle".
 *
 * What he says it takes to do it less badly:
 *
 * - a support that has been respected before (a historic low, or one he
 *   calculates);
 * - price falls to it, and does **not** buy on the touch: it waits for signs of a
 *   reversal — big red candles giving way to small ones, then green ones, a
 *   triple bottom or an inverted head and shoulders;
 * - closed candles only ("velas vivas" are the trap), on the daily and weekly;
 * - **a pivot: at least five periods without closing below the low** ("hasta
 *   que no se me encienda aquí el pivot no tomo esta referencia");
 * - a stop under the support, a target at the first resistance, "uno a dos";
 * - and to use it combined with phases and fundamentals, "no como estrategia
 *   principal".
 *
 * Written down before any result, the part that is a rule:
 *
 * 1. A swing low with five bars each side (so it is known five closes later).
 * 2. At a level: one of this app's pivot-cluster levels (`findLevels`, from the
 *    400 bars before the block, rebuilt every 20) lies within half an ATR of it.
 * 3. Entry at the close of the bar that confirms it. Stop under the pivot's low
 *    by a tenth of an ATR, target 2 R, out after 60 bars. Resistances and shorts
 *    are the mirror image. One position at a time.
 *
 * `needLevel` off is the control — buy every confirmed swing low — so what the
 * support adds is a difference.
 *
 * **Measured** (2026-10-11, `npm run ideas support`, 0.1 % round trip): OKX's
 * daily 2022–26, 22 coins, 590 trades, hit rate 33.9 % against the 33 % a 2 R
 * target needs, **−0.05 R gross and −0.07 R net** (interval by months [−0.19,
 * +0.05], halves −0.07 / −0.07). Buying every confirmed swing, with no level,
 * makes +0.03 R: the support subtracts 0.10 R there. 4 h 2022–26 −0.05 R over
 * 4 328 trades, the control −0.04. 2018–21, 8 coins: **+0.35 R** [+0.06, +0.71],
 * longs +0.64 and shorts −0.32 — a bull market's dip-buying, which 2022–26 does
 * not repeat. Not registered.
 */

export interface SupportPivotSettings {
  /** Bars each side of a swing point: 5 is his "cinco periodos". */
  pivot: number
  levels: LevelSettings
  window: number
  refresh: number
  zoneAtr: number
  stopBufferAtr: number
  targetR: number
  maxBars: number
  /** Require the swing point to be at a level. Off: the control. */
  needLevel: boolean
  feeRate: number
}

export const SUPPORT_PIVOT_SETTINGS: SupportPivotSettings = {
  pivot: 5,
  levels: LEVEL_SETTINGS,
  window: 400,
  refresh: 20,
  zoneAtr: 0.5,
  stopBufferAtr: 0.1,
  targetR: 2,
  maxBars: 60,
  needLevel: true,
  feeRate: 0.001,
}

export function supportPivotEntries(candles: Candle[], s: SupportPivotSettings = SUPPORT_PIVOT_SETTINGS): (Entry | null)[] {
  const n = candles.length
  const out: (Entry | null)[] = new Array(n).fill(null)
  const warmup = s.window + s.levels.atrLen + 5
  if (n < warmup + 10) return out

  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const close = candles.map((c) => c.close)
  const a = atr(high, low, close, s.levels.atrLen)
  const { highs, lows } = swingPoints(candles, s.pivot)
  const highAt = new Map(highs.map((p) => [p.index, p.price]))
  const lowAt = new Map(lows.map((p) => [p.index, p.price]))

  const cache = new Map<number, number[]>()
  const levelsAt = (i: number): number[] => {
    const block = warmup + Math.floor((i - warmup) / s.refresh) * s.refresh
    let l = cache.get(block)
    if (!l) {
      l = findLevels(candles.slice(block - s.window, block), s.levels).map((x) => x.price)
      cache.set(block, l)
    }
    return l
  }

  for (let i = warmup; i < n; i++) {
    const p = i - s.pivot
    const lowPrice = lowAt.get(p)
    const highPrice = highAt.get(p)
    // A bar that is both a swing high and a swing low says nothing.
    if ((lowPrice === undefined) === (highPrice === undefined)) continue
    const unit = a[i]
    if (!Number.isFinite(unit) || !(unit > 0)) continue
    const side: SignalSide = lowPrice !== undefined ? 'long' : 'short'
    const point = (lowPrice ?? highPrice) as number
    if (s.needLevel) {
      const zone = s.zoneAtr * unit
      if (!levelsAt(i).some((l) => Math.abs(point - l) <= zone)) continue
    }
    const entry = close[i]
    const stop = side === 'long' ? point - s.stopBufferAtr * unit : point + s.stopBufferAtr * unit
    const risk = Math.abs(entry - stop)
    if (!(risk > 0) || (side === 'long' ? stop >= entry : stop <= entry)) continue
    out[i] = {
      index: i,
      side,
      entry,
      stop,
      target: side === 'long' ? entry + s.targetR * risk : entry - s.targetR * risk,
      maxBars: s.maxBars,
    }
  }
  return out
}

export function analyseSupportPivot(candles: Candle[], s: SupportPivotSettings = SUPPORT_PIVOT_SETTINGS): StrategyResult {
  const entries = supportPivotEntries(candles, s)
  const warmup = s.window + s.levels.atrLen + 5
  const signals = walk(candles, warmup, (i) => entries[i], { feeRate: s.feeRate })
  return summarise(signals, [], warmup, liveSignal(signals))
}
