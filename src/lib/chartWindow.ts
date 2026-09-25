import type { Candle, StrategyResult } from './indicators/types'

/** Past this many candles the bodies are thinner than a pixel. */
const MAX_VISIBLE = 400

/**
 * Which candles the chart shows. Exported so the view can build levels and
 * trendlines from exactly these bars: fed the whole series including the deep
 * archive, the detector found levels months away from price, and the chart
 * then filtered them out as off-scale — so a view could show none at all.
 *
 * The window widens so the most recent signal is always on screen — otherwise
 * a chart of a signal indicator can show no signals at all.
 */
export function chartStart(candles: Candle[], result: StrategyResult, visible = 160): number {
  const lastSignal = result.signals.at(-1)
  const wanted = lastSignal ? Math.max(visible, candles.length - lastSignal.index + 12) : visible
  const span = Math.min(wanted, MAX_VISIBLE, candles.length)
  return Math.max(0, candles.length - span)
}
