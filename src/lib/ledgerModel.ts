import type { SignalSide } from './indicators/types'

/**
 * The tracking ledger's data model, and nothing that needs the strategies: the
 * app's first screen reads the ledger through `queries.ts`, and importing the
 * registry and every indicator for a type and a parser would make it carry them.
 * `ledger.ts` has the rest and re-exports this.
 */

export type TrackBar = '4H' | '1H' | '1D'

/** The bars a strategy may be tracked on. 15 m is not in the list: nothing offers it. */
export const TRACK_BARS: TrackBar[] = ['4H', '1H', '1D']

export const BAR_MS: Record<TrackBar, number> = { '4H': 4 * 3_600_000, '1H': 3_600_000, '1D': 86_400_000 }

/**
 * The clocks a run keeps. A crypto bar's is the close of BTC's newest candle on it; the equities track has its own,
 * `us`: the close of the newest New York session, because a US daily bar closes at 21:30 UTC where OKX's closes at 16:00,
 * and sharing a key would let one clock skip the other's pass.
 */
export type ProcessedKey = TrackBar | 'us'

export interface LedgerEntry {
  /** `${track}:${instId}:${open time of the entry candle}` — what makes a recorded signal the same one next run. */
  id: string
  track: string
  strategy: string
  preset: string
  bar: TrackBar
  instId: string
  symbol: string
  side: SignalSide
  /** Close time of the candle the entry was made on, in ms. */
  at: number
  entry: number
  /** The initial stop, which defines 1 R. */
  stop: number
  /** The fixed target, for the strategies that have one. */
  target?: number
  /** Where the trailing stop stands while open. */
  stopNow?: number
  status: 'open' | 'closed'
  /** Close time of the candle it ended on. */
  closedAt?: number
  exit?: number
  /** Gross R, once closed. */
  resultR?: number
  /** The round trip in R, assumed at 0.1 %. */
  feeR: number
  /** While open: gross R at the last closed candle. */
  markR?: number
  lastClose?: number
  /** While open: the close time of the candle that mark was taken at. */
  markedAt?: number
  /** First run that recorded it. */
  seen: number
  /** What was true at entry. Null where it could not be known. */
  volume: number | null
  btcAbove: boolean | null
  weekend: boolean
  /** Entered before the candle window of a later run: it can no longer be followed. Left out of every figure. */
  lost?: true
  /** Equities track only: what kind of contract it was (the evidence differs by kind) and the OKX contract to trade. */
  kind?: TradKind
  okxId?: string
  /**
   * What happened to the notification, when one was due. `illiquid`: recorded and followed like any other, but not announced,
   * because OKX's book could not take a position of the usual size at a sane price (`liquidityVerdict` in `tradMarkets.ts`).
   */
  alert?: 'sent' | 'failed' | 'illiquid'
}

export interface Ledger {
  version: 1
  /** The first run: nothing earlier counts as forward. */
  startedAt: number
  /** When the last run finished. */
  lastRun: number
  /** A run is in progress until this time; another trigger skips meanwhile. */
  lockUntil?: number
  runs: number
  /** `${track}|${instId}` → the moment it was last put in the universe. Only entries after it count. */
  since: Record<string, number>
  /** What each track scanned at the last run. */
  universe: Record<string, string[]>
  /** Per clock: close time of the newest candle already processed. */
  processed: Partial<Record<ProcessedKey, number>>
  entries: LedgerEntry[]
  /** Where each equity, ETF and commodity contract stood at the last New York close; the Screener's card reads it. */
  board?: TradBoard
  /** Why the last run failed, when it did. */
  lastError?: string
}

export type TradKind = 'index' | 'leveraged' | 'commodity' | 'stock'

/** One contract of the equities board. Plain numbers and strings, so it survives the JSON round trip. */
export interface TradBoardRow {
  /** The symbol on Yahoo and the ticker on OKX: `GLD` and `XAU`. */
  yahoo: string
  okx: string
  /** The OKX contract, e.g. `AAPL-USD_UM_XPERP-310613`. */
  instId: string
  name?: string
  kind: TradKind
  status: 'nueva' | 'cerca' | 'tendencia' | 'fuera' | 'corto'
  bars: number
  /** Close time of the bar the row is read at, ms. */
  asOf: number
  price: number
  ema?: number
  above?: boolean
  /** The 20-bar high a long waits on, and the close against it; absent when a long is already open. */
  level?: number
  distance?: number
  distanceAtr?: number
  entry?: number
  entryAt?: number
  /** Closed bars since the long entered. */
  age?: number
  /** Where the long's stop stands now. */
  stop?: number
  /** The rule holds a short here; nothing follows the short side. */
  shortOpen?: true
  /** Bars the rule needs, when it has too few. */
  need?: number
}

export interface TradBoard {
  /** When the run that wrote it ran. */
  at: number
  /** Close time of the New York session it reads. */
  asOf: number
  rows: TradBoardRow[]
  /** Symbols Yahoo would not give, with the reason. */
  errors?: string[]
}

export const emptyLedger = (now: number): Ledger => ({
  version: 1,
  startedAt: now,
  lastRun: 0,
  runs: 0,
  since: {},
  universe: {},
  processed: {},
  entries: [],
})

/**
 * A ledger as read from storage, or null when what is there is not one. Defensive
 * because it is JSON from outside the process, and a run that trusted its shape
 * would write a worse one back.
 */
export function parseLedger(raw: unknown): Ledger | null {
  if (!raw || typeof raw !== 'object') return null
  const l = raw as Partial<Ledger>
  if (l.version !== 1 || !Array.isArray(l.entries)) return null
  const dict = <T,>(x: unknown): Record<string, T> => (x && typeof x === 'object' && !Array.isArray(x) ? { ...(x as Record<string, T>) } : {})
  return {
    version: 1,
    startedAt: Number(l.startedAt) || 0,
    lastRun: Number(l.lastRun) || 0,
    lockUntil: typeof l.lockUntil === 'number' ? l.lockUntil : undefined,
    runs: Number(l.runs) || 0,
    since: dict<number>(l.since),
    universe: dict<string[]>(l.universe),
    processed: dict<number>(l.processed),
    entries: l.entries.filter((e): e is LedgerEntry => Boolean(e) && typeof e === 'object' && typeof (e as LedgerEntry).id === 'string'),
    lastError: typeof l.lastError === 'string' ? l.lastError : undefined,
    board: parseBoard(l.board),
  }
}

/** A board as stored, or undefined when what is there is not one: it is JSON from outside the process. */
export function parseBoard(raw: unknown): TradBoard | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const b = raw as Partial<TradBoard>
  if (!Array.isArray(b.rows)) return undefined
  return {
    at: Number(b.at) || 0,
    asOf: Number(b.asOf) || 0,
    rows: b.rows.filter((r): r is TradBoardRow => Boolean(r) && typeof r === 'object' && typeof (r as TradBoardRow).yahoo === 'string' && typeof (r as TradBoardRow).status === 'string'),
    errors: Array.isArray(b.errors) ? b.errors.filter((e): e is string => typeof e === 'string') : undefined,
  }
}

/**
 * Entries kept. Past it the oldest closed ones go; open ones always stay. About
 * 400 bytes each: 4 000 is a 1.7 MB file, and the endpoint answers with all of
 * it while a function's response is capped at 4.5 MB.
 */
export const MAX_ENTRIES = 4000

