// Candles of the Screener's 30 liquid coins (USDT spot, since 2022) at one
// timeframe, for sweeps that need more than BTC, ETH and SOL.
//
//   node scripts/fetch-board.mjs 4H        → ./.candles-board-4H/<SYM>.json
//
// Public endpoint, no key and no dev server. OKX allows 20 history-candles
// requests per 2 s; this sends 8 every 1.1 s.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const BAR = process.argv[2] ?? '4H'
const MS = { '1H': 3_600_000, '4H': 14_400_000, '1D': 86_400_000 }[BAR]
if (!MS) throw new Error(`bar no soportado: ${BAR}`)
const DIR = `./.candles-board-${BAR}`
const SINCE = Date.parse('2022-01-01T00:00:00Z')
mkdirSync(DIR, { recursive: true })
const symbols = JSON.parse(readFileSync('./.candles-screener/_universe.json', 'utf8'))
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
  const cursors = []
  for (let t = Date.now(); t > SINCE; t -= 100 * MS) cursors.push(t)
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
    .filter((c) => c.confirmed && !seen.has(c.time) && seen.add(c.time))
    .sort((a, b) => a.time - b.time)
  writeFileSync(file, JSON.stringify(candles))
  process.stdout.write(`${sym}:${candles.length} `)
}
console.log()
