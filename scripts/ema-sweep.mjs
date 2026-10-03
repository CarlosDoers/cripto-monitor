// Every common way of trading a single EMA, on every length and timeframe
// worth testing, held to the bar a sweep this size needs.
//
//   node scripts/fetch-board.mjs 4H   (once)
//   npm run emasweep
//
// The grid, fixed before measuring — 162 configurations:
//   lengths   9 13 21 25 34 50 89 100 200
//   bars      1H (BTC/ETH/SOL + X-Perps, ./.candles) · 4H (30 coins,
//             ./.candles-board-4H) · 1D (30 coins, ./.candles-screener)
//   family    cruce     — a close across the EMA; stop 2 ATR from entry
//             rebote    — first touch whose candle holds; stop 1 ATR beyond the EMA
//             retroceso — rebote with the EMA sloping its way over 5 bars
//   exit      x — a close back across the EMA (cruce becomes stop-and-reverse)
//             t — a fixed 2 R target
// 15 m is left out: every intraday test in this repo died to the fee there.
//
// A configuration passes only if it clears all of: n ≥ 100; net ≥ 0.1 R in
// aggregate and in both halves of each series; still positive without its ten
// best trades; a Deflated Sharpe ≥ 95 % with N = 162; and both neighbouring
// lengths (same family, exit, bar) ≥ +0.05 R. With 162 tries, roughly eight
// would clear a plain 95 % test by luck — which is why the DSR uses N = 162 and
// why a lone good cell is not enough.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { atr, ema } from '../src/lib/indicators/ta.ts'
import { deflate } from '../src/lib/indicators/deflated.ts'

const FEE = 0.001
const LENGTHS = [9, 13, 21, 25, 34, 50, 89, 100, 200]
const FAMILIES = ['cruce', 'rebote', 'retroceso']
const EXITS = ['x', 't']
const SLOPE = 5
const TRIALS = LENGTHS.length * FAMILIES.length * EXITS.length * 3

function load(dir, suffix) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_') && (!suffix || f.endsWith(suffix)))
    .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')).filter((c) => c.confirmed !== false))
    .filter((c) => c.length >= 600)
}
const DATA = {
  '1H': load('./.candles', '__1H.json'),
  '4H': load('./.candles-board-4H'),
  '1D': load('./.candles-screener'),
}

/** Net R of every closed trade, with the half of its series it opened in. */
function run(c, line, unit, family, exit) {
  const out = []
  const half = c[Math.floor(c.length / 2)].time
  const touch = (i) => c[i].low <= line[i] && line[i] <= c[i].high
  let pos = null
  const close = (price) => {
    const r = (pos.long ? price - pos.entry : pos.entry - price) / pos.risk
    out.push({ r: r - pos.fee, first: pos.time < half })
    pos = null
  }
  for (let i = Math.max(SLOPE + 1, 1); i < c.length; i++) {
    const b = c[i]
    if (!Number.isFinite(line[i - SLOPE]) || !(unit[i] > 0)) continue
    if (pos) {
      if (pos.long ? b.low <= pos.stop : b.high >= pos.stop) close(pos.stop)
      else if (exit === 't' && (pos.long ? b.high >= pos.target : b.low <= pos.target)) close(pos.target)
      else if (exit === 'x' && (pos.long ? b.close < line[i] : b.close > line[i])) close(b.close)
    }
    if (pos) continue
    let long
    const above = b.close > line[i]
    const wasAbove = c[i - 1].close > line[i - 1]
    if (family === 'cruce') {
      if (above === wasAbove) continue
      long = above
    } else {
      if (!touch(i) || touch(i - 1)) continue
      if (above !== wasAbove) continue // the candle did not hold
      long = wasAbove
      if (family === 'retroceso' && (long ? line[i] <= line[i - SLOPE] : line[i] >= line[i - SLOPE])) continue
    }
    const entry = b.close
    const stop = family === 'cruce' ? entry + (long ? -2 : 2) * unit[i] : line[i] + (long ? -1 : 1) * unit[i]
    const risk = long ? entry - stop : stop - entry
    if (!(risk > 0)) continue
    const fee = FEE / (risk / entry)
    if (fee > 1) continue
    pos = { long, entry, stop, risk, fee, time: b.time, target: entry + (long ? 2 : -2) * risk }
  }
  return out
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const results = []
for (const [bar, series] of Object.entries(DATA)) {
  const pre = series.map((c) => ({
    c,
    unit: atr(c.map((x) => x.high), c.map((x) => x.low), c.map((x) => x.close), 14),
    closes: c.map((x) => x.close),
  }))
  for (const length of LENGTHS) {
    const lines = pre.map((p) => ema(p.closes, length))
    for (const family of FAMILIES) {
      for (const exit of EXITS) {
        const trades = pre.flatMap((p, k) => run(p.c, lines[k], p.unit, family, exit))
        const rs = trades.map((t) => t.r)
        const sorted = [...rs].sort((a, b) => b - a)
        const d = rs.length > 2 ? deflate(rs, TRIALS) : { dsr: 0, survives: 0 }
        results.push({
          bar, length, family, exit,
          n: rs.length,
          net: mean(rs),
          h1: mean(trades.filter((t) => t.first).map((t) => t.r)),
          h2: mean(trades.filter((t) => !t.first).map((t) => t.r)),
          no10: mean(sorted.slice(10)),
          win: rs.filter((r) => r > 0).length / rs.length,
          dsr: d.dsr,
          survives: d.survives,
        })
      }
    }
  }
}

const key = (r) => `${r.bar}|${r.family}|${r.exit}`
for (const r of results) {
  const same = results.filter((x) => key(x) === key(r))
  const i = LENGTHS.indexOf(r.length)
  const nb = [LENGTHS[i - 1], LENGTHS[i + 1]].filter(Boolean).map((L) => same.find((x) => x.length === L)?.net ?? NaN)
  r.neighbours = nb
  r.fails = [
    r.n < 100 && 'n',
    !(r.net >= 0.1) && 'neto',
    !(Math.min(r.h1, r.h2) >= 0.1) && 'mitad',
    !(r.no10 > 0) && 'sin10',
    !(r.dsr >= 0.95) && 'DSR',
    !nb.every((x) => x >= 0.05) && 'vecinas',
  ].filter(Boolean)
}

const f = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '  — ')
console.log(`BARRIDO EMA · ${results.length} configuraciones · DSR con N = ${TRIALS}`)
console.log(`series: 1H ${DATA['1H'].length} · 4H ${DATA['4H'].length} · 1D ${DATA['1D'].length}\n`)
console.log('positivas (neto > 0) por temporalidad y familia, de 18 cada una:')
for (const bar of Object.keys(DATA)) {
  console.log(`  ${bar}  ` + FAMILIES.map((fam) => `${fam} ${results.filter((r) => r.bar === bar && r.family === fam && r.net > 0).length}`).join(' · '))
}
console.log('\nlas 15 mejores por neto (n ≥ 100):')
console.log('  TF  familia    sal EMA     n  acierto   neto    1ª     2ª   sin10   DSR  vecinas        falla')
for (const r of results.filter((r) => r.n >= 100).sort((a, b) => b.net - a.net).slice(0, 15)) {
  console.log(
    `  ${r.bar.padEnd(3)} ${r.family.padEnd(10)} ${r.exit}  ${String(r.length).padStart(4)} ${String(r.n).padStart(5)}  ${(r.win * 100).toFixed(0).padStart(4)} %  ${f(r.net)}  ${f(r.h1)}  ${f(r.h2)}  ${f(r.no10)}  ${(r.dsr * 100).toFixed(0).padStart(3)} %  ${r.neighbours.map((x) => f(x)).join('/').padEnd(12)}  ${r.fails.join(',') || 'PASA'}`,
  )
}
const pass = results.filter((r) => !r.fails.length)
console.log(`\n=== ${pass.length ? `PASAN ${pass.length}` : 'NINGUNA PASA'} ===`)
for (const r of pass) console.log(`  ${r.bar} ${r.family} ${r.exit} EMA ${r.length}: ${f(r.net)} R, n=${r.n}, mitades ${f(r.h1)}/${f(r.h2)}, sin10 ${f(r.no10)}, aguanta ${r.survives} variantes`)
