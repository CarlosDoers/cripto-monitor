// Candles of the Screener's 30 liquid coins (USDT spot, since 2022) at one
// timeframe, for sweeps that need more than BTC, ETH and SOL.
//
//   node scripts/fetch-board.mjs 4H        → ./.candles-board-4H/<SYM>.json
//   node scripts/fetch-board.mjs 1D        → ./.candles-board-1D/<SYM>.json  (OKX's daily, as the app reads it)
//   BOARD_SINCE=2024-10-11 BOARD_COINS=BTC node scripts/fetch-board.mjs 1m   → ./.candles-board-1m/BTC.json
//
// 1m and 5m are for scalping ideas (the 2026-10-11 video). They are heavy: a
// year of 1m is 525 600 bars, 5 256 requests and ~12 min a coin, ~105 MB of
// JSON per two years — so they need BOARD_SINCE and are fetched a coin at a time.
//
// Switches, all environment variables:
//   BOARD_SINCE=2024-10-11     start date; without it the board's 2022-01-01
//   BOARD_COINS=XRP,DOGE,ADA   only these coins (15 m is 1 670 requests a coin, ~4 min each)
//   BOARD_OLD=1                the years BEFORE the board's own first candle, into
//                              ./.candles-board-<BAR>old, for the 14 coins that already
//                              existed in 2018-2021 — a period no tuning has seen
//
// Public endpoint, no key and no dev server. OKX allows 20 history-candles
// requests per 2 s; this sends 8 every 1.1 s.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const BAR = process.argv[2] ?? '4H'
const MS = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1H': 3_600_000, '4H': 14_400_000, '1D': 86_400_000 }[BAR]
if (!MS) throw new Error(`bar no soportado: ${BAR}`)
const OLD = process.env.BOARD_OLD === '1'
const DIR = `./.candles-board-${BAR}${OLD ? 'old' : ''}`
const SINCE = Date.parse(OLD ? '2017-10-01T00:00:00Z' : `${process.env.BOARD_SINCE ?? '2022-01-01'}T00:00:00Z`)
if (['1m', '5m'].includes(BAR) && !process.env.BOARD_SINCE) throw new Error(`${BAR} necesita BOARD_SINCE: desde 2022 son millones de velas`)
/** The coins that were already listed in 2018–2021. */
const OLDER = ['BTC', 'ETH', 'LTC', 'XRP', 'BCH', 'DOGE', 'ADA', 'LINK', 'DOT', 'UNI', 'AAVE', 'AVAX', 'SOL', 'NEAR']
mkdirSync(DIR, { recursive: true })
const wanted = process.env.BOARD_COINS?.split(',').filter(Boolean)
const symbols = (wanted ?? (OLD ? OLDER : JSON.parse(readFileSync('./.candles-screener/_universe.json', 'utf8'))))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function page(inst, after) {
  for (let a = 0; a < 5; a++) {
    const r = await fetch(`https://www.okx.com/api/v5/market/history-candles?instId=${inst}&bar=${BAR}&limit=100&after=${after}`)
    const j = await r.json().catch(() => null)
    if (j?.code === '0') return j.data
    await sleep(2000 * (a + 1))
  }
  return []
}

for (const sym of symbols) {
  const file = `${DIR}/${sym}.json`
  if (existsSync(file)) continue
  const inst = `${sym}-USDT`
  // The old years end where the board's own candles begin.
  let from = Date.now()
  if (OLD) {
    const regular = `./.candles-board-${BAR}/${sym}.json`
    from = existsSync(regular) ? JSON.parse(readFileSync(regular, 'utf8'))[0]?.time : undefined
    if (!from) continue
  }
  const cursors = []
  for (let t = from; t > SINCE; t -= 100 * MS) cursors.push(t)
  const rows = []
  for (let i = 0; i < cursors.length; i += 8) {
    const started = Date.now()
    const pages = await Promise.all(cursors.slice(i, i + 8).map((c) => page(inst, c)))
    for (const p of pages) rows.push(...p)
    if (pages.every((p) => !p.length)) break
    await sleep(Math.max(0, 1100 - (Date.now() - started)))
  }
  const seen = new Set()
  const candles = rows
    .map((c) => ({ time: +c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], vol: +c[5], confirmed: c[8] === '1' }))
    .filter((c) => c.confirmed && c.time < from && !seen.has(c.time) && seen.add(c.time))
    .sort((a, b) => a.time - b.time)
  writeFileSync(file, JSON.stringify(candles))
  process.stdout.write(`${sym}:${candles.length} `)
}
console.log()
