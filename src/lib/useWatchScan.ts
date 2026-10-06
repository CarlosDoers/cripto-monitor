import { useMemo, useState } from 'react'
import { MIN_LIQUID_VOLUME, type Market } from './markets'
import { useCandleBoard } from './queries'

export const WATCH_SIZES = [10, 20] as const

/**
 * The scan behind the Screener's "qué vigilar" cards: the most traded X-Perps,
 * on demand, with their 4 h candles from the paced board query. Each card keeps
 * its own choice of size and universe, but they read the same cached candles
 * (10 minutes stale), so scanning the same contracts for the second card costs
 * no request.
 */
export function useWatchScan(markets: Market[]) {
  const [size, setSize] = useState<(typeof WATCH_SIZES)[number]>(10)
  const [cryptoOnly, setCryptoOnly] = useState(true)
  const [ids, setIds] = useState<string[] | null>(null)
  const board = useCandleBoard(ids ?? [], '4H')
  const byId = useMemo(() => new Map(markets.map((m) => [m.instId, m])), [markets])

  const run = () =>
    setIds(
      markets
        .filter((m) => m.volumeUsd >= MIN_LIQUID_VOLUME && (!cryptoOnly || m.category === 'cripto'))
        .sort((a, b) => b.volumeUsd - a.volumeUsd)
        .slice(0, size)
        .map((m) => m.instId),
    )

  return { size, setSize, cryptoOnly, setCryptoOnly, ids, run, board, byId }
}

export type WatchScan = ReturnType<typeof useWatchScan>

/** Four-hour candles are 4 h each: "hace 12 h", then days. */
export const hoursOf = (bars: number) => {
  const h = bars * 4
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} días`
}
