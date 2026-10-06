// The strategies exactly as the app runs them, exposed as `analyse*` so the two
// measurement tools can run them like any candidate:
//
//   TRY_DIR=./.candles-board-1D TRY_BAR=1D npm run try -- scripts/ideas-shipped.mjs --export analyseShippedReversal
//   npm run battery -- scripts/ideas-shipped.mjs analyseShippedDonchianTrend 4H
//
// The point is the universe: the audit measures on BTC, ETH and SOL (and seven
// X-Perps with months of history), while the app applies the same code to every
// liquid X-Perp. These run it on the 30-coin board and on 2018-2021.
import { STRATEGIES } from '../src/lib/indicators/registry.ts'
import { analyseDonchian, DONCHIAN_SETTINGS } from '../src/lib/indicators/donchianBreakout.ts'

const by = (key, preset) => (candles) => STRATEGIES.find((s) => s.key === key).run(candles, preset)

export const analyseShippedReversal = by('reversal', 'tuned')
export const analyseShippedDonchian = by('donchian', 'fast')
export const analyseShippedEma200 = by('ema200', 'base')

/**
 * The Donchian with the trend filter the strategy already supports (`trendLen`):
 * long only above the EMA, short only below. Not shipped — it is the measurement
 * behind `npm run ideas trend`.
 */
const withTrend = (trendLen) => (candles) => analyseDonchian(candles, { ...DONCHIAN_SETTINGS, trendLen })
export const analyseShippedDonchianTrend = withTrend(200)
export const analyseDonchianTrend100 = withTrend(100)
export const analyseDonchianTrend150 = withTrend(150)
export const analyseDonchianTrend300 = withTrend(300)
