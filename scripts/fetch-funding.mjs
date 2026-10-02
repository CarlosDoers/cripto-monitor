// Funding history for the funding research, cached under ./.funding.
//
//   npm run funding:fetch      (needs `npm run dev` up, for the X-Perp half)
//
// Two sources, because neither is enough on its own:
//
// - **OKX keeps three months.** `/public/funding-rate-history` pages back to
//   about 90 days and stops, on the global entity and on the account's (EEA)
//   alike. That is enough to see what the X-Perps this account can trade
//   actually pay, and nothing like enough to test a strategy on.
// - **Binance keeps everything**, public and keyless, from 2019. Its USDT
//   perpetuals are where crypto funding is set — the largest open interest —
//   so it is the long history, and the X-Perp months are the check that it
//   describes what this account would have been paid.
//
// The universe is the liquid crypto half of the X-Perp board, the list the
// Screener research already cached (./.candles-screener/_universe.json).
// Choosing today's liquid coins is survivorship: coins that died since 2022
// are not in it. The research says so.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const DEV = process.env.DEV_URL ?? 'http://localhost:5173'
const DIR = './.funding'
const SINCE = Date.parse('2022-01-01T00:00:00Z')
mkdirSync(`${DIR}/binance`, { recursive: true })
mkdirSync(`${DIR}/xperp`, { recursive: true })

const sleep = (ms) => new Promise((s) => setTimeout(s, ms))
const json = async (url) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url)
    if (r.status === 429 || r.status === 418) {
      await sleep(5000 * (attempt + 1))
      continue
    }
    return r.json()
  }
  throw new Error(`rate limited: ${url}`)
}

const universe = JSON.parse(readFileSync('./.candles-screener/_universe.json', 'utf8'))

// ── Binance: funding and daily perp candles since 2022 ────────────────────────
const FAPI = 'https://fapi.binance.com/fapi/v1'
for (const sym of universe) {
  const file = `${DIR}/binance/${sym}.json`
  if (existsSync(file)) continue
  let symbol = null
  for (const s of [`${sym}USDT`, `1000${sym}USDT`]) {
    const probe = await json(`${FAPI}/fundingRate?symbol=${s}&limit=1`)
    if (Array.isArray(probe) && probe.length) {
      symbol = s
      break
    }
  }
  if (!symbol) {
    console.log(`  ${sym}: no hay perpetuo en Binance`)
    writeFileSync(file, JSON.stringify(null))
    continue
  }

  const funding = []
  for (let start = SINCE; ; ) {
    const rows = await json(`${FAPI}/fundingRate?symbol=${symbol}&startTime=${start}&limit=1000`)
    if (!Array.isArray(rows) || !rows.length) break
    for (const r of rows) funding.push({ t: r.fundingTime, r: +r.fundingRate })
    if (rows.length < 1000) break
    start = rows.at(-1).fundingTime + 1
    await sleep(300)
  }

  const candles = []
  for (let start = SINCE; ; ) {
    const rows = await json(`${FAPI}/klines?symbol=${symbol}&interval=1d&startTime=${start}&limit=1500`)
    if (!Array.isArray(rows) || !rows.length) break
    for (const k of rows) {
      // Only finished days: the last row is today's, still moving.
      if (k[6] < Date.now()) candles.push({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4] })
    }
    if (rows.length < 1500) break
    start = rows.at(-1)[0] + 1
    await sleep(300)
  }

  writeFileSync(file, JSON.stringify({ symbol, funding, candles }))
  console.log(`  ${sym.padEnd(7)} ${symbol.padEnd(14)} ${funding.length} pagos · ${candles.length} días`)
  await sleep(300)
}

// ── OKX X-Perps: what this account is actually paid, last ~3 months ─────────
const okx = async (p) => {
  const r = await fetch(`${DEV}/api/okx?path=${encodeURIComponent(p)}`)
  const j = await r.json()
  if (j.error) throw new Error(j.message)
  return j.data ?? j
}
const instruments = await okx('/api/v5/public/instruments?instType=FUTURES')
for (const sym of universe) {
  const file = `${DIR}/xperp/${sym}.json`
  if (existsSync(file)) continue
  const inst = instruments.find((i) => i.instId.startsWith(`${sym}-USD_UM_XPERP`))
  if (!inst) continue
  const rows = []
  let after = ''
  for (let p = 0; p < 10; p++) {
    const page = await okx(
      `/api/v5/public/funding-rate-history?instId=${inst.instId}&limit=100${after ? `&after=${after}` : ''}`,
    )
    if (!page.length) break
    for (const r of page) rows.push({ t: +r.fundingTime, r: +r.realizedRate })
    after = page.at(-1).fundingTime
    await sleep(250)
  }
  writeFileSync(file, JSON.stringify({ instId: inst.instId, funding: rows.sort((a, b) => a.t - b.t) }))
  console.log(`  ${inst.instId.padEnd(26)} ${rows.length} pagos`)
}
