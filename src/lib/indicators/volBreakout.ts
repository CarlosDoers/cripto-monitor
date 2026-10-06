import { barSpacing, resolveTrade } from './tradeKit'
import { summarise, feeInR, type Candle, type StrategyResult, type StrategySignal } from './types'

/**
 * Larry Williams' volatility breakout — the rule behind most of the crypto bots
 * that circulate in Korean trading communities ("변동성 돌파"), measured here as
 * it is told, nothing tuned:
 *
 * - each UTC day has a trigger at its open plus (or minus) half of *yesterday's*
 *   range — the day's price has to travel that far from where it started;
 * - the first trigger of the day opens the trade, at the level (or at the open
 *   of the bar that gapped past it); a bar that reaches both triggers is a loss
 *   (whichever came first, the day's open between them is then the stop);
 * - the stop is the day's open (the breakout failed the moment price is back
 *   where the day began) and the trade closes at the day's last close.
 *
 * Needs intraday candles to put the events of a day in order — the stop and the
 * trigger often fall inside one bar, and a coarse bar must assume the worse. Any
 * spacing from 15 minutes to 4 hours that divides the day works; the daily
 * candle itself has no inside and returns nothing.
 *
 * **Measured** on BTC, ETH and SOL: +0.01 R on 15 m (4 400 trades), −0.12 R on 1 h
 * and −0.45 R on 4 h. The coarser the bar the worse, because the trigger and the
 * stop fall inside the same bar and the simulation has to assume the stop; only
 * the 15 m is faithful, and it is flat.
 */

export interface VolBreakoutSettings {
  /** Trigger distance from the open, as a share of the previous day's range. */
  k: number
  feeRate: number
}

export const VOL_BREAKOUT_SETTINGS: VolBreakoutSettings = { k: 0.5, feeRate: 0.001 }

const DAY_MS = 86_400_000

export function analyseVolBreakout(candles: Candle[], s: VolBreakoutSettings = VOL_BREAKOUT_SETTINGS): StrategyResult {
  const spacing = barSpacing(candles)
  if (!spacing || DAY_MS % spacing !== 0 || DAY_MS / spacing < 6) return summarise([], [], candles.length, null)
  const PER_DAY = DAY_MS / spacing

  // First index of each UTC day, for the days that start at 00:00 and are whole
  // (the newest may still be running).
  const starts = new Map<number, number>()
  candles.forEach((c, i) => {
    if (c.time % DAY_MS === 0) starts.set(c.time, i)
  })
  const whole = (start: number) => {
    const end = start + PER_DAY - 1
    return end < candles.length && candles[end].time === candles[start].time + (PER_DAY - 1) * spacing
  }

  const signals: StrategySignal[] = []
  for (const [dayTime, start] of [...starts.entries()].sort((a, b) => a[0] - b[0])) {
    const prev = starts.get(dayTime - DAY_MS)
    if (prev === undefined || !whole(prev)) continue
    const last = start + PER_DAY - 1

    let top = -Infinity
    let bottom = Infinity
    for (let k = prev; k < prev + PER_DAY; k++) {
      top = Math.max(top, candles[k].high)
      bottom = Math.min(bottom, candles[k].low)
    }
    const dayOpen = candles[start].open
    const up = dayOpen + s.k * (top - bottom)
    const down = dayOpen - s.k * (top - bottom)

    for (let i = start; i <= Math.min(last, candles.length - 1); i++) {
      const b = candles[i]
      const hitUp = b.high >= up
      const hitDown = b.low <= down
      if (!hitUp && !hitDown) continue

      // Both triggers inside one bar: the nearer to the open is taken as first
      // and the stop, which sits between them, is hit on that same bar.
      const long = hitUp && hitDown ? Math.abs(b.open - up) <= Math.abs(b.open - down) : hitUp
      const entry = long ? Math.max(up, b.open) : Math.min(down, b.open)
      if (!(Math.abs(entry - dayOpen) > 0) || feeInR(entry, dayOpen, s.feeRate) > 1) break
      signals.push(
        resolveTrade(
          candles,
          {
            index: i,
            side: long ? 'long' : 'short',
            entry,
            stop: dayOpen,
            maxBars: last - i,
            intrabar: true,
            note: `ruptura de ${(s.k * 100).toFixed(0)} % del rango de ayer`,
          },
          { feeRate: s.feeRate },
        ),
      )
      break
    }
  }

  const lastSignal = signals[signals.length - 1]
  return summarise(signals, [], PER_DAY * 2, lastSignal && lastSignal.outcome === 'open' ? lastSignal : null)
}
