import { pivots as swingPoints } from './levels'
import { atr } from './ta'
import { liveSignal, walk, type Entry } from './tradeKit'
import { feeInR, summarise, type Candle, type SignalSide, type StrategyResult, type StrategySignal } from './types'

/**
 * "Acción del precio con niveles calculados" — the method Esteban Pérez
 * (CreceTrader) teaches in his live sessions, here from "Simulación de trading
 * con la acción del precio y niveles calculados" (2026-10-11).
 *
 * What he says: every asset moves in phases. **Phase 1** is an impulse. **Phase
 * 2** is a correction that must not take longer than "a half or a third" of
 * phase 1 (if it does it is a lateral and "we forget it"). **Phase 3** is the
 * impulse again. There are two ways in:
 *
 * - **Event 1**: the correction reaches the 50 % or 38.2 % level — a deep
 *   retracement — and turns, with rising lows and rising highs.
 * - **Event 2**: the correction stalls at the 61.8 % level, which is shallow:
 *   then wait for **two closes** above phase 1's high and enter.
 *
 * Target: **50 % of phase 1's range projected beyond its high**, "trading, not
 * investing" (100 % is the investor's). Risk: "una relación de uno a dos" — he
 * loses half of what he is aiming to gain, so the stop sits at half the distance
 * to the target. He adds that he then looks for a support or resistance, an
 * unmeasured "refugio". His live example is Microsoft's weekly chart of 1994.
 *
 * Written as rules, and mine where he is loose — fixed before any result:
 *
 * 1. Swing points: a bar higher (lower) than the three each side. Phase 1 is a
 *    swing low followed by the next swing high, at least three ATRs tall.
 * 2. Phase 2 must not take the price below that low, and lasts, from the high to
 *    the entry, no more than half of phase 1's duration (`timeRatio`).
 * 3. Event 1: a swing low is confirmed above phase 1's low after a retracement of
 *    at least 50 %: enter at the close of the bar that confirms it.
 *    Event 2: the retracement is less than 50 % but at least 10 %, and price
 *    closes above phase 1's high twice in a row: enter at the second close.
 * 4. Target = high + 0.5 × (high − low). Stop = entry − (target − entry) / 2.
 *    Out at market after 60 bars: he says days to a month on the daily.
 * 5. Shorts are the mirror image. One position at a time.
 *
 * **Measured** (2026-10-11, `npm run ideas fib`, 0.1 % round trip): on OKX's
 * daily, 24 coins 2022–26, 440 trades, hit rate 35.0 % against the 33 % a 2 : 1
 * needs, **−0.01 R gross and −0.02 R net** (interval by months [−0.21, +0.18],
 * halves +0.08 / −0.12, longs −0.05, shorts +0.02). On 2018–21, 11 coins and a
 * period nothing was tuned on: +0.10 R [−0.13, +0.33], longs +0.30 and shorts
 * −0.25 — a bull market's dip-buying. 4 h −0.03 R (2 738). The time rule adds
 * +0.06 R in 2022–26 and costs 0.13 R in 2018–21. Event 2 alone (two closes above
 * the high) is +0.21 R on 61 trades with an interval of [−0.22, +0.74]. Not
 * registered.
 *
 * The two sessions that followed (same author, 2026-10-11) teach the "first
 * pivot" technique: the same events on the last swing low to the first swing
 * high, and three purchases that share one stop and exit at 25, 50 and 100 % of
 * phase 1. Measured as `stopExtension: 0.5` with a target each, and the first
 * pivot as a phase 1 of any size (pivot 2, 1.5 ATR): on 2022–26 the 25 % target
 * is −0.10 R, the 100 % one −0.06 R, the three taken in equal parts **−0.06 R**
 * (without moving the stop to break even) and the first pivot −0.02 R over 834
 * trades; on 2018–21 +0.11 R for the three parts and +0.11 R for the first pivot,
 * longs +0.29 and shorts −0.20. Nothing the first class had not shown.
 *
 * Two more (2026-10-11) add the trailing stop: half out at the 50 % projection,
 * the other half's stop at the entry and then under each higher low once the
 * last high is broken (`exit: 'tranches'`, with `swingTrail: false` as the
 * control that only moves it to the entry). 2022–26 daily: break-even only −0.03 R
 * over 431 trades, with the trail −0.02 R — the trail adds +0.01 R; 2018–21
 * +0.18 R both ways. Event 2 alone with the trail +0.34 R on 61 trades, interval
 * [−0.22, +1.02], −0.39 R without its ten best. No better than the fixed exit.
 */

export interface FibPhaseSettings {
  pivot: number
  atrLen: number
  /** Phase 1 must be at least this many ATRs tall. */
  minImpulseAtr: number
  /** Phase 2 may last this share of phase 1's duration. 0 turns the rule off. */
  timeRatio: number
  /** Retracement at or beyond which the turn is event 1; shallower is event 2. */
  deep: number
  /** Shallowest correction that counts as one at all. */
  minPullback: number
  /** Consecutive closes beyond the high that event 2 waits for. */
  breakCloses: number
  /** Projection of phase 1's range beyond its extreme, as a share of it. */
  extension: number
  /**
   * The projection the stop is sized from. `null`: the target's own, so the stop
   * is always at `1 / rewardToRisk` of the way to it. A number fixes the stop at
   * that projection's geometry whatever the target: the three-tranche exit of
   * the "first pivot" technique shares one stop across targets at 25, 50 and 100 %.
   */
  stopExtension: number | null
  /** Reward-to-risk that sizes the stop: 2 means the stop is half the way to the target. */
  rewardToRisk: number
  maxBars: number
  events: 'both' | 'turn' | 'break'
  /**
   * `fixed`: one position, one target. `tranches`: the way the later sessions
   * trade it — half closes at `firstExtension`, the stop of the other half moves
   * to the entry, and from there it follows each higher low once the last high
   * has been broken, until `extension` or the stop.
   */
  exit: 'fixed' | 'tranches'
  /** With `tranches`: the projection where the first half closes. */
  firstExtension: number
  /** With `tranches`: follow the higher lows after the first half. Off: the stop stays at the entry (the control). */
  swingTrail: boolean
  feeRate: number
}

export const FIB_PHASE_SETTINGS: FibPhaseSettings = {
  pivot: 3,
  atrLen: 14,
  minImpulseAtr: 3,
  timeRatio: 0.5,
  deep: 0.5,
  minPullback: 0.1,
  breakCloses: 2,
  extension: 0.5,
  stopExtension: null,
  rewardToRisk: 2,
  maxBars: 60,
  events: 'both',
  exit: 'fixed',
  firstExtension: 0.5,
  swingTrail: true,
  feeRate: 0.001,
}

interface Raw {
  index: number
  entry: number
  stop: number
  target: number
  /** Where the first tranche closes. */
  first: number
  event: 1 | 2
}

/** The long logic on one series; shorts run it on the negated prices. */
function longs(hi: number[], lo: number[], cl: number[], a: number[], s: FibPhaseSettings): Raw[] {
  const n = cl.length
  const out: Raw[] = []
  const k = s.pivot
  // Swing points, each known `pivot` bars after it happened: the same rule as `levels.pivots`.
  const view = hi.map((h, i) => ({ time: i, open: cl[i], high: h, low: lo[i], close: cl[i], confirmed: true }))
  const { highs, lows } = swingPoints(view, k)
  type P = { idx: number; price: number; high: boolean }
  const highAt = new Map(highs.map((p) => [p.index, p.price]))
  const lowAt = new Map(lows.map((p) => [p.index, p.price]))
  // The alternating list as it stood at each bar, built in the order the points were
  // confirmed: two highs in a row keep the higher one only once the second is known.
  const seq: P[] = []
  const add = (p: P) => {
    const last = seq[seq.length - 1]
    if (!last || last.high !== p.high) seq.push(p)
    else if (p.high ? p.price > last.price : p.price < last.price) seq[seq.length - 1] = p
  }
  for (let i = 0; i < n; i++) {
    const at = i - k
    if (at >= 0) {
      if (highAt.has(at)) add({ idx: at, price: highAt.get(at)!, high: true })
      if (lowAt.has(at)) add({ idx: at, price: lowAt.get(at)!, high: false })
    }
    if (seq.length < 2) continue
    const unit = a[i]
    if (!Number.isFinite(unit) || !(unit > 0)) continue
    const known = seq.slice(-3)
    // Reference pair: the latest swing high and the swing low before it.
    let H: P | null = null
    let L: P | null = null
    for (let j = known.length - 1; j >= 1; j--) {
      if (known[j].high && !known[j - 1].high) {
        H = known[j]
        L = known[j - 1]
        break
      }
    }
    if (!H || !L) continue
    const range = H.price - L.price
    if (!(range >= s.minImpulseAtr * unit)) continue
    const impulseBars = H.idx - L.idx
    const lastKnown = known[known.length - 1]

    let event: 1 | 2 | null = null
    if ((s.events === 'both' || s.events === 'turn') && !lastKnown.high && lastKnown.idx > H.idx && lastKnown.idx + k === i) {
      // Event 1: a swing low above phase 1's low after a deep retracement, confirmed on this bar.
      const retr = (H.price - lastKnown.price) / range
      const lasted = lastKnown.idx - H.idx
      if (lastKnown.price > L.price && retr >= s.deep && (s.timeRatio === 0 || lasted <= s.timeRatio * impulseBars)) event = 1
    }
    if (!event && (s.events === 'both' || s.events === 'break') && i >= s.breakCloses && i > H.idx + k) {
      // Event 2: the Nth close above phase 1's high, the first time.
      let above = true
      for (let d = 0; d < s.breakCloses; d++) if (!(cl[i - d] > H.price)) above = false
      if (above && !(cl[i - s.breakCloses] > H.price)) {
        let low = Infinity
        for (let j = H.idx + 1; j <= i; j++) low = Math.min(low, lo[j])
        const retr = (H.price - low) / range
        const lasted = i - H.idx
        if (low > L.price && retr >= s.minPullback && retr < s.deep && (s.timeRatio === 0 || lasted <= s.timeRatio * impulseBars)) event = 2
      }
    }
    if (!event) continue
    const entry = cl[i]
    const target = H.price + s.extension * range
    if (!(target > entry)) continue
    const sizing = s.stopExtension === null ? target : H.price + s.stopExtension * range
    if (!(sizing > entry)) continue
    const stop = entry - (sizing - entry) / s.rewardToRisk
    if (!(stop < entry)) continue
    out.push({ index: i, entry, stop, target, first: H.price + s.firstExtension * range, event })
  }
  return out
}

/** An entry and, for the tranche exit, where its first half closes. */
export interface FibSetup {
  entry: Entry
  first: number
}

export function fibPhaseSetups(candles: Candle[], s: FibPhaseSettings = FIB_PHASE_SETTINGS): (FibSetup | null)[] {
  const n = candles.length
  const out: (FibSetup | null)[] = new Array(n).fill(null)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const close = candles.map((c) => c.close)
  const a = atr(high, low, close, s.atrLen)
  const up = longs(high, low, close, a, s)
  // The mirror image: negate the prices, so highs become lows.
  const down = longs(
    low.map((v) => -v),
    high.map((v) => -v),
    close.map((v) => -v),
    a,
    s,
  )
  const put = (r: Raw, side: SignalSide) => {
    const sign = side === 'long' ? 1 : -1
    const taken = out[r.index]
    // Both sides firing on the same bar says nothing about direction.
    if (taken && taken.entry.side !== side) {
      out[r.index] = null
      return
    }
    out[r.index] = {
      entry: {
        index: r.index,
        side,
        entry: sign * r.entry,
        stop: sign * r.stop,
        target: sign * r.target,
        maxBars: s.maxBars,
        note: `evento ${r.event}`,
      },
      first: sign * r.first,
    }
  }
  for (const r of up) put(r, 'long')
  for (const r of down) put(r, 'short')
  return out
}

export function fibPhaseEntries(candles: Candle[], s: FibPhaseSettings = FIB_PHASE_SETTINGS): (Entry | null)[] {
  return fibPhaseSetups(candles, s).map((x) => (x ? x.entry : null))
}

/** A short is a long on negated prices: one rule set for both sides. */
function longFrame(candles: Candle[], side: SignalSide): Candle[] {
  if (side === 'long') return candles
  return candles.map((c) => ({ ...c, open: -c.open, close: -c.close, high: -c.low, low: -c.high }))
}

/** The last point confirmed by `upTo` (its index at or before it) and not older than `from`. */
function lastPoint(points: { price: number; index: number }[], upTo: number, from: number) {
  let lo = 0
  let hi = points.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].index <= upTo) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found >= 0 && points[found].index >= from ? points[found] : null
}

/**
 * The two-tranche exit. Half the position closes at the first target. The other
 * half's stop moves to the entry once that is reached (from the next bar, since
 * the bar that touched it may have touched the stop first), and from then on to
 * the latest confirmed swing low whenever a bar closes above the latest swing
 * high formed since the entry — "ha roto estos máximos, protegería donde
 * estuvieron los mínimos". The result is the mean of the two halves.
 */
function resolveTranches(
  frame: Candle[],
  swings: { highs: { price: number; index: number }[]; lows: { price: number; index: number }[] },
  setup: FibSetup,
  s: FibPhaseSettings,
): StrategySignal {
  const e = setup.entry
  const sign = e.side === 'long' ? 1 : -1
  const entry = sign * e.entry
  const stop0 = sign * e.stop
  const target = sign * (e.target as number)
  const first = sign * setup.first
  const risk = entry - stop0
  const k = s.pivot
  const signal: StrategySignal = {
    index: e.index,
    time: frame[e.index].time,
    side: e.side,
    entry: e.entry,
    stop: e.stop,
    target: e.target,
    riskReward: Math.abs((e.target as number) - e.entry) / risk,
    outcome: 'open',
    feeR: feeInR(e.entry, e.stop, s.feeRate),
    note: e.note,
  }
  let stop = stop0
  let firstR: number | null = null
  const finish = (i: number, price: number) => {
    const runner = (price - entry) / risk
    const r = 0.5 * (firstR ?? runner) + 0.5 * runner
    signal.resultR = r
    signal.outcome = r > 0 ? 'win' : 'loss'
    signal.closedIndex = i
    signal.closedTime = frame[i].time
    signal.closedPrice = sign * price
    return signal
  }
  for (let i = e.index + 1; i < frame.length; i++) {
    const b = frame[i]
    if (b.low <= stop) return finish(i, Math.min(b.open, stop))
    if (firstR === null && b.high >= first) firstR = (first - entry) / risk
    if (b.high >= target) {
      if (firstR === null) firstR = (first - entry) / risk
      return finish(i, target)
    }
    if (i >= e.index + (e.maxBars ?? Infinity)) return finish(i, b.close)
    if (firstR !== null) {
      stop = Math.max(stop, entry)
      const h = s.swingTrail ? lastPoint(swings.highs, i - k, e.index) : null
      if (h && b.close > h.price) {
        const l = lastPoint(swings.lows, i - k, 0)
        if (l && l.price < b.close) stop = Math.max(stop, l.price)
      }
    }
  }
  return signal
}

export function analyseFibPhases(candles: Candle[], s: FibPhaseSettings = FIB_PHASE_SETTINGS): StrategyResult {
  const warmup = s.atrLen + 4 * s.pivot
  if (s.exit === 'fixed') {
    const entries = fibPhaseEntries(candles, s)
    const signals = walk(candles, warmup, (i) => entries[i], { feeRate: s.feeRate })
    return summarise(signals, [], warmup, liveSignal(signals))
  }
  const setups = fibPhaseSetups(candles, s)
  const frames = { long: longFrame(candles, 'long'), short: longFrame(candles, 'short') }
  const swings = { long: swingPoints(frames.long, s.pivot), short: swingPoints(frames.short, s.pivot) }
  const signals: StrategySignal[] = []
  // One position at a time, the way the kit's `walk` runs every other candidate.
  let i = Math.max(1, warmup)
  while (i < candles.length) {
    const st = setups[i]
    if (!st || !(Math.abs(st.entry.entry - st.entry.stop) > 0) || feeInR(st.entry.entry, st.entry.stop, s.feeRate) > 1) {
      i++
      continue
    }
    const side = st.entry.side
    const signal = resolveTranches(frames[side], swings[side], st, s)
    signals.push(signal)
    if (signal.outcome === 'open') break
    i = (signal.closedIndex ?? i) + 1
  }
  return summarise(signals, [], warmup, liveSignal(signals))
}
