import { ratio } from './format'
import { ema } from './indicators/ta'
import type { Candle, SignalSide } from './indicators/types'

/**
 * What was true when a trend signal entered: the volume of its candle, which side
 * of its own EMA 200 BTC stood on, and whether the candle closed at a weekend.
 *
 * This is the one definition. The Screener's cards print it, the server's
 * tracking ledger stores it with every signal and Claude's text quotes it — and
 * `npm run improve` measured it with this very file, so the figure behind each
 * tag is the figure of the thing the tag shows. Nothing here is a signal: the
 * measurement says which entries of an existing strategy paid more, not that
 * any of them is worth taking on its own.
 */

/** A 4 h candle, the grid BTC's regime is read on whatever the bar of the entry. */
export const REGIME_BAR_MS = 4 * 3_600_000
/** The EMA BTC is measured against. */
export const REGIME_LENGTH = 200
/** The volume the heavier half of the entries had, against the mean of the 20 candles before. */
export const HIGH_VOLUME = 1.5
/** Candles the volume is averaged over, the entry candle excluded. */
export const VOLUME_WINDOW = 20

/**
 * Volume of candle `i` over the mean of the `VOLUME_WINDOW` before it. NaN when
 * there is not that much history, a volume is missing or the mean is zero —
 * freshly listed contracts open with frozen candles.
 */
export function volumeRatio(candles: Pick<Candle, 'vol'>[], i: number): number {
  if (i < VOLUME_WINDOW || i >= candles.length) return NaN
  let sum = 0
  for (let k = i - VOLUME_WINDOW; k < i; k++) {
    const v = candles[k].vol
    if (v === undefined || !Number.isFinite(v)) return NaN
    sum += v
  }
  const mean = sum / VOLUME_WINDOW
  const v = candles[i].vol
  return mean > 0 && v !== undefined && Number.isFinite(v) ? v / mean : NaN
}

export interface BtcRegime {
  /**
   * Whether BTC's last 4 h candle that had closed by `time` closed above its EMA
   * 200. `null` while the EMA has not settled (three of its lengths of history)
   * or before the first candle.
   */
  aboveAt(time: number): boolean | null
  /** The newest closed candle's reading. */
  latest: { above: boolean | null; close: number; ema: number; at: number }
  /** Since when BTC has been on that side: the close time of the first candle of the run. null if unknown. */
  since: number | null
  /** Closed candles the reading rests on. */
  bars: number
}

/**
 * BTC's regime from its closed 4 h candles, oldest first. Whichever bar a signal
 * came from, the side is read on this series — 1 h entries use the 4 h EMA 200
 * in force when they entered, not an 800-candle average of their own bar.
 */
export function btcRegime(candles: Candle[], barMs = REGIME_BAR_MS, length = REGIME_LENGTH): BtcRegime {
  const closed = candles.filter((c) => c.confirmed !== false)
  const line = ema(
    closed.map((c) => c.close),
    length,
  )
  const settled = length * 3 - 1
  const above = (i: number): boolean | null =>
    i >= settled && Number.isFinite(line[i]) ? closed[i].close > line[i] : null

  const aboveAt = (time: number): boolean | null => {
    // Binary search: the last candle whose close time is at or before `time`.
    let lo = 0
    let hi = closed.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (closed[mid].time + barMs <= time) lo = mid + 1
      else hi = mid
    }
    return lo === 0 ? null : above(lo - 1)
  }

  const last = closed.length - 1
  const side = last >= 0 ? above(last) : null
  let since: number | null = null
  if (side !== null) {
    let k = last
    while (k > settled && above(k - 1) === side) k--
    // The run reaches the first settled candle: it is older than the history can say.
    since = k > settled ? closed[k].time + barMs : null
  }
  return {
    aboveAt,
    latest: {
      above: side,
      close: last >= 0 ? closed[last].close : NaN,
      ema: last >= 0 ? line[last] : NaN,
      at: last >= 0 ? closed[last].time + barMs : NaN,
    },
    since,
    bars: closed.length,
  }
}

/** Closed 4 h candles BTC needs before its EMA has settled: the SMA seed is gone after three lengths. */
export const REGIME_MIN_BARS = REGIME_LENGTH * 3

export interface EntryContext {
  /** Entry candle's volume against the mean of the 20 before it. NaN when unknown. */
  volume: number
  /** BTC above its 4 h EMA 200 when the entry closed. null when the history cannot say. */
  btcAbove: boolean | null
  /** The entry candle closed on a Saturday or a Sunday (UTC). */
  weekend: boolean
}

/** A candle that closes at `closeMs` is a weekend one if that instant falls on a Saturday or Sunday UTC. */
export function closesAtWeekend(closeMs: number): boolean {
  const day = new Date(closeMs).getUTCDay()
  return day === 0 || day === 6
}

/**
 * The context of an entry made at the close of `candles[index]`. `regime` is
 * BTC's, read once per scan; without it `btcAbove` is null.
 */
export function entryContext(
  candles: Pick<Candle, 'time' | 'vol'>[],
  index: number,
  barMs: number,
  regime?: BtcRegime | null,
): EntryContext {
  const closeMs = candles[index].time + barMs
  return {
    volume: volumeRatio(candles, index),
    btcAbove: regime ? regime.aboveAt(closeMs) : null,
    weekend: closesAtWeekend(closeMs),
  }
}

/**
 * Whether the entry goes with BTC's regime: a long with BTC above its EMA, a
 * short with BTC below. The measurement found it matters for longs only; for
 * shorts it separated nothing, which `contextTags` says instead of colouring it.
 */
export function withRegime(side: SignalSide, btcAbove: boolean | null): boolean | null {
  if (btcAbove === null) return null
  return side === 'long' ? btcAbove : !btcAbove
}

// ── what was measured ────────────────────────────────────────────────────────

/** Mean net R per trade (n) of the two halves a filter splits a strategy into. */
interface Split {
  with: number
  without: number
  nWith: number
  nWithout: number
}

export interface ContextEvidence {
  /** Where the figures come from, as a sentence fragment. */
  sample: string
  /** The entry candle's volume at or above `HIGH_VOLUME` against below. */
  volume: Split
  /** Longs with BTC above its 4 h EMA 200 against longs with it below. */
  longs: Split
  /** Shorts with BTC below against above: the regime separated nothing for them. */
  shorts: Split
  /** Entries whose candle closed at a weekend against the rest. */
  weekend: { with: number; without: number; nWith: number; nWithout: number }
}

/**
 * Every figure the tags and the "?" quote, per strategy and bar. 30 coins' 4 h
 * (or 1 h), 2022–2026, net R after a 0.1 % round trip. `npm run improve` prints
 * them and exits non-zero when they drift.
 */
export const CONTEXT_EVIDENCE: Record<string, ContextEvidence> = {
  'donchian/trend@4H': {
    sample: '30 criptos, 4 h, 2022–2026',
    volume: { with: 0.51, without: 0.09, nWith: 2099, nWithout: 1188 },
    longs: { with: 0.74, without: 0.13, nWith: 1235, nWithout: 348 },
    shorts: { with: 0.0, without: 0.29, nWith: 1015, nWithout: 689 },
    weekend: { with: 0.09, without: 0.4, nWith: 516, nWithout: 2771 },
  },
  'ema200/base@4H': {
    sample: '30 criptos, 4 h, 2022–2026',
    volume: { with: 0.37, without: 0.09, nWith: 2292, nWithout: 4440 },
    longs: { with: 0.39, without: 0.04, nWith: 2400, nWithout: 957 },
    shorts: { with: 0.03, without: 0.12, nWith: 1329, nWithout: 2046 },
    weekend: { with: 0.08, without: 0.22, nWith: 1430, nWithout: 5302 },
  },
  // The plain breakout, without the EMA 200 filter: it takes longs below the average too, which
  // is why its longs split so clearly by BTC's regime.
  'donchian/fast@4H': {
    sample: '30 criptos, 4 h, 2022–2026',
    volume: { with: 0.28, without: 0.11, nWith: 3154, nWithout: 2377 },
    longs: { with: 0.51, without: 0.08, nWith: 1600, nWithout: 1127 },
    shorts: { with: 0.06, without: 0.06, nWith: 1326, nWithout: 1276 },
    weekend: { with: 0.04, without: 0.24, nWith: 942, nWithout: 4589 },
  },
  // 1 h entries read BTC's regime on its 4 h EMA 200 too (the one in force when they entered).
  'donchian/trend@1H': {
    sample: '30 criptos, 1 h, 2022–2026',
    volume: { with: 0.15, without: 0.09, nWith: 9840, nWithout: 5052 },
    longs: { with: 0.46, without: -0.02, nWith: 3951, nWithout: 3018 },
    shorts: { with: -0.03, without: 0.06, nWith: 3792, nWithout: 3798 },
    weekend: { with: -0.13, without: 0.21, nWith: 3394, nWithout: 11498 },
  },
}

/** A strategy and bar's key in `CONTEXT_EVIDENCE` and in the ledger. */
export const trackKey = (strategy: string, preset: string, bar: string) => `${strategy}/${preset}@${bar}`

export interface ContextTag {
  key: 'btc' | 'volume' | 'weekend'
  label: string
  /** `warn` is the side of the split that measured worse; never a green or a red. */
  tone: 'neutral' | 'warn'
  /** What was measured, for the tooltip and the text. */
  note: string
}

const signedR = (x: number) => `${x >= 0 ? '+' : '−'}${ratio(Math.abs(x))}`
const times = (x: number) => `${ratio(x, 1)}×`

/**
 * The tags a row or a signal carries. `volumePending` marks a candle still in
 * progress: its volume is partial and not comparable with finished ones.
 */
export function contextTags(
  ctx: Partial<EntryContext>,
  side: SignalSide,
  key: string,
  opts: { volumePending?: boolean } = {},
): ContextTag[] {
  const ev = CONTEXT_EVIDENCE[key]
  const tags: ContextTag[] = []

  if (ctx.btcAbove !== undefined && ctx.btcAbove !== null) {
    const above = ctx.btcAbove
    const label = `BTC ${above ? 'sobre' : 'bajo'} su EMA 200`
    if (side === 'long') {
      tags.push({
        key: 'btc',
        label,
        // Only a measured strategy gets a verdict: for the rest the side is a fact, not a warning.
        tone: ev && !above ? 'warn' : 'neutral',
        note: ev
          ? `Los longs de esta estrategia con BTC sobre su EMA 200 de 4 h midieron ${signedR(ev.longs.with)} R (${ev.longs.nWith} operaciones) y con BTC debajo ${signedR(ev.longs.without)} R (${ev.longs.nWithout}); ${ev.sample}. Es contexto, no una señal.`
          : 'Régimen de BTC en el momento de la entrada: contexto, sin medición propia para esta estrategia.',
      })
    } else {
      tags.push({
        key: 'btc',
        label,
        tone: 'neutral',
        note: ev
          ? `En los shorts el régimen de BTC no separó nada: con BTC debajo ${signedR(ev.shorts.with)} R (${ev.shorts.nWith}), con BTC encima ${signedR(ev.shorts.without)} R (${ev.shorts.nWithout}); ${ev.sample}.`
          : 'Régimen de BTC en el momento de la entrada: contexto, sin medición propia para esta estrategia.',
      })
    }
  }

  if (opts.volumePending) {
    tags.push({
      key: 'volume',
      label: 'Volumen: vela en curso',
      tone: 'neutral',
      note: 'El volumen de una vela sin cerrar es parcial y no se compara con el de las cerradas.',
    })
  } else if (ctx.volume !== undefined && Number.isFinite(ctx.volume)) {
    const heavy = ctx.volume >= HIGH_VOLUME
    tags.push({
      key: 'volume',
      label: `Volumen ${times(ctx.volume)}`,
      tone: heavy || !ev ? 'neutral' : 'warn',
      note: ev
        ? `Con la vela de entrada a ${times(HIGH_VOLUME)} o más el volumen medio de las 20 anteriores, esta estrategia midió ${signedR(ev.volume.with)} R por operación (${ev.volume.nWith}); con menos, ${signedR(ev.volume.without)} R (${ev.volume.nWithout}); ${ev.sample}.`
        : 'Volumen de la vela de entrada frente a la media de las 20 anteriores: sin medición propia para esta estrategia.',
    })
  }

  if (ctx.weekend) {
    tags.push({
      key: 'weekend',
      label: 'Cierra en fin de semana',
      tone: ev ? 'warn' : 'neutral',
      note: ev
        ? `Las entradas cuya vela cierra en sábado o domingo (UTC) midieron ${signedR(ev.weekend.with)} R (${ev.weekend.nWith}) frente a ${signedR(ev.weekend.without)} R (${ev.weekend.nWithout}) el resto de la semana; ${ev.sample}.`
        : 'La vela cierra en sábado o domingo (UTC).',
    })
  }
  return tags
}

/** The tags as one line for a text (Claude, a notification). */
export function contextLine(tags: ContextTag[]): string {
  return tags.map((t) => t.label).join(' · ')
}
