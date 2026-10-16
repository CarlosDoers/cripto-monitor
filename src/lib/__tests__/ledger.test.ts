import { describe, expect, it } from 'vitest'
import { btcRegime } from '../entryContext'
import { analyseDonchian, DONCHIAN_TREND_EVIDENCE, DONCHIAN_TREND_SETTINGS } from '../indicators/donchianBreakout'
import type { Candle, StrategyResult } from '../indicators/types'
import { expectedAt } from '../ledgerAge'
import {
  BAR_MS,
  contextSplits,
  emptyLedger,
  entriesFromResult,
  ledgerText,
  MAX_ENTRIES,
  mergeObserved,
  netR,
  noiseBand,
  offeredTracks,
  parseBoard,
  parseLedger,
  readLive,
  REFERENCE,
  refreshSince,
  trackLabel,
  trackStats,
  tradesToTell,
  type Ledger,
  type LedgerEntry,
} from '../ledger'

const H4 = BAR_MS['4H']
const NOW = Date.UTC(2026, 9, 15, 12)

const candle = (i: number, o: number, h: number, l: number, c: number, vol = 10): Candle => ({
  time: i * H4,
  open: o,
  high: h,
  low: l,
  close: c,
  vol,
  confirmed: true,
})
const flat = (from: number, n: number) => Array.from({ length: n }, (_, k) => candle(from + k, 100, 100.5, 99.5, 100))

const entry = (patch: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'donchian/trend@4H:ZEC-USD_UM_XPERP-1:1000',
  track: 'donchian/trend@4H',
  strategy: 'donchian',
  preset: 'trend',
  bar: '4H',
  instId: 'ZEC-USD_UM_XPERP-1',
  symbol: 'ZEC',
  side: 'long',
  at: 1000 + H4,
  entry: 100,
  stop: 98,
  status: 'open',
  feeR: 0.05,
  seen: 0,
  volume: 2,
  btcAbove: true,
  weekend: false,
  ...patch,
})

const ledgerWith = (patch: Partial<Ledger> = {}): Ledger => ({ ...emptyLedger(0), ...patch })

describe('what is tracked', () => {
  it('keeps the glossary\'s sample threshold equal to the one the app reads statistics with', async () => {
    const { MIN_SAMPLE } = await import('../performance')
    const { HELP } = await import('../glossary')
    // The help text prints the threshold it was written with: if the app's moves, this must follow.
    expect(JSON.stringify(HELP.trackingForward)).toContain(`${MIN_SAMPLE}`)
  })

  it('is whatever the registry offers, bar by bar', () => {
    const keys = offeredTracks().map((t) => t.key)
    expect(keys).toEqual(
      expect.arrayContaining(['donchian/fast@4H', 'donchian/trend@4H', 'donchian/trend@1H', 'ema200/base@4H', 'reversal/tuned@1D']),
    )
    // Blocked: the cross on 1 h (under the bar), the daily trend preset (unstable), the retired opening range.
    expect(keys).not.toContain('ema200/base@1H')
    expect(keys).not.toContain('donchian/trend@1D')
    expect(keys.some((k) => k.startsWith('opening/'))).toBe(false)
  })

  it('has a measured reference for every track it offers', () => {
    for (const t of offeredTracks()) expect(REFERENCE[t.key], t.key).toBeDefined()
  })

  it('quotes the same figures as the preset', () => {
    expect(REFERENCE['donchian/trend@4H'].net).toBe(DONCHIAN_TREND_EVIDENCE.board.net)
    expect(REFERENCE['donchian/trend@4H'].n).toBe(DONCHIAN_TREND_EVIDENCE.board.n)
    expect(REFERENCE['donchian/trend@1H'].net).toBe(DONCHIAN_TREND_EVIDENCE.hourly.net)
  })

  it('labels a track from the registry', () => {
    expect(trackLabel('donchian/trend@4H')).toBe('Ruptura · Canal 20 + EMA 200 · 4 h')
    expect(trackLabel('ema200/base@4H')).toBe('EMA 200 · 4 h')
    expect(trackLabel('reversal/tuned@1D')).toBe('Reversión · 1 d')
  })
})

describe('entries from a strategy result', () => {
  // 690 flat candles, a breakout, and a climb: a long open at the end.
  const rows = [
    ...flat(0, 690),
    candle(690, 100, 102.5, 99.8, 102),
    ...Array.from({ length: 9 }, (_, k) => {
      const c = 105 + 3 * k
      return candle(691 + k, c - 3, c + 0.5, c - 3.5, c)
    }),
  ]
  const def = offeredTracks().find((t) => t.key === 'donchian/trend@4H')!
  const result = analyseDonchian(rows, DONCHIAN_TREND_SETTINGS)
  const regime = btcRegime(rows)

  it('turns the open trade into an open entry with its trailing stop and its mark', () => {
    const [e] = entriesFromResult(def, 'ZEC-USD_UM_XPERP-1', 'ZEC', rows, result, regime, NOW)
    expect(e).toMatchObject({
      id: `donchian/trend@4H:ZEC-USD_UM_XPERP-1:${690 * H4}`,
      side: 'long',
      status: 'open',
      // The entry is at the close, which is the candle's end.
      at: 691 * H4,
      entry: 102,
      seen: NOW,
    })
    expect(e.stopNow).toBeGreaterThan(e.stop)
    expect(e.markR).toBeGreaterThan(0)
    expect(e.lastClose).toBe(rows.at(-1)!.close)
    expect(e.resultR).toBeUndefined()
    expect(e.volume).toBeCloseTo(1)
    expect(e.btcAbove).toBe(true)
  })

  it('carries the result of a closed one, and stores unknown context as null', () => {
    const closed: StrategyResult = {
      ...result,
      signals: [{ ...result.signals[0], outcome: 'loss', resultR: -1, closedIndex: 695, closedTime: 695 * H4, closedPrice: 100 }],
    }
    const [e] = entriesFromResult(def, 'X', 'X', rows, closed, null, NOW)
    expect(e).toMatchObject({ status: 'closed', resultR: -1, exit: 100, closedAt: 696 * H4, btcAbove: null })
    expect(e.markR).toBeUndefined()
  })
})

describe('the universe and its since', () => {
  it('keeps a contract that stays, starts a new one now and forgets one that left', () => {
    const since = { 'a@4H|AAA': 100, 'a@4H|BBB': 200 }
    const next = refreshSince(since, { 'a@4H': ['AAA', 'CCC'] }, 500)
    expect(next).toEqual({ 'a@4H|AAA': 100, 'a@4H|CCC': 500 })
    // BBB went out: when it comes back it starts again, so what it did meanwhile is not followed.
    expect(refreshSince(next, { 'a@4H': ['AAA', 'BBB', 'CCC'] }, 900)['a@4H|BBB']).toBe(900)
  })
})

describe('merging a run', () => {
  const key = 'donchian/trend@4H|ZEC-USD_UM_XPERP-1'

  it('records only what entered after the contract was put under watch', () => {
    const l = ledgerWith({ since: { [key]: 5000 } })
    const before = entry({ id: 'old', at: 5000 })
    const after = entry({ id: 'new', at: 5000 + H4 })
    const { ledger, added } = mergeObserved(l, [before, after], {}, NOW)
    expect(ledger.entries.map((e) => e.id)).toEqual(['new'])
    expect(added.map((e) => e.id)).toEqual(['new'])
    expect(ledger.entries[0].seen).toBe(NOW)
  })

  it('ignores a contract that is not under watch at all', () => {
    expect(mergeObserved(ledgerWith(), [entry()], {}, NOW).ledger.entries).toHaveLength(0)
  })

  it('is idempotent: the same observation twice adds nothing', () => {
    const l = ledgerWith({ since: { [key]: 0 } })
    const once = mergeObserved(l, [entry()], {}, NOW)
    const twice = mergeObserved(once.ledger, [entry()], {}, NOW + 1000)
    expect(twice.added).toHaveLength(0)
    expect(twice.ledger.entries).toEqual(once.ledger.entries)
    expect(twice.ledger.entries[0].seen).toBe(NOW)
  })

  it('closes an open entry when a later run sees it end, and then never rewrites it', () => {
    const l = ledgerWith({ since: { [key]: 0 } })
    const open = mergeObserved(l, [entry()], {}, NOW).ledger
    const ended = entry({ status: 'closed', resultR: 2.4, exit: 104.8, closedAt: 9 * H4, stopNow: undefined })
    const res = mergeObserved(open, [ended], {}, NOW + 1)
    expect(res.closed.map((e) => e.id)).toEqual([ended.id])
    expect(res.ledger.entries[0]).toMatchObject({ status: 'closed', resultR: 2.4, seen: NOW })
    // A later run computing something else for a closed entry does not change the record.
    const again = mergeObserved(res.ledger, [{ ...ended, resultR: -9 }], {}, NOW + 2)
    expect(again.ledger.entries[0].resultR).toBe(2.4)
  })

  it('does not touch the ledger that came in', () => {
    const l = ledgerWith({ since: { [key]: 0 }, entries: [entry()] })
    const frozen = JSON.stringify(l)
    mergeObserved(l, [entry({ status: 'closed', resultR: 1, exit: 1, closedAt: 1 })], {}, NOW)
    expect(JSON.stringify(l)).toBe(frozen)
  })

  it('sets aside an open entry older than the window it can still be followed in', () => {
    const l = ledgerWith({ since: { [key]: 0 }, entries: [entry({ at: 10 * H4 })] })
    // The run scanned this contract and its oldest candle is newer than the entry candle: it is lost, not open.
    const lost = mergeObserved(l, [], { [key]: 50 * H4 }, NOW).ledger.entries[0]
    expect(lost.lost).toBe(true)
    // A contract the run did not scan is left alone.
    expect(mergeObserved(l, [], {}, NOW).ledger.entries[0].lost).toBeUndefined()
    // And one the window still covers is a glitch, not a loss.
    expect(mergeObserved(l, [], { [key]: 0 }, NOW).ledger.entries[0].lost).toBeUndefined()
  })

  it('keeps the file under what a function may answer with', () => {
    // 4.5 MB is the limit on a response; an entry is a few hundred bytes of JSON.
    const sample = JSON.stringify(entry({ status: 'closed', resultR: 1.2345, exit: 123.456, closedAt: 123456789, markR: 1.2345, lastClose: 123.456, markedAt: 123456789 }))
    expect(MAX_ENTRIES * sample.length).toBeLessThan(2_500_000)
  })

  it('drops the oldest closed entries past the cap, never the open ones', () => {
    const many = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) =>
      entry({ id: `c${i}`, at: 1000 + i, status: 'closed', resultR: 1, closedAt: 2000 + i }),
    )
    const keepOpen = entry({ id: 'open-old', at: 1, status: 'open' })
    const { ledger } = mergeObserved(ledgerWith({ since: { [key]: 0 }, entries: [...many, keepOpen] }), [], {}, NOW)
    expect(ledger.entries).toHaveLength(MAX_ENTRIES)
    expect(ledger.entries.some((e) => e.id === 'open-old')).toBe(true)
    expect(ledger.entries.some((e) => e.id === 'c0')).toBe(false)
  })
})

describe('reading the ledger', () => {
  const closed = (id: string, resultR: number, patch: Partial<LedgerEntry> = {}) =>
    entry({ id, status: 'closed', resultR, feeR: 0.1, exit: 1, closedAt: 1, ...patch })

  it('nets the fee out of every closed trade and counts the open ones apart', () => {
    const es = [closed('a', 3), closed('b', -1), closed('c', -1), entry({ id: 'o', markR: 1, feeR: 0.1 })]
    const s = trackStats(es, 'donchian/trend@4H')
    expect(s).toMatchObject({ entries: 4, closed: 3, open: 1, wins: 1 })
    expect(s.meanNet).toBeCloseTo((2.9 - 1.1 - 1.1) / 3)
    expect(s.totalNet).toBeCloseTo(0.7)
    expect(s.openMark).toBeCloseTo(0.9)
    expect(s.best).toBeCloseTo(2.9)
    expect(netR(es[0])).toBeCloseTo(2.9)
  })

  it('leaves lost entries out of every figure', () => {
    const s = trackStats([closed('a', 3), closed('b', -1, { lost: true })], 'donchian/trend@4H')
    expect(s.closed).toBe(1)
  })

  it('says how far chance moves a mean, and how many trades it takes to tell the edge from zero', () => {
    expect(noiseBand(4, 16)).toBeCloseTo(1.96)
    expect(noiseBand(4, 16, 2.5)).toBeCloseTo(4.9)
    expect(noiseBand(4, 0)).toBeNaN()
    const ref = REFERENCE['donchian/trend@4H']
    // Independent trades would need about 540; signals that fire together are not independent: ×2.4², about 3 100.
    expect(tradesToTell(ref)).toBe(Math.ceil(((1.96 * 4.27) / 0.36) ** 2))
    expect(tradesToTell(ref, 'donchian/trend@4H')).toBe(Math.ceil(((1.96 * 2.4 * 4.27) / 0.36) ** 2))
    expect(tradesToTell(ref, 'donchian/trend@4H')).toBeGreaterThan(3000)
    expect(tradesToTell({ ...ref, net: 0 })).toBe(Infinity)
  })

  it('does not read a young ledger by its closed trades, which are the losers', () => {
    // Twenty trades, three days old: fifteen stopped out at −1 R and five running at +2 R. Their closed mean is
    // −0.8 R, and so would be any "live mean" — while the history's trades of that age were worth about the same.
    const at = 100 * H4
    const losers = Array.from({ length: 15 }, (_, i) => closed(`l${i}`, -1, { at, closedAt: at + 2 * H4 }))
    const runners = Array.from({ length: 5 }, (_, i) => entry({ id: `r${i}`, at, markR: 2, markedAt: at + 18 * H4, feeR: 0.1 }))
    const processed = { '4H': at + 18 * H4 } as const
    const s = trackStats([...losers, ...runners], 'donchian/trend@4H', processed)
    expect(s.meanNet).toBeCloseTo(-1.1)
    expect(s.versus!.n).toBe(20)
    // 15 × −1.1 and 5 × +1.9, against a history that was worth +0.17 at 18 bars: close, and well inside the noise.
    expect(s.versus!.mean).toBeCloseTo((15 * -1.1 + 5 * 1.9) / 20)
    expect(s.versus!.expected).toBeCloseTo(0.167, 2)
    expect(readLive(s)).toBe('compatible')
  })

  it('reads a long ledger against the history at the same ages, and says when it is clear of the noise', () => {
    // 400 trades all at 576 bars (long settled: the history was worth about +0.33 R by then).
    const at = 100 * H4
    const make = (n: number, r: number) =>
      Array.from({ length: n }, (_, i) => closed(`t${r}-${i}`, r + 0.1, { at, closedAt: at + 50 * H4 }))
    const processed = { '4H': at + 576 * H4 } as const
    expect(readLive(trackStats(make(400, -1), 'donchian/trend@4H', processed))).toBe('por-debajo')
    expect(readLive(trackStats(make(400, 2), 'donchian/trend@4H', processed))).toBe('por-encima')
    expect(readLive(trackStats(make(400, 0.2), 'donchian/trend@4H', processed))).toBe('compatible')
    expect(readLive(trackStats(make(3, 0.2), 'donchian/trend@4H', processed))).toBe('sin-muestra')
  })

  it('has a history curve for every track that is offered, with the shape the argument needs', () => {
    for (const t of offeredTracks()) {
      const young = expectedAt(t.key, 6)!
      const old = expectedAt(t.key, 2400)!
      expect(young, t.key).not.toBeNull()
      // A young trade is worth little and varies little; a settled one is worth its strategy's mean.
      expect(young.sd).toBeLessThan(old.sd)
      expect(young.mean).toBeLessThan(old.mean)
      expect(old.mean).toBeCloseTo(REFERENCE[t.key].net, 0)
    }
    // Between the grid's ages it interpolates, and past the last it stays flat.
    const a = expectedAt('donchian/trend@4H', 12)!.mean
    const b = expectedAt('donchian/trend@4H', 18)!.mean
    expect(expectedAt('donchian/trend@4H', 15)!.mean).toBeCloseTo((a + b) / 2)
    expect(expectedAt('donchian/trend@4H', 99999)!.mean).toBe(expectedAt('donchian/trend@4H', 2400)!.mean)
  })

  it('splits the trades by what was true at entry, each against the history at its own age', () => {
    // All long settled (576 bars), where the history was worth about +0.33 R.
    const old = { at: 100 * H4, closedAt: 200 * H4 }
    const processed = { '4H': 100 * H4 + 576 * H4 } as const
    const exp = expectedAt('donchian/trend@4H', 576)!.mean
    const es = [
      closed('a', 3, { ...old, volume: 2, btcAbove: true }),
      closed('b', 1, { ...old, volume: 2, btcAbove: true }),
      closed('c', -1, { ...old, volume: 0.5, btcAbove: false }),
      closed('d', -1, { ...old, volume: null, btcAbove: null, weekend: true }),
      closed('e', 5, { ...old, side: 'short', volume: 3, btcAbove: true }),
    ]
    const s = contextSplits(es, 'donchian/trend@4H', processed)
    expect(s.volume.with).toEqual({ n: 3, mean: expect.closeTo((2.9 + 0.9 + 4.9) / 3 - exp) })
    expect(s.volume.without.n).toBe(1)
    // Longs only: a and b are with BTC above; c against; d unknown; the short is not a long.
    expect(s.longs.with.n).toBe(2)
    expect(s.longs.without.n).toBe(1)
    expect(s.weekend.with.n).toBe(1)
  })

  it('writes the arithmetic into the text before any verdict', () => {
    const text = ledgerText(ledgerWith({ startedAt: Date.UTC(2026, 9, 1), entries: [closed('a', 2)] }), NOW)
    expect(text).toContain('# Seguimiento en vivo')
    expect(text).toContain('Banda de ruido')
    expect(text).toContain('las operaciones cerradas de un registro joven son casi todas pérdidas')
    expect(text).toContain('sin muestra para opinar')
    expect(text).toContain('Ruptura · Canal 20 + EMA 200 · 4 h')
  })
})

// ── the equities, ETFs and commodities track ─────────────────────────────────────────────────────────────────
describe('the equities track', () => {
  const DAYMS = 86_400_000
  const US_CLOSE = 21.5 * 3_600_000
  const trad = offeredTracks().find((t) => t.market === 'trad')!
  const session = (i: number, o: number, h: number, l: number, c: number): Candle => ({
    time: Date.UTC(2026, 0, 5) + i * DAYMS,
    open: o,
    high: h,
    low: l,
    close: c,
    vol: 1000,
    confirmed: true,
  })
  const candlesFor = [...Array.from({ length: 10 }, (_, i) => session(i, 100, 100.5, 99.5, 100)), session(10, 100, 103.5, 99.8, 103)]
  const long = { index: 10, time: candlesFor[10].time, side: 'long' as const, entry: 103, stop: 100.6, outcome: 'open' as const, feeR: 0.04, stopNow: 101 }
  const short = { ...long, side: 'short' as const, stop: 105.4, stopNow: undefined }
  const result = { signals: [long, short], overlays: [], warmup: 0, active: long } as unknown as StrategyResult

  it('is offered on a New York clock, long only, with its own reference and age curve', () => {
    expect(trad).toMatchObject({ key: 'trad/trend@1D', bar: '1D', market: 'trad', sides: ['long'], closeMs: US_CLOSE })
    expect(REFERENCE[trad.key].shorts).toBeLessThan(0)
    // Ages are calendar days: the curve for this track runs to two years, not to the 2 400 bars of a 4 h one.
    expect(expectedAt(trad.key, 730)).not.toBeNull()
    expect(offeredTracks().filter((t) => t.market === 'crypto').every((t) => t.closeMs === t.barMs)).toBe(true)
  })

  it('closes a session at 21:30 UTC, keeps only the longs and remembers what kind of contract it was', () => {
    const es = entriesFromResult(trad, 'SPY', 'SPY', candlesFor, result, null, NOW, { kind: 'index', okxId: 'SPY-USD_UM_XPERP-310613' })
    expect(es).toHaveLength(1)
    expect(es[0]).toMatchObject({ track: 'trad/trend@1D', side: 'long', kind: 'index', okxId: 'SPY-USD_UM_XPERP-310613', btcAbove: null })
    expect(es[0].at).toBe(candlesFor[10].time + US_CLOSE)
    expect(es[0].markedAt).toBe(candlesFor[10].time + US_CLOSE)
    // A crypto entry does not carry the fields.
    const crypto = entriesFromResult(offeredTracks().find((t) => t.key === 'donchian/trend@4H')!, 'X', 'X', candlesFor, result, null, NOW)
    expect(crypto.every((e) => e.kind === undefined && e.okxId === undefined)).toBe(true)
  })

  it('sets aside an open entry older than the window by the candle it began on, not by a daily bar', () => {
    const e = entry({ id: 'trad/trend@1D:SPY:1', track: 'trad/trend@1D', bar: '1D', instId: 'SPY', at: candlesFor[3].time + US_CLOSE })
    // The window starts after that session: it can no longer be followed.
    const lost = mergeObserved(ledgerWith({ entries: [e] }), [], { 'trad/trend@1D|SPY': candlesFor[5].time }, NOW)
    expect(lost.ledger.entries[0].lost).toBe(true)
    // The window's first candle is the entry's own: the entry is still inside it.
    const kept = mergeObserved(ledgerWith({ entries: [e] }), [], { 'trad/trend@1D|SPY': candlesFor[3].time }, NOW)
    expect(kept.ledger.entries[0].lost).toBeUndefined()
  })

  it('reads its entries against the New York clock, not OKX\'s daily one', () => {
    const start = Date.UTC(2026, 8, 1) + US_CLOSE
    const e = entry({ id: 't1', track: 'trad/trend@1D', bar: '1D', instId: 'SPY', at: start, status: 'closed', resultR: 1, feeR: 0.04, exit: 1, closedAt: start + 3 * DAYMS })
    const lateUs = start + 30 * DAYMS
    // `us` is the clock for this track; the crypto daily one is far behind and must not matter.
    const a = trackStats([e], 'trad/trend@1D', { '1D': start, us: lateUs }).versus!
    const b = trackStats([e], 'trad/trend@1D', { '1D': lateUs + 300 * DAYMS, us: lateUs }).versus!
    expect(a.expected).toBeCloseTo(b.expected, 10)
    // Thirty calendar days old at the last session: the curve at 30 days, between its 28 and 42 day points.
    expect(a.expected).toBeCloseTo(expectedAt('trad/trend@1D', 30)!.mean, 6)
  })

  it('keeps the board through the stored form and ignores one that is not a board', () => {
    const board = {
      at: 5,
      asOf: 9,
      rows: [{ yahoo: 'SPY', okx: 'SPY', instId: 'SPY-USD_UM_XPERP-1', kind: 'index', status: 'cerca', bars: 700, asOf: 9, price: 100 }],
      errors: ['X: Yahoo 404'],
    }
    const parsed = parseLedger(JSON.parse(JSON.stringify({ ...emptyLedger(1), board })))!
    expect(parsed.board).toEqual(board)
    expect(parseLedger({ ...emptyLedger(1), board: 'nope' })!.board).toBeUndefined()
    expect(parseLedger({ ...emptyLedger(1), board: { rows: [{ status: 'nueva' }, 7, null] } })!.board?.rows).toEqual([])
    expect(parseBoard(undefined)).toBeUndefined()
  })

  it('writes the board into the text Claude reads, with the evidence and the comparison with SPY', () => {
    const row = (okx: string, status: 'nueva' | 'cerca' | 'tendencia' | 'fuera' | 'corto', extra = {}) => ({
      yahoo: okx,
      okx,
      instId: `${okx}-USD_UM_XPERP-1`,
      kind: 'stock' as const,
      status,
      bars: 700,
      asOf: Date.UTC(2026, 9, 15, 21, 30),
      price: 100,
      ...extra,
    })
    const board = {
      at: NOW,
      asOf: Date.UTC(2026, 9, 15, 21, 30),
      rows: [row('AAPL', 'nueva'), row('GOOGL', 'cerca', { distanceAtr: 1.7 }), row('MSFT', 'tendencia'), row('NVDA', 'fuera'), row('SOXL', 'nueva', { kind: 'leveraged' })],
    }
    const text = ledgerText(ledgerWith({ startedAt: Date.UTC(2026, 9, 1), board }), NOW)
    expect(text).toContain('## Bolsa, ETF y oro · tendencia diaria, solo largos')
    expect(text).toContain('Señal nueva (las dos últimas sesiones): AAPL (acción)')
    expect(text).toContain('GOOGL (a 1,7 ATR del máximo)')
    // The leveraged ETF is on the board but is not something the rule follows.
    expect(text).not.toContain('SOXL')
    expect(text).toContain('supervivientes')
    expect(text).toContain('0,32 de Sharpe contra 0,64 de SPY')
    expect(text).toContain('contexto, no una recomendación')
  })
})
