import { describe, expect, it, vi } from 'vitest'
import { DAY_MS, fetchDaily, latestUsClose, parseChart, US_CLOSE_MS } from '../yahoo'

const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)
/** Yahoo stamps a session with the exchange's open: 14:30 UTC in summer. */
const stamp = (dayMs: number) => (dayMs + 14.5 * 3_600_000) / 1000

const body = (days: number[], close: (number | null)[] = days.map(() => 100)) => ({
  chart: {
    result: [
      {
        timestamp: days.map(stamp),
        indicators: {
          quote: [
            {
              open: close.map((c) => (c === null ? null : c - 1)),
              high: close.map((c) => (c === null ? null : c + 1)),
              low: close.map((c) => (c === null ? null : c - 2)),
              close,
              volume: days.map(() => 5000),
            },
          ],
        },
      },
    ],
    error: null,
  },
})

describe('parseChart', () => {
  const mon = day(2026, 10, 12)
  const days = [mon, mon + DAY_MS, mon + 2 * DAY_MS, mon + 3 * DAY_MS]

  it('keeps one closed candle per session, dated at 00:00 UTC, oldest first', () => {
    const afterThursdayClose = days[3] + US_CLOSE_MS + 60_000
    const { candles, closedAt } = parseChart(body(days, [100, 101, 102, 103]), afterThursdayClose)
    expect(candles.map((c) => c.close)).toEqual([100, 101, 102, 103])
    expect(candles.map((c) => c.time)).toEqual(days)
    expect(candles[0]).toMatchObject({ open: 99, high: 101, low: 98, vol: 5000, confirmed: true })
    expect(closedAt).toBe(days[3] + US_CLOSE_MS)
  })

  it('leaves out the session that has not closed, because a signal on it can vanish', () => {
    // Thursday at 16:00 UTC: New York is open and the last bar is the day so far.
    const during = days[3] + 16 * 3_600_000
    const { candles, closedAt } = parseChart(body(days, [100, 101, 102, 103]), during)
    expect(candles).toHaveLength(3)
    expect(closedAt).toBe(days[2] + US_CLOSE_MS)
  })

  it('drops rows with a missing price and a repeated date', () => {
    const dup = [...days, days[3]]
    const { candles } = parseChart(body(dup, [100, null, 102, 103, 104]), days[3] + 2 * DAY_MS)
    expect(candles.map((c) => c.time)).toEqual([days[0], days[2], days[3]])
    // The later of two rows for one date is the one kept.
    expect(candles.at(-1)?.close).toBe(104)
  })

  it('says what went wrong instead of returning nothing', () => {
    expect(() => parseChart({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }, 0)).toThrow('delisted')
    expect(() => parseChart({ chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } }, 0)).toThrow('velas')
    expect(() => parseChart(null, 0)).toThrow()
  })
})

describe('fetchDaily', () => {
  const now = day(2026, 10, 16) + 22 * 3_600_000
  const days = [day(2026, 10, 14), day(2026, 10, 15), day(2026, 10, 16)]
  const ok = () => new Response(JSON.stringify(body(days, [100, 101, 102])), { status: 200 })

  it('asks for explicit dates — `range=max` answers with monthly bars — on a browser-like agent', async () => {
    const run = vi.fn(async () => ok())
    const series = await fetchDaily('GLD', { fetch: run as never, now, backoff: 0 })
    expect(series.candles).toHaveLength(3)
    expect(series.closedAt).toBe(days[2] + US_CLOSE_MS)
    const [url, init] = run.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(url).toContain('/v8/finance/chart/GLD?period1=')
    expect(url).toContain('interval=1d')
    expect(url).not.toContain('range=max')
    expect(init.headers['user-agent']).toMatch(/Mozilla/)
  })

  it('retries a rate limit on the other host and then succeeds', async () => {
    const hosts: string[] = []
    const run = vi.fn(async (url: string) => {
      hosts.push(new URL(url).host)
      return hosts.length < 3 ? new Response('{}', { status: 429, statusText: 'Too Many Requests' }) : ok()
    })
    const series = await fetchDaily('SPY', { fetch: run as never, now, backoff: 0 })
    expect(series.candles).toHaveLength(3)
    expect(hosts).toEqual(['query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'query1.finance.yahoo.com'])
  })

  it('gives up on a symbol Yahoo does not know without trying the other host', async () => {
    const run = vi.fn(async () => new Response('{}', { status: 404, statusText: 'Not Found' }))
    await expect(fetchDaily('NOPE', { fetch: run as never, now, backoff: 0 })).rejects.toThrow('NOPE: Yahoo 404 Not Found')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('names the symbol and the last status when every try fails', async () => {
    const run = vi.fn(async () => new Response('{}', { status: 503, statusText: 'Service Unavailable' }))
    await expect(fetchDaily('QQQ', { fetch: run as never, now, backoff: 0 })).rejects.toThrow('QQQ: Yahoo 503 Service Unavailable')
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('treats a network error like a refusal', async () => {
    const run = vi.fn(async () => {
      throw new Error('fetch failed')
    })
    await expect(fetchDaily('SPY', { fetch: run as never, now, backoff: 0 })).rejects.toThrow('fetch failed')
  })
})

describe('latestUsClose', () => {
  it('is the close of the newest session that has finished, from one small request', async () => {
    const days = [day(2026, 10, 15), day(2026, 10, 16)]
    const run = vi.fn(async () => new Response(JSON.stringify(body(days)), { status: 200 }))
    // Friday morning: Thursday is the newest closed session.
    const morning = day(2026, 10, 16) + 9 * 3_600_000
    expect(await latestUsClose('SPY', { fetch: run as never, now: morning, backoff: 0 })).toBe(days[0] + US_CLOSE_MS)
    expect(String((run.mock.calls[0] as unknown as [string])[0])).toContain('range=5d')
  })
})
