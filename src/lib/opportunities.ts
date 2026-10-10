import { useMemo } from 'react'
import { MIN_LIQUID_VOLUME, useMarkets } from './markets'
import { useDailyBoard, usePositions } from './queries'
import { toCandles } from './signals'
import { analyseTraps, trapWatch, TUNED_SETTINGS } from './indicators/reversalTrap'
import { profileOf, strategyByKey } from './indicators/registry'
import { feeInR, type Candle } from './indicators/types'

/** The round trip the audit prices every late entry at. */
const ROUND_TRIP_FEE = 0.001

/**
 * *Oportunidades ahora*: the BTC, ETH and SOL X-Perps where the reversal — the highest
 * expectancy the app has measured — has a live daily signal still worth taking.
 *
 * What makes it a ranking and not a screen is two measurements, both in
 * `npm run audit`:
 *
 * - **A signal stays worth taking for a week.** The reversal fixes its stop
 *   and target when it fires, so entering k days late is a defined trade.
 *   Doing so, while price has touched neither, measured at least +0,31 R at
 *   every age from 1 to 7 days, both halves positive (`lateEntry` on the
 *   profile). Older signals are left out: not measured is not offered.
 * - **More reward left per unit of risk ranks higher.** Pooling those late
 *   entries by the reward-to-risk remaining at that close: under 1:1 +0,27 R,
 *   1–1,5 +0,46, 1,5–2 +0,54, 2–3 +0,24, over 3 +0,79 — noisy and not
 *   monotonic (2–3 is now the weakest), so the ordering is a mild preference:
 *   the most room is clearly the best bucket and every bucket is positive in
 *   both halves. The number shown is that ratio, not an invented score.
 *
 * And it only looks where the edge was measured. It used to scan the 40 most
 * traded crypto X-Perps, saying other coins were "the same rule, not the same
 * evidence" — until the evidence was measured (`npm run ideas reversal`, the
 * 2026-10-06 search): on the other 26 coins of the 30-coin board the reversal
 * makes −0.03 R over 759 signals, and before 2022 it lost on BTC, ETH and SOL
 * too. The edge is a property of these three coins in 2022–26, not of the rule,
 * so a DOGE tile beside "+0,43 R por señal" was a recommendation with no
 * backing. Since 2026-10-10 the panel scans BTC, ETH and SOL only — three
 * requests an hour instead of forty.
 */

/** The coins the reversal's edge was measured on, and the only ones it is offered on. */
export const MEASURED_COINS = ['BTC', 'ETH', 'SOL']

/**
 * The most liquid contract of each measured coin, most traded first. Shared by
 * the panel and the Claude text, so both look at the same three contracts.
 */
export function measuredContracts<T extends { symbol: string; volumeUsd: number }>(list: T[]): T[] {
  const best = new Map<string, T>()
  for (const x of list) {
    if (!MEASURED_COINS.includes(x.symbol)) continue
    const prev = best.get(x.symbol)
    if (!prev || x.volumeUsd > prev.volumeUsd) best.set(x.symbol, x)
  }
  return [...best.values()].sort((a, b) => b.volumeUsd - a.volumeUsd)
}

export interface Opportunity {
  instId: string
  symbol: string
  side: 'long' | 'short'
  entry: number
  stop: number
  target: number
  /** Live price the ratio is computed at. */
  price: number
  signalTime: number
  /** Daily candles since the signal bar; 0 means it fired on the last close. */
  age: number
  /** Reward left over risk left, at the live price. */
  remaining: number
  /** The same at the signal's own entry — what Estrategias shows as its ratio. */
  entryRatio: number
  /** Distance to the stop and to the target, as fractions of price. */
  toStop: number
  toTarget: number
  volumeUsd: number
  /** The account already has a position on this contract. */
  held: boolean
}

export interface Watch {
  instId: string
  symbol: string
  /** The trade a close back inside the band would open. */
  side: 'long' | 'short'
  volumeUsd: number
}

type Scan = { kind: 'signal'; opportunity: Omit<Opportunity, 'instId' | 'symbol' | 'volumeUsd' | 'held'> } | { kind: 'watch'; side: 'long' | 'short' } | null

const profile = profileOf(strategyByKey('reversal'), 'tuned')
const maxAge = profile.lateEntry?.maxAge ?? 0
/** The figures the panel quotes, read from the profile the audit checks. */
export const EVIDENCE = {
  expectancy: profile.byTimeframe['1D'] ?? 0,
  lateFloor: profile.lateEntry?.floor ?? 0,
  maxAge,
}

/** The reversal on one contract's daily candles, read at the live price. */
export function scanReversal(candles: Candle[], price: number): Scan {
  if (candles.length < 120 || !(price > 0)) return null
  const a = analyseTraps(candles, TUNED_SETTINGS)
  const s = a.active
  if (s) {
    const age = candles.length - 1 - s.index
    const long = s.side === 'long'
    const risk = long ? price - s.stop : s.stop - price
    const reward = long ? s.target - price : price - s.target
    // Past the measured age, or already through the stop or the target at
    // today's price even if no daily candle has closed there yet.
    if (age > maxAge || !(risk > 0) || !(reward > 0)) return null
    // A hair from the stop the remaining risk is so small that the round-trip
    // fee alone costs more than 1 R: not a trade anyone can take, yet its
    // reward-to-risk is astronomic and it ranked first — PEPE printed
    // "1:846.011" with its price 0,0 % from the stop.
    if (feeInR(price, s.stop, ROUND_TRIP_FEE) > 1) return null
    return {
      kind: 'signal',
      opportunity: {
        side: s.side,
        entry: s.entry,
        stop: s.stop,
        target: s.target,
        price,
        signalTime: s.time,
        age,
        remaining: reward / risk,
        entryRatio: s.riskReward,
        toStop: risk / price,
        toTarget: reward / price,
      },
    }
  }
  const watch = trapWatch(
    candles,
    a.upper,
    a.basis,
    a.lower,
    a.signals.at(-1)?.index ?? null,
    null,
    TUNED_SETTINGS,
  )
  if (watch?.armed) return { kind: 'watch', side: watch.zone === 'below' ? 'long' : 'short' }
  return null
}

export function useOpportunities() {
  // Price, volume and type are all it reads: no open interest or indices.
  const { markets, isLoading: marketsLoading } = useMarkets([], { lite: true })
  const positions = usePositions()

  const universe = useMemo(
    () => measuredContracts(markets.filter((m) => m.category === 'cripto' && m.volumeUsd >= MIN_LIQUID_VOLUME)),
    [markets],
  )
  const ids = useMemo(() => universe.map((m) => m.instId), [universe])
  const board = useDailyBoard(ids, '1D')

  return useMemo(() => {
    const held = new Set((positions.data ?? []).map((p) => p.instId))
    const found: Opportunity[] = []
    const watching: Watch[] = []
    for (const m of universe) {
      const rows = board.byInst[m.instId]
      if (!rows) continue
      const scan = scanReversal(toCandles(rows), m.last)
      if (scan?.kind === 'signal') {
        found.push({ ...scan.opportunity, instId: m.instId, symbol: m.symbol, volumeUsd: m.volumeUsd, held: held.has(m.instId) })
      } else if (scan?.kind === 'watch') {
        watching.push({ instId: m.instId, symbol: m.symbol, side: scan.side, volumeUsd: m.volumeUsd })
      }
    }
    found.sort((a, b) => b.remaining - a.remaining)
    return {
      top: found.slice(0, 3),
      /** Live signals beyond the three shown. */
      others: found.slice(3),
      watching,
      scanned: board.loaded,
      total: ids.length,
      maxAge,
      isLoading: marketsLoading || (ids.length > 0 && board.loaded === 0),
    }
  }, [universe, board.byInst, board.loaded, ids.length, positions.data, marketsLoading])
}
