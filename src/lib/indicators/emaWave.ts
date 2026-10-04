import { atr, ema } from './ta'
import { feeInR, summarise, type Candle, type StrategyResult, type StrategySignal } from './types'

/**
 * EMA Wave Indicator [LazyBear] — TradingView, ported for measurement.
 *
 * Three histograms of how far price (hlc3) sits from its EMA 5, 25 and 50,
 * each smoothed by an SMA 4: waves A, B and C. An optional flag marks
 * "spikes/exhaustions" where one wave is more than ten times the faster one
 * (`wc/wb > 10`, `wb/wa > 10`).
 *
 * **The script has no trading rules** — it plots and colours bars. So the two
 * readings measured here are choices, written down before measuring:
 *
 *   · alineación — the way the histograms are read: long on the bar all three
 *     waves turn positive, short on the bar all three turn negative; out at a
 *     2 ATR stop or on the opposite alignment, which opens the other side.
 *   · agotamiento — the script's own spike flag, faded: a spike while the
 *     waves are positive is a short, while negative a long; 2 ATR stop, 2 R
 *     target.
 *
 * Entry at the signal bar's close; management from the next bar, stop first.
 */

export interface EmaWaveSettings {
  aLen: number
  bLen: number
  cLen: number
  smooth: number
  cutoff: number
  mode: 'alineacion' | 'agotamiento' | 'alineacion-rota'
  stopAtr: number
  targetR: number
  feeRate: number
}

export const EMA_WAVE_SETTINGS: EmaWaveSettings = {
  aLen: 5,
  bLen: 25,
  cLen: 50,
  smooth: 4,
  cutoff: 10,
  mode: 'alineacion',
  stopAtr: 2,
  targetR: 0,
  feeRate: 0.001,
}

/** `ta.sma` over a series with a leading run of NaN, as Pine handles `na`. */
function smaFrom(values: number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  for (let i = length - 1; i < values.length; i++) {
    let sum = 0
    for (let k = i - length + 1; k <= i; k++) sum += values[k]
    out[i] = sum / length
  }
  return out
}

export function analyseEmaWave(candles: Candle[], settings: EmaWaveSettings = EMA_WAVE_SETTINGS): StrategyResult {
  const { aLen, bLen, cLen, smooth, cutoff, mode, stopAtr, targetR, feeRate } = settings
  const src = candles.map((c) => (c.high + c.low + c.close) / 3)
  const wave = (len: number) => {
    const line = ema(src, len)
    return smaFrom(
      src.map((v, i) => v - line[i]),
      smooth,
    )
  }
  const wa = wave(aLen)
  const wb = wave(bLen)
  const wc = wave(cLen)
  const unit = atr(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    candles.map((c) => c.close),
    14,
  )
  // Three lengths of the slowest EMA, as for every EMA the app draws.
  const warmup = cLen * 3

  const up = (i: number) => wa[i] > 0 && wb[i] > 0 && wc[i] > 0
  const down = (i: number) => wa[i] < 0 && wb[i] < 0 && wc[i] < 0
  const spike = (i: number) => {
    const c = wb[i] !== 0 && wc[i] / wb[i] > cutoff
    const b = wa[i] !== 0 && wb[i] / wa[i] > cutoff
    return c || b
  }

  const signals: StrategySignal[] = []
  let open: { signal: StrategySignal; risk: number } | null = null

  const exit = (price: number, i: number) => {
    if (!open) return
    const { signal, risk } = open
    signal.resultR = (signal.side === 'long' ? price - signal.entry : signal.entry - price) / risk
    signal.outcome = signal.resultR > 0 ? 'win' : 'loss'
    signal.closedIndex = i
    signal.closedTime = candles[i].time
    signal.closedPrice = price
    open = null
  }

  for (let i = 1; i < candles.length; i++) {
    const b = candles[i]
    const ready = Number.isFinite(wc[i]) && Number.isFinite(wc[i - 1])

    // Manage against this bar: stop first, then target or the rule's exit.
    if (open) {
      const s = open.signal
      const long = s.side === 'long'
      if (long ? b.low <= s.stop : b.high >= s.stop) exit(s.stop, i)
      else if (s.target !== undefined && (long ? b.high >= s.target : b.low <= s.target)) exit(s.target, i)
      else if (ready && mode === 'alineacion' && (long ? down(i) : up(i))) exit(b.close, i)
      else if (ready && mode === 'alineacion-rota' && (long ? !up(i) : !down(i))) exit(b.close, i)
    }
    if (open || i < warmup || !ready || !(unit[i] > 0)) continue

    let side: 'long' | 'short' | null = null
    let note = ''
    if (mode === 'agotamiento') {
      if (spike(i) && !spike(i - 1)) {
        side = wb[i] > 0 ? 'short' : 'long'
        note = `agotamiento ${wb[i] > 0 ? 'alcista' : 'bajista'}`
      }
    } else if (up(i) && !up(i - 1)) {
      side = 'long'
      note = 'tres ondas sobre cero'
    } else if (down(i) && !down(i - 1)) {
      side = 'short'
      note = 'tres ondas bajo cero'
    }
    if (!side) continue

    const entry = b.close
    const stop = side === 'long' ? entry - stopAtr * unit[i] : entry + stopAtr * unit[i]
    // Freshly listed contracts open with frozen bars: a stop that close is untradeable.
    if (feeInR(entry, stop, feeRate) > 1) continue
    const risk = Math.abs(entry - stop)
    const signal: StrategySignal = {
      index: i,
      time: b.time,
      side,
      entry,
      stop,
      target: targetR ? (side === 'long' ? entry + targetR * risk : entry - targetR * risk) : undefined,
      riskReward: targetR || undefined,
      outcome: 'open',
      feeR: feeInR(entry, stop, feeRate),
      note,
    }
    signals.push(signal)
    open = { signal, risk }
  }

  const live = open as { signal: StrategySignal } | null
  return summarise(signals, [], warmup, live ? live.signal : null)
}

/** Reading 2: the script's spike flag, faded, with a 2 R target. */
export const analyseEmaWaveExhaustion = (c: Candle[]) =>
  analyseEmaWave(c, { ...EMA_WAVE_SETTINGS, mode: 'agotamiento', targetR: 2 })

/** Variant of reading 1: out as soon as the alignment breaks, not on the opposite one. */
export const analyseEmaWaveBreak = (c: Candle[]) => analyseEmaWave(c, { ...EMA_WAVE_SETTINGS, mode: 'alineacion-rota' })
