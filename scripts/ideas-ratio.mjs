// The shipped trend rules on ALT/BTC candles (`npm run novel ratio-build` makes them): long the alt and short BTC when the
// ratio trends up, the mirror when it trends down. Two legs, so the cost is 0.2 % a round trip.
//
//   TRY_DIR=./.candles-ratio-4H TRY_BAR=4H npm run try -- scripts/ideas-ratio.mjs --export analyseRatioDonchian --trials 4
//   TRY_DIR=./.candles-ratio-1D TRY_BAR=1D npm run try -- scripts/ideas-ratio.mjs --export analyseRatioEma --trials 4
import { analyseDonchian, DONCHIAN_TREND_SETTINGS } from '../src/lib/indicators/donchianBreakout.ts'
import { analyseEmaCross, EMA_CROSS_SETTINGS } from '../src/lib/indicators/emaCross.ts'

export const analyseRatioDonchian = (candles) => analyseDonchian(candles, { ...DONCHIAN_TREND_SETTINGS, feeRate: 0.002 })
export const analyseRatioEma = (candles) => analyseEmaCross(candles, { ...EMA_CROSS_SETTINGS, feeRate: 0.002 })
