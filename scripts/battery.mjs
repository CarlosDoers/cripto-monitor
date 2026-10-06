// The checks a candidate that cleared `npm run try` still has to clear.
//
//   npm run battery -- <module> <export> [4H|1H|1D|1Dutc|4Hold|1Dold]
//   npm run battery -- fvg analyseFvg 1D
//   npm run battery -- scripts/ideas-shipped.mjs analyseShippedDonchianTrend 4H
//
// `try` answers "is it worth a look": n, net R in both halves, an edge over a
// random entry, a Deflated Sharpe. This is what the 2026-09 review asked of the
// shipped strategies and what `try` cannot say:
//
//   · the distribution, and the result without the 10, 20 and 50 best trades —
//     a trend follower lives on a few trades, and a strategy that does not
//     should show it here;
//   · each year, each side, each coin, and BTC's regime at the entry;
//   · a 95 % interval that resamples MONTHS, because coins in one month are not
//     independent trades;
//   · the same result at 0.66×, 2× and 3× the fee;
//   · and whether it trades differently from the Donchian 4 h and the EMA 200
//     cross already shipped — monthly correlation, shared entries, and what
//     adding it does to their combined monthly Sharpe. A candidate that clears
//     everything else and correlates 0.9 with one of them is a weaker copy, not
//     a new strategy (the squeeze, Ichimoku, EMA Wave and the EMA 9/50 all were).
//
// The first argument is a module under src/lib/indicators/ (by name) or a path.
// Data sets, all gitignored, all fetched by scripts/fetch-board.mjs:
//   4H     30 coins, 4 h, since 2022            ./.candles-board-4H
//   1H     30 coins, 1 h, since 2022            ./.candles-board-1H
//   1D     30 coins, OKX's daily (16:00 UTC)    ./.candles-board-1D
//   1Dutc  30 coins, daily at 00:00 UTC         ./.candles-screener
//   4Hold  14 coins, 4 h, 2018-2021             ./.candles-board-4Hold   (BOARD_OLD=1)
//   1Dold  14 coins, OKX's daily, 2017-2021     ./.candles-board-1Dold   (BOARD_OLD=1)
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflate } from '../src/lib/indicators/deflated.ts'
import { analyseDonchian } from '../src/lib/indicators/donchianBreakout.ts'
import { analyseEmaCross } from '../src/lib/indicators/emaCross.ts'

const [target, exportName, set = '4H'] = process.argv.slice(2)
const DIRS = {
  '4H': './.candles-board-4H',
  '1H': './.candles-board-1H',
  '1D': './.candles-board-1D',
  '1Dutc': './.candles-screener',
  '4Hold': './.candles-board-4Hold',
  '1Dold': './.candles-board-1Dold',
}
if (!target || !exportName || !DIRS[set]) {
  console.error('uso: npm run battery -- <módulo> <export> [4H|1H|1D|1Dutc|4Hold|1Dold]')
  process.exit(2)
}
if (!existsSync(DIRS[set])) {
  console.error(`falta ${DIRS[set]}: node scripts/fetch-board.mjs ${set.replace('old', '')}${set.endsWith('old') ? ' con BOARD_OLD=1' : ''}`)
  process.exit(2)
}
const modPath = target.includes('/') || target.endsWith('.mjs') ? resolve(target) : resolve(`./src/lib/indicators/${target}.ts`)
const run = (await import(pathToFileURL(modPath).href))[exportName]
if (typeof run !== 'function') {
  console.error(`${exportName} no es una función de ${modPath}`)
  process.exit(2)
}

const load = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))])
    .filter(([, c]) => c.length >= 250)
const coins = load(DIRS[set])
const BAR_MS = set.startsWith('4H') ? 4 * 3_600_000 : set === '1H' ? 3_600_000 : 86_400_000

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const sd = (xs) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN
}
const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]
const f = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '  —  ')
const month = (t) => new Date(t).toISOString().slice(0, 7)
const year = (t) => new Date(t).toISOString().slice(0, 4)

/** Closed trades of one strategy over every coin. */
function trades(fn, series) {
  const out = []
  for (const [coin, cs] of series) {
    const half = Math.floor(cs.length / 2)
    for (const s of fn(cs).signals) {
      if (s.outcome === 'open' || !Number.isFinite(s.resultR)) continue
      out.push({
        coin,
        side: s.side,
        t: s.time,
        tc: s.closedTime ?? s.time,
        gross: s.resultR,
        fee: s.feeR,
        r: s.resultR - s.feeR,
        risk: Math.abs(s.entry - s.stop) / s.entry,
        hold: (s.closedIndex ?? s.index) - s.index,
        firstHalf: s.index < half,
      })
    }
  }
  return out
}

const T = trades(run, coins)
const R = T.map((t) => t.r)
console.log(`BATERÍA · ${exportName} · ${set} · ${coins.length} monedas`)
console.log(`n=${T.length}  neto ${f(mean(R), 3)} R  bruto ${f(mean(T.map((t) => t.gross)), 3)}  acierto ${((T.filter((t) => t.r > 0).length / T.length) * 100).toFixed(1)} %  mediana ${f(med(R))}  P10 ${f(q(R, 0.1))}  P90 ${f(q(R, 0.9))}`)
console.log(`riesgo medio ${(mean(T.map((t) => t.risk)) * 100).toFixed(2)} %  coste medio ${f(mean(T.map((t) => t.fee)), 3)} R  tenencia media ${mean(T.map((t) => t.hold)).toFixed(1)} barras`)
const d1 = deflate(R, 1)
console.log(`Sharpe por operación ${d1.sharpe.toFixed(3)}  PSR ${(d1.psr * 100).toFixed(1)} %  aguanta ${d1.survives} variantes`)

const tMid = med(T.map((t) => t.t))
console.log(`\nmitades (por moneda, según dónde se abre la operación): ${f(mean(T.filter((t) => t.firstHalf).map((t) => t.r)), 3)} / ${f(mean(T.filter((t) => !t.firstHalf).map((t) => t.r)), 3)}`)
console.log(`mitades (calendario, corte ${month(tMid)}): ${f(mean(T.filter((t) => t.t < tMid).map((t) => t.r)), 3)} / ${f(mean(T.filter((t) => t.t >= tMid).map((t) => t.r)), 3)}`)

const sorted = [...R].sort((a, b) => b - a)
console.log(`\nsin las mejores: 10 → ${f(mean(sorted.slice(10)), 3)}   20 → ${f(mean(sorted.slice(20)), 3)}   50 → ${f(mean(sorted.slice(50)), 3)}   1 % (${Math.ceil(R.length / 100)}) → ${f(mean(sorted.slice(Math.ceil(R.length / 100))), 3)}`)
console.log(`la mejor operación: ${f(sorted[0], 1)} R · las 10 mejores suman ${f(sorted.slice(0, 10).reduce((a, b) => a + b, 0), 0)} R de ${f(R.reduce((a, b) => a + b, 0), 0)} R`)
console.log('(con un objetivo fijo todas las ganadoras valen lo mismo y esta prueba apenas dice nada)')

const group = (key) => {
  const g = {}
  for (const t of T) (g[key(t)] ??= []).push(t.r)
  return g
}
const show = (title, g) =>
  console.log(`${title}: ` + Object.entries(g).sort().map(([k, v]) => `${k} ${f(mean(v), 2)} (n=${v.length})`).join(' · '))
console.log('')
show('por año   ', group((t) => year(t.t)))
show('por lado  ', group((t) => t.side))

// BTC's regime at the entry: the daily close the day before against its own 200-day mean.
const btcFiles = ['./.candles-board-1Dold/BTC.json', './.candles-board-1D/BTC.json', './.candles-screener/BTC.json']
const btc = []
for (const file of btcFiles.slice(0, 2)) if (existsSync(file)) btc.push(...JSON.parse(readFileSync(file, 'utf8')))
if (!btc.length && existsSync(btcFiles[2])) btc.push(...JSON.parse(readFileSync(btcFiles[2], 'utf8')))
btc.sort((a, b) => a.time - b.time)
const sma200 = btc.map((_, i) => (i >= 199 ? mean(btc.slice(i - 199, i + 1).map((c) => c.close)) : NaN))
const regimeAt = (t) => {
  if (!btc.length) return 'n/d'
  let lo = 0
  let hi = btc.length - 1
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1
    if (btc[m].time <= t - 86_400_000) lo = m
    else hi = m - 1
  }
  return Number.isFinite(sma200[lo]) ? (btc[lo].close > sma200[lo] ? 'BTC>MM200' : 'BTC<MM200') : 'n/d'
}
show('régimen   ', group((t) => regimeAt(t.t)))

const byCoin = {}
for (const t of T) (byCoin[t.coin] ??= []).push(t.r)
const solid = Object.entries(byCoin).filter(([, v]) => v.length >= 20)
console.log(`\nmonedas con n≥20: ${solid.length} · positivas ${solid.filter(([, v]) => mean(v) > 0).length} · ≥+0,1 R ${solid.filter(([, v]) => mean(v) >= 0.1).length}`)
const ranked = solid.map(([c, v]) => [c, mean(v), v.length]).sort((a, b) => b[1] - a[1])
console.log('  mejores: ' + ranked.slice(0, 4).map(([c, m, n]) => `${c} ${f(m)} (${n})`).join(' · '))
console.log('  peores : ' + ranked.slice(-4).map(([c, m, n]) => `${c} ${f(m)} (${n})`).join(' · '))

console.log(`\ncoste ×0,66 (mezcla real de la cuenta) ${f(mean(T.map((t) => t.gross - 0.66 * t.fee)), 3)} · ×1 ${f(mean(R), 3)} · ×2 ${f(mean(T.map((t) => t.gross - 2 * t.fee)), 3)} · ×3 ${f(mean(T.map((t) => t.gross - 3 * t.fee)), 3)}`)

// Months, not trades, are the unit that resamples: coins in one month move together.
const months = {}
for (const t of T) (months[month(t.t)] ??= []).push(t.r)
const groups = Object.values(months)
let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const boot = []
for (let b = 0; b < 4000; b++) {
  const pick = []
  for (let i = 0; i < groups.length; i++) pick.push(...groups[Math.floor(rnd() * groups.length)])
  boot.push(mean(pick))
}
boot.sort((a, b) => a - b)
console.log(`intervalo 95 % por meses (${groups.length} meses): [${f(boot[100], 3)}, ${f(boot[3899], 3)}]  · meses con neto positivo ${groups.filter((v) => mean(v) > 0).length}/${groups.length}`)

// What `try` cannot say: is it the same trade as the two trend followers already shipped?
if (set.endsWith('old')) {
  console.log('\n(sin comparación con Donchian y EMA 200: se hace sobre el tablero de 2022-26, y estos meses no coinciden)')
  process.exit(0)
}
const shippedCoins = load(DIRS['4H'])
const shipped = {
  'Donchian 4h': trades((c) => analyseDonchian(c), shippedCoins),
  'EMA200 4h': trades((c) => analyseEmaCross(c), shippedCoins),
}
const monthly = (ts) => {
  const m = {}
  for (const t of ts) m[month(t.tc)] = (m[month(t.tc)] ?? 0) + t.r / 30
  return m
}
const series = { candidata: monthly(T), ...Object.fromEntries(Object.entries(shipped).map(([k, v]) => [k, monthly(v)])) }
const common = Object.keys(series.candidata).filter((k) => Object.values(series).every((s) => k in s)).sort()
if (common.length < 6) process.exit(0)
const vec = (name) => common.map((k) => series[name][k])
const corr = (a, b) => {
  const ma = mean(a)
  const mb = mean(b)
  return mean(a.map((x, i) => (x - ma) * (b[i] - mb))) / (sd(a) * sd(b))
}
console.log(`\ncorrelación mensual (${common.length} meses comunes): ` + Object.keys(shipped).map((k) => `${k} ${f(corr(vec('candidata'), vec(k)))}`).join(' · '))
for (const [name, ts] of Object.entries(shipped)) {
  const idx = {}
  for (const t of ts) (idx[`${t.coin}|${t.side}`] ??= []).push(t.t)
  const near = T.filter((t) => (idx[`${t.coin}|${t.side}`] ?? []).some((x) => Math.abs(x - t.t) <= 3 * BAR_MS)).length
  console.log(`  entradas a ≤3 barras de una de ${name}: ${((near / T.length) * 100).toFixed(0)} %`)
}
const sharpe = (xs) => mean(xs) / sd(xs)
const base = common.map((k) => (series['Donchian 4h'][k] + series['EMA200 4h'][k]) / 2)
const plus = common.map((k) => (series['Donchian 4h'][k] + series['EMA200 4h'][k] + series.candidata[k]) / 3)
console.log(`Sharpe mensual: Donchian+EMA200 ${sharpe(base).toFixed(2)} → con la candidata ${sharpe(plus).toFixed(2)}   (candidata sola ${sharpe(vec('candidata')).toFixed(2)})`)
