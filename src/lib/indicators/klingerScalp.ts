import { atr, ema } from './ta'
import { liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type SignalSide, type StrategyResult } from './types'

/**
 * The part that can be measured of "Claude encontró la estrategia más rápida
 * para scalping en 5 minutos — ¡imposible perder!" (Juego de Traders, video of
 * 2026-10-11), which promises a win rate above 90 %.
 *
 * What the video specifies:
 *
 * - An arrow indicator ("Black Pica XBT USD" in the automatic captions, sensitivity
 *   6.5 → 6) that marks a long or a short. **It could not be identified**, so
 *   its signal cannot be reproduced and is not in here.
 * - The Klinger volume oscillator with fast 35, slow 50 and signal 16 (the
 *   defaults are 34 / 55 / 13): for a long the candle is green, the oscillator's
 *   histogram is green (it is above its signal) and the signal line is above
 *   zero; the short is the mirror.
 * - A stop beyond the previous structural low or high, and a target 1.5 times the
 *   risk ("ratio 1,5 a 1"). Five minutes, Bitcoin.
 *
 * So this is the specified half, with the arrow replaced by the first bar on
 * which the conditions all hold — which is what a person following the rules
 * would see if the arrow sat on that bar. Written before measuring:
 *
 * 1. Klinger as TradingView draws it: volume is signed by the change of the
 *    typical price (hlc3), the oscillator is the fast EMA of it minus the slow
 *    EMA, and the signal is an EMA of the oscillator.
 * 2. Long: the candle closes above its open, the oscillator is above its signal,
 *    and the signal is above zero; entered on the first bar where that becomes
 *    true. Short is the mirror.
 * 3. Stop: the most recent confirmed swing low (two bars each side) of the last
 *    30 bars below the entry, less a tenth of an ATR; none, no trade.
 * 4. Target 1.5 R. Out at market after 48 bars (four hours on 5 m): he says
 *    "a few minutes", and gives no time stop.
 *
 * `kvo` off is the control: the same entries and the same stop and target on the
 * first candle of each colour run, with no volume condition — what the
 * oscillator adds is then the difference.
 *
 * **Measured** (2026-10-11, `npm run ideas kvo`, BTC and ETH, 24 months, 5 m
 * built from the 1 m cache): 13 865 trades, hit rate **43.3 %** against the 40 %
 * a 1.5 R target needs, **+0.01 R gross and −0.26 R net** (halves −0.25 / −0.26;
 * −0.12 R all-maker). The control with no oscillator — only the candle's colour,
 * same stop and target — makes 42.1 %, −0.01 R gross and −0.33 R net: the
 * Klinger adds +0.02 R. On 15 m −0.15 R. A target of 1 R and the oscillator's
 * default settings give the same. The arrow, which is the whole signal in the
 * video, was not identified and is not measured here. Not registered.
 */

export interface KlingerSettings {
  fast: number
  slow: number
  signal: number
  /** Bars each side that make a swing point for the stop. */
  pivot: number
  stopLookback: number
  stopBufferAtr: number
  targetR: number
  maxBars: number
  /** Require the Klinger conditions. Off, only the candle's colour: the control. */
  kvo: boolean
  feeRate: number
}

export const KLINGER_SETTINGS: KlingerSettings = {
  fast: 35,
  slow: 50,
  signal: 16,
  pivot: 2,
  stopLookback: 30,
  stopBufferAtr: 0.1,
  targetR: 1.5,
  maxBars: 48,
  kvo: true,
  feeRate: 0.001,
}

/** TradingView's Klinger Oscillator: signed volume, EMA(fast) − EMA(slow), and its signal EMA. */
export function klinger(candles: Candle[], fast: number, slow: number, signal: number) {
  const sv: number[] = []
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const hlc3 = (c.high + c.low + c.close) / 3
    const p = i > 0 ? candles[i - 1] : c
    const prev = (p.high + p.low + p.close) / 3
    const v = c.vol ?? 0
    sv.push(hlc3 - prev >= 0 ? v : -v)
  }
  const fastLine = ema(sv, fast)
  const slowLine = ema(sv, slow)
  const kvo = fastLine.map((f, i) => f - slowLine[i])
  // The signal needs a seed: feed zeros for the warm-up gap so the EMA starts.
  const sig = ema(kvo.map((v) => (Number.isFinite(v) ? v : 0)), signal)
  return { kvo, sig }
}

export function klingerEntries(candles: Candle[], s: KlingerSettings = KLINGER_SETTINGS): (Entry | null)[] {
  const n = candles.length
  const out: (Entry | null)[] = new Array(n).fill(null)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const close = candles.map((c) => c.close)
  const a = atr(high, low, close, 14)
  const { kvo, sig } = klinger(candles, s.fast, s.slow, s.signal)
  const warm = s.slow * 3 + s.signal

  const holds = (i: number, side: SignalSide): boolean => {
    const c = candles[i]
    const green = c.close > c.open
    const red = c.close < c.open
    if (!s.kvo) return side === 'long' ? green : red
    if (!Number.isFinite(kvo[i]) || !Number.isFinite(sig[i])) return false
    return side === 'long' ? green && kvo[i] > sig[i] && sig[i] > 0 : red && kvo[i] < sig[i] && sig[i] < 0
  }

  for (let i = warm + 1; i < n; i++) {
    for (const side of ['long', 'short'] as const) {
      // The first bar on which everything holds, not every bar it keeps holding.
      if (!holds(i, side) || holds(i - 1, side)) continue
      const entry = close[i]
      // The most recent confirmed swing point beyond the entry: known `pivot` bars after it happened.
      let extreme: number | null = null
      for (let j = i - s.pivot; j >= Math.max(s.pivot, i - s.stopLookback); j--) {
        let isPoint = true
        for (let d = 1; d <= s.pivot && isPoint; d++) {
          if (side === 'long') {
            if (!(low[j] < low[j - d]) || !(low[j] <= low[j + d])) isPoint = false
          } else if (!(high[j] > high[j - d]) || !(high[j] >= high[j + d])) isPoint = false
        }
        if (!isPoint) continue
        const level = side === 'long' ? low[j] : high[j]
        if (side === 'long' ? level < entry : level > entry) {
          extreme = level
          break
        }
      }
      if (extreme === null || !Number.isFinite(a[i])) continue
      const stop = side === 'long' ? extreme - s.stopBufferAtr * a[i] : extreme + s.stopBufferAtr * a[i]
      const risk = Math.abs(entry - stop)
      if (!(risk > 0)) continue
      out[i] = {
        index: i,
        side,
        entry,
        stop,
        target: side === 'long' ? entry + s.targetR * risk : entry - s.targetR * risk,
        maxBars: s.maxBars,
      }
      break
    }
  }
  return out
}

export function analyseKlingerScalp(candles: Candle[], s: KlingerSettings = KLINGER_SETTINGS): StrategyResult {
  const entries = klingerEntries(candles, s)
  const warm = s.slow * 3 + s.signal
  const signals = walk(candles, warm, (i) => entries[i], { feeRate: s.feeRate })
  return summarise(signals, [], warm, liveSignal(signals))
}
