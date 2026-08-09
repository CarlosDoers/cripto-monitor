import { useMemo } from 'react'
import { useCandleHistory } from './queries'
import {
  analyseTraps,
  DEFAULT_SETTINGS,
  type Candle as TrapCandle,
  type TrapSettings,
} from './indicators/reversalTrap'

/**
 * `verdict` comes from a sweep over 10 instruments and ~5 700 signals, scored
 * after trading costs. The cost is what separates them: on 15 m the stop sits
 * ~0.25 % away, so a 0.1 % round trip eats 0.4 R per signal.
 */
export const TIMEFRAMES = [
  { key: '15m', label: '15 m', verdict: 'poor' },
  { key: '1H', label: '1 h', verdict: 'marginal' },
  { key: '4H', label: '4 h', verdict: 'marginal' },
  { key: '1D', label: '1 d', verdict: 'good' },
] as const

export type Timeframe = (typeof TIMEFRAMES)[number]['key']
export type Verdict = (typeof TIMEFRAMES)[number]['verdict']

/** How long one candle lasts, for projecting a signal's age. */
export const BAR_MS: Record<Timeframe, number> = {
  '15m': 15 * 60_000,
  '1H': 60 * 60_000,
  '4H': 4 * 60 * 60_000,
  '1D': 24 * 60 * 60_000,
}

export function useSignals(
  instId: string,
  bar: Timeframe,
  settings: TrapSettings = DEFAULT_SETTINGS,
) {
  const query = useCandleHistory(instId, bar)

  const candles = useMemo<TrapCandle[]>(
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

  const analysis = useMemo(() => analyseTraps(candles, settings), [candles, settings])

  return {
    candles,
    ...analysis,
    /** Bars analysed after the warm-up period. */
    usableBars: Math.max(0, candles.length - analysis.warmup),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  }
}
