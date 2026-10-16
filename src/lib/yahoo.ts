import type { Candle } from './indicators/types'

/**
 * Daily candles of what OKX's equity, ETF and commodity perpetuals track, from
 * Yahoo's public chart endpoint. Server side only: the browser never calls it,
 * so the app's one credential boundary (the OKX proxy) is unchanged and nothing
 * here needs a key.
 *
 * Three things the first version of the research got wrong, kept here because
 * every one of them produces a plausible number:
 *
 *  - **Raw prices.** `quote.close` is adjusted for splits but not for dividends,
 *    which is what a position is opened and stopped at. The research used the
 *    total-return series first, and the bond ETFs' coupons were most of what it
 *    called an edge: +0.54 R long on bonds, currencies and commodities became
 *    +0.05 R on raw prices. A perpetual does not pay a dividend.
 *  - **Explicit dates.** `range=max` answers with MONTHLY bars whatever
 *    `interval` says; `period1`/`period2` answer daily.
 *  - **Only closed bars.** During the session the last bar is the day so far, and
 *    a signal computed on it can vanish at the close. A bar counts once the New
 *    York close has passed (`US_CLOSE_MS` after its date), so the session in
 *    progress is never read.
 */

/** 21:30 UTC: after New York's close in summer (20:00 UTC) and in winter (21:00 UTC), once Yahoo has settled the bar. */
export const US_CLOSE_MS = 21.5 * 3_600_000
export const DAY_MS = 86_400_000

export interface DailySeries {
  symbol: string
  /** Closed daily candles, oldest first, `time` the trading date at 00:00 UTC. */
  candles: Candle[]
  /** Close time of the newest closed bar (its date + `US_CLOSE_MS`); 0 with none. */
  closedAt: number
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000

interface Quote {
  open?: (number | null)[]
  high?: (number | null)[]
  low?: (number | null)[]
  close?: (number | null)[]
  volume?: (number | null)[]
}

interface ChartBody {
  chart?: {
    result?: { timestamp?: number[]; indicators?: { quote?: Quote[] } }[] | null
    error?: { code?: string; description?: string } | null
  }
}

/**
 * Yahoo's chart answer as candles. Rows with a missing price (a holiday, a
 * halt) are dropped, one bar is kept per date, and a bar whose session has not
 * closed by `now` is left out.
 */
export function parseChart(body: unknown, now: number): { candles: Candle[]; closedAt: number } {
  const chart = (body as ChartBody | null)?.chart
  if (chart?.error) throw new Error(chart.error.description || chart.error.code || 'Yahoo devolvió un error')
  const result = chart?.result?.[0]
  const q = result?.indicators?.quote?.[0]
  const stamps = result?.timestamp
  if (!result || !q || !stamps?.length) throw new Error('Yahoo no devolvió velas')
  const byDate = new Map<number, Candle>()
  for (let i = 0; i < stamps.length; i++) {
    const [o, h, l, c] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]]
    if (![o, h, l, c].every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)) continue
    // The stamp is the exchange's open (14:30 or 13:30 UTC): the same UTC date as the session.
    const time = Math.floor((stamps[i] * 1000) / DAY_MS) * DAY_MS
    if (time + US_CLOSE_MS > now) continue
    // Yahoo prints float32 noise (41.58000183105469): four decimals is what a quote has.
    byDate.set(time, {
      time,
      open: round4(o as number),
      high: round4(h as number),
      low: round4(l as number),
      close: round4(c as number),
      vol: q.volume?.[i] ?? 0,
      confirmed: true,
    })
  }
  const candles = [...byDate.values()].sort((a, b) => a.time - b.time)
  return { candles, closedAt: candles.length ? candles[candles.length - 1].time + US_CLOSE_MS : 0 }
}

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
const HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; cripto-monitor)', accept: 'application/json' }
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

export interface FetchOptions {
  fetch?: typeof fetch
  now?: number
  /** Years of history; six reach the EMA 200's three lengths of warm-up and then some. */
  years?: number
  /** Pause between retries, ms; tests set it to 0. */
  backoff?: number
}

/**
 * One symbol's closed daily candles. Retries a rate limit or a server error on
 * the other host with a growing pause — Yahoo answers cloud addresses with 429
 * more readily than a home connection — and throws with the last status when
 * every try failed.
 */
export async function fetchDaily(symbol: string, opts: FetchOptions = {}): Promise<DailySeries> {
  const run = opts.fetch ?? fetch
  const now = opts.now ?? Date.now()
  const years = opts.years ?? 6
  const step = opts.backoff ?? 700
  const period1 = Math.floor((now - years * 365 * DAY_MS) / 1000)
  const period2 = Math.floor(now / 1000) + 86_400
  let last = 'sin respuesta'
  for (let attempt = 0; attempt < 3; attempt++) {
    const host = HOSTS[attempt % HOSTS.length]
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div%7Csplit`
    try {
      const res = await run(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) })
      if (res.ok) return { symbol, ...parseChart(await res.json(), now) }
      last = `${res.status} ${res.statusText}`.trim()
      // A symbol Yahoo does not know will not be known on the second host either.
      if (res.status === 404) break
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
    await sleep(step * (attempt + 1))
  }
  throw new Error(`${symbol}: Yahoo ${last}`)
}

/** The newest closed bar's close time, from one cheap request: the clock the daily scan is gated on. */
export async function latestUsClose(symbol: string, opts: FetchOptions = {}): Promise<number> {
  const run = opts.fetch ?? fetch
  const now = opts.now ?? Date.now()
  const step = opts.backoff ?? 700
  let last = 'sin respuesta'
  for (let attempt = 0; attempt < 3; attempt++) {
    const host = HOSTS[attempt % HOSTS.length]
    try {
      const res = await run(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return parseChart(await res.json(), now).closedAt
      last = `${res.status} ${res.statusText}`.trim()
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
    await sleep(step * (attempt + 1))
  }
  throw new Error(`${symbol}: Yahoo ${last}`)
}
