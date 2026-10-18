import { groupOf, type HabitGroup } from './habits'
import { analyseDonchian, DONCHIAN_TREND_SETTINGS } from './indicators/donchianBreakout'
import type { Candle, StrategySignal } from './indicators/types'
import type { Trade } from './performance'

/**
 * Where the account's own trades stood against the lead trend rule (Canal 20 + EMA 200, 4 h, run on the very contract the
 * trade was in): did the rule hold a position in the same direction when the trade was opened, the opposite one, or none.
 * Descriptive — the rule is not the account's strategy, most of its trades are shorter than a 4 h trend and are not expected
 * to coincide — but it shows whether the trades that did coincide were the better ones, and how many followed nothing.
 */

export type Stance = 'with' | 'against' | 'none'

export const RULE_BAR_MS = 4 * 3_600_000
/** Candles before the rule can signal at all: the channel, the ATR and three EMA lengths, as the engine itself waits. */
export const RULE_WARMUP = Math.max(DONCHIAN_TREND_SETTINGS.channelLen, DONCHIAN_TREND_SETTINGS.atrLen, DONCHIAN_TREND_SETTINGS.trendLen * 3) + 20

/**
 * What the rule held at `at`: a position of its own in the same direction ('with'), the opposite one ('against') or none. A
 * position counts from the close of its signal candle and, once closed, only up to the open of the candle that closed it —
 * inside that candle it is not known which came first, and the doubt is resolved towards "none".
 */
export function stanceAt(signals: StrategySignal[], side: string, at: number, barMs = RULE_BAR_MS): Stance {
  for (const s of signals) {
    if (s.time + barMs > at) continue
    const open = s.outcome === 'open' || (s.closedTime !== undefined && at < s.closedTime)
    if (open) return s.side === side ? 'with' : 'against'
  }
  return 'none'
}

export interface Alignment {
  groups: Record<Stance, HabitGroup>
  /** Trades that could be placed against the rule. */
  placed: number
  /** Left out: no candles for their contract, or opened before the rule had warmed up there. */
  unplaced: number
  contracts: number
}

/** Places each trade against the rule on its own contract. `candlesByInst` holds closed 4 h candles, oldest first. */
export function alignWithRule(trades: Trade[], candlesByInst: Record<string, Candle[]>): Alignment {
  const signals = new Map<string, { signals: StrategySignal[]; from: number }>()
  const buckets: Record<Stance, Trade[]> = { with: [], against: [], none: [] }
  let unplaced = 0
  for (const t of trades) {
    const candles = candlesByInst[t.instId]?.filter((c) => c.confirmed !== false)
    if (!candles || candles.length <= RULE_WARMUP || !(t.openedAt > 0)) {
      unplaced++
      continue
    }
    let known = signals.get(t.instId)
    if (!known) {
      known = { signals: analyseDonchian(candles, DONCHIAN_TREND_SETTINGS).signals, from: candles[RULE_WARMUP].time + RULE_BAR_MS }
      signals.set(t.instId, known)
    }
    if (t.openedAt < known.from) {
      unplaced++
      continue
    }
    buckets[stanceAt(known.signals, t.direction, t.openedAt)].push(t)
  }
  return {
    groups: { with: groupOf(buckets.with), against: groupOf(buckets.against), none: groupOf(buckets.none) },
    placed: buckets.with.length + buckets.against.length + buckets.none.length,
    unplaced,
    contracts: signals.size,
  }
}
