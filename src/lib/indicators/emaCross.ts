import { atr, ema } from './ta'
import { feeInR, summarise, type Candle, type Overlay, type StrategyResult, type StrategySignal } from './types'

/**
 * Price against its EMA 200 on 4 h, stop-and-reverse: long while candles close
 * above the average, short while they close below, with a 2 ATR stop in case
 * the move against comes faster than a close.
 *
 * The one configuration of 162 that `npm run emasweep` let through — 9 EMA
 * lengths × 3 timeframes × 3 ways of trading an EMA × 2 exits, on 30 coins.
 * Entry at the close that crosses; out at a close back across (which opens the
 * other side) or at the stop, checked from the next bar, stop first.
 */

export interface EmaCrossSettings {
  length: number
  stopAtr: number
  feeRate: number
}

export const EMA_CROSS_SETTINGS: EmaCrossSettings = { length: 200, stopAtr: 2, feeRate: 0.001 }

export function analyseEmaCross(candles: Candle[], settings: EmaCrossSettings = EMA_CROSS_SETTINGS): StrategyResult {
  const { length, stopAtr, feeRate } = settings
  const close = candles.map((c) => c.close)
  const line = ema(close, length)
  const unit = atr(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    close,
    14,
  )
  // Three lengths of history, as for every EMA the app draws: the SMA seed
  // still shows before that.
  const warmup = length * 3
  const signals: StrategySignal[] = []
  let open: { signal: StrategySignal; risk: number } | null = null

  const exit = (price: number, i: number) => {
    if (!open) return
    const { signal, risk } = open
    signal.resultR = (signal.side === 'long' ? price - signal.entry : signal.entry - price) / risk
    signal.outcome = signal.resultR > 0 ? 'win' : 'loss'
    signal.closedIndex = i
    signal.closedTime = candles[i].time
    signal.closedPrice = price
    open = null
  }

  for (let i = 1; i < candles.length; i++) {
    const b = candles[i]
    if (open) {
      const long = open.signal.side === 'long'
      if (long ? b.low <= open.signal.stop : b.high >= open.signal.stop) exit(open.signal.stop, i)
      else if (long ? b.close < line[i] : b.close > line[i]) exit(b.close, i)
    }
    if (open || i < warmup || !Number.isFinite(line[i - 1]) || !(unit[i] > 0)) continue
    const above = b.close > line[i]
    if (above === candles[i - 1].close > line[i - 1]) continue

    const entry = b.close
    const stop = above ? entry - stopAtr * unit[i] : entry + stopAtr * unit[i]
    if (feeInR(entry, stop, feeRate) > 1) continue
    const signal: StrategySignal = {
      index: i,
      time: b.time,
      side: above ? 'long' : 'short',
      entry,
      stop,
      outcome: 'open',
      feeR: feeInR(entry, stop, feeRate),
      note: `cierre ${above ? 'sobre' : 'bajo'} la EMA ${length}`,
    }
    signals.push(signal)
    open = { signal, risk: Math.abs(entry - stop) }
  }

  const overlays: Overlay[] = [{ key: `ema${length}`, label: `EMA ${length}`, values: line, colour: 'var(--series-2)' }]
  const live = open as { signal: StrategySignal } | null
  return summarise(signals, overlays, warmup, live ? live.signal : null)
}

export const analyseEmaCross150 = (c: Candle[]) => analyseEmaCross(c, { ...EMA_CROSS_SETTINGS, length: 150 })
export const analyseEmaCross250 = (c: Candle[]) => analyseEmaCross(c, { ...EMA_CROSS_SETTINGS, length: 250 })
export const analyseEmaCross300 = (c: Candle[]) => analyseEmaCross(c, { ...EMA_CROSS_SETTINGS, length: 300 })
export const analyseEmaCrossFee2 = (c: Candle[]) => analyseEmaCross(c, { ...EMA_CROSS_SETTINGS, feeRate: 0.002 })
