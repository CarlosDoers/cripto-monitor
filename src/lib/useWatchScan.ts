import { useMemo, useState } from 'react'
import { btcRegime, type BtcRegime } from './entryContext'
import { MIN_LIQUID_VOLUME, type Market } from './markets'
import { useCandleBoard } from './queries'
import { toCandles } from './signals'
import { barsOf, spanText, type WatchBar, type WatchView } from './watchBars'

export const WATCH_SIZES = [10, 20] as const

/** Pages of candles a reading needs: five of 4 h reach an X-Perp's whole life, four of 1 h are 50 days. */
const PAGES: Record<WatchBar, number> = { '4H': 5, '1H': 4 }

/** BTC's spot pair: the regime tags read its 4 h EMA 200, whichever reading is on screen. */
const BTC_SPOT = 'BTC-USDT'

/**
 * The scan behind the Screener's "qué vigilar" cards: the most traded X-Perps,
 * on demand, with their candles from the paced board query. Each card keeps
 * its own choice of size, universe and reading, but they read the same cached
 * candles (10 minutes stale on 4 h, 5 on 1 h), so scanning the same contracts
 * for the second card costs no request.
 *
 * `view` is one reading — the longer one on 4 h, the shorter on 1 h — or both,
 * a row each. A bar that is not on screen is not fetched.
 */
export function useWatchScan(markets: Market[]) {
  const [size, setSize] = useState<(typeof WATCH_SIZES)[number]>(10)
  const [cryptoOnly, setCryptoOnly] = useState(true)
  const [view, setView] = useState<WatchView>('4H')
  const [ids, setIds] = useState<string[] | null>(null)
  const bars = barsOf(view)
  const idsFor = (b: WatchBar) => (ids && bars.includes(b) ? ids : [])
  const board4 = useCandleBoard(idsFor('4H'), '4H', PAGES['4H'])
  const board1 = useCandleBoard(idsFor('1H'), '1H', PAGES['1H'])
  const boards: Record<WatchBar, typeof board4> = { '4H': board4, '1H': board1 }
  // BTC's regime: five pages of its 4 h candles, once the scan has begun.
  const btc = useCandleBoard(ids ? [BTC_SPOT] : [], '4H', PAGES['4H'])
  const btcRows = btc.byInst[BTC_SPOT]
  const regime = useMemo<BtcRegime | null>(() => (btcRows ? btcRegime(toCandles(btcRows)) : null), [btcRows])
  const byId = useMemo(() => new Map(markets.map((m) => [m.instId, m])), [markets])

  const run = () =>
    setIds(
      markets
        .filter((m) => m.volumeUsd >= MIN_LIQUID_VOLUME && (!cryptoOnly || m.category === 'cripto'))
        .sort((a, b) => b.volumeUsd - a.volumeUsd)
        .slice(0, size)
        .map((m) => m.instId),
    )

  /** The bar a single-reading card is on; the longer one when both are shown. */
  const bar = bars[0]
  /** Contracts whose candles have all arrived, on the slowest of the bars on screen. */
  const loaded = Math.min(...bars.map((b) => boards[b].loaded))
  /** An age in candles of a bar, as the cards say it. */
  const span = (candles: number, of: WatchBar = bar) => spanText(candles, of)

  return { size, setSize, cryptoOnly, setCryptoOnly, view, setView, bars, bar, ids, run, boards, board: boards[bar], loaded, byId, span, regime }
}

export type WatchScan = ReturnType<typeof useWatchScan>
