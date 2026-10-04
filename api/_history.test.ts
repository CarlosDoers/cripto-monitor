import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// An in-memory blob store and a scripted OKX.
const store = new Map<string, string>()
vi.mock('@vercel/blob', () => ({
  get: vi.fn(async (path: string, opts: { access: string }) => {
    expect(opts.access).toBe('private')
    const text = store.get(path)
    if (text === undefined) throw Object.assign(new Error('Blob not found'), { name: 'BlobNotFoundError' })
    return { statusCode: 200, stream: new Response(text).body }
  }),
  put: vi.fn(async (path: string, body: string, opts: { access: string; allowOverwrite: boolean }) => {
    expect(opts.access).toBe('private')
    expect(opts.allowOverwrite).toBe(true)
    store.set(path, body)
    return { url: `blob://${path}` }
  }),
}))
vi.mock('./_okx.js', () => ({
  okxData: vi.fn(async (path: string) => {
    if (path.includes('asset-valuation')) return [{ totalBal: '15000' }]
    if (path.includes('balance')) return [{ totalEq: '9000' }]
    return [{ upl: '-100' }, { upl: '40' }]
  }),
  checkAccess: () => null,
}))

const { measure, readHistory, record } = await import('./_history.js')
const { default: history } = await import('./history.js')

const env = { ...process.env }
beforeEach(() => {
  store.clear()
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test'
  process.env.CRON_SECRET = 'c'.repeat(32)
})
afterEach(() => {
  process.env = { ...env }
})

describe('the net-worth history', () => {
  it('is off without a linked store', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    expect(await readHistory()).toEqual([])
    const res = await history.fetch(new Request('https://x/api/history'))
    expect(await res.json()).toEqual({ enabled: false, points: [] })
  })

  it('starts empty on a store with no file yet', async () => {
    expect(await readHistory()).toEqual([])
  })

  it('measures from OKX, not from what a client says', async () => {
    const p = await measure(Date.UTC(2026, 9, 4, 12))
    expect(p).toMatchObject({ date: '2026-10-04', netWorth: 15000, tradingEq: 9000, openPnl: -60 })
  })

  it('keeps one point a day, the last one recorded, in date order', async () => {
    await record({ date: '2026-10-05', at: 2, netWorth: 100, tradingEq: 0, openPnl: 0 })
    await record({ date: '2026-10-04', at: 1, netWorth: 90, tradingEq: 0, openPnl: 0 })
    const points = await record({ date: '2026-10-05', at: 3, netWorth: 110, tradingEq: 0, openPnl: 0 })
    expect(points.map((p) => [p.date, p.netWorth])).toEqual([
      ['2026-10-04', 90],
      ['2026-10-05', 110],
    ])
  })

  it('refuses to record an empty net worth', async () => {
    await expect(record({ date: '2026-10-04', at: 1, netWorth: 0, tradingEq: 0, openPnl: 0 })).rejects.toThrow()
  })

  it('lets the cron in only with its secret', async () => {
    const url = 'https://x/api/history?record=cron'
    expect((await history.fetch(new Request(url))).status).toBe(401)
    expect((await history.fetch(new Request(url, { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401)
    const ok = await history.fetch(new Request(url, { headers: { authorization: `Bearer ${'c'.repeat(32)}` } }))
    expect(ok.status).toBe(200)
    expect((await ok.json()).points).toHaveLength(1)
  })
})
