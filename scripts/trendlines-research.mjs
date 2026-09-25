// Does a trendline mean anything, or is any diagonal line "respected" often
// enough to look convincing?
//
//   npm run trendlines
//
// Needs ./.candles populated by `npm run candles`.
//
// The same control as `levels-research.mjs`, tilted: at each test point the
// lines come from the bars the detector could see, and each one is judged
// against a PARALLEL line — same slope, same side of price — placed at a random
// distance. The decoy keeps the geometry of a trendline and throws away only
// the claim that these two particular swings matter.
import { readFileSync, readdirSync } from 'node:fs'
import { findTrendlines, lineAt, TRENDLINE_SETTINGS } from '../src/lib/indicators/trendlines.ts'
import { atr } from '../src/lib/indicators/ta.ts'

const DIR = './.candles'
const BARS = ['15m', '1H', '4H', '1D']
const WINDOW = 300
const HORIZON = 40
const MOVE_ATR = 1

const series = {}
for (const f of readdirSync(DIR)) {
  const [inst, bar] = f.replace('.json', '').split('__')
  series[bar] ??= {}
  series[bar][inst] = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
}

/**
 * First touch of a moving line after `from`, then which way price leaves it.
 * `at(i)` is the line's price at bar i. Null when untouched or undecided.
 */
function testLine(candles, atrs, from, at, fromAbove) {
  for (let i = from + 1; i < Math.min(candles.length, from + 1 + HORIZON * 3); i++) {
    const c = candles[i]
    const v = at(i)
    if (c.low > v || c.high < v) continue

    const unit = atrs[i]
    if (!Number.isFinite(unit) || unit <= 0) return null
    const move = unit * MOVE_ATR
    for (let k = i; k < Math.min(candles.length, i + HORIZON); k++) {
      const b = candles[k]
      const w = at(k)
      if (fromAbove) {
        if (b.high >= w + move) return 'rechazo'
        if (b.low <= w - move) return 'ruptura'
      } else {
        if (b.low <= w - move) return 'rechazo'
        if (b.high >= w + move) return 'ruptura'
      }
    }
    return null
  }
  return null
}

const rnd = (() => {
  let seed = 11
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
})()

const rate = (r) => (r.rechazo + r.ruptura > 0 ? r.rechazo / (r.rechazo + r.ruptura) : 0)
const f = (x, d = 1) => x.toFixed(d).padStart(6)

console.log('LÍNEAS DE TENDENCIA · ¿reacciona el precio en ellas más que en una paralela al azar?')
console.log(`Ventana ${WINDOW} velas · horizonte ${HORIZON} · rechazo = ${MOVE_ATR} ATR antes de romper\n`)
console.log('  TF     líneas  rechazo   azar  ventaja   n azar   ≥3 toques  rechazo')

for (const bar of BARS) {
  const real = { rechazo: 0, ruptura: 0 }
  const fake = { rechazo: 0, ruptura: 0 }
  const strong = { rechazo: 0, ruptura: 0 }

  for (const candles of Object.values(series[bar] ?? {})) {
    if (candles.length < WINDOW + HORIZON * 4) continue
    const atrs = atr(
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      candles.map((c) => c.close),
      TRENDLINE_SETTINGS.atrLen,
    )
    for (let t = WINDOW; t < candles.length - HORIZON * 4; t += HORIZON) {
      const base = t - WINDOW
      const lines = findTrendlines(candles.slice(base, t), TRENDLINE_SETTINGS)
      const price = candles[t - 1].close
      for (const line of lines) {
        const at = (i) => lineAt(line, i - base)
        const support = line.kind === 'soporte'
        const outcome = testLine(candles, atrs, t - 1, at, support)
        if (outcome) {
          real[outcome]++
          if (line.touches >= 3) strong[outcome]++
        }

        const distance = Math.abs(at(t - 1) - price)
        const shift = distance * (0.5 + rnd()) - distance
        const decoy = (i) => at(i) + (support ? -shift : shift)
        const fakeOutcome = testLine(candles, atrs, t - 1, decoy, support)
        if (fakeOutcome) fake[fakeOutcome]++
      }
    }
  }

  const n = real.rechazo + real.ruptura
  const nFake = fake.rechazo + fake.ruptura
  const nStrong = strong.rechazo + strong.ruptura
  console.log(
    `  ${bar.padEnd(4)} ${String(n).padStart(7)}  ${f(rate(real) * 100)}%  ${f(rate(fake) * 100)}%  ${f((rate(real) - rate(fake)) * 100)} pp  ${String(nFake).padStart(6)}  ${String(nStrong).padStart(10)}  ${f(rate(strong) * 100)}%`,
  )
}

console.log('\nUna línea sólo significa algo si su columna de rechazo supera a la de la paralela al azar.')
