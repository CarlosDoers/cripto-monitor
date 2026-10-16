import type { runWatch as Declared, sendTest as DeclaredTest } from '../../api/_watch'
import { btcRegime, REGIME_MIN_BARS, type BtcRegime } from './entryContext'
import { strategyByKey } from './indicators/registry'
import type { SignalSide } from './indicators/types'
import {
  BAR_MS,
  emptyLedger,
  entriesFromResult,
  mergeObserved,
  offeredTracks,
  parseLedger,
  refreshSince,
  TRACK_BARS,
  type Ledger,
  type LedgerEntry,
  type TrackBar,
  type TrackDef,
} from './ledger'
import { formatAlert, notifiersFromEnv, sendTestAlerts, type Notifier } from './notify'
import { measuredContracts } from './opportunities'
import { toCandles } from './signals'
import { collectMarket, liquidCrypto, patient, type Get } from './snapshot'
import type { Candle as OkxCandle } from './types'

/**
 * The server's pass over the strategies the app offers: put the contracts under
 * watch, recompute each strategy on closed candles, record the signals that
 * appeared after the ledger began, resolve the ones still open and tell the
 * phone about the new ones.
 *
 * Nothing in it needs to run on a schedule to be correct. A signal is found by
 * recomputing from candles — not by catching it as it happens — so a run a day
 * late records the same entries a run an hour late would have, only later; and
 * running twice records them once. That is what lets three triggers share it: a
 * daily cron, an hourly external ping, and the browser when it opens.
 *
 * Web-standard and dependency-free (`get` and the store are injected), so it
 * runs in the dev server from source and on Vercel from the bundle
 * `npm run build` writes to `api/_watch.js`.
 */

type Env = Record<string, string | undefined>

export interface WatchConfig {
  /** Contracts watched for the trend strategies: the most traded crypto X-Perps. */
  top: number
  /** Bars that are tracked (a bar the registry does not offer is never tracked). */
  bars: TrackBar[]
  /** Bars a notification is sent for. 1 h is recorded and silent by default: it fires several times a day. */
  alertBars: TrackBar[]
  alertSides: SignalSide[]
  /** A signal older than this is recorded but not announced — after an outage the phone is not flooded. */
  maxAlertAgeMs: number
}

const bars = (raw: string | undefined, fallback: TrackBar[]): TrackBar[] => {
  const asked = (raw ?? '')
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter((x): x is TrackBar => (TRACK_BARS as string[]).includes(x))
  return asked.length ? asked : fallback
}

export function configFromEnv(env: Env): WatchConfig {
  const top = Math.round(Number(env.WATCH_TOP))
  const hours = Number(env.WATCH_ALERT_MAX_HOURS)
  const sides = (env.WATCH_ALERT_SIDES ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter((x): x is SignalSide => x === 'long' || x === 'short')
  return {
    top: Number.isFinite(top) && top > 0 ? Math.min(40, Math.max(5, top)) : 20,
    bars: bars(env.WATCH_BARS, TRACK_BARS),
    alertBars: bars(env.WATCH_ALERT_BARS, ['4H', '1D']),
    alertSides: sides.length ? sides : ['long', 'short'],
    maxAlertAgeMs: (Number.isFinite(hours) && hours > 0 ? hours : 8) * 3_600_000,
  }
}

/** Whether a new entry is announced. */
export function alertEligible(e: LedgerEntry, cfg: WatchConfig, now: number): boolean {
  return cfg.alertBars.includes(e.bar) && cfg.alertSides.includes(e.side) && now - e.at <= cfg.maxAlertAgeMs
}

// ── pacing ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** At most `max` request starts in any `windowMs`: OKX allows 40 per 2 s on the candle endpoints. */
function limited(get: Get, max = 30, windowMs = 2_000): Get {
  const starts: number[] = []
  return async <T,>(path: string, params?: Record<string, string | number | undefined>) => {
    for (;;) {
      const now = Date.now()
      while (starts.length && now - starts[0] >= windowMs) starts.shift()
      if (starts.length < max) {
        starts.push(now)
        break
      }
      await sleep(windowMs - (now - starts[0]) + 5)
    }
    return get<T>(path, params)
  }
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await run(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
}

/** Pages of candles a reading needs, like the Screener's cards: five of 4 h, four of 1 h, one daily page. */
const PAGES: Record<TrackBar, number> = { '4H': 5, '1H': 4, '1D': 1 }

async function candlesOf(get: Get, instId: string, bar: TrackBar): Promise<OkxCandle[]> {
  const all: OkxCandle[] = []
  let after: string | undefined
  for (let page = 0; page < PAGES[bar]; page++) {
    const batch = await get<OkxCandle>('/api/v5/market/candles', { instId, bar, limit: 300, after })
    if (!batch.length) break
    all.push(...batch)
    after = batch[batch.length - 1][0]
    if (batch.length < 300) break
  }
  return all.sort((a, b) => Number(a[0]) - Number(b[0]))
}

/** Close time of the newest confirmed candle of `bar`, from one cheap request. */
async function latestClose(get: Get, instId: string, bar: TrackBar): Promise<number> {
  const rows = await get<OkxCandle>('/api/v5/market/candles', { instId, bar, limit: 3 })
  const newest = rows.filter((r) => r[8] === '1').sort((a, b) => Number(b[0]) - Number(a[0]))[0]
  return newest ? Number(newest[0]) + BAR_MS[bar] : 0
}

// ── a run ────────────────────────────────────────────────────────────────────

/** Two runs closer than this are one run: the second skips. */
const MIN_GAP_MS = 10 * 60_000
/** A run holds the ledger this long; a crashed one cannot block it for ever. */
const LOCK_MS = 120_000
/**
 * Stop starting new contracts after this. Vercel's function limit is 60 s, and a
 * contract already in flight can take 15 s more through a rate limit's retries.
 */
const BUDGET_MS = 35_000
/** Candle requests in flight at once. */
const CONCURRENCY = 6
/** Tries at a conditional write before giving the run up. */
const WRITE_TRIES = 4

/** BTC's spot pair: years of history, and its price is the perpetual's within the basis. */
const BTC_SPOT = 'BTC-USDT'

export const runWatch: typeof Declared = async (options) => {
  const t0 = Date.now()
  const now = options.now ?? t0
  const cfg = configFromEnv(options.env)
  const errors: string[] = []
  const dry = Boolean(options.dry)
  const get = limited(patient(options.get as Get))
  const notifiers: Notifier[] = dry ? [] : notifiersFromEnv(options.env)
  const result = (patch: Partial<ReturnType<typeof base>> & { status: 'ran' | 'skipped' | 'failed' }) => ({
    ...base(),
    ...patch,
  })
  const base = () => ({
    status: 'ran' as 'ran' | 'skipped' | 'failed',
    reason: undefined as string | undefined,
    tracks: [] as string[],
    scanned: 0,
    added: 0,
    closed: 0,
    alerts: { sent: 0, failed: 0, channels: notifiers.map((n) => n.name) },
    errors,
    ms: 0,
    ledger: null as Ledger | null,
  })
  const done = (r: ReturnType<typeof base>) => ({ ...r, ms: Date.now() - t0 })

  // ── read, and decide whether this is a run at all ──
  const first = await options.store.read()
  let ledger = parseLedger(first.ledger) ?? emptyLedger(now)
  let token = first.token
  if (!options.force && !dry) {
    if (ledger.lockUntil !== undefined && ledger.lockUntil > now) return done(result({ status: 'skipped', reason: 'locked', ledger }))
    if (ledger.lastRun && now - ledger.lastRun < MIN_GAP_MS) return done(result({ status: 'skipped', reason: 'recent', ledger }))
  }
  if (!dry) {
    // Claim the ledger: a conditional write, so of two triggers at the same moment only one gets it.
    const claimed = { ...ledger, lockUntil: now + LOCK_MS }
    let claim = await options.store.write(claimed, token)
    if (!claim.ok) {
      // Refused: either someone wrote first (the store's token has moved on) or the store refused a condition
      // that held — a validator it does not honour. In the second case waiting would lock this out for ever.
      const again = await options.store.read()
      if (again.token !== token) return done(result({ status: 'skipped', reason: 'locked', ledger }))
      claim = await options.store.write(claimed, null)
      if (!claim.ok) return done(result({ status: 'skipped', reason: 'locked', ledger }))
    }
    token = claim.token
  }

  try {
    const tracks = offeredTracks().filter((t) => cfg.bars.includes(t.bar))
    const market = await collectMarket(get)
    const trend = liquidCrypto(market, cfg.top)
    const measured = measuredContracts(liquidCrypto(market, 400))
    const symbols = new Map([...trend, ...measured].map((x) => [x.instId, x.symbol]))
    const symbolOf = (id: string) => symbols.get(id) ?? id.split('-')[0]

    // The universe of each track: where the reversal's edge was measured, or the most traded.
    const universe: Record<string, string[]> = {}
    for (const t of tracks) universe[t.key] = (t.strategy === 'reversal' ? measured : trend).map((x) => x.instId)

    // A dry run can pretend the ledger began earlier, to show what it would have recorded.
    const startedAt = options.pretendStart ?? now
    if (options.pretendStart !== undefined) ledger = { ...ledger, startedAt: options.pretendStart, since: {}, entries: [], processed: {} }
    const since = refreshSince(ledger.since, universe, startedAt)

    // BTC is the clock (its newest closed candle tells whether a bar has moved on) and the regime. Its spot
    // pair, or failing that the perpetual the board already lists.
    const perp = measured.find((x) => x.symbol === 'BTC')?.instId
    let btc = BTC_SPOT
    try {
      await latestClose(get, btc, '4H')
    } catch (err) {
      if (!perp) throw err
      errors.push(`${BTC_SPOT}: ${(err as Error).message}`)
      btc = perp
    }

    // Which bars have a candle that closed since the last pass.
    const due: TrackBar[] = []
    const latest: Partial<Record<TrackBar, number>> = {}
    for (const bar of new Set(tracks.map((t) => t.bar))) {
      try {
        latest[bar] = await latestClose(get, btc, bar)
      } catch (err) {
        errors.push(`${bar}: ${(err as Error).message}`)
        continue
      }
      if (dry || (latest[bar] ?? 0) > (ledger.processed[bar] ?? 0)) due.push(bar)
    }

    const observed: LedgerEntry[] = []
    const windows: Record<string, number> = {}
    const processed: Partial<Record<TrackBar, number>> = {}
    let scanned = 0

    if (due.length) {
      // BTC's regime, on its 4 h candles, whichever bar the entries came from.
      let regime: BtcRegime | null = null
      try {
        const r = btcRegime(toCandles(await candlesOf(get, btc, '4H')))
        if (r.bars >= REGIME_MIN_BARS) regime = r
        else errors.push(`régimen de BTC: solo ${r.bars} velas de 4 h, hacen falta ${REGIME_MIN_BARS}`)
      } catch (err) {
        errors.push(`régimen de BTC: ${(err as Error).message}`)
      }

      const deadline = t0 + BUDGET_MS
      for (const bar of due) {
        const barTracks = tracks.filter((t) => t.bar === bar)
        // Everything a track watches, plus whatever it still has open: those must be resolved even if
        // the contract has since dropped out of the most traded.
        const needed = new Map<string, TrackDef[]>()
        const want = (id: string, t: TrackDef) => {
          const have = needed.get(id) ?? []
          if (!have.includes(t)) needed.set(id, [...have, t])
        }
        for (const t of barTracks) {
          for (const id of universe[t.key]) want(id, t)
          for (const e of ledger.entries) {
            if (e.track === t.key && e.status === 'open' && !e.lost && !universe[t.key].includes(e.instId)) want(e.instId, t)
          }
        }
        let complete = true
        await pool([...needed.entries()], CONCURRENCY, async ([instId, defs]) => {
          if (Date.now() > deadline) {
            complete = false
            return
          }
          try {
            const candles = toCandles(await candlesOf(get, instId, bar))
            scanned++
            for (const def of defs) {
              const result = strategyByKey(def.strategy).run(candles, def.preset)
              observed.push(...entriesFromResult(def, instId, symbolOf(instId), candles, result, regime, now))
              if (candles.length) windows[`${def.key}|${instId}`] = candles[0].time
            }
          } catch (err) {
            complete = false
            errors.push(`${instId} ${bar}: ${(err as Error).message}`)
          }
        })
        if (complete && latest[bar]) processed[bar] = latest[bar]
      }
    }

    // ── merge and write, again from a fresh read when something else wrote first ──
    let merged = mergeObserved({ ...ledger, since }, observed, windows, now)
    const finish = (l: Ledger): Ledger => ({
      ...l,
      lastRun: now,
      runs: ledger.runs + 1,
      lockUntil: undefined,
      universe,
      since,
      processed: { ...l.processed, ...processed },
      lastError: errors.length ? errors.slice(0, 5).join(' · ') : undefined,
    })
    let next = finish(merged.ledger)
    if (!dry) {
      for (let attempt = 0; ; attempt++) {
        const w = await options.store.write(next, token)
        if (w.ok) {
          token = w.token
          break
        }
        if (attempt >= WRITE_TRIES - 1) throw new Error('El seguimiento cambió mientras se escribía; se reintenta en la próxima ejecución.')
        // Another run wrote between our read and our write: take its ledger and fold ours into it. If the store's
        // token has not moved, nobody did — it refused a condition that held — and the next write goes unconditional.
        const again = await options.store.read()
        token = again.token === token ? null : again.token
        const fresh = parseLedger(again.ledger) ?? emptyLedger(now)
        const fold = { ...fresh, since: refreshSince(fresh.since, universe, startedAt), processed: { ...fresh.processed } }
        merged = mergeObserved(fold, observed, windows, now)
        next = {
          ...finish(merged.ledger),
          since: fold.since,
          runs: fresh.runs + 1,
          processed: Object.fromEntries(
            TRACK_BARS.flatMap((b) => {
              const v = Math.max(fresh.processed[b] ?? 0, processed[b] ?? 0)
              return v ? [[b, v]] : []
            }),
          ),
        }
      }
    }

    // ── tell the phone, once: only the run whose write introduced an entry announces it ──
    const alerts = { sent: 0, failed: 0, channels: notifiers.map((n) => n.name) }
    const announce = merged.added.filter((e) => alertEligible(e, cfg, now))
    if (announce.length && notifiers.length) {
      // One message per contract, side and candle: strategies that fired on the same close are one signal.
      const groups = new Map<string, LedgerEntry[]>()
      for (const e of announce) {
        const key = `${e.instId}|${e.side}|${e.bar}|${e.at}`
        groups.set(key, [...(groups.get(key) ?? []), e])
      }
      const flags = new Map<string, 'sent' | 'failed'>()
      for (const group of groups.values()) {
        const message = formatAlert(group, options.appUrl)
        let ok = false
        for (const n of notifiers) {
          for (let attempt = 0; attempt < 2 && !ok; attempt++) {
            try {
              await n.send(message)
              ok = true
            } catch (err) {
              if (attempt === 1) errors.push(`${n.name}: ${(err as Error).message}`)
              else await sleep(800)
            }
          }
        }
        for (const e of group) flags.set(e.id, ok ? 'sent' : 'failed')
        if (ok) alerts.sent++
        else alerts.failed++
      }
      next = { ...next, entries: next.entries.map((e) => (flags.has(e.id) ? { ...e, alert: flags.get(e.id) } : e)) }
      // Recording the outcome is best effort: the announcement already went out.
      for (let attempt = 0; attempt < WRITE_TRIES; attempt++) {
        const w = await options.store.write(next, token)
        if (w.ok) break
        const again = await options.store.read()
        token = again.token
        const fresh = parseLedger(again.ledger)
        if (!fresh) break
        next = { ...fresh, entries: fresh.entries.map((e) => (flags.has(e.id) ? { ...e, alert: flags.get(e.id) } : e)) }
      }
    }

    return done({
      ...base(),
      status: 'ran',
      tracks: tracks.map((t) => t.key),
      scanned,
      added: merged.added.length,
      closed: merged.closed.length,
      alerts,
      ledger: next,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    errors.push(message)
    if (!dry) {
      // Release the claim and say why, so the next trigger is not locked out by this one's failure.
      try {
        const again = await options.store.read()
        const fresh = parseLedger(again.ledger) ?? ledger
        await options.store.write({ ...fresh, lockUntil: undefined, lastError: message }, again.token)
      } catch {
        // The claim expires on its own.
      }
    }
    return done(result({ status: 'failed', reason: message, ledger }))
  }
}

/** A message that is not a signal, through every configured channel (`notify.ts`). */
export const sendTest: typeof DeclaredTest = (env, appUrl) => sendTestAlerts(env, appUrl)

/** What the browser is told about the configuration: names and numbers, never a secret. */
export function describeWatch(env: Env) {
  const cfg = configFromEnv(env)
  return {
    channels: notifiersFromEnv(env).map((n) => n.name),
    top: cfg.top,
    bars: cfg.bars,
    alertBars: cfg.alertBars,
    alertSides: cfg.alertSides,
  }
}
