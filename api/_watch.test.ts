import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// An in-memory blob store with ETags, so the conditional write can be exercised.
const blobs = new Map<string, { text: string; etag: string }>()
let etags = 0
class BlobPreconditionFailedError extends Error {
  constructor() {
    super('Precondition failed: ETag mismatch')
    this.name = 'BlobPreconditionFailedError'
  }
}
vi.mock('@vercel/blob', () => ({
  BlobPreconditionFailedError,
  get: vi.fn(async (path: string, opts: { access: string; useCache?: boolean }) => {
    expect(opts.access).toBe('private')
    // A read followed by a write must not be served from a CDN cache.
    expect(opts.useCache).toBe(false)
    const b = blobs.get(path)
    if (!b) throw Object.assign(new Error('Blob not found'), { name: 'BlobNotFoundError' })
    return { statusCode: 200, stream: new Response(b.text).body, blob: { etag: b.etag } }
  }),
  put: vi.fn(async (path: string, body: string, opts: { access: string; ifMatch?: string }) => {
    expect(opts.access).toBe('private')
    const current = blobs.get(path)
    if (opts.ifMatch && current?.etag !== opts.ifMatch) throw new BlobPreconditionFailedError()
    const etag = `"${++etags}"`
    blobs.set(path, { text: body, etag })
    return { url: `blob://${path}`, etag }
  }),
}))
vi.mock('./_okx.js', () => ({
  okxData: vi.fn(),
  checkAccess: (request: Request) => (request.headers.get('x-app-token') === 'ok' ? null : Response.json({ error: 'unauthorized' }, { status: 401 })),
}))

const { createWatchHandler } = await import('./_watchHandler.js')
const { ledgerStore, ledgerStorage } = await import('./_ledger.js')

const env = { ...process.env }
const CRON = `Bearer ${'c'.repeat(32)}`

import type { RunResult, TestResult } from './_watch.js'

const result = (patch: Partial<RunResult> = {}): RunResult => ({
  status: 'ran',
  tracks: [],
  scanned: 0,
  added: 0,
  closed: 0,
  alerts: { sent: 0, failed: 0, channels: [] },
  errors: [],
  ms: 1,
  ledger: { version: 1 },
  ...patch,
})

const deps = (
  runWatch = vi.fn(async (): Promise<RunResult> => result()),
  sendTest = vi.fn(async (): Promise<TestResult> => ({ channels: [{ name: 'ntfy', ok: true }] })),
) => ({
  runWatch,
  describeWatch: () => ({ channels: ['ntfy'], top: 20 }),
  sendTest,
  get: vi.fn(),
})

beforeEach(() => {
  blobs.clear()
  etags = 0
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test'
  process.env.WATCH_STORAGE = 'blob'
  delete process.env.VERCEL
  process.env.CRON_SECRET = 'c'.repeat(32)
})
afterEach(() => {
  process.env = { ...env }
})

describe('where the ledger is kept', () => {
  it('is the linked store on a deployment, a local file in development and nothing on a deployment without one', () => {
    process.env.VERCEL = '1'
    expect(ledgerStorage()).toBe('blob')
    delete process.env.BLOB_READ_WRITE_TOKEN
    expect(ledgerStorage()).toBeNull()
    expect(ledgerStore()).toBeNull()
    // Locally: a file, even with the production store's token in .env.local, unless the store is asked for.
    delete process.env.VERCEL
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test'
    delete process.env.WATCH_STORAGE
    expect(ledgerStorage()).toBe('file')
    process.env.WATCH_STORAGE = 'blob'
    expect(ledgerStorage()).toBe('blob')
  })

  it('refuses a write made on a stale read, so two runs cannot overwrite each other', async () => {
    const store = ledgerStore()!
    expect(await store.read()).toEqual({ ledger: null, token: null })
    const first = await store.write({ n: 1 }, null)
    expect(first.ok).toBe(true)
    const stale = first.token
    expect((await store.write({ n: 2 }, stale)).ok).toBe(true)
    // Someone else wrote after we read: our token is no longer current.
    expect((await store.write({ n: 3 }, stale)).ok).toBe(false)
    expect((await store.read()).ledger).toEqual({ n: 2 })
  })

  it('hands the store the strong validator even when a read gave it the weak one', async () => {
    // `get` answers a large body with W/"…", and the store only honours ifMatch against the strong form.
    const { put } = await import('@vercel/blob')
    blobs.set('watch/ledger.json', { text: '{"version":1}', etag: 'W/"abc123"' })
    const store = ledgerStore()!
    const read = await store.read()
    expect(read.token).toBe('"abc123"')
    blobs.set('watch/ledger.json', { text: '{"version":1}', etag: '"abc123"' })
    await store.write({ version: 1 }, read.token)
    expect(vi.mocked(put).mock.calls.at(-1)![2]).toMatchObject({ ifMatch: '"abc123"' })
  })

  it('does the same with the local file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watch-'))
    try {
      delete process.env.WATCH_STORAGE
      process.env.WATCH_LOCAL_DIR = dir
      const store = ledgerStore()!
      expect(await store.read()).toEqual({ ledger: null, token: null })
      const a = await store.write({ n: 1 }, null)
      expect(a.ok).toBe(true)
      expect((await store.read()).ledger).toEqual({ n: 1 })
      expect((await store.write({ n: 2 }, null)).ok).toBe(false)
      expect((await store.write({ n: 2 }, a.token)).ok).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('the endpoint', () => {
  it('says it is off, with its configuration, where nothing can store the ledger', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    process.env.VERCEL = '1'
    const res = await createWatchHandler(deps())(new Request('https://x/api/watch'))
    expect(await res.json()).toEqual({ enabled: false, ledger: null, config: { channels: ['ntfy'], top: 20 } })
  })

  it('serves the ledger only behind the app password', async () => {
    const handler = createWatchHandler(deps())
    expect((await handler(new Request('https://x/api/watch'))).status).toBe(401)
    const ok = await handler(new Request('https://x/api/watch', { headers: { 'x-app-token': 'ok' } }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ enabled: true, storage: 'blob', ledger: null })
  })

  it('lets a scheduler in only with the cron secret, and the browser only with the password', async () => {
    const run = deps().runWatch
    const handler = createWatchHandler({ ...deps(), runWatch: run })
    const url = 'https://x/api/watch?run=cron'
    expect((await handler(new Request(url))).status).toBe(401)
    expect((await handler(new Request(url, { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401)
    // The app password is not the scheduler's key.
    expect((await handler(new Request(url, { headers: { 'x-app-token': 'ok' } }))).status).toBe(401)
    expect(run).not.toHaveBeenCalled()
    const res = await handler(new Request(url, { headers: { authorization: CRON } }))
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledTimes(1)
    expect(await res.json()).toMatchObject({ enabled: true, run: { status: 'ran' } })
  })

  it('runs a pass on POST from the app, pointing links at the address it was reached on', async () => {
    const run = deps().runWatch
    const handler = createWatchHandler({ ...deps(), runWatch: run })
    await handler(new Request('https://mi-app.vercel.app/api/watch', { method: 'POST', headers: { 'x-app-token': 'ok' } }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ appUrl: 'https://mi-app.vercel.app', dry: false, force: false }))
    // APP_URL wins when set.
    process.env.APP_URL = 'https://panel.mi-dominio.es'
    await handler(new Request('https://mi-app.vercel.app/api/watch', { method: 'POST', headers: { 'x-app-token': 'ok' } }))
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ appUrl: 'https://panel.mi-dominio.es' }))
  })

  it('does not let the browser force a pass past the guards', async () => {
    const run = deps().runWatch
    const handler = createWatchHandler({ ...deps(), runWatch: run })
    await handler(new Request('https://x/api/watch?force=1', { method: 'POST', headers: { 'x-app-token': 'ok' } }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ force: false }))
  })

  it('answers 502 with the reason when the run fails', async () => {
    const failing = vi.fn(async (): Promise<RunResult> => result({ status: 'failed', reason: 'OKX caído', errors: ['OKX caído'], ledger: null }))
    const res = await createWatchHandler(deps(failing))(new Request('https://x/api/watch', { method: 'POST', headers: { 'x-app-token': 'ok' } }))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ run: { status: 'failed', reason: 'OKX caído' } })
  })

  it('answers its pulse without the ledger when asked for the meta', async () => {
    const handler = createWatchHandler(deps())
    const empty = await handler(new Request('https://x/api/watch?meta=1', { headers: { 'x-app-token': 'ok' } }))
    expect(await empty.json()).toMatchObject({ enabled: true, storage: 'blob', meta: { exists: false, lastRun: 0, entries: 0 } })
    // A ledger exists: its size and last run come back, its entries do not.
    const store = ledgerStore()!
    await store.write({ version: 1, startedAt: 5, lastRun: 77, runs: 3, entries: [{ id: 'a' }, { id: 'b' }] }, null)
    const res = await handler(new Request('https://x/api/watch?meta=1', { headers: { 'x-app-token': 'ok' } }))
    const body = await res.json()
    expect(body.meta).toMatchObject({ exists: true, startedAt: 5, lastRun: 77, runs: 3, entries: 2 })
    expect(body.ledger).toBeUndefined()
  })

  describe('the test message', () => {
    const post = (headers: Record<string, string> = { 'x-app-token': 'ok' }, path = '/api/watch?notify=test') =>
      new Request(`https://mi-app.vercel.app${path}`, { method: 'POST', headers })

    it('is sent only behind the password, and runs no pass', async () => {
      const run = deps().runWatch
      const send = deps().sendTest
      const handler = createWatchHandler({ ...deps(run, send) })
      expect((await handler(post({}))).status).toBe(401)
      expect(send).not.toHaveBeenCalled()
      const res = await handler(post())
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ test: { channels: [{ name: 'ntfy', ok: true }] } })
      expect(send).toHaveBeenCalledTimes(1)
      expect(run).not.toHaveBeenCalled()
    })

    it('points its link at the address it was reached on, or at APP_URL', async () => {
      const send = deps().sendTest
      const handler = createWatchHandler({ ...deps(undefined, send) })
      await handler(post())
      expect(send).toHaveBeenLastCalledWith(expect.anything(), 'https://mi-app.vercel.app')
      process.env.APP_URL = 'https://panel.mi-dominio.es'
      await handler(post())
      expect(send).toHaveBeenLastCalledWith(expect.anything(), 'https://panel.mi-dominio.es')
    })

    it('does not need the ledger to exist: a deployment without a store can still test its channels', async () => {
      process.env.VERCEL = '1'
      delete process.env.BLOB_READ_WRITE_TOKEN
      const res = await createWatchHandler(deps())(post())
      expect(res.status).toBe(200)
      expect((await res.json()).test.channels[0]).toMatchObject({ name: 'ntfy', ok: true })
    })

    it('is not a way for the scheduler to send one: the cron secret is not the password', async () => {
      const send = deps().sendTest
      const res = await createWatchHandler(deps(undefined, send))(post({ authorization: CRON }))
      expect(res.status).toBe(401)
      expect(send).not.toHaveBeenCalled()
    })

    it('a GET never sends anything', async () => {
      const send = deps().sendTest
      await createWatchHandler(deps(undefined, send))(
        new Request('https://x/api/watch?notify=test', { headers: { 'x-app-token': 'ok' } }),
      )
      expect(send).not.toHaveBeenCalled()
    })
  })

  it('only answers GET and POST', async () => {
    const res = await createWatchHandler(deps())(new Request('https://x/api/watch', { method: 'DELETE', headers: { 'x-app-token': 'ok' } }))
    expect(res.status).toBe(405)
  })
})
