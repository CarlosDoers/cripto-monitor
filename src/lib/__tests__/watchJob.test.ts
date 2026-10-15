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
