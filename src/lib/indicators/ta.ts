/**
 * Technical-analysis primitives, ported to match Pine Script exactly.
 *
 * The seeding rules matter: Pine warms both `ta.ema` and `ta.rma` with an SMA
 * of the first `length` values and emits NaN before that. Starting from the
 * first value instead (as many JS libraries do) shifts every downstream number,
 * which would quietly move signals to different candles.
 *
 * Series are oldest-first. Output arrays always match the input length, with
 * NaN where Pine would have `na`.
 */

/** `ta.sma` */
export function sma(values: number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= length) sum -= values[i - length]
    if (i >= length - 1) out[i] = sum / length
  }
  return out
}

/**
 * `ta.ema` — alpha = 2 / (length + 1), seeded with the SMA of the first
 * `length` values.
 */
export function ema(values: number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  if (values.length < length) return out

  const alpha = 2 / (length + 1)
  let seed = 0
  for (let i = 0; i < length; i++) seed += values[i]
  out[length - 1] = seed / length

  for (let i = length; i < values.length; i++) {
    out[i] = alpha * values[i] + (1 - alpha) * out[i - 1]
  }
  return out
}

/**
 * `ta.rma` — Wilder's smoothing, alpha = 1 / length. This is what `ta.atr` and
 * `ta.rsi` are built on, and it is NOT the same as an EMA of the same length.
 */
export function rma(values: number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  if (values.length < length) return out

  const alpha = 1 / length
  let seed = 0
  for (let i = 0; i < length; i++) seed += values[i]
  out[length - 1] = seed / length

  for (let i = length; i < values.length; i++) {
    out[i] = alpha * values[i] + (1 - alpha) * out[i - 1]
  }
  return out
}

/** `ta.tr(true)` — the first bar falls back to high − low. */
export function trueRange(high: number[], low: number[], close: number[]): number[] {
  return high.map((h, i) => {
    if (i === 0) return h - low[i]
    const prev = close[i - 1]
    return Math.max(h - low[i], Math.abs(h - prev), Math.abs(low[i] - prev))
  })
}

/** `ta.atr` */
export function atr(high: number[], low: number[], close: number[], length: number): number[] {
  return rma(trueRange(high, low, close), length)
}

/** `ta.rsi` — Wilder's, using RMA of gains and losses. */
export function rsi(values: number[], length: number): number[] {
  const gains = new Array<number>(values.length).fill(0)
  const losses = new Array<number>(values.length).fill(0)

  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1]
    gains[i] = Math.max(change, 0)
    losses[i] = Math.max(-change, 0)
  }

  // Pine's rsi effectively starts the RMA at index 1, so the first change is
  // included in the seed window rather than the index-0 zero.
  const avgGain = rma(gains.slice(1), length)
  const avgLoss = rma(losses.slice(1), length)

  const out = new Array<number>(values.length).fill(NaN)
  for (let i = 0; i < avgGain.length; i++) {
    const g = avgGain[i]
    const l = avgLoss[i]
    if (Number.isNaN(g) || Number.isNaN(l)) continue
    // A zero average loss means unbroken gains: RSI 100 (and 50 if both are 0).
    out[i + 1] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l)
  }
  return out
}

/** `ta.lowest(source, length)` — rolling minimum over the last `length` bars. */
export function lowest(values: number[], length: number): number[] {
  return values.map((_, i) =>
    i < length - 1 ? NaN : Math.min(...values.slice(i - length + 1, i + 1)),
  )
}

/** `ta.highest(source, length)` */
export function highest(values: number[], length: number): number[] {
  return values.map((_, i) =>
    i < length - 1 ? NaN : Math.max(...values.slice(i - length + 1, i + 1)),
  )
}
