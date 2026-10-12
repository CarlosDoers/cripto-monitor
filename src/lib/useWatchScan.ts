import { useMemo, useState } from 'react'
import { MIN_LIQUID_VOLUME, type Market } from './markets'
import { useCandleBoard } from './queries'
import { spanText, type WatchBar } from './watchBars'

export const WATCH_SIZES = [10, 20] as const

/** Pages of candles a reading needs: five of 4 h reach an X-Perp's whole life, four of 1 h are 50 days. */
const PAGES: Record<WatchBar, number> = { '4H': 5, '1H': 4 }

/**
 * The scan behind the Screener's "qué vigilar" cards: the most traded X-Perps,
 * on demand, with their candles from the paced board query. Each card keeps
 * its own choice of size, universe and bar, but they read the same cached
 * candles (10 minutes stale on 4 h, 5 on 1 h), so scanning the same contracts
 * for the second card costs no request.
 */
export function useWatchScan(markets: Market[]) {
  const [size, setSize] = useState<(typeof WATCH_SIZES)[number]>(10)
  const [cryptoOnly, setCryptoOnly] = useState(true)
  const [bar, setBar] = useState<WatchBar>('4H')
  const [ids, setIds] = useState<string[] | null>(null)
  const board = useCandleBoard(ids ?? [], bar, PAGES[bar])
  const byId = useMemo(() => new Map(markets.map((m) => [m.instId, m])), [markets])

  const run = () =>
    setIds(
      markets
        .filter((m) => m.volumeUsd >= MIN_LIQUID_VOLUME && (!cryptoOnly || m.category === 'cripto'))
        .sort((a, b) => b.volumeUsd - a.volumeUsd)
        .slice(0, size)
        .map((m) => m.instId),
    )

  /** An age in candles of the chosen bar, as the cards say it. */
  const span = (candles: number) => spanText(candles, bar)

  return { size, setSize, cryptoOnly, setCryptoOnly, bar, setBar, ids, run, board, byId, span }
}

export type WatchScan = ReturnType<typeof useWatchScan>
