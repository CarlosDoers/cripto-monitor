// Three ways of drawing a level, against the same random control, across a grid
// of the two constants the first measurement had to guess.
//
//   npm run levels:sweep
//
// The first run said pivot levels beat a random line by 0.3 pp on 15 m and lost
// on every higher timeframe. Before believing that, two things had to be ruled
// out. The thresholds were picked by hand, so the whole grid is printed rather
// than its best cell — picking the winner afterwards is how a false positive is
// manufactured. And pivot clustering is only one technique: round numbers and
// the previous day's extremes are the other two in common use, and they fail or
// survive independently.
//
// Restricted to BTC/ETH/SOL and the last 40 000 bars per series: 27 cells times
// three sources is enough work that the full cache would take minutes, and the
// three long histories are the only genuinely independent ones anyway.
import { readFileSync, readdirSync } from 'node:fs'
import { findLevels, LEVEL_SETTINGS } from '../src/lib/indicators/levels.ts'
import { atr } from '../src/lib/indicators/ta.ts'

const DIR = './.candles'
const BARS = ['15m', '1H', '4H', '1D']
const LONG = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT']
const WINDOW = 400
const CAP = 40_000
const MOVES = [0.5, 1, 2]
const HORIZONS = [20, 40, 80]
const DAY_MS = 86_400_000

const series = {}
for (const f of readdirSync(DIR)) {
  const [inst, bar] = f.replace('.json', '').split('__')
  if (!LONG.includes(inst)) continue
  const all = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
  series[bar] ??= {}
  series[bar][inst] = all.slice(-CAP)
}

/** Nearest round prices above and below, on a step of about one ATR. */
function roundLevels(price, unit) {
  const mag = 10 ** Math.floor(Math.log10(unit))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= unit) ?? mag * 10
  const below = Math.floor(price / step) * step
  return [below, below + step, below - step, below + step * 2].filter((v) => v > 0)
}

/** Previous UTC day's high and low, as of bar `t`. */
function priorDayLevels(candles, t) {
  const day = Math.floor(candles[t].time / DAY_MS) * DAY_MS
  let high = -Infinity
  let low = Infinity
  for (let i = t - 1; i >= 0; i--) {
    const d = Math.floor(candles[i].time / DAY_MS) * DAY_MS
    if (d >= day) continue
    if (d < day - DAY_MS) break
    high = Math.max(high, candles[i].high)
    low = Math.min(low, candles[i].low)
  }
  return Number.isFinite(high) && Number.isFinite(low) ? [high, low] : []
}

function testLevel(candles, atrs, from, level, horizon, moveAtr) {
  const fromBelow = candles[from].close < level
  for (let i = from + 1; i < Math.min(candles.length, from + 1 + horizon * 3); i++) {
    const c = candles[i]
    if (c.low > level || c.high < level) continue
    const unit = atrs[i]
    if (!Number.isFinite(unit) || unit <= 0) return null
    const move = unit * moveAtr
    for (let k = i; k < Math.min(candles.length, i + horizon); k++) {
      const b = candles[k]
      if (fromBelow) {
        if (b.low <= level - move) return 'rechazo'
        if (b.high >= level + move) return 'ruptura'
      } else {
        if (b.high >= level + move) return 'rechazo'
        if (b.low <= level - move) return 'ruptura'
      }
    }
    return null
  }
  return null
}

let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const rate = (r) => (r.rechazo + r.ruptura > 0 ? r.rechazo / (r.rechazo + r.ruptura) : 0)
const f = (x, d = 1) => x.toFixed(d).padStart(5)

const SOURCES = {
  pivotes: (candles, t) => findLevels(candles.slice(t - WINDOW, t), LEVEL_SETTINGS).map((l) => l.price),
  redondos: (candles, t, unit) => roundLevels(candles[t].close, unit),
  'máx/mín día': (candles, t) => priorDayLevels(candles, t),
}

console.log('NIVELES · tres técnicas contra la misma línea al azar')
console.log('ventaja en puntos porcentuales de rechazo sobre el control; n entre paréntesis\n')

for (const [name, source] of Object.entries(SOURCES)) {
  console.log(`\n=== ${name} ===`)
  console.log('  TF    ' + HORIZONS.map((h) => `h=${h}`.padStart(16)).join(''))
  for (const bar of BARS) {
    const list = Object.values(series[bar] ?? {})
    if (!list.length) continue
    for (const move of MOVES) {
      const cells = []
      for (const horizon of HORIZONS) {
        const real = { rechazo: 0, ruptura: 0 }
        const fake = { rechazo: 0, ruptura: 0 }
        for (const candles of list) {
          if (candles.length < WINDOW + horizon * 3) continue
          const atrs = atr(
            candles.map((c) => c.high),
            candles.map((c) => c.low),
            candles.map((c) => c.close),
            LEVEL_SETTINGS.atrLen,
          )
          for (let t = WINDOW; t < candles.length - horizon * 3; t += horizon) {
            const unit = atrs[t]
            if (!Number.isFinite(unit) || unit <= 0) continue
            const price = candles[t].close
            for (const level of source(candles, t, unit)) {
              if (!Number.isFinite(level) || level <= 0) continue
              const outcome = testLevel(candles, atrs, t, level, horizon, move)
              if (outcome) real[outcome]++
              const distance = Math.abs(level - price)
              const side = level >= price ? 1 : -1
              const decoy = price + side * distance * (0.5 + rnd())
              const fakeOutcome = testLevel(candles, atrs, t, decoy, horizon, move)
              if (fakeOutcome) fake[fakeOutcome]++
            }
          }
        }
        const n = real.rechazo + real.ruptura
        const edge = (rate(real) - rate(fake)) * 100
        cells.push(`${f(edge)} pp (${String(n).padStart(6)})`)
      }
      console.log(`  ${bar.padEnd(4)} ${String(move).padStart(3)}atr ${cells.join(' ')}`)
    }
  }
}

console.log('\nUna técnica sólo vale si su ventaja es positiva en casi toda la rejilla.')
console.log('Una celda buena rodeada de celdas malas es ruido, no un hallazgo.')
