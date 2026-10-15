// "Buying exhausted 7-day pumps on illiquid trash" — the claim of a 2026-10-15 video (Creator Magic,
// *I Gave Gemini 4 Argon My Losing AI Trading Bots*) about why one of its three bots lost 48 %.
// It gives no rule, so this is the claim written down BEFORE any number:
//
//   · Universe: every Binance USDT spot pair listed that week (the delisted ones included —
//     `node scripts/fetch-binance-daily.mjs`), with at least 90 days of history.
//   · Each Sunday close, rank the pairs by their 30-day mean dollar volume and cut them in three
//     bands: the 30 most traded, ranks 31–100 and the rest ("illiquid").
//   · A pump is a pair in the top fifth of its band's 7-day return that week (variant B: a 7-day
//     return of at least +30 %, the band's pumps in absolute terms).
//   · Long it at that close and hold 7 days (a pair that stops trading is closed at its last price).
//   · Return reported minus the same band's mean that week, so the market's move is not the result;
//     the absolute mean too. Cost: 0.1 % a round trip, and 0.5 % for the illiquid band, whose spread
//     the data cannot see.
//   · Lag 1 (entering a day later) is the one other variant.
//
// npm run pump
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const DIR = './.research/binance-1d'
if (!existsSync(DIR)) {
  console.log('Falta ./.research/binance-1d: node scripts/fetch-binance-daily.mjs')
  process.exit(1)
}
const DAY = 86_400_000
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const sd = (xs) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const p = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)} %` : '   — ')
const f = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '—')
const SKIP = /^(WBTC|WBETH|BETH|RENBTC|BTCB|PAXG|XAUT|WBNB|STETH|CBBTC)$/

const coins = []
for (const file of readdirSync(DIR)) {
  const name = file.replace('.json', '')
  if (SKIP.test(name)) continue
  const rows = JSON.parse(readFileSync(`${DIR}/${file}`, 'utf8'))
  if (rows.length < 100) continue
  const days = new Map(rows.map((r, i) => [Math.round(r[0] / DAY), i]))
  const close = rows.map((r) => r[4])
  const qv30 = new Array(rows.length).fill(0)
  let acc = 0
  for (let i = 0; i < rows.length; i++) {
    acc += rows[i][6]
    if (i >= 30) acc -= rows[i - 30][6]
    qv30[i] = i >= 29 ? acc / 30 : 0
  }
  coins.push({ name, days, close, qv30, last: Math.round(rows[rows.length - 1][0] / DAY), n: rows.length })
}
const lastDay = Math.max(...coins.map((c) => c.last))
const firstDay = Math.round(Date.UTC(2018, 0, 1) / DAY)
const sundays = []
for (let d = Math.ceil(firstDay / 7) * 7; d + 8 <= lastDay; d += 7) sundays.push(d)
console.log(`${coins.length} pares, ${coins.filter((c) => c.last < lastDay - 30).length} dejaron de cotizar · ${sundays.length} domingos`)

const BANDS = [
  ['las 30 más negociadas', 0, 30, 0.001],
  ['puestos 31 a 100', 30, 100, 0.001],
  ['el resto (ilíquidas)', 100, 10_000, 0.005],
]

function weeks({ lag, mode }) {
  const out = BANDS.map(() => [])
  for (const d of sundays) {
    const rows = []
    for (const c of coins) {
      const i = c.days.get(d)
      const j = c.days.get(d - 7)
      if (i === undefined || j === undefined || i < 90 || !(c.qv30[i] > 0)) continue
      const e = c.days.get(d + lag)
      if (e === undefined) continue
      const nx = c.days.get(d + lag + 7)
      const exit = nx !== undefined ? c.close[nx] : c.last < d + lag + 7 ? c.close[c.n - 1] : undefined
      if (exit === undefined) continue
      rows.push({ qv: c.qv30[i], r7: c.close[i] / c.close[j] - 1, fwd: exit / c.close[e] - 1 })
    }
    rows.sort((a, b) => b.qv - a.qv)
    BANDS.forEach(([, from, to, cost], b) => {
      const band = rows.slice(from, to)
      if (band.length < 15) return
      const pumps =
        mode === 'quintile'
          ? [...band].sort((x, y) => y.r7 - x.r7).slice(0, Math.floor(band.length / 5))
          : band.filter((x) => x.r7 >= 0.3)
      if (pumps.length < 3) return
      const all = mean(band.map((x) => x.fwd))
      out[b].push({ d, abs: mean(pumps.map((x) => x.fwd)), ex: mean(pumps.map((x) => x.fwd)) - all, n: pumps.length, qv: mean(band.map((x) => x.qv)), cost })
    })
  }
  return out
}

function report(label, opts) {
  console.log(`\n── ${label}`)
  console.log(`     ${'banda'.padEnd(26)} ${'sem.'.padStart(4)} ${'pumps/sem.'.padStart(10)} ${'vol. medio/día'.padStart(14)} ${'exceso'.padStart(9)} ${'t'.padStart(5)} ${'sem.+'.padStart(6)} ${'neto'.padStart(9)} ${'absoluto'.padStart(9)} ${'mitades'.padStart(19)} ${'sin 10 mejores'.padStart(15)}`)
  weeks(opts).forEach((ws, b) => {
    const ex = ws.map((w) => w.ex)
    if (ex.length < 40) return console.log(`     ${BANDS[b][0].padEnd(26)} (solo ${ex.length} semanas)`)
    const half = Math.floor(ex.length / 2)
    const sorted = [...ex].sort((x, y) => y - x)
    const cost = BANDS[b][3]
    console.log(
      `     ${BANDS[b][0].padEnd(26)} ${String(ex.length).padStart(4)} ${mean(ws.map((w) => w.n)).toFixed(1).padStart(10)} ${(mean(ws.map((w) => w.qv)) / 1e6).toFixed(1).padStart(11)} M$ ${p(mean(ex)).padStart(9)} ${f(mean(ex) / (sd(ex) / Math.sqrt(ex.length))).padStart(5)} ${(100 * ex.filter((x) => x > 0).length / ex.length).toFixed(0).padStart(5)}% ${p(mean(ex) - cost).padStart(9)} ${p(mean(ws.map((w) => w.abs))).padStart(9)} ${(p(mean(ex.slice(0, half)), 1) + ' / ' + p(mean(ex.slice(half)), 1)).padStart(19)} ${p(mean(sorted.slice(10))).padStart(15)}`,
    )
  })
}

report('A · el quinto con más subida en 7 días de su banda, largo 7 días', { lag: 0, mode: 'quintile' })
report('B · subida de 7 días ≥ +30 %, largo 7 días', { lag: 0, mode: 'threshold' })
report('A con un día de retraso al entrar', { lag: 1, mode: 'quintile' })
