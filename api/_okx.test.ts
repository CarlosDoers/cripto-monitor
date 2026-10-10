import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALLOWED_PATHS, checkAccess, proxyOkxGet } from './_okx.js'

describe('the signing proxy', () => {
  it('signs nothing outside the allowlist', async () => {
    expect((await proxyOkxGet('/api/v5/trade/order')).status).toBe(403)
    expect((await proxyOkxGet('/api/v5/asset/withdrawal')).status).toBe(403)
    // A traversal does not reach an unlisted path either.
    expect((await proxyOkxGet('/api/v5/account/balance/../../trade/order')).status).toBe(403)
  })

  it('only speaks the v5 API', async () => {
    expect((await proxyOkxGet('/etc/passwd')).status).toBe(400)
  })

  // OKX's write endpoints, by their last path segment. A read endpoint can share
  // a prefix (orders-pending, orders-history), so the match is exact.
  const WRITES = new Set([
    'order', 'batch-orders', 'cancel-order', 'cancel-batch-orders', 'amend-order', 'amend-batch-orders',
    'close-position', 'order-algo', 'cancel-algos', 'amend-algos', 'set-leverage', 'set-position-mode',
    'withdrawal', 'cancel-withdrawal', 'transfer', 'purchase_redempt', 'purchase', 'redeem',
    'order-algo-create', 'stop-order-algo', 'create', 'stop', 'margin-balance',
  ])
  it('lists nothing that could move money', () => {
    for (const path of ALLOWED_PATHS) expect(WRITES.has(path.split('/').pop() ?? '')).toBe(false)
  })
})

describe('the access gate', () => {
  afterEach(() => vi.unstubAllEnvs())
  const request = (token?: string) => new Request('http://x/api/okx', { headers: token ? { 'x-app-token': token } : {} })

  it('fails closed on a deployment without a password', () => {
    vi.stubEnv('APP_ACCESS_TOKEN', '')
    for (const env of ['production', 'preview']) {
      vi.stubEnv('VERCEL_ENV', env)
      expect(checkAccess(request())?.status).toBe(503)
    }
  })

  it('stays open locally, where there is no password by choice', () => {
    vi.stubEnv('APP_ACCESS_TOKEN', '')
    vi.stubEnv('VERCEL_ENV', '')
    expect(checkAccess(request())).toBeNull()
  })

  it('asks for the password wherever one is set', () => {
    vi.stubEnv('APP_ACCESS_TOKEN', 'a'.repeat(64))
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(checkAccess(request())?.status).toBe(401)
    expect(checkAccess(request('b'.repeat(64)))?.status).toBe(401)
    expect(checkAccess(request('a'.repeat(64)))).toBeNull()
  })
})
