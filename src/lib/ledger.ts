import {
  CONTEXT_EVIDENCE,
  contextTags,
  entryContext,
  HIGH_VOLUME,
  trackKey,
  withRegime,
  type BtcRegime,
  type ContextTag,
} from './entryContext'
import { plural, price, ratio } from './format'
import { DONCHIAN_TREND_EVIDENCE } from './indicators/donchianBreakout'
import { expectedAt, inflationOf } from './ledgerAge'
import { BAR_MS, MAX_ENTRIES, TRACK_BARS, type Ledger, type LedgerEntry, type ProcessedKey, type TrackBar } from './ledgerModel'
import { blockReason, MIN_TRADABLE_R, profileOf, STRATEGIES, type StrategyDef } from './indicators/registry'
import type { Candle, SignalSide, StrategyResult } from './indicators/types'
import { isTradTrack, tradFollowed, tradKindNote, TRAD_KIND, TRAD_TRACK_KEY, TRAD_TREND_EVIDENCE, type TradKind } from './tradMarkets'
import { US_CLOSE_MS } from './yahoo'

/**
 * The tracking ledger: every signal the measured strategies gave *after* the
 * ledger began, with what became of it.
 *
 * Everything the app knows about these strategies was found on history, and a
 * history can only say what a search could find in it. This is the other kind of
 * evidence — signals recorded before their outcome existed — and the only one
 * that cannot have been selected by the result. It is slow: a trend follower's
 * trades have a standard deviation ten times their mean, so a few dozen trades
 * say almost nothing, and the view says so with the arithmetic rather than a
 * verdict. The server writes it (`src/lib/watchJob.ts`); this file is the shared
 * model, so the browser, the server and Claude's text all read the same thing.
 */

export { BAR_MS, emptyLedger, MAX_ENTRIES, parseBoard, parseLedger, TRACK_BARS } from './ledgerModel'
export type { Ledger, LedgerEntry, ProcessedKey, TrackBar, TradBoard, TradBoardRow } from './ledgerModel'

// ── the tracks ───────────────────────────────────────────────────────────────

export interface TrackDef {
  key: string
  strategy: string
  preset: string
  bar: TrackBar
  /** "Ruptura · Canal 20 + EMA 200" */
  label: string
  barMs: number
  /**
   * Where the strategy's candles come from: OKX's crypto X-Perps, or the underlying of the equity, ETF and commodity
   * ones (`yahoo.ts`). They have different clocks, so the job scans them apart.
   */
  market: 'crypto' | 'trad'
  /** From the start of a candle to its close: the bar for crypto, 21.5 h for a New York session. */
  closeMs: number
  /** The only sides the track records, when not both. */
  sides?: SignalSide[]
}

const labelOf = (st: StrategyDef, presetKey: string) => {
  const preset = st.presets.find((p) => p.key === presetKey)
  return st.presets.length > 1 && preset ? `${st.label} · ${preset.label}` : st.label
}

/**
 * What the app offers, as the registry says it: every strategy and preset on
 * every bar it is not blocked on. Derived, like the timeframe buttons and the
 * cards' readings, so a re-measurement that blocks a bar stops tracking it and
 * a new offered strategy starts without anyone editing a list.
 */
export function offeredTracks(): TrackDef[] {
  const out: TrackDef[] = []
  for (const st of STRATEGIES) {
    for (const preset of st.presets) {
      const profile = profileOf(st, preset.key)
      for (const bar of TRACK_BARS) {
        if (blockReason(profile, bar) !== null) continue
        out.push({
          key: trackKey(st.key, preset.key, bar),
          strategy: st.key,
          preset: preset.key,
          bar,
          label: `${labelOf(st, preset.key)} · ${bar === '1D' ? '1 d' : bar === '4H' ? '4 h' : '1 h'}`,
          barMs: BAR_MS[bar],
          market: 'crypto',
          closeMs: BAR_MS[bar],
        })
      }
    }
  }
  if (tradOffered()) out.push(TRAD_TRACK)
  return out
}

/**
 * The equities track: the Donchian + EMA 200 preset on the daily bar of what OKX's stock, ETF and commodity perpetuals
 * track, long only. Offered by the same kind of rule as every other bar — the measured edge clears `MIN_TRADABLE_R` in
 * both halves, beats a random long by the same margin `npm run try` asks, and survives losing its ten best trades — so a
 * re-measurement that fails it stops the tracking without anyone editing a list.
 */
export function tradOffered(): boolean {
  const e = TRAD_TREND_EVIDENCE.index
  return Math.min(...e.halves) >= MIN_TRADABLE_R && e.net - e.random >= 0.05 && e.withoutBest10 > 0
}

export const TRAD_TRACK: TrackDef = {
  key: TRAD_TRACK_KEY,
  strategy: 'donchian',
  preset: 'trend',
  bar: '1D',
  label: 'Tendencia diaria · bolsa, ETF y oro',
  barMs: BAR_MS['1D'],
  market: 'trad',
  closeMs: US_CLOSE_MS,
  sides: ['long'],
}

/** From the start of an entry's candle to its close. */
const closeOffset = (e: Pick<LedgerEntry, 'track' | 'bar'>) => (isTradTrack(e.track) ? US_CLOSE_MS : BAR_MS[e.bar])

/** The label of a track key, from the registry, even for one no longer offered. */
export function trackLabel(key: string): string {
  if (key === TRAD_TRACK_KEY) return TRAD_TRACK.label
  const m = /^([^/]+)\/([^@]+)@(.+)$/.exec(key)
  if (!m) return key
  const st = STRATEGIES.find((s) => s.key === m[1])
  const bar = m[3] === '1D' ? '1 d' : m[3] === '4H' ? '4 h' : '1 h'
  return st ? `${labelOf(st, m[2])} · ${bar}` : key
}

// ── what each track was measured at ──────────────────────────────────────────

export interface TrackReference {
  /** Net R per trade after a 0.1 % round trip. */
  net: number
  n: number
  /** Standard deviation of the net R of one trade: the noise a mean of n of them carries. */
  sd: number
  longs: number
  shorts: number
  /** Where it was measured. */
  sample: string
}

/**
 * The yardstick for each track: the broad board (30 coins) rather than the
 * audit's cache, which a few strong trends of the last month lifted. `npm run
 * improve evidence` measures all of them and exits non-zero on drift.
 */
export const REFERENCE: Record<string, TrackReference> = {
  'donchian/fast@4H': { net: 0.2, n: 5531, sd: 3.09, longs: 0.33, shorts: 0.08, sample: '30 criptos, 4 h, 2022–2026' },
  'donchian/trend@4H': {
    net: DONCHIAN_TREND_EVIDENCE.board.net,
    n: DONCHIAN_TREND_EVIDENCE.board.n,
    sd: 4.27,
    longs: DONCHIAN_TREND_EVIDENCE.board.longs,
    shorts: DONCHIAN_TREND_EVIDENCE.board.shorts,
    sample: '30 criptos, 4 h, 2022–2026',
  },
  'donchian/trend@1H': {
    net: DONCHIAN_TREND_EVIDENCE.hourly.net,
    n: DONCHIAN_TREND_EVIDENCE.hourly.n,
    sd: 3.49,
    longs: DONCHIAN_TREND_EVIDENCE.hourly.longs,
    shorts: DONCHIAN_TREND_EVIDENCE.hourly.shorts,
    sample: '30 criptos, 1 h, 2022–2026',
  },
  'ema200/base@4H': { net: 0.19, n: 6732, sd: 3.31, longs: 0.29, shorts: 0.08, sample: '30 criptos, 4 h, 2022–2026' },
  'reversal/tuned@1D': { net: 0.37, n: 140, sd: 1.79, longs: 0.59, shorts: 0.12, sample: 'BTC, ETH y SOL, diario, 2022–2026' },
  [TRAD_TRACK_KEY]: {
    net: TRAD_TREND_EVIDENCE.index.net,
    n: TRAD_TREND_EVIDENCE.index.n,
    sd: TRAD_TREND_EVIDENCE.index.sd,
    longs: TRAD_TREND_EVIDENCE.index.net,
    shorts: TRAD_TREND_EVIDENCE.indexShorts,
    sample: '20 ETF de índices y sectores, diario, 1993–2026, precios sin ajustar',
  },
}

// ── from a strategy's result to ledger entries ───────────────────────────────

const r3 = (x: number) => Math.round(x * 1000) / 1000

/**
 * Every signal of `result` as an entry. Which of them count is not decided
 * here: only those after the contract's `since` are recorded (`mergeObserved`).
 * `candles` are the closed ones the strategy ran on.
 */
export function entriesFromResult(
  def: TrackDef,
  instId: string,
  symbol: string,
  candles: Candle[],
  result: StrategyResult,
  regime: BtcRegime | null,
  now: number,
  /** The equities track also records what kind of contract it was and which OKX contract trades it. */
  meta?: { kind: TradKind; okxId: string },
): LedgerEntry[] {
  const last = candles.at(-1)
  return result.signals
    .filter((s) => !def.sides || def.sides.includes(s.side))
    .map((s) => {
    const ctx = entryContext(candles, s.index, def.closeMs, regime)
    const open = s.outcome === 'open'
    const risk = Math.abs(s.entry - s.stop)
    const dir = s.side === 'long' ? 1 : -1
    return {
      id: `${def.key}:${instId}:${s.time}`,
      track: def.key,
      strategy: def.strategy,
      preset: def.preset,
      bar: def.bar,
      instId,
      symbol,
      side: s.side,
      at: s.time + def.closeMs,
      entry: s.entry,
      stop: s.stop,
      target: s.target,
      stopNow: open ? (s.stopNow ?? s.stop) : undefined,
      status: open ? 'open' : 'closed',
      closedAt: !open && s.closedTime !== undefined ? s.closedTime + def.closeMs : undefined,
      exit: open ? undefined : (s.closedPrice ?? (s.outcome === 'win' ? s.target : s.stop)),
      resultR: open ? undefined : s.resultR,
      feeR: s.feeR,
      markR: open && last && risk > 0 ? r3((dir * (last.close - s.entry)) / risk) : undefined,
      lastClose: open && last ? last.close : undefined,
      markedAt: open && last ? last.time + def.closeMs : undefined,
      seen: now,
      volume: Number.isFinite(ctx.volume) ? r3(ctx.volume) : null,
      btcAbove: ctx.btcAbove,
      weekend: ctx.weekend,
      ...(meta ? { kind: meta.kind, okxId: meta.okxId } : {}),
    }
  })
}

// ── merging a run into the ledger ────────────────────────────────────────────

/**
 * The universe at a run: contracts that are in keep their `since`, new ones
 * start now, and one that dropped out forgets it — when it comes back it starts
 * again, so the signals it gave while it was out (a contract tends to come back
 * because it was moving) never enter as if they had been followed.
 */
export function refreshSince(
  since: Record<string, number>,
  universe: Record<string, string[]>,
  now: number,
): Record<string, number> {
  const next: Record<string, number> = {}
  for (const [track, ids] of Object.entries(universe)) {
    for (const id of ids) {
      const key = `${track}|${id}`
      next[key] = since[key] ?? now
    }
  }
  return next
}

export interface Merge {
  ledger: Ledger
  /** Recorded for the first time by this merge. */
  added: LedgerEntry[]
  /** Open before, closed now. */
  closed: LedgerEntry[]
}

/**
 * Folds what a run observed into the ledger. Idempotent: the same observation
 * twice changes nothing, a closed entry is never rewritten, and an entry that
 * began before its contract's `since` is not recorded — the ledger only holds
 * what was followed forward.
 *
 * `windows` says, per `track|instId` scanned this run, the oldest candle the
 * strategy saw: an entry open from before it cannot be followed any more and
 * is set aside as `lost` instead of being left open for ever.
 */
export function mergeObserved(
  ledger: Ledger,
  observed: LedgerEntry[],
  windows: Record<string, number>,
  now: number,
): Merge {
  // Copies: the ledger that came in is not touched, so a failed write can be retried from it.
  const byId = new Map(ledger.entries.map((e) => [e.id, { ...e }]))
  const added: LedgerEntry[] = []
  const closed: LedgerEntry[] = []
  const seenIds = new Set<string>()

  for (const o of observed) {
    seenIds.add(o.id)
    const known = byId.get(o.id)
    if (known) {
      // What was true at entry is the same whenever it is computed: a regime BTC's candles could not give
      // at the time (a failed request) is filled in by the run that has it. Nothing else is rewritten.
      if (known.btcAbove === null && o.btcAbove !== null) known.btcAbove = o.btcAbove
      if (known.volume === null && o.volume !== null) known.volume = o.volume
      if (known.status === 'closed') continue
      const wasOpen = known.status === 'open'
      Object.assign(known, {
        status: o.status,
        closedAt: o.closedAt,
        exit: o.exit,
        resultR: o.resultR,
        markR: o.markR,
        lastClose: o.lastClose,
        markedAt: o.markedAt,
        stopNow: o.stopNow,
      })
      if (wasOpen && o.status === 'closed') closed.push(known)
      continue
    }
    const from = ledger.since[`${o.track}|${o.instId}`]
    if (from === undefined || o.at <= from) continue
    const entry: LedgerEntry = { ...o, seen: now }
    byId.set(entry.id, entry)
    added.push(entry)
  }

  const entries = [...byId.values()]
  for (const e of entries) {
    if (e.status !== 'open' || seenIds.has(e.id)) continue
    const oldest = windows[`${e.track}|${e.instId}`]
    // Scanned this run, the window reaches back past the entry, and the strategy no longer shows it: leave it open
    // (a data glitch). Scanned and the entry is older than the window: it cannot be followed.
    if (oldest !== undefined && e.at - closeOffset(e) < oldest) e.lost = true
  }

  entries.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  // Over the cap, the oldest closed entries go first: the open ones are still being followed.
  let excess = entries.length - MAX_ENTRIES
  const kept = entries.filter((e) => {
    if (excess <= 0 || e.status !== 'closed') return true
    excess--
    return false
  })
  return { ledger: { ...ledger, entries: kept }, added, closed }
}

// ── reading it ───────────────────────────────────────────────────────────────

/** Net R of a closed entry: what reached the balance, fee included. */
export const netR = (e: LedgerEntry): number => (e.resultR ?? 0) - e.feeR

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}

/**
 * A trade as it stands now: what it ended at if it ended, what it would be
 * worth at the last closed candle if not. Net of the round trip.
 */
export const currentR = (e: LedgerEntry): number => (e.status === 'closed' ? netR(e) : (e.markR ?? 0) - e.feeR)

/** Bars of its own timeframe the entry had lived at `asOf`, which is where history is asked for what it was worth. */
export function ageOf(e: LedgerEntry, asOf: number): number {
  return Math.max(0, Math.floor((asOf - e.at) / BAR_MS[e.bar] + 1e-9))
}

/**
 * The moment each entry is read at: the candle the open ones were last marked
 * at, and for the closed ones the newest candle the run has processed on their
 * bar — because a closed trade is worth the same at any later age, and the
 * history's curve it is compared with includes the ones that had closed.
 */
function asOfOf(e: LedgerEntry, processed: Partial<Record<ProcessedKey, number>>): number {
  // The equities track keeps its own clock: a New York session closes at 21:30 UTC, OKX's daily at 16:00.
  const clock = processed[isTradTrack(e.track) ? 'us' : e.bar]
  if (e.status === 'open') return e.markedAt ?? clock ?? e.at
  return Math.max(clock ?? 0, e.closedAt ?? e.at)
}

export interface Versus {
  n: number
  /** Mean of what each entry is worth now. */
  mean: number
  /** Mean of what the history's trades were worth at the same ages. */
  expected: number
  /** `mean − expected`. */
  diff: number
  /**
   * What chance moves that difference: ±1.96 standard errors from the spread the history had at those ages, widened
   * by how much more signals fired together move than independent ones (`NOISE_INFLATION`).
   */
  band: number
}

/**
 * The live trades against the history's own at the same ages — the only
 * comparison a young ledger allows. The mean of the closed ones is not it: the
 * losers close first.
 */
export function versusHistory(
  entries: LedgerEntry[],
  track: string,
  processed: Partial<Record<ProcessedKey, number>>,
): Versus | null {
  const mine = entries.filter((e) => e.track === track && !e.lost)
  if (!mine.length || !expectedAt(track, 0)) return null
  let live = 0
  let expected = 0
  let variance = 0
  for (const e of mine) {
    const exp = expectedAt(track, ageOf(e, asOfOf(e, processed)))!
    live += currentR(e)
    expected += exp.mean
    variance += exp.sd ** 2
  }
  const n = mine.length
  return {
    n,
    mean: live / n,
    expected: expected / n,
    diff: (live - expected) / n,
    band: (1.96 * inflationOf(track) * Math.sqrt(variance)) / n,
  }
}

export interface TrackStats {
  track: string
  entries: number
  open: number
  closed: number
  wins: number
  /** Share of the closed ones that ended above zero net. NaN with none. */
  winRate: number
  /** Mean net R of the closed. NaN with none — and biased while the ledger is young: the losers close first. */
  meanNet: number
  totalNet: number
  sdNet: number
  best: number
  worst: number
  /** The open ones marked to the last close, net, summed. */
  openMark: number
  longs: { n: number; mean: number }
  shorts: { n: number; mean: number }
  /** Everything — open and closed — against the history at the same ages. */
  versus: Versus | null
}

export function trackStats(
  entries: LedgerEntry[],
  track: string,
  processed: Partial<Record<ProcessedKey, number>> = {},
): TrackStats {
  const mine = entries.filter((e) => e.track === track && !e.lost)
  const closed = mine.filter((e) => e.status === 'closed' && e.resultR !== undefined)
  const open = mine.filter((e) => e.status === 'open')
  const net = closed.map(netR)
  const side = (s: SignalSide) => {
    const xs = closed.filter((e) => e.side === s).map(netR)
    return { n: xs.length, mean: mean(xs) }
  }
  return {
    track,
    entries: mine.length,
    open: open.length,
    closed: closed.length,
    wins: net.filter((x) => x > 0).length,
    winRate: closed.length ? net.filter((x) => x > 0).length / closed.length : NaN,
    meanNet: mean(net),
    totalNet: net.reduce((a, b) => a + b, 0),
    sdNet: stdev(net),
    best: net.length ? Math.max(...net) : NaN,
    worst: net.length ? Math.min(...net) : NaN,
    openMark: open.reduce((a, e) => a + (e.markR ?? 0) - e.feeR, 0),
    longs: side('long'),
    shorts: side('short'),
    versus: versusHistory(entries, track, processed),
  }
}

/**
 * How far a mean of `n` trades wanders by chance: ±1.96 standard errors, with
 * the standard deviation the strategy had when it was measured. A live mean
 * inside this band says nothing against — or for — the measured one.
 */
export function noiseBand(sd: number, n: number, inflation = 1): number {
  return n > 0 && Number.isFinite(sd) ? (1.96 * inflation * sd) / Math.sqrt(n) : NaN
}

/**
 * Trades needed before a mean at the measured value is told from zero at 95 %:
 * (1.96 × inflation × sd ÷ mean)². The inflation is what makes it years and not
 * months — twenty contracts that break out together are not twenty trials.
 */
export function tradesToTell(ref: TrackReference, track?: string): number {
  return ref.net > 0 ? Math.ceil(((1.96 * (track ? inflationOf(track) : 1) * ref.sd) / ref.net) ** 2) : Infinity
}

/**
 * Where the live trades stand against the history's at the same ages, in words
 * that do not claim more than the sample can: inside the noise band, or clearly
 * off it. Under `MIN_READ` trades there is nothing to read.
 */
export type Reading = 'sin-muestra' | 'compatible' | 'por-encima' | 'por-debajo'

/** The least trades (open or closed) before the page says anything about them. */
export const MIN_READ = 5

export function readLive(stats: TrackStats): Reading {
  const v = stats.versus
  if (!v || v.n < MIN_READ) return 'sin-muestra'
  if (v.diff > v.band) return 'por-encima'
  if (v.diff < -v.band) return 'por-debajo'
  return 'compatible'
}

export interface SplitStat {
  n: number
  mean: number
}

/**
 * The two halves of a context filter, each as the mean amount by which its
 * trades stand above (or below) what the strategy's history was worth at the
 * same ages. The raw means would mix the age of the trades into the split; the
 * deviation does not. This is the forward test of what the history found.
 */
function split(
  es: LedgerEntry[],
  track: string,
  processed: Partial<Record<ProcessedKey, number>>,
  pick: (e: LedgerEntry) => boolean | null,
): { with: SplitStat; without: SplitStat } {
  const dev = (e: LedgerEntry) => currentR(e) - (expectedAt(track, ageOf(e, asOfOf(e, processed)))?.mean ?? 0)
  const a = es.filter((e) => pick(e) === true).map(dev)
  const b = es.filter((e) => pick(e) === false).map(dev)
  return { with: { n: a.length, mean: mean(a) }, without: { n: b.length, mean: mean(b) } }
}

export interface ContextSplits {
  volume: { with: SplitStat; without: SplitStat }
  /** Longs only: with BTC above its EMA 200 against below. */
  longs: { with: SplitStat; without: SplitStat }
  weekend: { with: SplitStat; without: SplitStat }
}

export function contextSplits(
  entries: LedgerEntry[],
  track: string,
  processed: Partial<Record<ProcessedKey, number>> = {},
): ContextSplits {
  const mine = entries.filter((e) => e.track === track && !e.lost)
  return {
    volume: split(mine, track, processed, (e) => (e.volume === null ? null : e.volume >= HIGH_VOLUME)),
    longs: split(
      mine.filter((e) => e.side === 'long'),
      track,
      processed,
      (e) => withRegime('long', e.btcAbove),
    ),
    weekend: split(mine, track, processed, (e) => e.weekend),
  }
}

/** The tags of an entry, with the evidence of its own track. */
export function entryTags(e: LedgerEntry): ContextTag[] {
  // Measured on crypto; on ETFs and stocks neither volume nor the market's regime replicated, so they say nothing there.
  if (isTradTrack(e.track)) return []
  return contextTags(
    { volume: e.volume ?? NaN, btcAbove: e.btcAbove, weekend: e.weekend },
    e.side,
    e.track,
  )
}

/** Whether a track has quoted evidence for its context tags. */
export const hasContextEvidence = (track: string) => track in CONTEXT_EVIDENCE

// ── as text, for Claude ──────────────────────────────────────────────────────

const signedR = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${ratio(Math.abs(x))}` : '—')

const dayText = (ms: number) =>
  new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms))

const READING: Record<Reading, string> = {
  'sin-muestra': `sin muestra para opinar (menos de ${MIN_READ} señales)`,
  compatible: 'dentro del ruido: ni desmiente lo medido ni lo confirma',
  'por-encima': 'por encima de lo que el histórico valía a esa edad, fuera del ruido',
  'por-debajo': 'por debajo de lo que el histórico valía a esa edad, fuera del ruido',
}

/**
 * The ledger as Markdown. It leads with the arithmetic, because a model reading
 * "+0,12 R en 14 operaciones" will otherwise take it for a result — and with
 * the one thing that makes a young ledger misleading: the trades that closed
 * first are the losers.
 */
export function ledgerText(ledger: Ledger, now = Date.now()): string {
  const tracks = [...new Set([...offeredTracks().map((t) => t.key), ...ledger.entries.map((e) => e.track)])]
  const days = Math.max(0, (now - ledger.startedAt) / 86_400_000)
  const sds = Object.values(REFERENCE).map((r) => r.sd)
  const sdLow = Math.min(...sds)
  const sdHigh = Math.max(...sds)
  const lines = [
    `# Seguimiento en vivo de las estrategias — desde el ${dayText(ledger.startedAt)} (${plural(Math.floor(days), 'día', 'días')})`,
    `El servidor apunta cada señal nueva de las estrategias medidas, sobre los contratos que ya vigilaba, antes de que exista su resultado, y la resuelve con las velas siguientes. Es la única evidencia que no pudo escogerse mirando el resultado, y es lenta: la desviación típica de una operación acabada es de ${ratio(sdLow, 1)} a ${ratio(sdHigh, 1)} R frente a una media de 0,1 a 0,4 R, así que pocas operaciones no dicen casi nada.`,
    'Un seguidor de tendencia corta rápido las perdedoras y deja correr las ganadoras, así que **las operaciones cerradas de un registro joven son casi todas pérdidas y su media no significa nada**. Por eso cada señal, abierta o cerrada, se compara con lo que valían las del histórico **a esa misma edad** (las abiertas, al último cierre). «Banda de ruido» es lo que se mueve esa diferencia por azar (±1,96 errores típicos).',
  ]
  const rows: string[][] = []
  for (const track of tracks) {
    const s = trackStats(ledger.entries, track, ledger.processed)
    const ref = REFERENCE[track]
    const v = s.versus
    rows.push([
      trackLabel(track),
      String(s.entries),
      `${s.closed} / ${s.open}`,
      v ? signedR(v.mean) : '—',
      v ? signedR(v.expected) : '—',
      v ? signedR(v.diff) : '—',
      v ? `±${ratio(v.band)}` : '—',
      s.closed ? signedR(s.meanNet) : '—',
      ref ? signedR(ref.net) : '—',
      READING[readLive(s)],
    ])
  }
  const head = [
    'Estrategia',
    'Señales',
    'Cerradas / abiertas',
    'Hoy por señal (R)',
    'Histórico a esa edad (R)',
    'Diferencia (R)',
    'Banda de ruido',
    'Solo cerradas (R)',
    'Medido al final (R)',
    'Lectura',
  ]
  lines.push(
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  )
  const open = ledger.entries.filter((e) => e.status === 'open' && !e.lost).sort((a, b) => b.at - a.at)
  if (open.length) {
    lines.push(
      '',
      `## Abiertas ahora (${open.length})`,
      ...open
        .slice(0, 15)
        .map(
          (e) =>
            `- ${e.symbol} ${e.side === 'long' ? 'Long' : 'Short'} · ${trackLabel(e.track)} · desde el ${dayText(e.at)} · entrada ${price(e.entry)} · stop ${price(e.stopNow ?? e.stop)} · ${signedR((e.markR ?? 0) - e.feeR)} R al último cierre`,
        ),
    )
  }
  const board = ledger.board
  if (board?.rows.length) {
    // Where the equities, ETFs and commodities stand at the last New York close, with how much evidence each kind has.
    const followed = board.rows.filter((r) => tradFollowed(r.kind))
    const names = (status: string) =>
      followed
        .filter((r) => r.status === status)
        .map((r) => (status === 'cerca' ? `${r.okx} (a ${ratio(r.distanceAtr ?? 0, 1)} ATR del máximo)` : status === 'nueva' ? `${r.okx} (${TRAD_KIND[r.kind].label.toLowerCase()})` : r.okx))
    lines.push(
      '',
      `## Bolsa, ETF y oro · tendencia diaria, solo largos · cierre de Nueva York del ${dayText(board.asOf)}`,
      `Señal nueva (las dos últimas sesiones): ${names('nueva').join(', ') || 'ninguna'}. Cerca de romper: ${names('cerca').join(', ') || 'ninguno'}. En tendencia: ${names('tendencia').length} contratos. Sin posición: ${followed.filter((r) => r.status === 'fuera').length}. Historial corto: ${followed.filter((r) => r.status === 'corto').length}.`,
      `Qué hay detrás: ${tradKindNote('index')} ${tradKindNote('stock')} ${tradKindNote('commodity')} Como cuenta, la regla en largos de índices rinde ${TRAD_TREND_EVIDENCE.portfolio.sharpe.toFixed(2).replace('.', ',')} de Sharpe contra ${TRAD_TREND_EVIDENCE.portfolio.spySharpe.toFixed(2).replace('.', ',')} de SPY comprado y mantenido: es contexto, no una recomendación.`,
    )
  }
  lines.push(
    '',
    ledger.entries.length
      ? `Último apunte: ${dayText(Math.max(...ledger.entries.map((e) => e.at)))}. Ejecuciones del servidor: ${ledger.runs}.`
      : 'Todavía no hay ninguna señal apuntada.',
  )
  return lines.join('\n')
}

/** For the cards and the view: "+0,4 R", "−1,2 R". */
export const signedRText = signedR
