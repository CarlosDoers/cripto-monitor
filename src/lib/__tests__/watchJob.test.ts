import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alertEligible, configFromEnv, describeWatch, runWatch } from '../watchJob'
import { parseLedger, type Ledger } from '../ledger'

const H4 = 4 * 3_600_000
/** A 4 h boundary: 2026-10-15 12:00 UTC, which is when the 08:00 candle has just closed. */
const T0 = Date.UTC(2026, 9, 15, 12)
const ZEC = 'ZEC-USD_UM_XPERP-1'
const BTC_PERP = 'BTC-USD_UM_XPERP-1'

/**
 * A scripted OKX. Candles are a pure function of their index, so a later run sees
 * the same history plus the candles that closed since: ZEC sits flat at 100 and
 * breaks out at `breakoutAt`, BTC sits flat and then climbs, so it ends above its EMA.
 */
const BREAKOUT_K = T0 / H4 + 2

function candleAt(coin: 'ZEC' | 'BTC', k: number) {
  if (coin === 'BTC') {
    const close = k <= BREAKOUT_K - 500 ? 100 : 100 + (k - (BREAKOUT_K - 500)) * 0.5
    return { o: close, h: close + 0.5, l: close - 0.5, c: close, v: 10 }
  }
  if (k < BREAKOUT_K) return { o: 100, h: 100.5, l: 99.5, c: 100, v: 10 }
  if (k === BREAKOUT_K) return { o: 100, h: 102.5, l: 99.8, c: 102, v: 40 }
  // Then it climbs, so the long stays open and its trailing stop moves.
  const c = 102 + (k - BREAKOUT_K) * 1.5
  return { o: c - 1.5, h: c + 0.5, l: c - 2, c, v: 12 }
}

function okx(nowMs: () => number, calls: string[] = []) {
  return async <T,>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T[]> => {
    calls.push(`${path} ${params.instId ?? params.instType ?? ''} ${params.bar ?? ''}`.trim())
    if (path.endsWith('/public/instruments')) {
      return [
        { instId: ZEC, state: 'live', instCategory: '1' },
        { instId: BTC_PERP, state: 'live', instCategory: '1' },
      ] as unknown as T[]
    }
    if (path.endsWith('/market/tickers')) {
      return [
        { instId: ZEC, last: '102', volCcy24h: '900000' },
        { instId: BTC_PERP, last: '100', volCcy24h: '9000000' },
      ] as unknown as T[]
    }
    if (path.endsWith('/market/candles')) {
      const coin = String(params.instId).startsWith('ZEC') ? 'ZEC' : 'BTC'
      const lastClosed = Math.floor(nowMs() / H4) // index of the candle that closes at or before now, plus one
      const limit = Number(params.limit ?? 100)
      const after = params.after === undefined ? Infinity : Number(params.after) / H4
      const rows: string[][] = []
      for (let k = lastClosed - 1; rows.length < limit && k > lastClosed - 1 - 1500; k--) {
        if (k >= after) continue
        const c = candleAt(coin, k)
        rows.push([String(k * H4), String(c.o), String(c.h), String(c.l), String(c.c), String(c.v), '0', '0', '1'])
      }
      return rows as unknown as T[]
    }
    throw new Error(`unexpected ${path}`)
  }
}

/** In-memory store with optimistic concurrency, and a switch to make the next writes lose a race. */
function memoryStore(initial: unknown = null) {
  let data: string | null = initial === null ? null : JSON.stringify(initial)
  let version = 0
  let lose = 0
  let onLose: (() => void) | null = null
  return {
    async read() {
      return { ledger: data ? (JSON.parse(data) as unknown) : null, token: data ? String(version) : null }
    },
    async write(ledger: unknown, token: string | null) {
      if (lose > 0) {
        lose--
        onLose?.()
        return { ok: false, token }
      }
      if ((data ? String(version) : null) !== token) return { ok: false, token }
      data = JSON.stringify(ledger)
      version++
      return { ok: true, token: String(version) }
    },
    get ledger(): Ledger | null {
      return data ? parseLedger(JSON.parse(data)) : null
    },
    get version() {
      return data ? version : 0
    },
    /** The next `n` writes find that someone else wrote first. */
    race(n: number, whileLosing?: () => void) {
      lose = n
      onLose = whileLosing ?? null
    },
  }
}

const env = { WATCH_TOP: '5', WATCH_BARS: '4H', NTFY_TOPIC: 'topic-de-prueba' }

describe('configuration', () => {
  it('has sane defaults and clamps what it is given', () => {
    const d = configFromEnv({})
    expect(d).toMatchObject({ top: 20, bars: ['4H', '1H', '1D'], alertBars: ['4H', '1D'], alertSides: ['long', 'short'] })
    expect(d.maxAlertAgeMs).toBe(8 * 3_600_000)
    expect(configFromEnv({ WATCH_TOP: '1000' }).top).toBe(40)
    expect(configFromEnv({ WATCH_TOP: '2' }).top).toBe(5)
    expect(configFromEnv({ WATCH_BARS: '4h, nope, 1d' }).bars).toEqual(['4H', '1D'])
    expect(configFromEnv({ WATCH_ALERT_SIDES: 'LONG' }).alertSides).toEqual(['long'])
  })

  it('names the channels and never prints a secret', () => {
    const d = describeWatch({ NTFY_TOPIC: 'abc', TELEGRAM_BOT_TOKEN: 'secret-token', TELEGRAM_CHAT_ID: '42' })
    expect(d.channels).toEqual(['ntfy', 'telegram'])
    expect(JSON.stringify(d)).not.toContain('secret-token')
    expect(describeWatch({}).channels).toEqual([])
  })

  it('announces only what the config asks for, and nothing stale', () => {
    const cfg = configFromEnv({ WATCH_ALERT_SIDES: 'long' })
    const e = { bar: '4H', side: 'long', at: T0 - H4 } as Parameters<typeof alertEligible>[0]
    expect(alertEligible(e, cfg, T0)).toBe(true)
    expect(alertEligible({ ...e, side: 'short' }, cfg, T0)).toBe(false)
    expect(alertEligible({ ...e, bar: '1H' }, cfg, T0)).toBe(false)
    expect(alertEligible({ ...e, at: T0 - 9 * 3_600_000 }, cfg, T0)).toBe(false)
  })
})

describe('a run', () => {
  const sent: unknown[] = []
  beforeEach(() => {
    sent.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body))
        return new Response('{}', { status: 200 })
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('puts the contracts under watch and records nothing that came before', async () => {
    let clock = T0
    const store = memoryStore()
    const res = await runWatch({ get: okx(() => clock), store, env, now: clock })
    expect(res.status).toBe('ran')
    const l = store.ledger!
    expect(l.entries).toHaveLength(0)
    expect(l.since[`donchian/trend@4H|${ZEC}`]).toBe(T0)
    expect(l.universe['donchian/trend@4H']).toEqual([BTC_PERP, ZEC])
    expect(l.processed['4H']).toBe(T0)
    expect(l.lockUntil).toBeUndefined()
    expect(sent).toHaveLength(0)
    clock += 0
  })

  it('records a signal that appears afterwards exactly once, and announces it exactly once', async () => {
    let clock = T0
    const store = memoryStore()
    await runWatch({ get: okx(() => clock), store, env, now: clock })

    // Three candles later the breakout candle (the third of them) has closed.
    clock = T0 + 3 * H4
    const res = await runWatch({ get: okx(() => clock), store, env, now: clock, appUrl: 'https://app.test' })
    // The same close is a breakout for the plain channel, for the one filtered by the EMA and a cross of it.
    expect(res).toMatchObject({ status: 'ran', added: 3 })
    const l = store.ledger!
    expect(l.entries.map((e) => e.track).sort()).toEqual(['donchian/fast@4H', 'donchian/trend@4H', 'ema200/base@4H'])
    const zec = l.entries.filter((e) => e.instId === ZEC && e.track === 'donchian/trend@4H')
    expect(zec).toHaveLength(1)
    expect(zec[0]).toMatchObject({ side: 'long', entry: 102, status: 'open', alert: 'sent', symbol: 'ZEC' })
    // Entry at the close of the breakout candle: which is the end of the candle that opened at BREAKOUT_K.
    expect(zec[0].at).toBe((BREAKOUT_K + 1) * H4)
    expect(zec[0].btcAbove).toBe(true)
    expect(zec[0].volume).toBeCloseTo(4)
    expect(sent).toHaveLength(1)
    const msg = sent[0] as { topic: string; title: string; message: string; click: string }
    expect(msg.topic).toBe('topic-de-prueba')
    expect(msg.title).toBe('Señal nueva · ZEC · Long · 4 h')
    // One message for the three strategies that fired on that candle, each with its own line.
    expect(msg.message).toContain('Ruptura · Canal 20 + EMA 200 · 4 h: entrada')
    expect(msg.message).toContain('EMA 200 · 4 h: entrada')
    expect(msg.message).toContain('Ruptura · Canal 20 · 4 h: entrada')
    expect(msg.message).toContain('BTC sobre su EMA 200')
    expect(msg.message).toContain('Volumen 4,0×')
    expect(msg.click).toContain('https://app.test/#/estrategias?inst=ZEC-USD_UM_XPERP-1')

    // Run again, even forced: nothing new, nothing announced, nothing rewritten.
    const again = await runWatch({ get: okx(() => clock + 5 * H4), store, env, now: clock + 20 * 60_000, force: true })
    expect(again.added).toBe(0)
    expect(sent).toHaveLength(1)
    expect(store.ledger!.entries.filter((e) => e.instId === ZEC)).toHaveLength(3)
  })

  it('skips a second trigger that comes right behind the first', async () => {
    const clock = T0
    const store = memoryStore()
    await runWatch({ get: okx(() => clock), store, env, now: clock })
    const second = await runWatch({ get: okx(() => clock), store, env, now: clock + 60_000 })
    expect(second).toMatchObject({ status: 'skipped', reason: 'recent' })
  })

  it('does not collide with a run that is in progress', async () => {
    const store = memoryStore({
      version: 1,
      startedAt: 0,
      lastRun: 0,
      runs: 1,
      lockUntil: T0 + 60_000,
      since: {},
      universe: {},
      processed: {},
      entries: [],
    })
    const res = await runWatch({ get: okx(() => T0), store, env, now: T0 })
    expect(res).toMatchObject({ status: 'skipped', reason: 'locked' })
    // …but a lock that has run out does not block for ever.
    const later = await runWatch({ get: okx(() => T0), store, env, now: T0 + 120_000 })
    expect(later.status).toBe('ran')
  })

  it('folds its work into the ledger another run wrote first, without announcing twice', async () => {
    let clock = T0
    const store = memoryStore()
    await runWatch({ get: okx(() => clock), store, env, now: clock })
    clock = T0 + 3 * H4
    const calls: string[] = []
    // The claim goes through; the write of the result is the one that loses.
    let writes = 0
    const racing = {
      read: () => store.read(),
      write: async (l: unknown, t: string | null) => {
        writes++
        if (writes === 2) return { ok: false, token: t }
        return store.write(l, t)
      },
    }
    const res = await runWatch({ get: okx(() => clock, calls), store: racing, env, now: clock })
    expect(res.status).toBe('ran')
    expect(store.ledger!.entries.filter((e) => e.instId === ZEC)).toHaveLength(3)
    expect(sent).toHaveLength(1)
  })

  it('is not locked out by a store that refuses a condition that holds', async () => {
    // A validator the store does not honour: every conditional write is refused, though nobody else wrote.
    let clock = T0
    const inner = memoryStore()
    const stubborn = {
      read: () => inner.read(),
      write: async (l: unknown, t: string | null) => (t === null ? inner.write(l, inner.version === 0 ? null : String(inner.version)) : { ok: false, token: t }),
    }
    const first = await runWatch({ get: okx(() => clock), store: stubborn, env, now: clock })
    expect(first.status).toBe('ran')
    expect(inner.ledger?.runs).toBe(1)
    clock = T0 + 3 * H4
    const second = await runWatch({ get: okx(() => clock), store: stubborn, env, now: clock })
    expect(second.status).toBe('ran')
    expect(inner.ledger?.entries.length).toBe(3)
  })

  it('writes nothing and tells nobody on a dry run, even pretending it began earlier', async () => {
    const clock = T0 + 3 * H4
    const store = memoryStore()
    const res = await runWatch({ get: okx(() => clock), store, env, now: clock, dry: true, pretendStart: T0 })
    expect(res.status).toBe('ran')
    expect(store.ledger).toBeNull()
    expect(sent).toHaveLength(0)
    const entries = (res.ledger as Ledger).entries
    expect(entries.some((e) => e.instId === ZEC && e.side === 'long')).toBe(true)
  })

  it('follows an open entry to its end on a later run', async () => {
    let clock = T0
    const store = memoryStore()
    await runWatch({ get: okx(() => clock), store, env, now: clock })
    clock = T0 + 5 * H4
    await runWatch({ get: okx(() => clock), store, env, now: clock })
    const open = store.ledger!.entries.find((e) => e.instId === ZEC)!
    expect(open.status).toBe('open')
    expect(open.markR).toBeGreaterThan(0)
    expect(open.stopNow).toBeGreaterThanOrEqual(open.stop)
  })

  it('leaves the lock released and says why when OKX fails', async () => {
    const store = memoryStore()
    const res = await runWatch({
      get: async () => {
        throw Object.assign(new Error('OKX caído'), { status: 500 })
      },
      store,
      env,
      now: T0,
    })
    expect(res.status).toBe('failed')
    expect(res.reason).toContain('OKX caído')
    expect(store.ledger?.lockUntil).toBeUndefined()
    expect(store.ledger?.lastError).toContain('OKX caído')
  })
})

// ── the equities, ETFs and commodities track ──────────────────────────────────────────────────────────────────
const THU = Date.UTC(2026, 9, 15, 22) // after Thursday's New York close
const FRI = Date.UTC(2026, 9, 16, 22) // after Friday's
const DAY = 86_400_000
const SPY = 'SPY-USD_UM_XPERP-310613'
const XAU = 'XAU-USD_UM_XPERP-310502'
const SOXL = 'SOXL-USD_UM_XPERP-310627'

/** Weekday sessions (UTC dates at 00:00) from `count` sessions before `last`, up to and including `last`. */
function sessionsTo(last: number, count: number): number[] {
  const out: number[] = []
  for (let d = last; out.length < count; d -= DAY) {
    const wd = new Date(d).getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(d)
  }
  return out
}

/**
 * A scripted Yahoo. Every symbol sits flat at 100 for years and breaks out on the Friday session: above its 20-day
 * high and above its EMA 200, so the Canal 20 + EMA 200 enters long on that close. `down` makes one symbol fail.
 */
function yahoo(now: () => number, opts: { fail?: (symbol: string) => number | null; calls?: string[] } = {}) {
  return vi.fn(async (url: string) => {
    const u = new URL(url)
    const symbol = decodeURIComponent(u.pathname.split('/').pop() ?? '')
    opts.calls?.push(`${symbol}${u.searchParams.has('range') ? ' (sonda)' : ''}`)
    const status = opts.fail?.(symbol)
    if (status) return new Response('{}', { status, statusText: 'Too Many Requests' })
    const current = now()
    // The session in progress at `current` (before 21:30 UTC it is not closed and Yahoo still lists it).
    const today = Math.floor(current / DAY) * DAY
    const days = sessionsTo(new Date(today).getUTCDay() === 0 || new Date(today).getUTCDay() === 6 ? today - 2 * DAY : today, u.searchParams.has('range') ? 5 : 760)
    const breakout = Date.UTC(2026, 9, 16)
    const rows = days.map((d) => (d < breakout ? { o: 100, h: 100.5, l: 99.5, c: 100 } : { o: 100, h: 103.5, l: 99.8, c: 103 }))
    return new Response(
      JSON.stringify({
        chart: {
          result: [
            {
              timestamp: days.map((d) => (d + 14.5 * 3_600_000) / 1000),
              indicators: { quote: [{ open: rows.map((r) => r.o), high: rows.map((r) => r.h), low: rows.map((r) => r.l), close: rows.map((r) => r.c), volume: rows.map(() => 1000) }] },
            },
          ],
          error: null,
        },
      }),
      { status: 200 },
    )
  })
}

/** What a contract's book looks like in a test: deep, too thin for the usual size, wide but deep enough, or not answering. */
type Book = 'deep' | 'thin' | 'wide' | 'fail'
const level = (px: number, sz: number) => [String(px), String(sz), '0', '1']
const BOOKS: Record<Exclude<Book, 'fail'>, { asks: string[][]; bids: string[][]; ts: string }> = {
  // 3 bp each way for 5 000 $ behind a 6 bp spread, at one share a contract.
  deep: { asks: [level(100.03, 2000), level(100.1, 5000)], bids: [level(99.97, 2000), level(99.9, 5000)], ts: '0' },
  // 101 dollars on the ask: the usual size does not fit.
  thin: { asks: [level(101, 1)], bids: [level(99, 1)], ts: '0' },
  // Deep enough, and 50 bp each way: a whole R of spread against a stop 2 % away.
  wide: { asks: [level(100.5, 1000)], bids: [level(99.5, 1000)], ts: '0' },
}

/** The scripted OKX, plus a board that lists a stock/ETF, a commodity and a leveraged ETF as live perpetuals. */
function okxTrad(nowMs: () => number, extraStocks: string[] = [], book: (instId: string) => Book = () => 'deep') {
  const base = okx(nowMs)
  return async <T,>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T[]> => {
    if (path.endsWith('/public/instruments')) {
      return [
        { instId: ZEC, state: 'live', instCategory: '1' },
        { instId: BTC_PERP, state: 'live', instCategory: '1' },
        { instId: SPY, state: 'live', instCategory: '3', ctVal: '1' },
        { instId: XAU, state: 'live', instCategory: '4', ctVal: '1' },
        { instId: SOXL, state: 'live', instCategory: '3', ctVal: '1' },
        ...extraStocks.map((t) => ({ instId: `${t}-USD_UM_XPERP-310613`, state: 'live', instCategory: '3', ctVal: '1' })),
      ] as unknown as T[]
    }
    if (path.endsWith('/market/books')) {
      const kind = book(String(params.instId))
      if (kind === 'fail') throw new Error('libro caído')
      return [BOOKS[kind]] as unknown as T[]
    }
    if (path.endsWith('/public/funding-rate')) {
      const t = Date.UTC(2026, 9, 16, 16)
      // Gold pays a third of a year to its shorts; an index ETF's perpetual pays almost nothing.
      const rate = params.instId === XAU ? '0.0003' : '0.0000005'
      return [{ instId: params.instId, fundingRate: rate, fundingTime: String(t), nextFundingTime: String(t + 8 * 3_600_000) }] as unknown as T[]
    }
    return base<T>(path, params)
  }
}

describe('the equities track', () => {
  const sent: { title: string; message: string; click: string }[] = []
  const tradEnv = { ...env, WATCH_BARS: '4H' }
  const ntfy = () =>
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body))
      return new Response('{}', { status: 200 })
    })

  beforeEach(() => {
    sent.length = 0
    vi.stubGlobal('fetch', ntfy())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('writes a board of what it read and follows only what has evidence to be followed', async () => {
    const store = memoryStore()
    const res = await runWatch({ get: okxTrad(() => THU), store, env: tradEnv, now: THU, fetch: yahoo(() => THU) as never })
    expect(res.status).toBe('ran')
    expect(res.tracks).toContain('trad/trend@1D')
    const l = store.ledger!
    // The leveraged ETF is on the board but outside the universe the ledger follows.
    expect(l.universe['trad/trend@1D']).toEqual(['SPY', 'GLD'])
    expect(l.board?.rows.map((r) => r.okx).sort()).toEqual(['SOXL', 'SPY', 'XAU'])
    expect(l.board?.rows.find((r) => r.okx === 'XAU')).toMatchObject({ yahoo: 'GLD', kind: 'commodity', status: 'fuera' })
    // The board reads Thursday's session, closed at 21:30 UTC.
    expect(l.board?.asOf).toBe(Date.UTC(2026, 9, 15, 21, 30))
    expect(l.processed.us).toBe(Date.UTC(2026, 9, 15, 21, 30))
    expect(l.entries).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  it('records a breakout that appears on the next session, once, and tells the phone with the evidence and the funding', async () => {
    const store = memoryStore()
    await runWatch({ get: okxTrad(() => THU), store, env: tradEnv, now: THU, fetch: yahoo(() => THU) as never })
    const res = await runWatch({ get: okxTrad(() => FRI), store, env: tradEnv, now: FRI, fetch: yahoo(() => FRI) as never, appUrl: 'https://app.test' })
    expect(res.status).toBe('ran')
    const trad = store.ledger!.entries.filter((e) => e.track === 'trad/trend@1D')
    expect(trad.map((e) => `${e.instId}:${e.side}:${e.kind}`).sort()).toEqual(['GLD:long:commodity', 'SPY:long:index'])
    const spy = trad.find((e) => e.instId === 'SPY')!
    expect(spy).toMatchObject({ symbol: 'SPY', okxId: SPY, status: 'open', entry: 103, alert: 'sent' })
    // The entry is the close of Friday's session, 21:30 UTC.
    expect(spy.at).toBe(Date.UTC(2026, 9, 16, 21, 30))
    expect(store.ledger!.board?.rows.find((r) => r.okx === 'SPY')).toMatchObject({ status: 'nueva', age: 0 })
    // The leveraged ETF broke out too and is neither recorded nor announced.
    expect(store.ledger!.entries.some((e) => e.instId === 'SOXL')).toBe(false)

    expect(sent).toHaveLength(2)
    const gold = sent.find((m) => m.title.includes('XAU'))!
    expect(gold.title).toBe('Señal nueva · XAU (oro) · Long · 1 d')
    expect(gold.message).toContain('Tendencia diaria · bolsa, ETF y oro: entrada')
    expect(gold.message).toContain(`contrato en OKX: ${XAU}`)
    expect(gold.message).toContain('Cuatro series')
    expect(gold.message).toContain('financiación ahora: +32,9 % anual, la paga quien está largo')
    expect(gold.click).toBe('https://app.test/#/screener')
    const index = sent.find((m) => m.title.includes('SPY'))!
    expect(index.message).toContain('Medido en 1169 operaciones de 20 ETF')
    // What the book says about getting in, from a walk of the book for 5 000 $: 3 bp each way, 6 bp the round trip.
    expect(index.message).toContain('liquidez ahora: entrar con 5000 $ cuesta ~3,0 pb')
    expect(gold.message).toContain('liquidez ahora: entrar con 5000 $ cuesta ~3,0 pb')
    expect(index.message).toContain('sin contar comisiones')
    expect(index.message).toContain('stop 100,61 ')
    // The crypto tags were not measured on stocks and are not printed.
    expect(index.message).not.toContain('Volumen')
    expect(index.message).not.toContain('financiación')

    // The same close, read again: nothing new and nothing announced twice.
    const again = await runWatch({ get: okxTrad(() => FRI), store, env: tradEnv, now: FRI + 20 * 60_000, fetch: yahoo(() => FRI) as never, force: true })
    expect(again.added).toBe(0)
    expect(sent).toHaveLength(2)
  })

  it('records and follows a breakout whose book cannot take the usual size, and does not wake the phone for it', async () => {
    const store = memoryStore()
    const get = (t: () => number) => okxTrad(t, ['AAPL'], (id) => (id.startsWith('AAPL') ? 'thin' : 'deep'))
    await runWatch({ get: get(() => THU), store, env: tradEnv, now: THU, fetch: yahoo(() => THU) as never })
    const res = await runWatch({ get: get(() => FRI), store, env: tradEnv, now: FRI, fetch: yahoo(() => FRI) as never })
    const aapl = store.ledger!.entries.find((e) => e.instId === 'AAPL')!
    expect(aapl).toMatchObject({ status: 'open', kind: 'stock', side: 'long', alert: 'illiquid' })
    // It is on the board too, as any other: only the buzz is withheld.
    expect(store.ledger!.board?.rows.find((r) => r.okx === 'AAPL')).toMatchObject({ status: 'nueva' })
    expect(sent.some((m) => m.title.includes('AAPL'))).toBe(false)
    expect(sent.map((m) => m.title).sort()).toEqual(['Señal nueva · SPY · Long · 1 d', 'Señal nueva · XAU (oro) · Long · 1 d'])
    expect(res.alerts).toMatchObject({ sent: 2, failed: 0 })
    // Nothing is announced later either: the next pass finds it already settled.
    const again = await runWatch({ get: get(() => FRI), store, env: tradEnv, now: FRI + 20 * 60_000, fetch: yahoo(() => FRI) as never, force: true })
    expect(again.added).toBe(0)
    expect(sent).toHaveLength(2)
  })

  it('also withholds one whose book takes the size but charges a whole R for it', async () => {
    const store = memoryStore()
    const get = (t: () => number) => okxTrad(t, ['AAPL'], (id) => (id.startsWith('AAPL') ? 'wide' : 'deep'))
    await runWatch({ get: get(() => THU), store, env: tradEnv, now: THU, fetch: yahoo(() => THU) as never })
    await runWatch({ get: get(() => FRI), store, env: tradEnv, now: FRI, fetch: yahoo(() => FRI) as never })
    expect(store.ledger!.entries.find((e) => e.instId === 'AAPL')!.alert).toBe('illiquid')
    expect(sent).toHaveLength(2)
  })

  it('announces it with the line when the cap is switched off', async () => {
    const store = memoryStore()
    const open = { ...tradEnv, WATCH_TRAD_MAX_COST_R: 'off' }
    const get = (t: () => number) => okxTrad(t, ['AAPL'], (id) => (id.startsWith('AAPL') ? 'wide' : 'deep'))
    await runWatch({ get: get(() => THU), store, env: open, now: THU, fetch: yahoo(() => THU) as never })
    await runWatch({ get: get(() => FRI), store, env: open, now: FRI, fetch: yahoo(() => FRI) as never })
    expect(store.ledger!.entries.find((e) => e.instId === 'AAPL')!.alert).toBe('sent')
    const aapl = sent.find((m) => m.title.includes('AAPL'))!
    // 50 bp each way behind a stop about 2 % away: the message says what it costs, and the person decides.
    expect(aapl.message).toContain('liquidez ahora: entrar con 5000 $ cuesta ~50,0 pb')
    expect(sent).toHaveLength(3)
  })

  it('does not hold a message back because the book could not be read', async () => {
    const store = memoryStore()
    const get = (t: () => number) => okxTrad(t, [], (id) => (id.startsWith('SPY') ? 'fail' : 'deep'))
    await runWatch({ get: get(() => THU), store, env: tradEnv, now: THU, fetch: yahoo(() => THU) as never })
    await runWatch({ get: get(() => FRI), store, env: tradEnv, now: FRI, fetch: yahoo(() => FRI) as never })
    expect(store.ledger!.entries.find((e) => e.instId === 'SPY')!.alert).toBe('sent')
    const spy = sent.find((m) => m.title.includes('SPY'))!
    expect(spy.message).not.toContain('liquidez')
    // The other one still has its line.
    expect(sent.find((m) => m.title.includes('XAU'))!.message).toContain('liquidez ahora')
  })

  it('reads nothing while no new session has closed, and costs one request', async () => {
    const store = memoryStore()
    await runWatch({ get: okxTrad(() => THU), store, env: tradEnv, now: THU, fetch: yahoo(() => THU) as never })
    const calls: string[] = []
    // Friday morning: Thursday is still the newest session.
    const morning = Date.UTC(2026, 9, 16, 9)
    await runWatch({ get: okxTrad(() => morning), store, env: tradEnv, now: morning, fetch: yahoo(() => morning, { calls }) as never, force: true })
    expect(calls).toEqual(['SPY (sonda)'])
  })

  it('does not announce what the config leaves out, and can be switched off', async () => {
    const quiet = memoryStore()
    await runWatch({ get: okxTrad(() => THU), store: quiet, env: { ...tradEnv, WATCH_TRAD_KINDS: 'index' }, now: THU, fetch: yahoo(() => THU) as never })
    await runWatch({ get: okxTrad(() => FRI), store: quiet, env: { ...tradEnv, WATCH_TRAD_KINDS: 'index' }, now: FRI, fetch: yahoo(() => FRI) as never })
    // Both are recorded; only the index ETF is announced.
    expect(quiet.ledger!.entries.filter((e) => e.track === 'trad/trend@1D')).toHaveLength(2)
    expect(sent.map((m) => m.title)).toEqual(['Señal nueva · SPY · Long · 1 d'])

    const off = memoryStore()
    const calls: string[] = []
    const res = await runWatch({ get: okxTrad(() => THU), store: off, env: { ...tradEnv, WATCH_TRAD: 'off' }, now: THU, fetch: yahoo(() => THU, { calls }) as never })
    expect(res.tracks).not.toContain('trad/trend@1D')
    expect(calls).toEqual([])
    expect(off.ledger!.board).toBeUndefined()
  })

  it('survives Yahoo refusing: the crypto tracks still run and the session is read again next time', async () => {
    const store = memoryStore()
    const res = await runWatch({ get: okxTrad(() => THU), store, env: tradEnv, now: THU, fetch: yahoo(() => THU, { fail: () => 429 }) as never })
    expect(res.status).toBe('ran')
    expect(res.errors.join(' ')).toContain('Yahoo')
    const l = store.ledger!
    // The crypto clock moved and the equities one did not, so the next pass tries the session again.
    expect(l.processed['4H']).toBeGreaterThan(0)
    expect(l.processed.us).toBeUndefined()
    expect(l.board).toBeUndefined()
    expect(l.lastError).toContain('Yahoo')
  })

  it('counts a session as read when most of the table answered, and lists the symbol that did not', async () => {
    const store = memoryStore()
    // Six of the seven symbols answer; one never does (Yahoo does not know it).
    const stocks = ['AAPL', 'MSFT', 'NVDA', 'AMZN']
    const get = okxTrad(() => THU, stocks)
    const flaky = yahoo(() => THU, { fail: (s) => (s === 'MSFT' ? 404 : null) })
    const res = await runWatch({ get, store, env: tradEnv, now: THU, fetch: flaky as never })
    expect(res.status).toBe('ran')
    const l = store.ledger!
    expect(l.processed.us).toBe(Date.UTC(2026, 9, 15, 21, 30))
    expect(l.board?.rows.map((r) => r.okx)).not.toContain('MSFT')
    expect(l.board?.rows).toHaveLength(6)
    expect(l.board?.errors?.[0]).toContain('MSFT')
    expect(res.errors.join(' ')).toContain('MSFT')
  })

  it('does not count a session as read when too little of the table answered', async () => {
    const store = memoryStore()
    const stocks = ['AAPL', 'MSFT', 'NVDA', 'AMZN']
    const flaky = yahoo(() => THU, { fail: (s) => (['SPY', 'GLD', 'AAPL', 'MSFT'].includes(s) ? 500 : null) })
    await runWatch({ get: okxTrad(() => THU, stocks), store, env: tradEnv, now: THU, fetch: flaky as never })
    expect(store.ledger!.board).toBeUndefined()
    expect(store.ledger!.processed.us).toBeUndefined()
  })

  it('announces a daily signal for up to 30 hours, and an hourly one for 8', () => {
    const cfg = configFromEnv({})
    const daily = { track: 'trad/trend@1D', bar: '1D', side: 'long', kind: 'stock', at: T0 } as Parameters<typeof alertEligible>[0]
    expect(alertEligible(daily, cfg, T0 + 29 * 3_600_000)).toBe(true)
    expect(alertEligible(daily, cfg, T0 + 31 * 3_600_000)).toBe(false)
    // The kinds are the ones asked for: leveraged ETFs are never announced, and an entry without a kind is not either.
    expect(alertEligible({ ...daily, kind: 'leveraged' }, cfg, T0)).toBe(false)
    expect(alertEligible({ ...daily, kind: undefined }, cfg, T0)).toBe(false)
    expect(alertEligible(daily, configFromEnv({ WATCH_TRAD_ALERT: 'off' }), T0)).toBe(false)
    expect(alertEligible(daily, configFromEnv({ WATCH_TRAD_KINDS: 'index,commodity' }), T0)).toBe(false)
    // The crypto daily (the reversal) gets the longer window too; a 4 h signal keeps 8 hours.
    expect(alertEligible({ ...daily, track: 'reversal/tuned@1D', kind: undefined }, cfg, T0 + 20 * 3_600_000)).toBe(true)
    expect(alertEligible({ ...daily, track: 'donchian/trend@4H', bar: '4H', kind: undefined }, cfg, T0 + 9 * 3_600_000)).toBe(false)
  })

  it('has the equities track on by default and says so in the configuration it shows', () => {
    expect(configFromEnv({})).toMatchObject({ trad: true, tradAlert: true, tradKinds: ['index', 'commodity', 'stock'], tradMaxCostR: 0.15 })
    expect(describeWatch({}).trad).toEqual({ enabled: true, alert: true, kinds: ['index', 'commodity', 'stock'], maxCostR: 0.15 })
    expect(configFromEnv({ WATCH_TRAD: 'OFF' }).trad).toBe(false)
    // The cap on what a thin book may cost: a number of R, `off` for none, and the default for anything that is not one.
    expect(configFromEnv({ WATCH_TRAD_MAX_COST_R: '0.3' }).tradMaxCostR).toBe(0.3)
    expect(configFromEnv({ WATCH_TRAD_MAX_COST_R: 'off' }).tradMaxCostR).toBe(0)
    expect(configFromEnv({ WATCH_TRAD_MAX_COST_R: '0' }).tradMaxCostR).toBe(0)
    expect(configFromEnv({ WATCH_TRAD_MAX_COST_R: 'mucho' }).tradMaxCostR).toBe(0.15)
    expect(configFromEnv({ WATCH_TRAD_MAX_COST_R: '-1' }).tradMaxCostR).toBe(0.15)
  })
})
