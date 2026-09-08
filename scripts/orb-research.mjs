// The evidence behind the opening range, which audit-strategies.mjs does not
// check. The audit verifies that the declared expectancy matches what the
// shipped code measures; it says nothing about *why* the setup should work.
// These four tests are that argument, and they are what would have to be re-run
// before changing the anchor, the range or the volume filter.
//
//   npm run orb
//
// Needs ./.candles populated by `npm run candles`.
//
// It runs the strategy's own analyseOpeningRange() rather than a copy, so it
// cannot drift away from what the app executes.
import { readFileSync, readdirSync } from 'node:fs'
import { analyseOpeningRange, OPENING_RANGE_SETTINGS } from '../src/lib/indicators/openingRange.ts'
import { efficiencyRatio } from '../src/lib/indicators/registry.ts'

const DIR = './.candles'
// The three with four years of 15 m. The dated contracts have weeks, and an
// aggregate is only as independent as the histories behind it.
const LONG = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT']

const series = {}
for (const f of readdirSync(DIR)) {
  const [inst, bar] = f.replace('.json', '').split('__')
  if (bar !== '15m' || !LONG.includes(inst)) continue
  series[inst] = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
}

const resolved = (r) => r.signals.filter((s) => s.outcome !== 'open' && Number.isFinite(s.resultR))
const netR = (s) => (s.length ? s.reduce((a, x) => a + x.resultR - x.feeR, 0) / s.length : 0)
// Gross, matching audit-strategies.mjs, so the two never disagree.
const hit = (s) => (s.length ? s.filter((x) => x.resultR > 0).length / s.length : 0)
const sg = (r) => `${r >= 0 ? '+' : ''}${r.toFixed(3)}`

const run = (settings, slice = 'all') => {
  const out = []
  for (const cs of Object.values(series)) {
    const half = Math.floor(cs.length / 2)
    const data = slice === 'first' ? cs.slice(0, half) : slice === 'second' ? cs.slice(half) : cs
    out.push(...resolved(analyseOpeningRange(data, settings)))
  }
  return out
}

console.log('OPENING RANGE · the evidence the audit does not cover')
console.log(`BTC/ETH/SOL, 15 m, ${Object.values(series)[0].length} velas por instrumento\n`)

console.log('═══ 1. Is it one instrument? ═══\n')
for (const [inst, cs] of Object.entries(series)) {
  const s = resolved(analyseOpeningRange(cs, OPENING_RANGE_SETTINGS))
  console.log(`  ${inst.padEnd(10)} n=${String(s.length).padStart(4)}  ${sg(netR(s))} R  acierto ${(hit(s) * 100).toFixed(0)} %`)
}
{
  const s = run(OPENING_RANGE_SETTINGS)
  console.log(`  ${'AGREGADO'.padEnd(10)} n=${String(s.length).padStart(4)}  ${sg(netR(s))} R`)
}

console.log('\n═══ 2. Is it one regime? ═══\n')
{
  const byYear = {}
  for (const t of run(OPENING_RANGE_SETTINGS)) {
    ;(byYear[new Date(t.time).getUTCFullYear()] ??= []).push(t)
  }
  for (const y of Object.keys(byYear).sort()) {
    const s = byYear[y]
    console.log(`  ${y}  n=${String(s.length).padStart(4)}  ${sg(netR(s))} R  ${'█'.repeat(Math.max(0, Math.round((netR(s) + 0.3) * 30)))}`)
  }
}

console.log('\n═══ 3. Is the neighbourhood flat? ═══\n')
console.log('  A single lucky parameter set is the failure mode this catches.')
const axes = [
  ['rango', 'rangeMinutes', [15, 30, 45, 60, 90], (v) => `${v}m`],
  ['hold', 'holdHours', [6, 12, 18, 24, 36], (v) => `${v}h`],
  ['volumen', 'minRelVolume', [0, 1, 1.1, 1.2, 1.3, 1.5, 2], (v) => (v ? `>${v}` : 'sin')],
]
for (const [name, key, values, label] of axes) {
  const cells = values.map((v) => {
    const settings = { ...OPENING_RANGE_SETTINGS, [key]: v }
    const ins = netR(run(settings, 'first'))
    const out = netR(run(settings, 'second'))
    return `${label(v).padStart(6)} ${sg(netR(run(settings)))}${ins > 0 && out > 0 ? ' ' : '*'}`
  })
  console.log(`  ${name.padEnd(9)} ${cells.join('  ')}`)
}
console.log('\n  (* = no positiva en las dos mitades del histórico)')

console.log('\n═══ 4. Does it beat a random entry with the same geometry? ═══\n')
console.log('  A high hit rate is geometry, not signal: with a wide stop against a')
console.log('  near target, random entries reach 73 %. Same stop distance, same')
console.log('  window, entry and direction drawn at random.\n')
{
  let seed = 42
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const { holdHours, feeRate } = OPENING_RANGE_SETTINGS
  const holdBars = (holdHours * 60) / 15
  const real = run(OPENING_RANGE_SETTINGS)
  const fake = []
  for (const cs of Object.values(series)) {
    // Anchor on the real signals so the comparison shares their days and their
    // risk unit; only entry timing and direction are randomised.
    for (const sig of resolved(analyseOpeningRange(cs, OPENING_RANGE_SETTINGS))) {
      const risk = Math.abs(sig.entry - sig.stop)
      const start = sig.index + Math.floor(rnd() * Math.max(1, holdBars / 2))
      const end = Math.min(cs.length, sig.index + holdBars)
      if (start >= end) continue
      const dir = rnd() < 0.5 ? 1 : -1
      const entry = cs[start].open
      const stop = entry - dir * risk
      let r = null
      for (let i = start; i < end; i++) {
        if (dir > 0 ? cs[i].low <= stop : cs[i].high >= stop) { r = -1; break }
      }
      if (r === null) r = ((cs[end - 1].close - entry) * dir) / risk
      fake.push({ resultR: r, feeR: feeRate / (risk / entry) })
    }
  }
  console.log(`  apertura   n=${String(real.length).padStart(4)}  ${sg(netR(real))} R  acierto ${(hit(real) * 100).toFixed(0)} %`)
  console.log(`  al azar    n=${String(fake.length).padStart(4)}  ${sg(netR(fake))} R  acierto ${(hit(fake) * 100).toFixed(0)} %`)
  console.log(`\n  ventaja de la señal sobre la geometría: ${sg(netR(real) - netR(fake))} R`)
}

console.log('\n═══ 5. How much cost does it take before it dies? ═══\n')
console.log('  Every entry is a taker stop order, so this is the real risk.\n')
for (const feeRate of [0.00066, 0.001, 0.0015, 0.002, 0.003]) {
  const s = run({ ...OPENING_RANGE_SETTINGS, feeRate })
  console.log(`  ${(feeRate * 100).toFixed(3)} % ida y vuelta   ${sg(netR(s))} R`)
}

console.log('\n═══ 6. Does it need a trending regime? ═══\n')
console.log('  StrategyDef.regime drives a warning in the view, so declaring')
console.log('  "trending" without measuring it would nag on every quiet day.')
console.log('  Kaufman efficiency over the 100 bars before each entry.\n')
{
  const buckets = { 'lateral (<0.20)': [], 'mixto (0.20-0.35)': [], 'tendencia (>0.35)': [] }
  for (const cs of Object.values(series)) {
    for (const sig of resolved(analyseOpeningRange(cs, OPENING_RANGE_SETTINGS))) {
      // efficiencyRatio reads the tail of what it is given, so slice to entry.
      const er = efficiencyRatio(cs.slice(Math.max(0, sig.index - 101), sig.index))
      const key = er > 0.35 ? 'tendencia (>0.35)' : er > 0.2 ? 'mixto (0.20-0.35)' : 'lateral (<0.20)'
      buckets[key].push(sig)
    }
  }
  for (const [name, s] of Object.entries(buckets)) {
    console.log(`  ${name.padEnd(20)} n=${String(s.length).padStart(4)}  ${sg(netR(s))} R`)
  }
}
