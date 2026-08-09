import { useMemo } from 'react'
import { useCandleHistory } from './queries'
import { efficiencyRatio, regimeOf, strategyByKey } from './indicators/registry'
import type { Candle } from './indicators/types'

/**
 * `verdict` comes from a sweep over 10 instruments and thousands of signals,
 * scored after trading costs. Cost is what separates the timeframes: on 15 m the
 * stop sits ~0.25 % away, so a 0.1 % round trip eats 0.4 R per signal, while on
 * the daily the same cost is 0.02 R. Both strategies only clear costs on 1 D.
 */
export const TIMEFRAMES = [
  { key: '15m', label: '15 m', verdict: 'poor' },
  { key: '1H', label: '1 h', verdict: 'marginal' },
  { key: '4H', label: '4 h', verdict: 'marginal' },
  { key: '1D', label: '1 d', verdict: 'good' },
] as const

export type Timeframe = (typeof TIMEFRAMES)[number]['key']
export type Verdict = (typeof TIMEFRAMES)[number]['verdict']

export function useSignals(instId: string, bar: Timeframe, strategyKey: string, presetKey: string) {
  const query = useCandleHistory(instId, bar)
  const strategy = strategyByKey(strategyKey)

  const candles = useMemo<Candle[]>(
    () =>
      (query.data ?? [])
        .map((row) => ({
          time: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          confirmed: row[8] === '1',
        }))
        // The still-forming candle would make signals appear and disappear.
        .filter((c) => c.confirmed && Number.isFinite(c.close)),
    [query.data],
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
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  }
}
