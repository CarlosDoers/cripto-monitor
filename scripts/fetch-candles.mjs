// Populates ./.candles for scripts/audit-strategies.mjs.
//
// Uses /market/history-candles rather than /market/candles: the latter only
// serves the last ~1440 bars, which on 15 m was two weeks — enough for nothing.
// The former pages backwards without that ceiling and reaches 2021. The opening
// range is measured over years of intraday data; without them there is no audit
// worth running.
//
// Needs `npm run dev` up; the proxy signs the request and applies the allowlist.
// Pass DEV_URL if Vite picked a different port.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'

const B = process.env.DEV_URL ?? 'http://localhost:5174'
const DIR = './.candles'
const SINCE = Date.parse('2022-01-01T00:00:00Z')
mkdirSync(DIR, { recursive: true })

// The three with genuinely long history come first — the rest are recent
// contracts and cannot support a backtest on their own.
const INSTRUMENTS = [
  'BTC-USDT', 'ETH-USDT', 'SOL-USDT',
  'ZEC-USD_UM_XPERP-310530', 'HYPE-USD_UM_XPERP-310523', 'SOL-USD_UM_XPERP-310404',
  'XRP-USD_UM_XPERP-310404', 'TAO-USD_UM_XPERP-310523', 'DOGE-USD_UM_XPERP-310404',
  'ETH-USD_UM_XPERP-310404',
]
// history-candles caps at 100 per page, so the ceiling is per timeframe.
const BARS = { '15m': 1800, '1H': 450, '4H': 120, '1D': 40 }

const sleep = (ms) => new Promise((s) => setTimeout(s, ms))

const get = async (p) => {
  const r = await fetch(`${B}/api/okx?path=${encodeURIComponent(p)}`)
  const j = await r.json()
  return j.error ? { error: j.message } : (j.data ?? [])
}

for (const instId of INSTRUMENTS) {
  for (const [bar, maxPages] of Object.entries(BARS)) {
    const file = `${DIR}/${instId.replace(/\W/g, '_')}__${bar}.json`
    if (existsSync(file)) { console.log(`${instId.padEnd(26)} ${bar.padEnd(4)} ya está`); continue }
    const all = []
    let after = Date.now()
    for (let p = 0; p < maxPages && after > SINCE; p++) {
      const rows = await get(
        `/api/v5/market/history-candles?instId=${instId}&bar=${bar}&after=${after}&limit=100`,
      )
      if (rows.error) { console.log(`  ERROR ${instId} ${bar}: ${rows.error}`); break }
      if (!rows.length) break
      all.push(...rows)
      after = +rows.at(-1)[0]
      await sleep(110)
    }
    const seen = new Set()
    const candles = all
      // Volume is only used by the opening range, for its abnormal-volume filter.
      .map((c) => ({ time: +c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], vol: +c[5], confirmed: c[8] === '1' }))
      .filter((c) => c.confirmed && !seen.has(c.time) && seen.add(c.time))
      .sort((a, b) => a.time - b.time)
    writeFileSync(file, JSON.stringify(candles))
    console.log(`${instId.padEnd(26)} ${bar.padEnd(4)} ${String(candles.length).padStart(6)}  ${candles.length ? new Date(candles[0].time).toISOString().slice(0, 10) : '—'}`)
  }
}
console.log('LISTO')
