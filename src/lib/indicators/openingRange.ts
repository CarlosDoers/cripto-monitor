import { feeInR, summarise, type Candle, type Overlay, type StrategyResult, type StrategySignal } from './types'

/**
 * Opening Range Breakout, anchored to the Wall Street open.
 *
 * The obvious objection is that a 24/7 market has no open. It turns out it has
 * a borrowed one: at 09:30 in New York BTC's volume runs at 1.48× the daily
 * average and the first half hour's range is nearly double the one at UTC
 * midnight. Swept hour by hour across the New York clock over four years and
 * eight months, **09:30 is the only clearly positive hour of the 24** — 08:30
 * measures −0.03 R and 10:30 −0.04 R. It is a narrow spike pinned to the bell,
 * not a diffuse "US session" effect.
 *
 * The anchor cannot be a fixed UTC hour. New York opens at 13:30 UTC in summer
 * and 14:30 in winter, so a fixed anchor sends half the year's signals to the
 * wrong hour and smears the effect until it disappears. Hence `nyAnchorTime()`.
 *
 * Why it survives costs where everything else on 15 m dies: the stop is not an
 * ATR multiple but **the whole opening range**, which at the bell measures
 * ~0.55 % instead of the ~0.25 % typical of this timeframe. Cost in R is
 * `feeRate / (stop distance / price)`, so a wide range halves it. Measured at
 * +0.16 R with a 0.1 % round trip, still positive (+0.08 R) at 0.2 %, dead at
 * 0.3 %. That last number is the one to watch: every entry here is a taker stop
 * order, so slippage is the real risk, not the signal.
 *
 * The volume filter is the "stocks in play" screen of the original paper, where
 * trading only the names with abnormal volume is where nearly all the result
 * comes from. There are no names to screen here, so the demand is that the
 * opening range itself move more volume than its own recent average.
 *
 * Only meaningful on 15 m candles: the range is 30 minutes and it takes that
 * resolution to build it. On any other timeframe `analyseOpeningRange` returns
 * no signals, and the view's own gating blocks it without being told to.
 */

export interface OpeningRangeSettings {
  /** Minute of the day, New York time, at which the market opens. */
  anchorMinuteNY: number
  /** Length of the opening range, in minutes. */
  rangeMinutes: number
  /** How long the position is held before being closed at market. */
  holdHours: number
  /** Minimum range volume against its own average, in multiples. 0 = off. */
  minRelVolume: number
  /** How many previous opens that average is taken over. */
  relVolumeLookback: number
  feeRate: number
}

/**
 * Measured on BTC/ETH/SOL, 15 m, 2022-01 → 2026-09. Varying one parameter at a
 * time — range from 15 to 90 minutes, hold from 6 to 36 hours, volume filter
 * from 1.0 to 2.0, fixed targets of 2 R to 8 R or none — all 21 variants stay
 * positive across both halves of the history. That flat neighbourhood is what
 * separates a real result from having landed on lucky parameters.
 */
export const OPENING_RANGE_SETTINGS: OpeningRangeSettings = {
  anchorMinuteNY: 570, // 09:30
  rangeMinutes: 30,
  holdHours: 24,
  minRelVolume: 1.2,
  relVolumeLookback: 14,
  feeRate: 0.001,
}

/**
 * Every open, with no volume screen. Measured lower per signal than the filtered
 * version but it fires more than three times as often, so it produces more R per
 * year — the same trade the Donchian presets offer between size and frequency.
 */
export const OPENING_RANGE_ALL: OpeningRangeSettings = {
  ...OPENING_RANGE_SETTINGS,
  minRelVolume: 0,
}

const BAR_MS = 900_000 // 15 m
const DAY_MS = 86_400_000

/**
 * New York's offset from UTC in hours at a given instant: −4 on daylight saving
 * time, −5 otherwise.
 */
function nyOffsetHours(ms: number): number {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }).format(new Date(ms)),
  )
  let diff = (hour % 24) - new Date(ms).getUTCHours()
  if (diff > 12) diff -= 24
  if (diff < -12) diff += 24
  return diff
}

/** The UTC instant of the open for a given UTC day. */
function nyAnchorTime(dayStart: number, anchorMinuteNY: number): number {
  // Resolved at midday so the lookup never lands inside the clock change itself.
  const offset = nyOffsetHours(dayStart + DAY_MS / 2)
  return dayStart + (anchorMinuteNY - offset * 60) * 60_000
}

interface OpeningRange {
  dayStart: number
  /** Index of the first candle of the range. */
  start: number
  /** How many candles the range spans. */
  length: number
  high: number
  low: number
  volume: number
  /** Volume against the average of previous opens; null for the first one. */
  relVolume: number | null
}

/** The real spacing between candles, used to reject anything but 15 m. */
function barSpacing(candles: Candle[]): number {
  if (candles.length < 3) return 0
  const diffs: number[] = []
  for (let i = 1; i < Math.min(candles.length, 50); i++) diffs.push(candles[i].time - candles[i - 1].time)
  diffs.sort((a, b) => a - b)
  return diffs[Math.floor(diffs.length / 2)]
}

function buildRanges(candles: Candle[], settings: OpeningRangeSettings): OpeningRange[] {
  const { anchorMinuteNY, rangeMinutes, relVolumeLookback } = settings
  const byTime = new Map<number, number>()
  candles.forEach((c, i) => byTime.set(c.time, i))

  const days = [...new Set(candles.map((c) => Math.floor(c.time / DAY_MS) * DAY_MS))].sort((a, b) => a - b)
  const length = rangeMinutes / 15
  const ranges: OpeningRange[] = []

  for (const dayStart of days) {
    const anchor = nyAnchorTime(dayStart, anchorMinuteNY)
    const start = byTime.get(anchor)
    if (start === undefined || start + length >= candles.length) continue

    const bars = candles.slice(start, start + length)
    if (bars.length < length) continue
    // A hole in the data would quietly turn the range into something else.
    if (bars.some((b, k) => b.time !== anchor + k * BAR_MS)) continue

    const high = Math.max(...bars.map((b) => b.high))
    const low = Math.min(...bars.map((b) => b.low))
    if (!(high > low)) continue

    ranges.push({
      dayStart,
      start,
      length,
      high,
      low,
      volume: bars.reduce((sum, b) => sum + (b.vol ?? 0), 0),
      relVolume: null,
    })
  }

  // Relative volume looks strictly backwards: including the current day in its
  // own average would be reading the future.
  for (let i = 0; i < ranges.length; i++) {
    const prev = ranges.slice(Math.max(0, i - relVolumeLookback), i)
    const avg = prev.length ? prev.reduce((sum, r) => sum + r.volume, 0) / prev.length : 0
    ranges[i].relVolume = avg > 0 ? ranges[i].volume / avg : null
  }
  return ranges
}

export function analyseOpeningRange(
  candles: Candle[],
  settings: OpeningRangeSettings = OPENING_RANGE_SETTINGS,
): StrategyResult {
  const { rangeMinutes, holdHours, minRelVolume, feeRate } = settings

  // The range is 30 minutes: without 15 m candles there is nothing to build.
  if (barSpacing(candles) !== BAR_MS) return summarise([], [], candles.length, null)

  const ranges = buildRanges(candles, settings)
  const holdBars = (holdHours * 60) / 15
  const signals: StrategySignal[] = []

  // The range lines are drawn from the moment the range is fixed until the
  // window closes, so the chart shows the level that was being watched.
  const orHigh = new Array<number>(candles.length).fill(NaN)
  const orLow = new Array<number>(candles.length).fill(NaN)

  for (const range of ranges) {
    const first = range.start + range.length
    const end = Math.min(candles.length, first + holdBars)
    // The last window of a live history is usually still running. Closing it
    // just because the data ends would turn an open trade into a result.
    const complete = first + holdBars <= candles.length

    for (let i = first; i < end; i++) {
      orHigh[i] = range.high
      orLow[i] = range.low
    }

    if (minRelVolume && !(range.relVolume !== null && range.relVolume >= minRelVolume)) continue

    let signal: StrategySignal | null = null
    let risk = 0

    for (let i = first; i < end; i++) {
      const bar = candles[i]

      if (!signal) {
        const up = bar.high >= range.high
        const down = bar.low <= range.low
        // Both sides in one candle: there is no way to know which was touched
        // first, so the day is dropped rather than resolved the flattering way.
        if (up && down) break
        if (!up && !down) continue

        const side = up ? 'long' : 'short'
        const level = up ? range.high : range.low
        // A stop order into a gap fills at the open, not at the level.
        const entry = up ? Math.max(level, bar.open) : Math.min(level, bar.open)
        const stop = up ? range.low : range.high
        risk = Math.abs(entry - stop)
        if (!(risk > 0)) break

        signal = {
          index: i,
          time: bar.time,
          side,
          entry,
          stop,
          outcome: 'open',
          feeR: feeInR(entry, stop, feeRate),
          // relVolume is null on the first open of the history, which only gets
          // this far when the filter is off.
          note: [
            range.relVolume === null ? null : `vol ${range.relVolume.toFixed(1)}×`,
            `rango ${(((range.high - range.low) / entry) * 100).toFixed(2)} %`,
          ]
            .filter(Boolean)
            .join(' · '),
        }
        signals.push(signal)
      }

      // The stop is checked on the entry candle too. Only 2.9 % of trades
      // resolve that way, but assuming otherwise would flatter the backtest.
      const long = signal.side === 'long'
      if (long ? bar.low <= signal.stop : bar.high >= signal.stop) {
        signal.resultR = -1
        signal.outcome = 'loss'
        signal.closedIndex = i
        signal.closedTime = bar.time
        signal.closedPrice = signal.stop
        break
      }

      // No fixed target: the position is closed at market when the window runs
      // out. That is what turns a 36 % hit rate into positive expectancy —
      // losers cost exactly 1 R and winners are left alone.
      if (i === end - 1 && complete) {
        const gross = long ? bar.close - signal.entry : signal.entry - bar.close
        signal.resultR = gross / risk
        signal.outcome = signal.resultR > 0 ? 'win' : 'loss'
        signal.closedIndex = i
        signal.closedTime = bar.time
        signal.closedPrice = bar.close
      }
    }
  }

  const overlays: Overlay[] = [
    { key: 'orHigh', label: `Techo apertura ${rangeMinutes} m`, values: orHigh, colour: 'var(--good)' },
    { key: 'orLow', label: `Suelo apertura ${rangeMinutes} m`, values: orLow, colour: 'var(--critical)', fillTo: 'orHigh' },
  ]

  // Only the last signal can still be live: one open's window closes before the
  // next one is built.
  const last = signals[signals.length - 1]
  const active = last && last.outcome === 'open' ? last : null

  // One session is enough for relative volume to have something to compare to.
  const warmup = Math.min(candles.length, DAY_MS / BAR_MS)
  return summarise(signals, overlays, warmup, active)
}
