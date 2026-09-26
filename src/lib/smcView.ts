import type { SmcResult } from './indicators/smc'
import type { Candle, ChartAnnotations, ChartSegment, ChartZone } from './indicators/types'

/**
 * How Smart Money Concepts is drawn in the Análisis tab.
 *
 * It follows the original's defaults — internal and swing structure, the five
 * most recent internal order blocks, equal highs and lows, strong and weak
 * high/low — with fair value gaps behind their own toggle, since the original
 * ships them off.
 *
 * Colours: bullish and bearish structure in the app's up/down pair, as LuxAlgo
 * uses green and red; internal order blocks in the categorical blue and pink
 * (`--series-1`, `--series-5`), the same hues the original gives them, so they
 * are never mistaken for a structure line. One deliberate change: gaps run to
 * the right edge while unfilled. The original draws them three bars wide,
 * which on a 200-bar chart is a sliver.
 */

const BULL = 'var(--good)'
const BEAR = 'var(--critical)'
const OB_BULL = 'var(--series-1)'
const OB_BEAR = 'var(--series-5)'

/** The original draws the first five of each list. */
const ORDER_BLOCKS_SHOWN = 5

export function smcAnnotations(
  r: SmcResult,
  candles: Candle[],
  start: number,
  { gaps }: { gaps: boolean },
): ChartAnnotations {
  const last = candles.length - 1
  const segments: ChartSegment[] = []
  const zones: ChartZone[] = []

  for (const s of r.structures) {
    if (s.index < start) continue
    segments.push({
      key: `st-${s.scale}-${s.index}-${s.bias}`,
      i1: s.pivotIndex,
      i2: s.index,
      price: s.price,
      colour: s.bias > 0 ? BULL : BEAR,
      dashed: s.scale === 'internal',
      label: s.kind,
      labelBelow: s.bias < 0,
    })
  }

  for (const e of r.equals) {
    if (e.toIndex < start) continue
    segments.push({
      key: `eq-${e.kind}-${e.toIndex}`,
      i1: e.fromIndex,
      i2: e.toIndex,
      price: e.price,
      colour: e.kind === 'EQH' ? BEAR : BULL,
      dashed: true,
      label: e.kind,
      labelBelow: e.kind === 'EQL',
    })
  }

  // Strong / weak high and low: whichever side the swing trend is expected to
  // break is "weak". Drawn from the extreme to the right edge.
  const t = r.trailing
  if (Number.isFinite(t.top) && t.topIndex >= 0) {
    segments.push({
      key: 'trail-top',
      i1: t.topIndex,
      i2: last,
      price: t.top,
      colour: BEAR,
      label: r.swingTrend === -1 ? 'Máx. fuerte' : 'Máx. débil',
    })
  }
  if (Number.isFinite(t.bottom) && t.bottomIndex >= 0) {
    segments.push({
      key: 'trail-bottom',
      i1: t.bottomIndex,
      i2: last,
      price: t.bottom,
      colour: BULL,
      label: r.swingTrend === 1 ? 'Mín. fuerte' : 'Mín. débil',
      labelBelow: true,
    })
  }

  for (const b of r.internalOrderBlocks.slice(0, ORDER_BLOCKS_SHOWN)) {
    zones.push({
      key: `ob-${b.index}-${b.createdAt}-${b.bias}`,
      i1: b.index,
      top: b.barHigh,
      bottom: b.barLow,
      colour: b.bias > 0 ? OB_BULL : OB_BEAR,
      opacity: 0.2,
      label: 'OB',
    })
  }

  if (gaps) {
    for (const g of r.gaps) {
      zones.push({
        key: `fvg-${g.createdAt}-${g.bias}`,
        i1: g.index,
        top: g.top,
        bottom: g.bottom,
        colour: g.bias > 0 ? BULL : BEAR,
        opacity: 0.14,
        label: 'FVG',
      })
    }
  }

  const legend: ChartAnnotations['legend'] = [
    { key: 'swing', label: 'Estructura principal', colour: 'var(--ink-secondary)', kind: 'line' },
    { key: 'internal', label: 'Interna', colour: 'var(--ink-secondary)', kind: 'dashed' },
    { key: 'ob-bull', label: 'OB alcista', colour: OB_BULL, kind: 'zone' },
    { key: 'ob-bear', label: 'OB bajista', colour: OB_BEAR, kind: 'zone' },
  ]
  if (gaps) {
    legend.push({ key: 'fvg-bull', label: 'FVG alcista', colour: BULL, kind: 'zone' })
    legend.push({ key: 'fvg-bear', label: 'FVG bajista', colour: BEAR, kind: 'zone' })
  }

  return { segments, zones, legend }
}

export interface SmcReading {
  swing: { trend: 1 | -1 | 0; kind?: 'BOS' | 'CHoCH'; time?: number; price?: number }
  internal: { trend: 1 | -1 | 0; kind?: 'BOS' | 'CHoCH'; time?: number; price?: number }
  /** Where the close sits in the trailing swing range, 0 = bottom, 1 = top. */
  rangePosition: number | null
  top: number
  bottom: number
  /** Nearest live internal order block above and below price, as zones. */
  obAbove?: { top: number; bottom: number }
  obBelow?: { top: number; bottom: number }
  gapsUp: number
  gapsDown: number
}

export function smcReading(r: SmcResult, candles: Candle[]): SmcReading {
  const close = candles.at(-1)?.close ?? NaN
  const lastOf = (scale: 'swing' | 'internal') => {
    const s = [...r.structures].reverse().find((x) => x.scale === scale)
    return s ? { kind: s.kind, time: candles[s.index]?.time, price: s.price } : {}
  }
  const { top, bottom } = r.trailing
  const span = top - bottom
  const zonesOf = r.internalOrderBlocks.map((b) => ({
    top: Math.max(b.barHigh, b.barLow),
    bottom: Math.min(b.barHigh, b.barLow),
  }))
  const above = zonesOf.filter((z) => z.bottom > close).sort((a, b) => a.bottom - b.bottom)[0]
  const below = zonesOf.filter((z) => z.top < close).sort((a, b) => b.top - a.top)[0]

  return {
    swing: { trend: r.swingTrend, ...lastOf('swing') },
    internal: { trend: r.internalTrend, ...lastOf('internal') },
    rangePosition: span > 0 && Number.isFinite(close) ? (close - bottom) / span : null,
    top,
    bottom,
    obAbove: above,
    obBelow: below,
    gapsUp: r.gaps.filter((g) => g.bias > 0).length,
    gapsDown: r.gaps.filter((g) => g.bias < 0).length,
  }
}
