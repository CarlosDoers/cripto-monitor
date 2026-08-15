// Audits every strategy the app ships against the backtest profile it claims in
// registry.ts. The UI presents those numbers as measured fact, so if they were
// written by hand they are misinformation with money attached.
import { readFileSync, readdirSync } from 'node:fs'
// Use the registry's own run() — that is exactly what the app executes, and it
// is where resultR gets filled in for the reversal adapter.
import { STRATEGIES } from '../src/lib/indicators/registry.ts'

const DIR = './.candles'
const series = {}
for (const f of readdirSync(DIR)) {
  const [inst, bar] = f.replace('.json', '').split('__')
  series[bar] ??= {}
  series[bar][inst] = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
}

const runners = {}
for (const s of STRATEGIES) {
  for (const p of s.presets) runners[`${s.key}/${p.key}`] = (c) => s.run(c, p.key)
}

// What registry.ts tells the user.
const CLAIMED = {
  'reversal/tuned':    { tf: { '15m': -0.3, '1H': 0.0, '4H': -0.01, '1D': 0.53 }, oos: 0.22, n: 1222 },
  'donchian/fast':     { tf: { '15m': -0.23, '1H': -0.11, '4H': -0.08, '1D': 0.48 }, oos: 0.19, n: 104 },
  'donchian/accurate': { tf: { '15m': -0.21, '1H': -0.19, '4H': -0.05, '1D': 0.29 }, oos: 0.47, n: 117 },
  'donchian/momentum': { tf: { '15m': -0.12, '1H': -0.06, '4H': 0.02, '1D': 0.34 }, oos: 0.38, n: 96 },
  'pullback/default':  { tf: { '15m': -0.04, '1H': 0.12, '4H': 0.21, '1D': 0.58 }, oos: 0.41, n: 612 },
}

/** Resolved signals for one runner over one timeframe, optionally half the data. */
function collect(run, bar, slice = 'all') {
  const out = []
  for (const cs of Object.values(series[bar] ?? {})) {
    const half = Math.floor(cs.length / 2)
    const data = slice === 'first' ? cs.slice(0, half) : slice === 'second' ? cs.slice(half) : cs
    if (data.length < 150) continue
    try {
      out.push(...run(data).signals.filter((s) => s.outcome !== 'open' && Number.isFinite(s.resultR)))
    } catch (e) {
      console.log(`    (fallo en ${bar}: ${e.message})`)
    }
  }
  return out
}

const netExp = (sigs) => (sigs.length ? sigs.reduce((s, x) => s + x.resultR - x.feeR, 0) / sigs.length : 0)
const winRate = (sigs) => (sigs.length ? sigs.filter((s) => s.resultR > 0).length / sigs.length : 0)
const f = (x, d = 2) => x.toFixed(d).padStart(6)

console.log('AUDITORÍA · esperanza NETA en R medida frente a la declarada en la interfaz\n')
console.log('estrategia            TF     n    acierto   MEDIDO   DECLARADO   desvío')

const problems = []
for (const [name, run] of Object.entries(runners)) {
  const claim = CLAIMED[name]
  console.log()
  let totalN = 0
  for (const bar of ['15m', '1H', '4H', '1D']) {
    const sigs = collect(run, bar)
    totalN += sigs.length
    const measured = netExp(sigs)
    const declared = claim?.tf?.[bar]
    const gap = declared === undefined ? null : measured - declared
    if (gap !== null && Math.abs(gap) > 0.15 && sigs.length >= 20) {
      problems.push({ name, bar, measured, declared, n: sigs.length })
    }
    console.log(
      `${name.padEnd(20)} ${bar.padEnd(4)} ${String(sigs.length).padStart(4)}  ${f(winRate(sigs) * 100, 1)}%  ${f(measured)} R   ${declared === undefined ? '     —' : f(declared) + ' R'}   ${gap === null ? '' : (Math.abs(gap) > 0.15 ? '⚠ ' : '  ') + f(gap)}`,
    )
  }
  if (claim) {
    const oos = netExp(collect(run, '1D', 'second'))
    const oosN = collect(run, '1D', 'second').length
    console.log(`${''.padEnd(20)} fuera de muestra (1D, 2ª mitad): ${f(oos)} R (n=${oosN})  declarado ${f(claim.oos)} R`)
    console.log(`${''.padEnd(20)} n total medido: ${totalN}   declarado: ${claim.n}`)
    if (Math.abs(totalN - claim.n) > claim.n * 0.4) {
      problems.push({ name, bar: 'n', measured: totalN, declared: claim.n, n: totalN })
    }
  }
}

console.log('\n\n=== DESVIACIONES SIGNIFICATIVAS (>0,15 R o n muy distinto) ===')
if (!problems.length) console.log('  ninguna')
for (const p of problems) {
  console.log(`  ${p.name} · ${p.bar}: medido ${p.measured.toFixed(2)} vs declarado ${p.declared} (n=${p.n})`)
}
