// Does any Screener preset predict anything?
//
//   npm run screener
//
// Needs `npm run dev` up the first time; it caches daily candles under
// ./.candles-screener. Not inside ./.candles: every other script reads each
// entry there as a series, and a subdirectory made them all crash (EISDIR).
// Pass DEV_URL if Vite picked another port.
//
// A screen is cross-sectional: it picks some contracts out of many on a given
// day. So the question is not "did it go up" — in a bull market everything
// did — but "did what the screen picked beat the rest of the board that week".
// Each observation is a contract's forward 7-day return minus the mean of every
// contract on the same day. Days are sampled every 7th, so no two weeks
// overlap, and the interval is bootstrapped by day, because contracts that
// share a day are not independent.
//
// The universe is the liquid crypto half of today's X-Perp board, measured on
// its USDT spot pair: the X-Perp contracts were listed on 2026-03-30 and have
// half a year of history, the spot pairs have years. Equities and commodities
// have no spot pair on OKX and are left out, which the report says.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rsi, sma } from '../src/lib/indicators/ta.ts'
import { analyseSmc } from '../src/lib/indicators/smc.ts'

const B = process.env.DEV_URL ?? 'http://localhost:5173'
const DIR = './.candles-screener'
const SINCE = Date.parse('2022-01-01T00:00:00Z')
const DAY = 86_400_000
const H = 7
mkdirSync(DIR, { recursive: true })

const sleep = (ms) => new Promise((s) => setTimeout(s, ms))
const get = async (p) => {
  const r = await fetch(`${B}/api/okx?path=${encodeURIComponent(p)}`)
  const j = await r.json()
  return j.error ? { error: j.message } : (j.data ?? j)
}

// ── universe ────────────────────────────────────────────────────────────────
let symbols
const listFile = `${DIR}/_universe.json`
if (existsSync(listFile)) {
  symbols = JSON.parse(readFileSync(listFile, 'utf8'))
} else {
  const inst = await get('/api/v5/public/instruments?instType=FUTURES')
  const tick = await get('/api/v5/market/tickers?instType=FUTURES')
  const vol = new Map(tick.map((t) => [t.instId, +t.volCcy24h * +t.last]))
  symbols = [
    ...new Set(
      inst
        .filter((i) => i.instId.includes('XPERP') && i.instCategory === '1' && (vol.get(i.instId) ?? 0) >= 1e6)
        .map((i) => i.instId.split('-')[0]),
    ),
  ]
  writeFileSync(listFile, JSON.stringify(symbols))
}

const series = {}
for (const sym of symbols) {
  const file = `${DIR}/${sym}.json`
  if (!existsSync(file)) {
    const all = []
    let after = Date.now()
    for (let p = 0; p < 20 && after > SINCE; p++) {
      const rows = await get(`/api/v5/market/history-candles?instId=${sym}-USDT&bar=1Dutc&after=${after}&limit=100`)
      if (rows.error || !rows.length) break
      all.push(...rows)
      after = +rows.at(-1)[0]
      await sleep(110)
    }
    const seen = new Set()
    const candles = all
      .map((c) => ({ time: +c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], vol: +c[5], confirmed: c[8] === '1' }))
      .filter((c) => c.confirmed && !seen.has(c.time) && seen.add(c.time))
      .sort((a, b) => a.time - b.time)
    writeFileSync(file, JSON.stringify(candles))
  }
  const c = JSON.parse(readFileSync(file, 'utf8'))
  if (c.length >= 120) series[sym] = c
}

// ── conditions at each day, from data up to that day only ─────────────────
const CONDITIONS = {
  sobreventa: 'RSI(14) < 30',
  sobrecompra: 'RSI(14) > 70',
  max20: 'nuevo máximo 20 d',
  min20: 'nuevo mínimo 20 d',
  volumen: 'volumen ≥ 2× su media 20 d',
  alcista: 'precio > media 20 > media 50',
  bajista: 'precio < media 20 < media 50',
  chochUp: 'CHoCH alcista (SMC) en 5 d',
  chochDown: 'CHoCH bajista (SMC) en 5 d',
}

const obs = [] // { day, sym, fwd, flags }
for (const [sym, c] of Object.entries(series)) {
  const close = c.map((x) => x.close)
  const r = rsi(close, 14)
  const s20 = sma(close, 20)
  const s50 = sma(close, 50)
  // Structure events are causal: a break at index i used only bars up to i.
  const smc = analyseSmc(c)
  const lastUp = new Array(c.length).fill(-1e9)
  const lastDown = new Array(c.length).fill(-1e9)
  for (const e of smc.structures) {
    if (e.kind !== 'CHoCH') continue
    ;(e.bias > 0 ? lastUp : lastDown)[e.index] = e.index
  }
  for (let i = 1; i < c.length; i++) {
    lastUp[i] = Math.max(lastUp[i], lastUp[i - 1])
    lastDown[i] = Math.max(lastDown[i], lastDown[i - 1])
  }
  for (let i = 60; i + H < c.length; i++) {
    const day = Math.floor(c[i].time / DAY)
    if (day % H !== 0) continue
    const prevHi = Math.max(...c.slice(i - 20, i).map((x) => x.high))
    const prevLo = Math.min(...c.slice(i - 20, i).map((x) => x.low))
    const meanVol = c.slice(i - 20, i).reduce((s, x) => s + x.vol * x.close, 0) / 20
    obs.push({
      day,
      sym,
      fwd: close[i + H] / close[i] - 1,
      flags: {
        sobreventa: r[i] < 30,
        sobrecompra: r[i] > 70,
        max20: c[i].close > prevHi,
        min20: c[i].close < prevLo,
        volumen: meanVol > 0 && (c[i].vol * c[i].close) / meanVol >= 2,
        alcista: close[i] > s20[i] && s20[i] > s50[i],
        bajista: close[i] < s20[i] && s20[i] < s50[i],
        chochUp: i - lastUp[i] < 5,
        chochDown: i - lastDown[i] < 5,
      },
    })
  }
}

// Excess over the same day's board.
const byDay = new Map()
for (const o of obs) (byDay.get(o.day) ?? byDay.set(o.day, []).get(o.day)).push(o)
for (const list of byDay.values()) {
  const m = list.reduce((s, o) => s + o.fwd, 0) / list.length
  for (const o of list) o.excess = list.length >= 5 ? o.fwd - m : NaN
}
const usable = obs.filter((o) => Number.isFinite(o.excess))
const days = [...new Set(usable.map((o) => o.day))].sort((a, b) => a - b)
const midDay = days[Math.floor(days.length / 2)]

let seed = 11
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN)
const f = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)} %` : '   —   ').padStart(9)

/** Day-clustered bootstrap: resample whole days, keep each day's picks together. */
function interval(hits) {
  const groups = new Map()
  for (const o of hits) (groups.get(o.day) ?? groups.set(o.day, []).get(o.day)).push(o.excess)
  const g = [...groups.values()]
  if (g.length < 10) return [NaN, NaN]
  seed = 11
  const means = []
  for (let k = 0; k < 2000; k++) {
    let s = 0
    let n = 0
    for (let j = 0; j < g.length; j++) {
      const pick = g[Math.floor(rnd() * g.length)]
      for (const x of pick) {
        s += x
        n++
      }
    }
    means.push(s / n)
  }
  means.sort((a, b) => a - b)
  return [means[50], means[1950]]
}

console.log('SCREENER · ¿lo que selecciona cada atajo bate al resto del tablero la semana siguiente?')
console.log(
  `${Object.keys(series).length} criptos líquidas del tablero X-Perp, en su par USDT al contado · ` +
    `${days.length} semanas sin solapar desde ${new Date(days[0] * DAY).toISOString().slice(0, 10)}`,
)
console.log('Rendimiento a 7 días MENOS la media de todos ese mismo día. 0 = igual que el resto.\n')
// A few 5× weeks can carry a mean on their own. The trimmed mean clips every
// observation to the board's 1st–99th percentile of excess; the median and the
// share that beat the day's mean say what a typical pick did.
const sortedEx = usable.map((o) => o.excess).sort((a, b) => a - b)
const lo1 = sortedEx[Math.floor(sortedEx.length * 0.01)]
const hi1 = sortedEx[Math.floor(sortedEx.length * 0.99)]
const clip = (x) => Math.min(hi1, Math.max(lo1, x))
const median = (a) => {
  const b = [...a].sort((x, y) => x - y)
  return b.length ? b[Math.floor(b.length / 2)] : NaN
}
const baseBeat = usable.filter((o) => o.excess > 0).length / usable.length
console.log(`Referencia: un contrato cualquiera bate a la media del día el ${(baseBeat * 100).toFixed(0)} % de las semanas (la distribución tiene cola a la derecha).\n`)
console.log('  condición                         n    exceso    IC95 por días          1ª mitad  2ª mitad   recortada  mediana   bate %')
for (const [key, label] of Object.entries(CONDITIONS)) {
  const hits = usable.filter((o) => o.flags[key])
  const ex = hits.map((o) => o.excess)
  const [lo, hi] = interval(hits)
  const a = mean(hits.filter((o) => o.day < midDay).map((o) => o.excess))
  const b = mean(hits.filter((o) => o.day >= midDay).map((o) => o.excess))
  const beat = hits.filter((o) => o.excess > 0).length / (hits.length || 1)
  console.log(
    `  ${label.padEnd(30)} ${String(hits.length).padStart(5)} ${f(mean(ex))}  [${f(lo)}, ${f(hi)}]  ${f(a)} ${f(b)}  ${f(mean(ex.map(clip)))} ${f(median(ex))}   ${(beat * 100).toFixed(0).padStart(3)} %`,
  )
}
console.log('\nUn atajo solo anticipa algo si su intervalo no cruza el 0 y las dos mitades van en el mismo sentido.')
