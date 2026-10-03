// Do volume and structure make an EMA touch worth more?
//
//   npm run ematouch          (EMA 25; LENGTH=50 npm run ematouch for another)
//
// Needs ./.candles-screener: the Screener's daily (UTC) candles of 30 liquid
// coins since 2022, cached by `npm run screener`.
//
// `npm run ma` already found that a touch of the daily EMA 25 is "respected"
// (price leaves by the side it came from) no more often than a copy of the
// line shifted at random. The usual answer is that a touch only counts with
// confirmation, so the confirmations people use are tested here, written down
// before measuring:
//
//   estructura a favor   — internal SMC trend, as of the bar BEFORE the touch,
//                          bullish when the touch comes from above (the EMA as
//                          support) or bearish when it comes from below
//   volumen alto         — the touch candle's volume ≥ 1.5× its 20-day mean
//   vela que aguanta     — the touch candle closes on the side it came from
//
// and their combinations. Every one is known at the touch candle's close, and
// the outcome is read from the NEXT bar: the first of a 1 ATR move away on the
// side it came from ("rechazo") or 1 ATR through to the other side ("ruptura"),
// within 40 bars; a bar that does both counts as a break. Undecided touches
// are left out.
//
// Two comparisons, because a filter can look good for the wrong reason:
//   · against all touches — does the filter add anything at all?
//   · against the SAME filter applied to touches of decoy lines, the EMA shifted
//     by ±0.5, ±1 and ±1.5 ATR — is it the EMA that matters, or would any line
//     that follows price do as well under that filter? Only this one says the
//     EMA itself carries information.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { atr, ema } from '../src/lib/indicators/ta.ts'
import { analyseSmc } from '../src/lib/indicators/smc.ts'
import { EMA_TOUCH_EVIDENCE } from '../src/lib/emaTouch.ts'
import { analyseEmaTouchEmaExit, analyseEmaTouchTrade } from '../src/lib/indicators/emaTouchTrade.ts'

const DIR = process.env.DIR ?? './.candles-screener'
const LENGTH = Number(process.env.LENGTH ?? 25)
const HORIZON = 40
const MOVE_ATR = 1
const HIGH_VOL = 1.5
const VOL_LOOKBACK = 20
const SHIFTS = [-1.5, -1, -0.5, 0.5, 1, 1.5]

if (!existsSync(DIR)) {
  console.error(`Falta ${DIR}: corre antes \`npm run screener\` con \`npm run dev\` levantado.`)
  process.exit(2)
}

const VARIANTS = [
  ['todos los toques', () => true],
  ['estructura a favor', (t) => t.favour],
  ['estructura en contra', (t) => t.against],
  ['estructura swing a favor', (t) => t.swingFavour],
  ['volumen alto', (t) => t.highVol],
  ['vela que aguanta', (t) => t.held],
  ['a favor + volumen alto', (t) => t.favour && t.highVol],
  ['a favor + aguanta', (t) => t.favour && t.held],
  ['a favor + aguanta + volumen', (t) => t.favour && t.held && t.highVol],
]

/** Every touch episode of `line`, with its filters and its outcome. */
function touches(c, line, unit, volRatio, internal, swing, half) {
  const out = []
  const touching = (i) => c[i].low <= line[i] && line[i] <= c[i].high
  for (let i = LENGTH * 3; i < c.length - 1; i++) {
    if (!Number.isFinite(line[i]) || !Number.isFinite(line[i - 1]) || !(unit[i] > 0)) continue
    // The first candle of a touch: one that touches after one that did not.
    if (!touching(i) || touching(i - 1)) continue
    const fromAbove = c[i - 1].close > line[i - 1]
    const move = unit[i] * MOVE_ATR
    let outcome = null
    for (let k = i + 1; k < Math.min(c.length, i + 1 + HORIZON); k++) {
      const up = c[k].high >= line[k] + move
      const down = c[k].low <= line[k] - move
      if (!up && !down) continue
      // Both on one bar: count the break, the worse case for a "respected" line.
      if (up && down) outcome = 'ruptura'
      else outcome = (fromAbove ? up : down) ? 'rechazo' : 'ruptura'
      break
    }
    if (!outcome) continue
    const dir = fromAbove ? 1 : -1
    out.push({
      outcome,
      first: i < half,
      favour: internal[i - 1] === dir,
      against: internal[i - 1] === -dir,
      swingFavour: swing[i - 1] === dir,
      highVol: volRatio[i] >= HIGH_VOL,
      held: fromAbove ? c[i].close > line[i] : c[i].close < line[i],
    })
  }
  return out
}

const real = []
const decoy = []
let coins = 0
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f.startsWith('_')) continue
  const c = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')).filter((x) => x.confirmed !== false)
  if (c.length < LENGTH * 3 + HORIZON + 30 || !c.every((x) => Number.isFinite(x.vol))) continue
  coins++
  const closes = c.map((x) => x.close)
  const line = ema(closes, LENGTH)
  const unit = atr(c.map((x) => x.high), c.map((x) => x.low), closes, 14)
  const volRatio = c.map((x, i) => {
    if (i < VOL_LOOKBACK) return NaN
    let s = 0
    for (let k = i - VOL_LOOKBACK; k < i; k++) s += c[k].vol
    return s > 0 ? x.vol / (s / VOL_LOOKBACK) : NaN
  })
  const smc = analyseSmc(c)
  const half = Math.floor(c.length / 2)
  real.push(...touches(c, line, unit, volRatio, smc.internalTrendSeries, smc.swingTrendSeries, half))
  for (const s of SHIFTS) {
    const shifted = line.map((v, i) => v + s * unit[i])
    decoy.push(...touches(c, shifted, unit, volRatio, smc.internalTrendSeries, smc.swingTrendSeries, half))
  }
}

const rate = (xs) => (xs.length ? xs.filter((t) => t.outcome === 'rechazo').length / xs.length : NaN)
const p = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '  —  ').padStart(6)
const pp = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}` : '—').padStart(6)
const ci = (r, n) => 1.96 * Math.sqrt((r * (1 - r)) / Math.max(n, 1))

console.log(`TOQUES A LA EMA ${LENGTH} DIARIA · ¿añaden algo el volumen y la estructura?`)
console.log(`${coins} monedas · rechazo = ${MOVE_ATR} ATR por el lado del que venía antes de cruzar ${MOVE_ATR} ATR · ${HORIZON} velas\n`)
console.log('  filtro                          n   rechazo  ±IC95   1ª mitad 2ª mitad   vs todos   copia   vs copia')
const base = rate(real)
const rows = []
for (const [name, keep] of VARIANTS) {
  const xs = real.filter(keep)
  const ys = decoy.filter(keep)
  const r = rate(xs)
  const row = {
    name,
    n: xs.length,
    r,
    first: rate(xs.filter((t) => t.first)),
    second: rate(xs.filter((t) => !t.first)),
    decoy: rate(ys),
  }
  rows.push(row)
  console.log(
    `  ${name.padEnd(28)} ${String(xs.length).padStart(5)}  ${p(r)}  ${(ci(r, xs.length) * 100).toFixed(1).padStart(5)}   ${p(row.first)}   ${p(row.second)}   ${pp(r - base)} pp ${p(row.decoy)}  ${pp(r - row.decoy)} pp`,
  )
}
console.log('\nUn filtro sólo da confianza si sube el rechazo frente a TODOS los toques y frente a la COPIA con el mismo')
console.log('filtro, en las dos mitades, y por más que su intervalo. Si sube igual en la copia, lo que mide es el filtro,')
console.log('no la EMA: cualquier línea que siga al precio lo haría igual de bien.')

// What the Screener card quotes, checked like the audit checks registry.ts.
if (LENGTH === EMA_TOUCH_EVIDENCE.length) {
  const e = EMA_TOUCH_EVIDENCE
  const by = Object.fromEntries(rows.map((r) => [r.name, r]))
  const problems = []
  const check = (name, got, want) => {
    if (!Number.isFinite(got) || Math.abs(got - want) > 0.005) problems.push(`${name}: medido ${got} vs declarado ${want}`)
  }
  check('touches', by['todos los toques'].n, e.touches)
  check('coins', coins, e.coins)
  check('rejection', by['todos los toques'].r, e.rejection)
  check('decoy', by['todos los toques'].decoy, e.decoy)
  check('favour.rejection', by['estructura a favor'].r, e.favour.rejection)
  check('favour.decoy', by['estructura a favor'].decoy, e.favour.decoy)
  check('highVolume.rejection', by['volumen alto'].r, e.highVolume.rejection)
  check('highVolume.decoy', by['volumen alto'].decoy, e.highVolume.decoy)
  check('all3.n', by['a favor + aguanta + volumen'].n, e.all3.n)
  check('all3.rejection', by['a favor + aguanta + volumen'].r, e.all3.rejection)
  check('all3.decoy', by['a favor + aguanta + volumen'].decoy, e.all3.decoy)

  // The trade, on the same coins: what `npm run try` measures with
  // TRY_DIR=./.candles-screener TRY_BAR=1D, recomputed here so the card's
  // figures are checked in one place.
  const trades = (run) => {
    const out = []
    for (const f of readdirSync(DIR)) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue
      const cs = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
      if (cs.length < 250) continue
      for (const s of run(cs).signals) if (s.outcome !== 'open') out.push(s.resultR - s.feeR)
    }
    return out
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
  const base = trades(analyseEmaTouchTrade)
  const exitEma = trades(analyseEmaTouchEmaExit).sort((a, b) => b - a)
  console.log(`\nOPERADO · vela que aguanta, stop en la mecha, objetivo 2 R: ${base.length} operaciones, ${mean(base).toFixed(2)} R netos`)
  console.log(`         saliendo al cerrar al otro lado de la EMA: ${mean(exitEma).toFixed(2)} R; sin sus 5 mejores, ${mean(exitEma.slice(5)).toFixed(2)} R`)
  check('trade.n', base.length, e.trade.n)
  check('trade.netR', mean(base), e.trade.netR)
  check('trade.emaExitNetR', mean(exitEma), e.trade.emaExitNetR)
  check('trade.emaExitWithoutTop5', mean(exitEma.slice(5)), e.trade.emaExitWithoutTop5)
  console.log('\n=== DESVIACIONES · lo que cita el Screener (EMA_TOUCH_EVIDENCE) ===')
  if (!problems.length) console.log('  ninguna')
  for (const p of problems) console.log(`  ⚠ ${p}`)
  if (problems.length) process.exitCode = 1
}
