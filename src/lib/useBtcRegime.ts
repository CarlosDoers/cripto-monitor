import { useMemo } from 'react'
import { btcRegime, type BtcRegime } from './entryContext'
import { useCandleBoard } from './queries'
import { toCandles } from './signals'

/** BTC's spot pair: years of 4 h history, which is what its EMA 200 needs to settle. */
export const BTC_SPOT = 'BTC-USDT'

/**
 * BTC's regime from its 4 h candles: five paced pages, the same query key the Screener's cards use, so opening both costs
 * the requests once. Ten minutes fresh, like every 4 h board. Null while it loads.
 */
export function useBtcRegime(): BtcRegime | null {
  const board = useCandleBoard([BTC_SPOT], '4H', 5)
  const rows = board.byInst[BTC_SPOT]
  return useMemo(() => (rows ? btcRegime(toCandles(rows)) : null), [rows])
}
