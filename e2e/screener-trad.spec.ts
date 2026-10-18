import { expect, test, type Page } from '@playwright/test'

/**
 * The Screener's equities card (`TradWatch`): the board is the server's, so it is replaced here by a fixed one; the
 * liquidity column is read live from OKX's tickers through the app's own proxy, so what it says about each contract is
 * whatever the market says today. The assertions are the ones that hold whatever the market does.
 */

const NOW = Date.now()

/** The OKX contract id for a ticker, from the live catalogue: the expiry suffix changes when a contract rolls. */
async function contractOf(page: Page, ticker: string): Promise<string> {
  const res = await page.request.get('/api/okx?path=' + encodeURIComponent('/api/v5/public/instruments?instType=FUTURES'))
  const body = (await res.json()) as { data?: { instId: string; state: string }[] } | { instId: string; state: string }[]
  const list = Array.isArray(body) ? body : (body.data ?? [])
  const hit = list.find((i) => i.state === 'live' && i.instId.startsWith(`${ticker}-USD_UM_XPERP`))
  if (!hit) throw new Error(`OKX no lista ${ticker}`)
  return hit.instId
}

const row = (okx: string, instId: string, kind: 'index' | 'commodity', price: number) => ({
  yahoo: okx,
  okx,
  instId,
  kind,
  status: 'tendencia',
  bars: 800,
  asOf: NOW,
  price,
  entry: price * 0.9,
  entryAt: NOW - 30 * 86_400_000,
  age: 30,
  stop: price * 0.95,
})

test.beforeEach(async ({ page }) => {
  const rows = [
    row('SPY', await contractOf(page, 'SPY'), 'index', 770),
    row('EWZ', await contractOf(page, 'EWZ'), 'index', 41.6),
    row('XAU', await contractOf(page, 'XAU'), 'commodity', 4180),
  ]
  await page.route('**/api/watch**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'GET' && url.searchParams.get('board') === '1') {
      return route.fulfill({
        json: { enabled: true, storage: 'file', config: { channels: [], top: 20, bars: [], alertBars: [], alertSides: [] }, board: { at: NOW, asOf: NOW, rows }, lastRun: NOW },
      })
    }
    return route.fulfill({ json: { enabled: true, run: { status: 'skipped' } } })
  })
})

async function openCard(page: Page) {
  await page.goto('/#/screener')
  const card = page.locator('section, .card').filter({ has: page.getByRole('heading', { name: /Tendencia diaria en bolsa, ETF y oro/ }) }).first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.getByRole('button', { name: /^Todos/ }).click()
  await expect(card.locator('tbody tr')).toHaveCount(3)
  return card
}

test('la tarjeta de bolsa tiene su columna de liquidez y no desborda la pantalla', async ({ page }) => {
  const card = await openCard(page)
  await expect(card.locator('thead th')).toContainText(['Contrato', 'Tipo', 'Liquidez', 'Estado'])
  // Nothing sticks out of the page, on a desktop or on a phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  // On a desktop the table fits its card too: it did not once, when the column was first added.
  if (!test.info().project.name.includes('móvil')) {
    const wrap = await card.locator('.table-wrap').evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(wrap).toBeLessThanOrEqual(1)
  }
})

test('cada contrato muestra volumen y horquilla, y solo los finos llevan el aviso', async ({ page }) => {
  const card = await openCard(page)
  const cell = (ticker: string) => card.locator('tbody tr').filter({ hasText: new RegExp(`^${ticker}\\b`) }).locator('td').nth(2)
  // Volume then spread, in the boards' own format ("158 k$ · 12,9 pb").
  for (const t of ['SPY', 'EWZ', 'XAU']) await expect(cell(t)).toContainText(/(k\$|M\$|US\$).*(pb|sin libro)/)
  // Gold moves millions a day at a hair of a spread; EWZ moves next to nothing.
  await expect(cell('XAU')).not.toContainText('poca liquidez')
  await expect(cell('EWZ')).toContainText('poca liquidez')
})

test('en el móvil cada fila es una tarjeta con la liquidez etiquetada', async ({ page }, info) => {
  test.skip(!info.project.name.includes('móvil'), 'solo tiene sentido con el ancho de un teléfono')
  const card = await openCard(page)
  const ewz = card.locator('tbody tr').filter({ hasText: /^EWZ\b/ })
  await expect(ewz.locator('td[data-label="Liquidez"]')).toBeVisible()
  await expect(ewz.locator('td[data-label="Liquidez"]')).toContainText('poca liquidez')
})
