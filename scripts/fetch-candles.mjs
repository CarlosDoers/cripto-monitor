import { writeFileSync, existsSync, mkdirSync } from 'node:fs'

const B = 'http://localhost:5174'
const DIR = './.candles'
mkdirSync(DIR, { recursive: true })

// The three with genuinely long daily history come first — everything else has
// only weeks of data and cannot support a daily backtest.
const INSTRUMENTS = [
  'BTC-USDT', 'ETH-USDT', 'SOL-USDT',
  'ZEC-USD_UM_XPERP-310530', 'HYPE-USD_UM_XPERP-310523', 'SOL-USD_UM_XPERP-310404',
  'XRP-USD_UM_XPERP-310404', 'TAO-USD_UM_XPERP-310523', 'DOGE-USD_UM_XPERP-310404',
  'ETH-USD_UM_XPERP-310404',
]
const BARS = ['15m', '1H', '4H', '1D']

const get = async (p) => {
  const r = await fetch(`${B}/api/okx?path=${encodeURIComponent(p)}`)
  const j = await r.json()
  return j.error ? { error: j.message } : (j.data ?? [])
}

for (const instId of INSTRUMENTS) {
  for (const bar of BARS) {
    const file = `${DIR}/${instId.replace(/\W/g, '_')}__${bar}.json`
    if (existsSync(file)) continue
    const all = []
    let after
    for (let p = 0; p < 6; p++) {
      const q = `/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=300${after ? `&after=${after}` : ''}`
      const rows = await get(q)
      if (rows.error) { console.log(`  ERROR ${instId} ${bar}: ${rows.error}`); break }
      if (!rows.length) break
      all.push(...rows)
      after = rows.at(-1)[0]
      if (rows.length < 300) break
    }
    const candles = all
      .map((c) => ({ time: +c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], confirmed: c[8] === '1' }))
      .filter((c) => c.confirmed)
      .sort((a, b) => a.time - b.time)
    writeFileSync(file, JSON.stringify(candles))
    console.log(`${instId.padEnd(26)} ${bar.padEnd(4)} ${candles.length}`)
  }
}
console.log('LISTO')
