import { expect, test, type Page } from '@playwright/test'
import { expectNoBrokenText, expectNoOverflow, watchProblems } from './helpers'

/**
 * Seguimiento con un registro fijo (el del servidor se sustituye): una señal de bolsa avisada y otra que no se avisó por
 * poca liquidez. Cubre lo que se ve del seguimiento de bolsa y el botón «Probar aviso», sin tocar ningún registro real
 * ni mandar nada.
 */

const NOW = Date.now()
const entry = (symbol: string, alert: 'sent' | 'illiquid') => ({
  id: `trad/trend@1D:${symbol}:${NOW}`,
  track: 'trad/trend@1D',
  strategy: 'donchian',
  preset: 'trend',
  bar: '1D',
  instId: symbol,
  symbol,
  side: 'long',
  at: NOW - 6 * 3_600_000,
  entry: 100,
  stop: 95,
  status: 'open',
  feeR: 0.02,
  seen: NOW,
  volume: null,
  btcAbove: null,
  weekend: false,
  kind: 'index',
  okxId: `${symbol}-USD_UM_XPERP-310613`,
  markR: 0.4,
  lastClose: 102,
  markedAt: NOW - 3_600_000,
  alert,
})

const config = {
  channels: ['ntfy'],
  top: 20,
  bars: ['4H', '1D'],
  alertBars: ['4H', '1D'],
  alertSides: ['long', 'short'],
  trad: { enabled: true, alert: true, kinds: ['index', 'commodity', 'stock'], maxCostR: 0.15 },
}

const ledger = {
  version: 1,
  startedAt: NOW - 86_400_000,
  lastRun: NOW - 600_000,
  runs: 4,
  since: {},
  universe: { 'trad/trend@1D': ['SPY', 'EWZ'] },
  processed: {},
  entries: [entry('SPY', 'sent'), entry('EWZ', 'illiquid')],
}

async function mockServer(page: Page) {
  await page.route('**/api/watch**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (method === 'POST' && url.searchParams.get('notify') === 'test') {
      return route.fulfill({ json: { test: { channels: [{ name: 'ntfy', ok: true }] } } })
    }
    if (method === 'POST') return route.fulfill({ json: { enabled: true, storage: 'file', ledger, config, run: { status: 'skipped' } } })
    if (url.searchParams.get('meta') === '1') {
      return route.fulfill({ json: { enabled: true, storage: 'file', config, meta: { exists: true, startedAt: ledger.startedAt, lastRun: ledger.lastRun, runs: 4, entries: 2 }, now: NOW } })
    }
    return route.fulfill({ json: { enabled: true, storage: 'file', ledger, config, now: NOW } })
  })
}

test('Seguimiento enseña la pista de bolsa y dice cuáles se avisaron y cuáles no', async ({ page }) => {
  const verify = watchProblems(page)
  await mockServer(page)
  await page.goto('/#/seguimiento')
  await expect(page.getByRole('heading', { name: 'Señales apuntadas' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Tendencia diaria · bolsa, ETF y oro').first()).toBeVisible()
  // One was announced and the other was kept quiet because its book is thin: each row says so.
  await expect(page.getByText('avisada', { exact: true })).toBeVisible()
  await expect(page.getByText('sin aviso: poca liquidez')).toBeVisible()
  // The footnote explains the cap and the variable that moves it.
  await expect(page.getByText('WATCH_TRAD_MAX_COST_R')).toBeVisible()
  await expectNoOverflow(page)
  await expectNoBrokenText(page)
  verify()
})

test('«Probar aviso» manda la prueba y dice a dónde mirar', async ({ page }) => {
  await mockServer(page)
  await page.goto('/#/seguimiento')
  const button = page.getByRole('button', { name: 'Probar aviso' })
  await expect(button).toBeEnabled({ timeout: 30_000 })
  await button.click()
  await expect(page.getByText(/Enviado por ntfy: deberían sonar dos mensajes/)).toBeVisible()
})
