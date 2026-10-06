import { atr, sma } from './ta'
import { liveSignal, walk, type Entry } from './tradeKit'
import { summarise, type Candle, type StrategyResult } from './types'

/**
 * The Nadaraya-Watson envelope (LuxAlgo, jdehorty) — a Gaussian-kernel
 * regression of the close with bands at three times its mean absolute error,
 * the "smart" Bollinger band behind a lot of reversal scripts.
 *
 * The famous version repaints: it refits the whole curve on every bar, so its
 * past signals are drawn with knowledge they did not have. This is the endpoint
 * version the same authors publish for strategies — each bar's estimate uses
 * only the bars up to it. Written as published, nothing tuned: bandwidth 8 over
 * the last 60 bars, bands at 3 × the 100-bar mean error, a long at the close
 * that first falls below the lower band (a short above the upper), the stop 2
 * ATR away and the exit at the regression line.
 *
 * **Measured** (30 coins since 2022): −0.10 R on 4 h (3 122 trades), −0.15 R and
 * −0.16 R on the daily at the UTC and OKX closes.
 */

export interface NadarayaSettings {
  bandwidth: number
  window: number
  maeLen: number
  mult: number
  stopAtr: number
  feeRate: number
}

export const NADARAYA_SETTINGS: NadarayaSettings = {
  bandwidth: 8,
  window: 60,
  maeLen: 100,
  mult: 3,
  stopAtr: 2,
  feeRate: 0.001,
}

export function analyseNadarayaWatson(candles: Candle[], s: NadarayaSettings = NADARAYA_SETTINGS): StrategyResult {
  const n = candles.length
  const close = candles.map((c) => c.close)
  const unit = atr(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    close,
    14,
  )

  // Weight by age, newest first: exp(−d² / 2h²).
  const weights = Array.from({ length: s.window }, (_, d) => Math.exp(-(d * d) / (2 * s.bandwidth ** 2)))
  const total = weights.reduce((a, b) => a + b, 0)
  const fit = new Array<number>(n).fill(NaN)
  for (let i = s.window - 1; i < n; i++) {
    let acc = 0
    for (let d = 0; d < s.window; d++) acc += weights[d] * close[i - d]
    fit[i] = acc / total
  }
  // A NaN would poison the running sum of `sma` for good, so the bars before the
  // first fit count as zero; the warm-up keeps them out of every signal.
  const error = sma(
    close.map((c, i) => (Number.isFinite(fit[i]) ? Math.abs(c - fit[i]) : 0)),
    s.maeLen,
  )
  const upper = fit.map((v, i) => v + s.mult * error[i])
  const lower = fit.map((v, i) => v - s.mult * error[i])

  const warmup = s.window + s.maeLen
  const find = (i: number): Entry | null => {
    if (i < warmup || !(unit[i] > 0)) return null
    const long = close[i] < lower[i] && close[i - 1] >= lower[i - 1]
    const short = close[i] > upper[i] && close[i - 1] <= upper[i - 1]
    if (!long && !short) return null
    return {
      index: i,
      side: long ? 'long' : 'short',
      entry: close[i],
      stop: long ? close[i] - s.stopAtr * unit[i] : close[i] + s.stopAtr * unit[i],
      note: `fuera de la envolvente ${s.mult}×`,
    }
  }

  const signals = walk(candles, warmup, find, {
    feeRate: s.feeRate,
    exitOnClose: (i, side) => (side === 'long' ? close[i] >= fit[i] : close[i] <= fit[i]),
  })
  return summarise(signals, [], warmup, liveSignal(signals))
}
