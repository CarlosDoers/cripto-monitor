import { feeInR, type Candle, type SignalSide, type StrategySignal } from './types'

/**
 * What a candidate decides at a bar; the kit runs the trade from there, so every
 * candidate resolves its positions by the same rules and none of them can
 * flatter itself in its own way. The rules are the ones this project already
 * learned the hard way:
 *
 * - **Stop before target** when one bar touches both.
 * - **A gap through the stop fills at the open**, not at the stop.
 * - **The entry bar is resolved** when the entry happens inside it (a stop order):
 *   it can still hit the stop, and a bar that reaches both stop and target counts
 *   as the stop.
 * - **The last trade stays open** when the data ends before its window does.
 * - **Two stop orders reached by one bar is a loss, not a skipped day.** The
 *   other level is the stop, so the outcome is known even if the order of events
 *   is not; dropping those bars deletes certain −1 R trades. It turned an NR7 of
 *   −0.07 R into +0.32 R, and it had the shipped opening range at +0.25 R where
 *   the honest count is +0.22 — counted since 2026-10-10, which blocked it.
 * - **A limit order against the move is not credited its target on its fill bar**
 *   (`limitFill`): see `Entry`.
 */
export interface Entry {
  /** The bar the position opens on: its close, or inside it when `intrabar`. */
  index: number
  side: SignalSide
  entry: number
  /** Initial stop. Defines 1 R. */
  stop: number
  /** Fixed target, in price. */
  target?: number
  /** Close at the close of bar `index + maxBars` when nothing else ended it first. */
  maxBars?: number
  /** The fill happens inside `index` (a stop order), so that bar can still hit the stop. */
  intrabar?: boolean
  /**
   * The fill is a limit order *against* the move (a pullback). Price had to come
   * back to the level, so the bar's high may well have come before the fill: the
   * target is not credited on the fill bar, only from the next one. Without this
   * rule a 2 R pullback strategy collects every wide bar as a win — it was the
   * whole edge of the first FVG measurement on 2018–21.
   */
  limitFill?: boolean
  note?: string
}

export interface ResolveOptions {
  feeRate: number
  /** Asked from the bar after the entry on: true closes the trade at that bar's close. */
  exitOnClose?: (i: number, side: SignalSide) => boolean
  /** Moves the stop in the trade's favour; the kit never lets it go back. */
  trail?: (i: number, side: SignalSide, stop: number) => number
}

/** Runs one trade to its end and returns it, still `open` if the data ran out first. */
export function resolveTrade(candles: Candle[], e: Entry, o: ResolveOptions): StrategySignal {
  const long = e.side === 'long'
  const risk = Math.abs(e.entry - e.stop)
  const signal: StrategySignal = {
    index: e.index,
    time: candles[e.index].time,
    side: e.side,
    entry: e.entry,
    stop: e.stop,
    target: e.target,
    riskReward: e.target === undefined ? undefined : Math.abs(e.target - e.entry) / risk,
    outcome: 'open',
    feeR: feeInR(e.entry, e.stop, o.feeRate),
    note: e.note,
  }

  const finish = (i: number, price: number) => {
    signal.resultR = (long ? price - e.entry : e.entry - price) / risk
    signal.outcome = signal.resultR > 0 ? 'win' : 'loss'
    signal.closedIndex = i
    signal.closedTime = candles[i].time
    signal.closedPrice = price
  }

  let stop = e.stop
  for (let i = e.intrabar ? e.index : e.index + 1; i < candles.length; i++) {
    const b = candles[i]
    if (long ? b.low <= stop : b.high >= stop) {
      // On the entry bar the open came before the fill, so only later bars can gap through.
      const fill = i === e.index ? stop : long ? Math.min(b.open, stop) : Math.max(b.open, stop)
      finish(i, fill)
      return signal
    }
    if (e.target !== undefined && !(e.limitFill && i === e.index) && (long ? b.high >= e.target : b.low <= e.target)) {
      finish(i, e.target)
      return signal
    }
    if (e.maxBars !== undefined && i >= e.index + e.maxBars) {
      finish(i, b.close)
      return signal
    }
    if (i > e.index && o.exitOnClose?.(i, e.side)) {
      finish(i, b.close)
      return signal
    }
    if (o.trail) {
      const next = o.trail(i, e.side, stop)
      stop = long ? Math.max(stop, next) : Math.min(stop, next)
    }
  }
  return signal
}

/**
 * One position at a time, the way every strategy here runs: `find(i)` proposes
 * an entry while flat, the kit resolves it, and the search resumes on the bar
 * after the trade closed. A stop closer than the fee can pay for (more than
 * 1 R of cost) is not a trade and is skipped.
 */
export function walk(
  candles: Candle[],
  from: number,
  find: (i: number) => Entry | null,
  o: ResolveOptions,
): StrategySignal[] {
  const signals: StrategySignal[] = []
  let i = Math.max(1, from)
  while (i < candles.length) {
    const e = find(i)
    if (!e || !(Math.abs(e.entry - e.stop) > 0) || feeInR(e.entry, e.stop, o.feeRate) > 1) {
      i++
      continue
    }
    const signal = resolveTrade(candles, e, o)
    signals.push(signal)
    if (signal.outcome === 'open') break
    i = (signal.closedIndex ?? i) + 1
  }
  return signals
}

/**
 * The real spacing between candles, in milliseconds. An idea written for one
 * timeframe uses it to return nothing elsewhere instead of computing nonsense.
 */
export function barSpacing(candles: Candle[]): number {
  if (candles.length < 3) return 0
  const diffs: number[] = []
  for (let i = 1; i < Math.min(candles.length, 50); i++) diffs.push(candles[i].time - candles[i - 1].time)
  diffs.sort((a, b) => a - b)
  return diffs[Math.floor(diffs.length / 2)]
}

/** The trade still running on the newest candle, for the strategy's `active` slot. */
export function liveSignal(signals: StrategySignal[]): StrategySignal | null {
  const last = signals[signals.length - 1]
  return last && last.outcome === 'open' ? last : null
}
