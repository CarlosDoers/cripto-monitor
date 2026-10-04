import { describe, expect, it } from 'vitest'
import { ALLOWED_PATHS, proxyOkxGet } from './_okx.js'

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
