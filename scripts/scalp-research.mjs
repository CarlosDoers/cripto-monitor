// Does the scalping method of the 2026-10-11 video (Alex Ruiz: 1 h direction,
// 5 m structure, 1 m trigger, EMA 50, tight stop and 1:1 target) make money?
//
//   BOARD_SINCE=2024-10-11 BOARD_COINS=BTC,ETH node scripts/fetch-board.mjs 1m
//   npm run scalp
//
// The rules are in `src/lib/indicators/scalpPullback.ts`, fixed before any
// result. This prints the result as described, the changes that were allowed
// (three) and the two things that decide a scalp more than the signal: what the
// fee takes of 1 R, and how many setups it makes untradeable.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { feeInR } from '../src/lib/indicators/types.ts'
import { analyseScalpPullback, SCALP_SETTINGS, SCALP_WARMUP, scalpEntries } from '../src/lib/indicators/scalpPullback.ts'

const DIR = process.env.SCALP_DIR ?? './.candles-board-1m'
if (!existsSync(DIR)) {
  console.error(`falta ${DIR}: BOARD_SINCE=2024-10-11 BOARD_COINS=BTC,ETH node scripts/fetch-board.mjs 1m`)
  process.exit(2)
}
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
const coins = Object.fromEntries(files.map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))]))

const FEES = { 'taker 0,10 %': 0.001, 'mezcla de la cuenta 0,066 %': 0.00066, 'maker 0,04 %': 0.0004 }
const f = (x, d = 2) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d)
const net = (sigs) => (sigs.length ? sigs.reduce((a, s) => a + s.resultR - s.feeR, 0) / sigs.length : NaN)
const gross = (sigs) => (sigs.length ? sigs.reduce((a, s) => a + s.resultR, 0) / sigs.length : NaN)
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }

function measure(settings) {
  const all = []
  const halves = [[], []]
  let candidates = 0
  let unaffordable = 0
  let days = 0
  for (const [coin, cs] of Object.entries(coins)) {
    const half = Math.floor(cs.length / 2)
    const r = analyseScalpPullback(cs, settings)
    for (const s of r.signals) if (s.outcome !== 'open') { all.push({ ...s, coin }); halves[s.index < half ? 0 : 1].push(s) }
    for (const e of scalpEntries(cs, settings)) {
      if (!e || e.index < SCALP_WARMUP) continue
      candidates++
      if (feeInR(e.entry, e.stop, settings.feeRate) > 1) unaffordable++
    }
    days += (cs.length - SCALP_WARMUP) / 1440
  }
  return { all, halves, candidates, unaffordable, days }
}

const VARIANTS = [
  ['tal como se describe: objetivo 1 R, sesgo 1 h + 5 m', {}],
  ['cambio 1: objetivo «a medio camino» del impulso', { target: 'half' }],
  ['cambio 2: solo 07–16 UTC (Londres y mañana de Nueva York)', { hoursUtc: [7, 16] }],
  ['cambio 3: sin el sesgo de 1 h y 5 m (solo estructura de 1 m)', { bias: false }],
  ['cambio 4: entrada con orden límite en la EMA 50 de 1 m, como dice que preferiría (stop a 0,25 ATR de la media)', { entry: 'limitEma' }],
  // The stop "cerca del precio" is not a number. Two wider readings of the same order, so the
  // verdict does not hang on how close "close" is.
  ['   · el mismo, stop a 1 ATR de la media', { entry: 'limitEma', limitBufferAtr: 1 }],
  ['   · el mismo, stop a 3 ATR de la media', { entry: 'limitEma', limitBufferAtr: 3 }],
]

console.log(`SCALPING · ${Object.entries(coins).map(([c, cs]) => `${c} ${cs.length} velas de 1 m (${new Date(cs[0].time).toISOString().slice(0, 10)} → ${new Date(cs.at(-1).time).toISOString().slice(0, 10)})`).join(' · ')}\n`)
for (const [name, patch] of VARIANTS) {
  console.log(`── ${name}`)
  for (const [label, feeRate] of Object.entries(FEES)) {
    const m = measure({ ...SCALP_SETTINGS, ...patch, feeRate })
    const wins = m.all.filter((s) => s.outcome === 'win')
    const stopPct = median(m.all.map((s) => Math.abs(s.entry - s.stop) / s.entry))
    console.log(
      `   ${label.padEnd(30)} n=${String(m.all.length).padStart(6)}  ${(m.all.length / m.days).toFixed(1).padStart(5)}/día  acierto ${(100 * wins.length / Math.max(1, m.all.length)).toFixed(1)} %  bruto ${f(gross(m.all))} R  NETO ${f(net(m.all))} R  mitades ${f(net(m.halves[0]))} / ${f(net(m.halves[1]))}  stop mediano ${(100 * stopPct).toFixed(3)} %  coste medio ${(m.all.reduce((a, s) => a + s.feeR, 0) / Math.max(1, m.all.length)).toFixed(2)} R  inviables por coste ${m.candidates ? (100 * m.unaffordable / m.candidates).toFixed(0) : '—'} % de ${m.candidates}`,
    )
    if (feeRate === 0.001) {
      for (const coin of Object.keys(coins)) {
        const c = m.all.filter((s) => s.coin === coin)
        console.log(`        ${coin.padEnd(5)} n=${c.length}  bruto ${f(gross(c))}  neto ${f(net(c))}`)
      }
    }
  }
  console.log()
}
