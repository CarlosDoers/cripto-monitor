import { get, put } from '@vercel/blob'
import { okxData } from './_okx.js'

/**
 * The net worth, one point a day, kept by the app because OKX keeps none.
 *
 * Stored as one private JSON file in a Vercel Blob store: private, because it
 * is the account's money, and a public blob is readable by anyone with its URL.
 * The store's token (`BLOB_READ_WRITE_TOKEN`) is injected by Vercel when the
 * store is linked to the project; without it the history is simply off.
 *
 * A point is computed here, from OKX, never taken from the browser: a client
 * that could post its own figure could write any curve it liked.
 */

const PATH = 'history/net-worth.json'
/** Five years of days is ~100 KB; past that the oldest points go. */
const MAX_POINTS = 1825

export interface HistoryPoint {
  /** UTC day, YYYY-MM-DD: one point per day, the last one recorded wins. */
  date: string
  at: number
  /** `asset-valuation` total: every wallet, as the Resumen shows it. */
  netWorth: number
  /** Trading account equity. */
  tradingEq: number
  /** Unrealised PnL of the open positions at the time. */
  openPnl: number
}

export const historyEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN)

export async function readHistory(): Promise<HistoryPoint[]> {
  if (!historyEnabled()) return []
  try {
    const blob = await get(PATH, { access: 'private' })
    if (!blob || blob.statusCode !== 200) return []
    const text = await new Response(blob.stream).text()
    const points = JSON.parse(text) as HistoryPoint[]
    return Array.isArray(points) ? points : []
  } catch (err) {
    // A store with no file yet answers "not found": that is an empty history.
    if (err instanceof Error && /not.?found/i.test(err.name + err.message)) return []
    throw err
  }
}

/** Today's point, from OKX. */
export async function measure(now = Date.now()): Promise<HistoryPoint> {
  const [valuation, balance, positions] = await Promise.all([
    okxData<{ totalBal: string }>('/api/v5/asset/asset-valuation', { ccy: 'USD' }),
    okxData<{ totalEq: string }>('/api/v5/account/balance'),
    okxData<{ upl: string }>('/api/v5/account/positions'),
  ])
  return {
    date: new Date(now).toISOString().slice(0, 10),
    at: now,
    netWorth: Number(valuation[0]?.totalBal) || 0,
    tradingEq: Number(balance[0]?.totalEq) || 0,
    openPnl: positions.reduce((sum, p) => sum + (Number(p.upl) || 0), 0),
  }
}

/** Adds or replaces today's point and writes the file back. */
export async function record(point: HistoryPoint): Promise<HistoryPoint[]> {
  if (!(point.netWorth > 0)) throw new Error('OKX devolvió un patrimonio vacío; no se registra.')
  const points = (await readHistory()).filter((p) => p.date !== point.date)
  points.push(point)
  points.sort((a, b) => a.date.localeCompare(b.date))
  const kept = points.slice(-MAX_POINTS)
  await put(PATH, JSON.stringify(kept), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
  return kept
}
