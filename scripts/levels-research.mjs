// Does a support/resistance level mean anything, or is any horizontal line
// "respected" often enough to look convincing?
//
//   npm run levels
//
// Needs ./.candles populated by `npm run candles`.
//
// A drawn level is an assertion, and this project does not ship assertions it
// has not measured. The test is the same shape as the random-entry control that
// killed five strategy families: build levels from history the detector can see,
// then compare how price behaves at them against how it behaves at a line put
// somewhere arbitrary at the same distance.
//
// Walk-forward, so nothing is fitted to the bars it is judged on: at each test
// point the levels come from bars [0..t) and the verdict from bars after t.
import { readFileSync, readdirSync } from 'node:fs'
import { findLevels, LEVEL_SETTINGS } from '../src/lib/indicators/levels.ts'
import { atr } from '../src/lib/indicators/ta.ts'

const DIR = './.candles'
const BARS = ['15m', '1H', '4H', '1D']
/** Bars of history the detector gets before a test point. */
const WINDOW = 400
/** How far ahead a touch is allowed to resolve. */
const HORIZON = 40
/** A move of this many ATRs decides rejection or break. */
const MOVE_ATR = 1

const series = {}
for (const f of readdirSync(DIR)) {
  const [inst, bar] = f.replace('.json', '').split('__')
  series[bar] ??= {}
  series[bar][inst] = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
}

/**
 * What happened the first time price reached `level` after bar `from`.
 *
 * Approach direction decides what a rejection means: coming from below, a
 * rejection is a fall back; coming from above, a rise. Returns null when the
 * level is never touched or the horizon runs out undecided — an undecided touch
 * is not evidence either way and must not be counted as a win.
 */
function testLevel(candles, atrs, from, level) {
  const startPrice = candles[from].close
  const fromBelow = startPrice < level
  for (let i = from + 1; i < Math.min(candles.length, from + 1 + HORIZON * 3); i++) {
    const c = candles[i]
    if (c.low > level || c.high < level) continue // not touched yet

    const unit = atrs[i]
    if (!Number.isFinite(unit) || unit <= 0) return null
    const move = unit * MOVE_ATR

    for (let k = i; k < Math.min(candles.length, i + HORIZON); k++) {
      const b = candles[k]
      if (fromBelow) {
        if (b.low <= level - move) return 'rechazo'
        if (b.high >= level + move) return 'ruptura'
      } else {
        if (b.high >= level + move) return 'rechazo'
        if (b.low <= level - move) return 'ruptura'
      }
    }
    return null // touched but undecided inside the horizon
  }
  return null
}

const rnd = (() => {
  let seed = 7
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
})()

const rate = (r) => (r.rechazo + r.ruptura > 0 ? r.rechazo / (r.rechazo + r.ruptura) : 0)
const f = (x, d = 1) => x.toFixed(d).padStart(6)

console.log('NIVELES · ¿reacciona el precio en ellos más que en una línea al azar?')
console.log(`Ventana ${WINDOW} velas · horizonte ${HORIZON} · rechazo = ${MOVE_ATR} ATR antes de romper\n`)
console.log('  TF     niveles  rechazo   azar  ventaja   n azar')

for (const bar of BARS) {
  const real = { rechazo: 0, ruptura: 0 }
  const fake = { rechazo: 0, ruptura: 0 }

  for (const candles of Object.values(series[bar] ?? {})) {
    if (candles.length < WINDOW + HORIZON * 2) continue
    const atrs = atr(
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      candles.map((c) => c.close),
      LEVEL_SETTINGS.atrLen,
    )
    // Step in chunks so consecutive test points are not the same setup again.
    for (let t = WINDOW; t < candles.length - HORIZON * 2; t += HORIZON) {
      // Sólo la ventana: es lo que el detector vería en el gráfico, y evita
      // copiar el histórico entero en cada punto de prueba.
      const levels = findLevels(candles.slice(t - WINDOW, t), LEVEL_SETTINGS)
      if (!levels.length) continue
      const price = candles[t].close
      const unit = atrs[t]
      if (!Number.isFinite(unit) || unit <= 0) continue

      for (const level of levels) {
        const outcome = testLevel(candles, atrs, t, level.price)
        if (outcome) real[outcome]++

        // The control keeps the distance and the side, and throws away only the
        // claim that this particular price matters.
        const distance = Math.abs(level.price - price)
        const side = level.price >= price ? 1 : -1
        const jitter = 0.5 + rnd()
        const decoy = price + side * distance * jitter
        const fakeOutcome = testLevel(candles, atrs, t, decoy)
        if (fakeOutcome) fake[fakeOutcome]++
      }
    }
  }

  const n = real.rechazo + real.ruptura
  const nFake = fake.rechazo + fake.ruptura
  console.log(
    `  ${bar.padEnd(4)} ${String(n).padStart(8)}  ${f(rate(real) * 100)}%  ${f(rate(fake) * 100)}%  ${f((rate(real) - rate(fake)) * 100)} pp  ${String(nFake).padStart(6)}`,
  )
}

console.log('\nUn nivel sólo significa algo si su columna de rechazo supera a la del azar.')
console.log('Si la ventaja es de un par de puntos, la línea es decoración.')
