import { atr, ema, lowest, highest, sma } from './ta'
import { feeInR, summarise, type Candle, type StrategyResult, type StrategySignal } from './types'

/**
 * The classic moving-average and MACD systems, as they are usually published,
 * so they can be measured instead of quoted.
 *
 * - `golden`: SMA 50 crosses SMA 200 — the golden cross and the death cross.
 * - `ema921`: EMA 9 crosses EMA 21, the popular crypto version.
 * - `macd200`: MACD 12/26/9 crosses its signal on the far side of zero, in the
 *   direction of the EMA 200; stop at the last 5-bar swing, target 1.5 R.
 * - `macdSignal`: MACD crosses its signal line, always in the market.
 * - `faber`: long while the close is above the SMA 200, flat below (Faber 2007).
 *
 * The crossover systems have no stop in their usual telling, but a trade needs
 * one to be priced in R: theirs is 2 ATR(14), the Donchian's, and the trade
 * otherwise runs until the opposite cross. Every entry is at the close of the
 * bar that crossed; exits are checked from the next bar, stop first.
 */

export type Classic = 'golden' | 'ema921' | 'macd200' | 'macdSignal' | 'faber'

export interface ClassicSettings {
  kind: Classic
  fast: number
  slow: number
  signal: number
  /** EMA trend filter for `macd200`. */
  trendLen: number
  /** Initial stop in ATRs for the crossover systems. */
  stopAtr: number
  /** Bars back for the swing stop of `macd200`. */
  swing: number
  /** Fixed target in R; 0 = hold until the opposite cross. */
  targetR: number
  feeRate: number
}

const BASE: Omit<ClassicSettings, 'kind'> = {
  fast: 12,
  slow: 26,
  signal: 9,
  trendLen: 200,
  stopAtr: 2,
  swing: 5,
  targetR: 0,
  feeRate: 0.001,
}

export const CLASSICS: Record<Classic, ClassicSettings> = {
  golden: { ...BASE, kind: 'golden', fast: 50, slow: 200 },
  ema921: { ...BASE, kind: 'ema921', fast: 9, slow: 21 },
  macd200: { ...BASE, kind: 'macd200', targetR: 1.5 },
  macdSignal: { ...BASE, kind: 'macdSignal' },
  faber: { ...BASE, kind: 'faber', slow: 200 },
}

/** `ta.ema` over a series with a leading run of NaN. */
function emaFrom(values: number[], length: number): number[] {
  const start = values.findIndex(Number.isFinite)
  const out = new Array<number>(values.length).fill(NaN)
  if (start < 0) return out
  const tail = ema(values.slice(start), length)
  for (let i = 0; i < tail.length; i++) out[start + i] = tail[i]
  return out
}

export function analyseClassic(candles: Candle[], settings: ClassicSettings): StrategyResult {
  const { kind, fast, slow, signal, trendLen, stopAtr, swing, targetR, feeRate } = settings
  const close = candles.map((c) => c.close)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const a = atr(high, low, close, 14)

  // Two series whose crossings are the signals: `up` crossing above `down`.
  let up: number[]
  let down: number[]
  if (kind === 'golden' || kind === 'faber') {
    up = kind === 'faber' ? close : sma(close, fast)
    down = sma(close, slow)
  } else if (kind === 'ema921') {
    up = ema(close, fast)
    down = ema(close, slow)
  } else {
    const ef = ema(close, fast)
    const es = ema(close, slow)
    up = ef.map((v, i) => v - es[i])
    down = emaFrom(up, signal)
  }
  const trend = kind === 'macd200' ? ema(close, trendLen) : null
  const swingLow = lowest(low, swing)
  const swingHigh = highest(high, swing)

  const warmup = Math.max(slow, trendLen && kind === 'macd200' ? trendLen : 0, 30) + 5
  const signals: StrategySignal[] = []
  let open: { signal: StrategySignal; risk: number } | null = null

  const exit = (price: number, i: number) => {
    if (!open) return
    const { signal: s, risk } = open
    s.resultR = (s.side === 'long' ? price - s.entry : s.entry - price) / risk
    s.outcome = s.resultR > 0 ? 'win' : 'loss'
    s.closedIndex = i
    s.closedTime = candles[i].time
    s.closedPrice = price
    open = null
  }

  for (let i = 1; i < candles.length; i++) {
    if (open) {
      const s = open.signal
      const long = s.side === 'long'
      if (long ? low[i] <= s.stop : high[i] >= s.stop) exit(s.stop, i)
      else if (s.target && (long ? high[i] >= s.target : low[i] <= s.target)) exit(s.target, i)
    }
    if (i < warmup) continue
    const ok = [up[i], down[i], up[i - 1], down[i - 1], a[i]].every(Number.isFinite)
    if (!ok) continue
    const crossUp = up[i - 1] <= down[i - 1] && up[i] > down[i]
    const crossDown = up[i - 1] >= down[i - 1] && up[i] < down[i]
    if (!crossUp && !crossDown) continue

    // The opposite cross closes the trade, for every system without a target.
    if (open && !targetR) {
      const s = open.signal
      if ((s.side === 'long' && crossDown) || (s.side === 'short' && crossUp)) exit(close[i], i)
    }
    if (open) continue

    let side: 'long' | 'short' | null = crossUp ? 'long' : 'short'
    if (kind === 'faber' && side === 'short') side = null
    if (kind === 'macd200') {
      // Below zero for a long, above for a short, and with the 200 EMA.
      if (side === 'long' && !(up[i] < 0 && close[i] > trend![i])) side = null
      if (side === 'short' && !(up[i] > 0 && close[i] < trend![i])) side = null
    }
    if (!side) continue

    const entry = close[i]
    const stop =
      kind === 'macd200'
        ? side === 'long'
          ? swingLow[i]
          : swingHigh[i]
        : side === 'long'
          ? entry - stopAtr * a[i]
          : entry + stopAtr * a[i]
    const risk: number = side === 'long' ? entry - stop : stop - entry
    // Untradeable: a stop so close that the round trip costs more than 1 R.
    // Freshly listed X-Perps open with hours of frozen 15 m bars, where the ATR
    // is zero and a 2 ATR stop sits a millionth from price.
    if (!(risk > 0) || feeInR(entry, stop, feeRate) > 1) continue

    const s: StrategySignal = {
      index: i,
      time: candles[i].time,
      side,
      entry,
      stop,
      target: targetR ? (side === 'long' ? entry + targetR * risk : entry - targetR * risk) : undefined,
      riskReward: targetR || undefined,
      outcome: 'open',
      feeR: feeInR(entry, stop, feeRate),
      note: kind,
    }
    signals.push(s)
    open = { signal: s, risk }
  }

  const live = open as { signal: StrategySignal } | null
  return summarise(signals, [], warmup, live ? live.signal : null)
}

export const analyseGolden = (c: Candle[]) => analyseClassic(c, CLASSICS.golden)
export const analyseEma921 = (c: Candle[]) => analyseClassic(c, CLASSICS.ema921)
export const analyseMacd200 = (c: Candle[]) => analyseClassic(c, CLASSICS.macd200)
export const analyseMacdSignal = (c: Candle[]) => analyseClassic(c, CLASSICS.macdSignal)
export const analyseFaber = (c: Candle[]) => analyseClassic(c, CLASSICS.faber)

/**
 * The cell chosen from the 4 h grid (fast 5–20 × slow 21–100, every cell
 * positive): EMA 9/50, from the middle of the good region, not its peak.
 */
export const analyseEma950 = (c: Candle[]) => analyseClassic(c, { ...CLASSICS.ema921, fast: 9, slow: 50 })
