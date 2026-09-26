import { analyseSmc, SMC_SETTINGS, type Scale, type SmcSettings, type SmcStructure } from './smc'
import { feeInR, summarise, type Candle, type StrategyResult, type StrategySignal } from './types'

/**
 * Smart Money Concepts traded the way its users trade it — four candidates,
 * each written as the rule is usually stated and measured as written with
 * `npm run try`. Nothing here was tuned after seeing a result.
 *
 * 1. `analyseSmcSwingBreak`  — swing (50-bar) structure: enter on the close of
 *    every BOS or CHoCH, stop on the protected swing on the other side, raise
 *    the stop to each new protected swing, exit on the opposite break.
 * 2. `analyseSmcInternalBreak` — the same on the internal (5-bar) structure.
 * 3. `analyseSmcChoch` — swing structure, entering only on a change of
 *    character: the reversal trade.
 * 4. `analyseSmcObRetest` — after an internal break, a limit order at the edge
 *    of the order block it left, stop on the far side of the block, target at
 *    the extreme of the impulse that broke structure.
 *
 * Two conventions the rest of the project learned the hard way:
 * - **The entry bar is resolved.** The breaks enter on a close, so their entry
 *   bar is already over; the order block fills intrabar, so its fill bar is
 *   checked against the stop before anything else.
 * - **Stop before target** whenever one bar touches both.
 */

const FEE = 0.001
const WARMUP = 200

type Position = {
  signal: StrategySignal
  stop: number
  risk: number
  target?: number
}

function close(pos: Position, i: number, price: number, candles: Candle[]) {
  const s = pos.signal
  const long = s.side === 'long'
  const r = (long ? price - s.entry : s.entry - price) / pos.risk
  s.resultR = r
  s.outcome = r > 0 ? 'win' : 'loss'
  s.closedIndex = i
  s.closedTime = candles[i].time
  s.closedPrice = price
}

/** A bar that trades through the stop exits there — or at the open if it gapped past it. */
function stopFill(pos: Position, c: Candle): number | null {
  if (pos.signal.side === 'long') {
    return c.low <= pos.stop ? Math.min(c.open, pos.stop) : null
  }
  return c.high >= pos.stop ? Math.max(c.open, pos.stop) : null
}

/** Exported for the neighbourhood check in `npm run smc`, which varies the swing lengths. */
export function structureTrades(
  candles: Candle[],
  scale: Scale,
  onlyChoch: boolean,
  settings: SmcSettings = SMC_SETTINGS,
): StrategyResult {
  const r = analyseSmc(candles, settings)
  const byIndex = new Map<number, SmcStructure[]>()
  for (const e of r.structures) {
    if (e.scale !== scale) continue
    const list = byIndex.get(e.index) ?? []
    list.push(e)
    byIndex.set(e.index, list)
  }

  const signals: StrategySignal[] = []
  let pos: Position | null = null

  for (let i = WARMUP; i < candles.length; i++) {
    const c = candles[i]

    if (pos && pos.signal.index < i) {
      const fill = stopFill(pos, c)
      if (fill !== null) {
        close(pos, i, fill, candles)
        pos = null
      }
    }

    for (const e of byIndex.get(i) ?? []) {
      const long = e.bias === 1
      if (pos) {
        const posLong = pos.signal.side === 'long'
        if (posLong === long) {
          // Continuation: the stop follows the new protected swing, never back.
          const lvl = e.protectedLevel
          if (Number.isFinite(lvl)) {
            if (posLong && lvl < c.close) pos.stop = Math.max(pos.stop, lvl)
            if (!posLong && lvl > c.close) pos.stop = Math.min(pos.stop, lvl)
          }
          continue
        }
        // The opposite break ends the trade on its close.
        close(pos, i, c.close, candles)
        pos = null
      }
      if (onlyChoch && e.kind !== 'CHoCH') continue

      const entry = c.close
      const stop = e.protectedLevel
      if (!Number.isFinite(stop) || (long ? stop >= entry : stop <= entry)) continue
      const signal: StrategySignal = {
        index: i,
        time: c.time,
        side: long ? 'long' : 'short',
        entry,
        stop,
        outcome: 'open',
        feeR: feeInR(entry, stop, FEE),
        note: `${e.kind} ${scale === 'swing' ? 'principal' : 'interna'}`,
      }
      signals.push(signal)
      pos = { signal, stop, risk: Math.abs(entry - stop) }
    }
  }

  return summarise(signals, [], WARMUP, pos?.signal ?? null)
}

export function analyseSmcSwingBreak(candles: Candle[]): StrategyResult {
  return structureTrades(candles, 'swing', false)
}

export function analyseSmcInternalBreak(candles: Candle[]): StrategyResult {
  return structureTrades(candles, 'internal', false)
}

export function analyseSmcChoch(candles: Candle[]): StrategyResult {
  return structureTrades(candles, 'swing', true)
}

export function analyseSmcObRetest(candles: Candle[]): StrategyResult {
  const r = analyseSmc(candles)
  const blockAt = new Map<string, { top: number; bottom: number }>()
  for (const b of r.orderBlockHistory) {
    if (b.scale !== 'internal') continue
    blockAt.set(`${b.createdAt}:${b.bias}`, {
      top: Math.max(b.barHigh, b.barLow),
      bottom: Math.min(b.barHigh, b.barLow),
    })
  }
  const breaks = new Map<number, SmcStructure>()
  for (const e of r.structures) if (e.scale === 'internal') breaks.set(e.index, e)

  type Setup = { long: boolean; entry: number; stop: number; target: number; from: number; kind: string }
  let setup: Setup | null = null
  let pos: Position | null = null
  const signals: StrategySignal[] = []

  for (let i = WARMUP; i < candles.length; i++) {
    const c = candles[i]

    // An open trade: stop first, then target (never on its fill bar).
    if (pos && pos.signal.index < i) {
      const fill = stopFill(pos, c)
      if (fill !== null) {
        close(pos, i, fill, candles)
        pos = null
      } else if (pos.target !== undefined) {
        const hit = pos.signal.side === 'long' ? c.high >= pos.target : c.low <= pos.target
        if (hit) {
          close(pos, i, pos.target, candles)
          pos = null
        }
      }
    }

    // A pending limit, from the bar after the break that created it.
    if (!pos && setup && i > setup.from) {
      const s = setup
      const reachedTarget = s.long ? c.high >= s.target : c.low <= s.target
      const touched = s.long ? c.low <= s.entry : c.high >= s.entry
      if (reachedTarget) {
        // Ran to the target without retesting: the setup is spent.
        setup = null
      } else if (touched) {
        const entry = s.long ? Math.min(c.open, s.entry) : Math.max(c.open, s.entry)
        if (s.long ? entry > s.stop : entry < s.stop) {
          const signal: StrategySignal = {
            index: i,
            time: c.time,
            side: s.long ? 'long' : 'short',
            entry,
            stop: s.stop,
            target: s.target,
            outcome: 'open',
            feeR: feeInR(entry, s.stop, FEE),
            riskReward: Math.abs(s.target - entry) / Math.abs(entry - s.stop),
            note: `retorno a OB tras ${s.kind}`,
          }
          signals.push(signal)
          pos = { signal, stop: s.stop, risk: Math.abs(entry - s.stop), target: s.target }
          // The fill bar itself: a candle that tags the block and falls through it.
          const fill = stopFill(pos, c)
          if (fill !== null) {
            close(pos, i, fill, candles)
            pos = null
          }
        }
        setup = null
      }
    }

    // A new internal break replaces any pending setup.
    const e = breaks.get(i)
    if (e) {
      if (setup && setup.long !== (e.bias === 1)) setup = null
      const block = blockAt.get(`${i}:${e.bias}`)
      if (block && !pos) {
        const long = e.bias === 1
        const entry = long ? block.top : block.bottom
        const stop = long ? block.bottom : block.top
        const target = e.impulseExtreme
        const valid = long ? stop < entry && target > entry : stop > entry && target < entry
        setup = valid ? { long, entry, stop, target, from: i, kind: e.kind } : null
      }
    }
  }

  return summarise(signals, [], WARMUP, pos?.signal ?? null)
}
