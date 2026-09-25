// Does a moving average act as support/resistance, or is any line that follows
// price "respected" just as often?
//
//   npm run ma
//
// Needs ./.candles populated by `npm run candles`.
//
// The same control as `trendlines-research.mjs`, bent to follow the average:
// at each test point the decoy is the EMA itself shifted by a random amount,
// kept on the same side of price. It moves exactly like the average — same
// slope, same curvature — and throws away only the claim that the average's
// own value is where price reacts.
//
// No walk-forward window is needed: an EMA at bar t reads only bars up to t, so
// it cannot see the bars it is judged on.
import { readFileSync, readdirSync } from 'node:fs'
import { atr, ema } from '../src/lib/indicators/ta.ts'

const DIR = './.candles'
const BARS = ['15m', '1H', '4H', '1D']
const LENGTHS = [50, 200]
const HORIZON = 40
const MOVE_ATR = 1

const series = {}
for (const f of readdirSync(DIR)) {
  const [inst, bar] = f.replace('.json', '').split('__')
  series[bar] ??= {}
  series[bar][inst] = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
}

/** First touch of a moving line after `from`, then which way price leaves it. */
function testLine(candles, atrs, from, at, fromAbove) {
  for (let i = from + 1; i < Math.min(candles.length, from + 1 + HORIZON * 3); i++) {
    const c = candles[i]
    const v = at(i)
    if (!Number.isFinite(v)) return null
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
  let seed = 13
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
})()

const rate = (r) => (r.rechazo + r.ruptura > 0 ? r.rechazo / (r.rechazo + r.ruptura) : 0)
const f = (x, d = 1) => x.toFixed(d).padStart(6)

console.log('MEDIAS MÓVILES · ¿reacciona el precio en la EMA más que en una copia desplazada al azar?')
console.log(`Horizonte ${HORIZON} · rechazo = ${MOVE_ATR} ATR antes de romper\n`)
console.log('  EMA  TF      toques  rechazo   azar  ventaja   n azar')

for (const length of LENGTHS) {
  for (const bar of BARS) {
    const real = { rechazo: 0, ruptura: 0 }
    const fake = { rechazo: 0, ruptura: 0 }

    for (const candles of Object.values(series[bar] ?? {})) {
      if (candles.length < length + HORIZON * 4) continue
      const closes = candles.map((c) => c.close)
      const line = ema(closes, length)
      const atrs = atr(
        candles.map((c) => c.high),
        candles.map((c) => c.low),
        closes,
        14,
      )
      for (let t = length + 1; t < candles.length - HORIZON * 4; t += HORIZON) {
        const price = candles[t].close
        const now = line[t]
        if (!Number.isFinite(now) || now === price) continue
        const fromAbove = price > now
        const outcome = testLine(candles, atrs, t, (i) => line[i], fromAbove)
        if (outcome) real[outcome]++

        const distance = Math.abs(now - price)
        const shift = distance * (0.5 + rnd()) - distance
        // Positive shift moves the decoy away from price, negative towards it.
        const decoy = (i) => line[i] + (fromAbove ? -shift : shift)
        const fakeOutcome = testLine(candles, atrs, t, decoy, fromAbove)
        if (fakeOutcome) fake[fakeOutcome]++
      }
    }

    const n = real.rechazo + real.ruptura
    const nFake = fake.rechazo + fake.ruptura
    console.log(
      `  ${String(length).padStart(3)}  ${bar.padEnd(4)} ${String(n).padStart(8)}  ${f(rate(real) * 100)}%  ${f(rate(fake) * 100)}%  ${f((rate(real) - rate(fake)) * 100)} pp  ${String(nFake).padStart(6)}`,
    )
  }
}

console.log('\nLa EMA sólo hace de soporte o resistencia si su rechazo supera al de la copia desplazada.')
