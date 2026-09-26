import { atr, highest, lowest } from './ta'
import type { Candle } from './types'

/**
 * Smart Money Concepts — port of LuxAlgo's "Smart Money Concepts (SMC)"
 * (Pine v6, luxalgo.com/library, TradingView script CnB3fSph), for personal,
 * non-commercial use with attribution to LuxAlgo.
 *
 * It reads market structure the way discretionary "smart money" traders do:
 *
 * - **Swings** at two scales: *swing* (50 bars) and *internal* (5 bars).
 * - **BOS / CHoCH**: a close through the last swing high or low. Through it in
 *   the direction of the current trend is a *break of structure*; against it,
 *   a *change of character* — the trend flips.
 * - **Order blocks**: the most extreme candle between the swing and the break,
 *   kept until price trades back through it.
 * - **Fair value gaps**: three-candle gaps the middle candle left behind.
 * - **Equal highs / lows**: two swings within 0.1 ATR(200) — resting liquidity.
 * - **Strong / weak high and low**, and the premium / discount range.
 *
 * Everything below follows the Pine script bar by bar, in its execution
 * order, because that order decides the result. Five details that are easy to
 * "fix" and must not be:
 *
 * 1. A swing looks only forward: bar `i - size` is a swing high when its high
 *    beats every one of the `size` bars after it (`high[size] > ta.highest(size)`).
 *    So a 50-bar swing is confirmed 50 bars later, and nothing repaints.
 * 2. `ta.crossover(close, level)` compares against the level *as it stood on the
 *    previous bar*, so the previous level is tracked per pivot.
 * 3. An order block candle whose range is at least 2 × ATR(200) has its high
 *    and low **swapped** (`parsedHigh = low`). Mitigation then compares against
 *    the swapped values. Faithful, odd-looking, and it matters on spikes.
 * 4. Fair value gaps are removed asymmetrically: a bullish gap when price
 *    trades below its *bottom* (fully filled), a bearish one when price trades
 *    above its *top*, which for a bearish gap is the lower edge — i.e. as soon
 *    as price re-enters it. Kept as published so the chart matches TradingView.
 * 5. The internal break is ignored when the internal pivot sits at the same
 *    level as the swing pivot (the swing break covers it).
 *
 * One deliberate difference: Pine removes mitigated order blocks and gaps with
 * `array.remove` inside a `for…in` over the same array, which can skip the
 * element after each removal. Here every mitigated one is removed. It can only
 * make a zone disappear one bar earlier than on TradingView.
 */

export type Bias = 1 | -1
export type Scale = 'swing' | 'internal'

export interface SmcSettings {
  swingLength: number
  internalLength: number
  equalLength: number
  /** Equal highs/lows sit within this many ATR(200) of each other. */
  equalThreshold: number
  /** `highlow` (default) mitigates on wicks, `close` on closes. */
  orderBlockMitigation: 'highlow' | 'close'
  /** Filter tiny gaps against twice the running mean candle body. */
  gapAutoThreshold: boolean
}

export const SMC_SETTINGS: SmcSettings = {
  swingLength: 50,
  internalLength: 5,
  equalLength: 3,
  equalThreshold: 0.1,
  orderBlockMitigation: 'highlow',
  gapAutoThreshold: true,
}

export interface SmcStructure {
  kind: 'BOS' | 'CHoCH'
  bias: Bias
  scale: Scale
  /** The swing that was broken. */
  pivotIndex: number
  price: number
  /** The bar whose close broke it. */
  index: number
  /**
   * The opposite swing of the same scale at the moment of the break — the
   * "protected" low under a bullish break, the high over a bearish one. Not
   * drawn by the original; kept so a strategy can put its stop there.
   */
  protectedLevel: number
  /** The impulse extreme between the swing and the break (the break's high for a bullish one). */
  impulseExtreme: number
}

export interface SmcOrderBlock {
  bias: Bias
  scale: Scale
  /** As stored by the original — swapped on high-volatility candles. */
  barHigh: number
  barLow: number
  /** The candle the block is drawn from. */
  index: number
  /** The bar of the break that created it. */
  createdAt: number
  /**
   * The bar price traded through it. Set while the block is among the 100 the
   * original keeps; one pushed out of that list is never marked.
   */
  mitigatedAt?: number
}

export interface SmcGap {
  bias: Bias
  /** Pine's `top`/`bottom`: for a bearish gap `top` is the lower edge. */
  top: number
  bottom: number
  /** Left edge of the drawing: the middle candle. */
  index: number
  createdAt: number
}

export interface SmcEqual {
  kind: 'EQH' | 'EQL'
  fromIndex: number
  toIndex: number
  fromPrice: number
  price: number
  /** Bar at which the second swing was confirmed. */
  confirmedAt: number
}

export interface SmcTrailing {
  top: number
  bottom: number
  topIndex: number
  bottomIndex: number
  /** Bar of the last swing pivot — where the premium/discount zones start. */
  barIndex: number
}

export interface SmcResult {
  structures: SmcStructure[]
  /** Unmitigated at the last bar, newest first — the original draws the first 5. */
  internalOrderBlocks: SmcOrderBlock[]
  swingOrderBlocks: SmcOrderBlock[]
  /** Every order block ever created, oldest first, with when it was mitigated. */
  orderBlockHistory: SmcOrderBlock[]
  gaps: SmcGap[]
  equals: SmcEqual[]
  swingTrend: Bias | 0
  internalTrend: Bias | 0
  trailing: SmcTrailing
  /** Per bar, the internal trend after that bar — the original's candle colour. */
  internalTrendSeries: (Bias | 0)[]
  swingTrendSeries: (Bias | 0)[]
}

interface Pivot {
  current: number
  last: number
  crossed: boolean
  index: number
}

const newPivot = (): Pivot => ({ current: NaN, last: NaN, crossed: false, index: -1 })

export function analyseSmc(candles: Candle[], settings: SmcSettings = SMC_SETTINGS): SmcResult {
  const n = candles.length
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const close = candles.map((c) => c.close)
  const open = candles.map((c) => c.open)

  const atr200 = atr(high, low, close, 200)
  const parsedHigh = high.map((h, i) => (h - low[i] >= 2 * atr200[i] ? low[i] : h))
  const parsedLow = low.map((l, i) => (high[i] - l >= 2 * atr200[i] ? high[i] : l))

  // ta.highest(size) / ta.lowest(size) for each call site's size.
  const extremes = new Map<number, { hi: number[]; lo: number[] }>()
  for (const size of [settings.swingLength, settings.internalLength, settings.equalLength]) {
    if (!extremes.has(size)) extremes.set(size, { hi: highest(high, size), lo: lowest(low, size) })
  }

  const swingHigh = newPivot()
  const swingLow = newPivot()
  const internalHigh = newPivot()
  const internalLow = newPivot()
  const equalHigh = newPivot()
  const equalLow = newPivot()
  // `var leg = 0` per call site, and its value on the previous bar for ta.change.
  const legs = { swing: 0, internal: 0, equal: 0 }
  const prevLegs = { swing: NaN, internal: NaN, equal: NaN }
  // The level each pivot showed on the previous bar, for ta.crossover/crossunder.
  const prevLevel = new Map<Pivot, number>()
  const trend = { swing: 0 as Bias | 0, internal: 0 as Bias | 0 }

  const trailing: SmcTrailing = { top: NaN, bottom: NaN, topIndex: -1, bottomIndex: -1, barIndex: -1 }
  const structures: SmcStructure[] = []
  let internalOBs: SmcOrderBlock[] = []
  let swingOBs: SmcOrderBlock[] = []
  const orderBlockHistory: SmcOrderBlock[] = []
  let gaps: SmcGap[] = []
  const equals: SmcEqual[] = []
  const internalTrendSeries: (Bias | 0)[] = []
  const swingTrendSeries: (Bias | 0)[] = []

  let cumDelta = 0

  for (let i = 0; i < n; i++) {
    // ── updateTrailingExtremes ─────────────────────────────────────────────
    // math.max(high, na) is na in Pine, so nothing trails until a swing sets it.
    if (Number.isFinite(trailing.top)) {
      if (high[i] >= trailing.top) {
        trailing.top = high[i]
        trailing.topIndex = i
      }
    }
    if (Number.isFinite(trailing.bottom)) {
      if (low[i] <= trailing.bottom) {
        trailing.bottom = low[i]
        trailing.bottomIndex = i
      }
    }

    // ── deleteFairValueGaps (runs before this bar's new gaps) ──────────────
    gaps = gaps.filter(
      (g) => !((g.bias === 1 && low[i] < g.bottom) || (g.bias === -1 && high[i] > g.top)),
    )

    // ── getCurrentStructure × 3: swing, internal, equal ────────────────────
    const structure = (size: number, kind: 'swing' | 'internal' | 'equal') => {
      const { hi, lo } = extremes.get(size)!
      if (i >= size) {
        const newLegHigh = high[i - size] > hi[i]
        const newLegLow = low[i - size] < lo[i]
        if (newLegHigh) legs[kind] = 0
        else if (newLegLow) legs[kind] = 1
      }
      const change = legs[kind] - prevLegs[kind]
      prevLegs[kind] = legs[kind]
      if (!Number.isFinite(change) || change === 0) return

      const at = i - size
      if (change === 1) {
        // Start of a bullish leg: the bar `size` ago was a swing low.
        const p = kind === 'equal' ? equalLow : kind === 'internal' ? internalLow : swingLow
        if (
          kind === 'equal' &&
          Math.abs(p.current - low[at]) < settings.equalThreshold * atr200[i]
        ) {
          equals.push({ kind: 'EQL', fromIndex: p.index, toIndex: at, fromPrice: p.current, price: low[at], confirmedAt: i })
        }
        p.last = p.current
        p.current = low[at]
        p.crossed = false
        p.index = at
        if (kind === 'swing') {
          trailing.bottom = p.current
          trailing.barIndex = at
          trailing.bottomIndex = at
        }
      } else {
        const p = kind === 'equal' ? equalHigh : kind === 'internal' ? internalHigh : swingHigh
        if (
          kind === 'equal' &&
          Math.abs(p.current - high[at]) < settings.equalThreshold * atr200[i]
        ) {
          equals.push({ kind: 'EQH', fromIndex: p.index, toIndex: at, fromPrice: p.current, price: high[at], confirmedAt: i })
        }
        p.last = p.current
        p.current = high[at]
        p.crossed = false
        p.index = at
        if (kind === 'swing') {
          trailing.top = p.current
          trailing.barIndex = at
          trailing.topIndex = at
        }
      }
    }
    structure(settings.swingLength, 'swing')
    structure(settings.internalLength, 'internal')
    structure(settings.equalLength, 'equal')

    // ── displayStructure(internal) then displayStructure(swing) ────────────
    const storeOrderBlock = (p: Pivot, scale: Scale, bias: Bias) => {
      if (p.index < 0 || p.index >= i) return
      let idx = p.index
      for (let k = p.index; k < i; k++) {
        if (bias === -1 ? parsedHigh[k] > parsedHigh[idx] : parsedLow[k] < parsedLow[idx]) idx = k
      }
      const block: SmcOrderBlock = {
        bias,
        scale,
        barHigh: parsedHigh[idx],
        barLow: parsedLow[idx],
        index: idx,
        createdAt: i,
      }
      const list = scale === 'internal' ? internalOBs : swingOBs
      orderBlockHistory.push(block)
      list.unshift(block)
      if (list.length > 100) list.pop()
    }

    const display = (scale: Scale) => {
      const internal = scale === 'internal'
      const tr = internal ? 'internal' : 'swing'

      const up = internal ? internalHigh : swingHigh
      const upExtra = internal ? internalHigh.current !== swingHigh.current : true
      const prevUp = prevLevel.get(up) ?? NaN
      const crossover = i > 0 && close[i] > up.current && close[i - 1] <= prevUp
      if (crossover && !up.crossed && upExtra) {
        structures.push({
          kind: trend[tr] === -1 ? 'CHoCH' : 'BOS',
          bias: 1,
          scale,
          pivotIndex: up.index,
          price: up.current,
          index: i,
          protectedLevel: (internal ? internalLow : swingLow).current,
          impulseExtreme: Math.max(...high.slice(up.index, i + 1)),
        })
        up.crossed = true
        trend[tr] = 1
        storeOrderBlock(up, scale, 1)
      }

      const down = internal ? internalLow : swingLow
      const downExtra = internal ? internalLow.current !== swingLow.current : true
      const prevDown = prevLevel.get(down) ?? NaN
      const crossunder = i > 0 && close[i] < down.current && close[i - 1] >= prevDown
      if (crossunder && !down.crossed && downExtra) {
        structures.push({
          kind: trend[tr] === 1 ? 'CHoCH' : 'BOS',
          bias: -1,
          scale,
          pivotIndex: down.index,
          price: down.current,
          index: i,
          protectedLevel: (internal ? internalHigh : swingHigh).current,
          impulseExtreme: Math.min(...low.slice(down.index, i + 1)),
        })
        down.crossed = true
        trend[tr] = -1
        storeOrderBlock(down, scale, -1)
      }
    }
    display('internal')
    display('swing')
    for (const p of [internalHigh, internalLow, swingHigh, swingLow]) prevLevel.set(p, p.current)

    // ── deleteOrderBlocks ──────────────────────────────────────────────────
    const bearSrc = settings.orderBlockMitigation === 'close' ? close[i] : high[i]
    const bullSrc = settings.orderBlockMitigation === 'close' ? close[i] : low[i]
    const alive = (b: SmcOrderBlock) => {
      const gone = (b.bias === -1 && bearSrc > b.barHigh) || (b.bias === 1 && bullSrc < b.barLow)
      if (gone && b.mitigatedAt === undefined) b.mitigatedAt = i
      return !gone
    }
    internalOBs = internalOBs.filter(alive)
    swingOBs = swingOBs.filter(alive)

    // ── drawFairValueGaps, on the chart's own timeframe ────────────────────
    if (i >= 2) {
      const delta = (close[i - 1] - open[i - 1]) / (open[i - 1] * 100)
      cumDelta += Math.abs(delta)
      // ta.cum(...) / bar_index * 2 — bar_index is i, so bar 0 would divide by 0.
      const threshold = settings.gapAutoThreshold ? (cumDelta / i) * 2 : 0
      if (low[i] > high[i - 2] && close[i - 1] > high[i - 2] && delta > threshold) {
        gaps.unshift({ bias: 1, top: low[i], bottom: high[i - 2], index: i - 1, createdAt: i })
      }
      if (high[i] < low[i - 2] && close[i - 1] < low[i - 2] && -delta > threshold) {
        gaps.unshift({ bias: -1, top: high[i], bottom: low[i - 2], index: i - 1, createdAt: i })
      }
    } else if (i === 1) {
      // Bars 0 and 1 still feed ta.cum, even though no gap can form yet.
      cumDelta += Math.abs((close[0] - open[0]) / (open[0] * 100))
    }

    internalTrendSeries.push(trend.internal)
    swingTrendSeries.push(trend.swing)
  }

  return {
    structures,
    internalOrderBlocks: internalOBs,
    swingOrderBlocks: swingOBs,
    orderBlockHistory,
    gaps,
    equals,
    swingTrend: trend.swing,
    internalTrend: trend.internal,
    trailing,
    internalTrendSeries,
    swingTrendSeries,
  }
}
