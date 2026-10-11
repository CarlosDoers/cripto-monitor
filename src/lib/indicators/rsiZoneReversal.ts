import { findLevels, LEVEL_SETTINGS, type LevelSettings } from './levels'
import { atr, rsi } from './ta'
import { liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type SignalSide, type StrategyResult } from './types'

/**
 * The RSI strategy of the "El trading con RSI nunca ha sido tan fácil" video
 * (Alex Ruiz, 2026-10-11): the RSI alone is not a signal, so it is asked to
 * agree with two more things before a trade.
 *
 * What he says: wait for the RSI to be overbought or oversold (70 / 30, or
 * 80 / 20 "to filter more"); then for price to be at a resistance or a support;
 * then for a reversal candle ("una vela en la dirección contraria", "arranca con
 * fuerza" after two dojis). When the three hold, sell the overbought one and buy
 * the oversold one, stop beyond the previous extreme, target 2 R. One hour chart,
 * "ni muy grande, ni muy pequeña". He ends by saying a strategy like this is not
 * enough on its own — the measurement below is of exactly that, as written.
 *
 * Written down before any result, and mine where the video is loose:
 *
 * 1. RSI(14), Wilder's, at or beyond the threshold on the candle or on one of
 *    the two before it (`rsiBars`): the RSI stays extreme for a long time before
 *    the turn, as he says himself.
 * 2. At a level: one of this app's pivot-cluster levels (`findLevels`, built
 *    only from the 400 bars before the current block, rebuilt every 20) lies
 *    within half an ATR of the extreme of those same three candles, and the
 *    candle did not close through it by more than that.
 * 3. A reversal candle: bullish and closing above the previous candle's high
 *    (a long); bearish and closing below the previous candle's low (a short).
 * 4. Entry at the close of that candle. Stop at the extreme of the last five
 *    candles plus a tenth of an ATR. Target 2 R. No time stop: he gives none.
 *
 * `need` switches each condition off, so what each one adds can be read as a
 * difference rather than assumed.
 *
 * **Measured** (2026-10-11, `npm run ideas rsi`, 31 coins of 1 h since 2022, 0.1 %
 * round trip): as described 2 065 trades, hit rate 29.4 % against the 33.3 % a
 * 2 R target needs, **−0.12 R gross and −0.18 R net** (interval by months
 * [−0.25, −0.09], halves −0.17 / −0.18, longs −0.23, shorts −0.12). Thresholds
 * 20 / 80: 114 trades, −0.26 R. On 4 h −0.21 R (489), on the daily −0.38 R (77).
 * What each condition adds, all on 1 h: the reversal candle alone −0.03 R
 * (14 451 trades, 33.8 %, the control: same stop and target), with the level
 * −0.05, with the RSI −0.14, with both −0.18; the RSI alone −0.23, the level
 * alone −0.10. Every condition he adds is neutral or harmful, and the RSI is the
 * harmful one: an extreme RSI at a turn is more often a continuation. Not
 * registered.
 */

export interface RsiZoneSettings {
  rsiLen: number
  oversold: number
  overbought: number
  /** The RSI must be extreme on the candle or on one of this many, itself included. */
  rsiBars: number
  levels: LevelSettings
  /** Bars of history the level detector sees. */
  window: number
  /** Levels are rebuilt every this many bars. */
  refresh: number
  /** Half-width of a level's zone, in ATRs. */
  zoneAtr: number
  stopBars: number
  stopBufferAtr: number
  targetR: number
  need: { rsi: boolean; zone: boolean; candle: boolean }
  feeRate: number
}

export const RSI_ZONE_SETTINGS: RsiZoneSettings = {
  rsiLen: 14,
  oversold: 30,
  overbought: 70,
  rsiBars: 3,
  levels: LEVEL_SETTINGS,
  window: 400,
  refresh: 20,
  zoneAtr: 0.5,
  stopBars: 5,
  stopBufferAtr: 0.1,
  targetR: 2,
  need: { rsi: true, zone: true, candle: true },
  feeRate: 0.001,
}

export function rsiZoneEntries(candles: Candle[], s: RsiZoneSettings = RSI_ZONE_SETTINGS): (Entry | null)[] {
  const n = candles.length
  const out: (Entry | null)[] = new Array(n).fill(null)
  const warmup = s.window + s.levels.atrLen + 5
  if (n < warmup + 10) return out

  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const close = candles.map((c) => c.close)
  const a = atr(high, low, close, s.levels.atrLen)
  const r = rsi(close, s.rsiLen)
  const { rsi: needRsi, zone: needZone, candle: needCandle } = s.need
  if (!needRsi && !needZone && !needCandle) return out

  // Levels from the bars before each block of `refresh` bars, so none of them
  // has seen the bar it is asked about.
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
    const unit = a[i]
    if (!Number.isFinite(unit) || !(unit > 0)) continue
    const b = candles[i]
    const p = candles[i - 1]

    let rsiLong = false
    let rsiShort = false
    let lowMin = Infinity
    let highMax = -Infinity
    for (let k = 0; k < s.rsiBars; k++) {
      const v = r[i - k]
      if (v <= s.oversold) rsiLong = true
      if (v >= s.overbought) rsiShort = true
      lowMin = Math.min(lowMin, low[i - k])
      highMax = Math.max(highMax, high[i - k])
    }

    const zone = s.zoneAtr * unit
    const levels = needZone ? levelsAt(i) : []
    const zoneLong = levels.some((l) => Math.abs(lowMin - l) <= zone && b.close >= l - zone)
    const zoneShort = levels.some((l) => Math.abs(highMax - l) <= zone && b.close <= l + zone)
    const candleLong = b.close > b.open && b.close > p.high
    const candleShort = b.close < b.open && b.close < p.low

    const long = (!needRsi || rsiLong) && (!needZone || zoneLong) && (!needCandle || candleLong)
    const short = (!needRsi || rsiShort) && (!needZone || zoneShort) && (!needCandle || candleShort)
    // Both at once (a quirk of a loose combination) says nothing about direction.
    if (long === short) continue

    const side: SignalSide = long ? 'long' : 'short'
    let extreme = long ? Infinity : -Infinity
    for (let k = 0; k < s.stopBars; k++) extreme = long ? Math.min(extreme, low[i - k]) : Math.max(extreme, high[i - k])
    const stop = long ? extreme - s.stopBufferAtr * unit : extreme + s.stopBufferAtr * unit
    const entry = b.close
    const risk = Math.abs(entry - stop)
    if (!(risk > 0) || (long ? stop >= entry : stop <= entry)) continue
    out[i] = {
      index: i,
      side,
      entry,
      stop,
      target: long ? entry + s.targetR * risk : entry - s.targetR * risk,
    }
  }
  return out
}

export function analyseRsiZoneReversal(candles: Candle[], s: RsiZoneSettings = RSI_ZONE_SETTINGS): StrategyResult {
  const entries = rsiZoneEntries(candles, s)
  const warmup = s.window + s.levels.atrLen + 5
  const signals = walk(candles, warmup, (i) => entries[i], { feeRate: s.feeRate })
  return summarise(signals, [], warmup, liveSignal(signals))
}
