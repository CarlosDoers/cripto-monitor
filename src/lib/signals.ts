import { useMemo } from 'react'
import { useCandleArchive, useCandleHistory } from './queries'
import { efficiencyRatio, regimeOf, strategyByKey } from './indicators/registry'
import type { Candle } from './indicators/types'

/**
 * Just the labels. Whether a timeframe is worth offering is derived per strategy
 * from its measured profile — see `timeframeVerdict()` — and never listed here:
 * a hand-written verdict is free to contradict the measurement, and did. Cost is
 * what usually separates them, since a 15 m ATR stop sits ~0.25 % away and a
 * 0.1 % round trip eats 0.4 R of it. The opening range escapes that by stopping
 * at the edge of a range twice as wide, which is why it is the one strategy that
 * clears costs down here.
 */
export const TIMEFRAMES = [
  { key: '15m', label: '15 m' },
  { key: '1H', label: '1 h' },
  { key: '4H', label: '4 h' },
  { key: '1D', label: '1 d' },
] as const

export type Timeframe = (typeof TIMEFRAMES)[number]['key']

export function useSignals(instId: string, bar: Timeframe, strategyKey: string, presetKey: string) {
  const strategy = strategyByKey(strategyKey)
  const query = useCandleHistory(instId, bar)
  // Deep history for the strategies that need more than /market/candles will
  // ever return. The two overlap; the merge below dedupes on timestamp.
  const archive = useCandleArchive(instId, bar, strategy.archiveBars ?? 0)

  const candles = useMemo<Candle[]>(
    () => {
      const rows = [...(archive.data ?? []), ...(query.data ?? [])]
      const seen = new Set<string>()
      return rows
        .map((row) => ({
          time: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          vol: Number(row[5]),
          confirmed: row[8] === '1',
        }))
        // The still-forming candle would make signals appear and disappear.
        .filter((c) => c.confirmed && Number.isFinite(c.close))
        .filter((c) => !seen.has(String(c.time)) && seen.add(String(c.time)))
        .sort((a, b) => a.time - b.time)
    },
    [archive.data, query.data],
  )

  const result = useMemo(
    () => strategy.run(candles, presetKey),
    [strategy, candles, presetKey],
  )

  const efficiency = useMemo(() => efficiencyRatio(candles), [candles])

  return {
    candles,
    result,
    strategy,
    efficiency,
    regime: regimeOf(efficiency),
    usableBars: Math.max(0, candles.length - result.warmup),
    isLoading: query.isLoading || archive.isLoading,
    isFetching: query.isFetching || archive.isFetching,
    error: query.error ?? archive.error,
  }
}
