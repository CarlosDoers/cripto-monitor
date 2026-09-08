// Measures a candidate strategy that is NOT in registry.ts yet, and says
// whether it clears the bar to go in.
//
//   npm run try -- src/lib/indicators/myIdea.ts
//   npm run try -- src/lib/indicators/myIdea.ts --export analyseMyIdea
//
// Needs ./.candles populated by `npm run candles`.
//
// audit-strategies.mjs answers "does the UI tell the truth about what ships".
// This answers the question that comes first: "is this worth shipping at all".
// Nothing here writes to registry.ts — a candidate that passes still has to be
// registered by hand, with the figures this prints.
//
// The bar is deliberately the one the project already lost four strategies to:
//
//   1. Enough signals to mean anything.
//   2. Net of costs, at or above MIN_TRADABLE_R.
//   3. **Both halves of the history** at or above it — not just the aggregate.
//      The 55-bar Donchian scored +1.43 R in-sample and −0.02 R out.
//   4. Beats a random entry with the same geometry. A wide stop against a near
//      target hits 73 % with random entries; hit rate on its own is worthless.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { MIN_TRADABLE_R } from '../src/lib/indicators/registry.ts'

const args = process.argv.slice(2)
const modulePath = args.find((a) => !a.startsWith('--'))
const exportFlag = args.indexOf('--export')
const wantedExport = exportFlag >= 0 ? args[exportFlag + 1] : null

if (!modulePath) {
  console.error('uso: npm run try -- <ruta al módulo> [--export nombre]')
  process.exit(2)
}
if (!existsSync(modulePath)) {
  console.error(`no existe: ${modulePath}`)
  process.exit(2)
}

const DIR = './.candles'
const BARS = ['15m', '1H', '4H', '1D']
const MIN_SIGNALS = 30
/** How much the signal must add over its own geometry to count as a signal. */
const MIN_EDGE_OVER_RANDOM = 0.05

// ── load the candidate ──────────────────────────────────────────────────────
const mod = await import(pathToFileURL(modulePath).href)
let runName = wantedExport
if (!runName) {
  // The repo names them analyseTraps / analyseDonchian / analyseOpeningRange.
  const found = Object.keys(mod).filter((k) => /^analyse/.test(k) && typeof mod[k] === 'function')
  if (found.length !== 1) {
    console.error(
      found.length
        ? `varios candidatos (${found.join(', ')}): elige con --export`
        : 'ningún export que empiece por "analyse": pásalo con --export',
    )
    process.exit(2)
  }
  runName = found[0]
}
const run = mod[runName]
if (typeof run !== 'function') {
  console.error(`${runName} no es una función`)
  process.exit(2)
}

// ── data ────────────────────────────────────────────────────────────────────
const series = {}
for (const f of readdirSync(DIR)) {
  const [inst, bar] = f.replace('.json', '').split('__')
  series[bar] ??= {}
  series[bar][inst] = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
}

/** Resolved signals over one timeframe, optionally over half the data. */
function collect(bar, slice = 'all') {
  const out = []
  for (const cs of Object.values(series[bar] ?? {})) {
    const half = Math.floor(cs.length / 2)
    const data = slice === 'first' ? cs.slice(0, half) : slice === 'second' ? cs.slice(half) : cs
    if (data.length < 250) continue
    try {
      const result = run(data)
      for (const s of result.signals) {
        if (s.outcome !== 'open' && Number.isFinite(s.resultR)) out.push({ ...s, candles: data })
      }
    } catch (e) {
      console.log(`  (fallo en ${bar}: ${e.message})`)
    }
  }
  return out
}

/**
 * The same trades with the entry thrown away: same risk distance, same holding
 * horizon, direction and timing drawn at random. Whatever this scores is what
 * the *shape* of the trade is worth; the candidate has to beat it.
 */
function randomControl(signals) {
  let seed = 42
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const holds = signals
    .map((s) => (s.closedIndex ?? s.index) - s.index)
    .filter((h) => h > 0)
    .sort((a, b) => a - b)
  if (!holds.length) return null
  const hold = holds[Math.floor(holds.length / 2)]

  const out = []
  for (const s of signals) {
    const cs = s.candles
    const risk = Math.abs(s.entry - s.stop)
    if (!(risk > 0)) continue
    const start = s.index + Math.floor(rnd() * Math.max(1, hold))
    const end = Math.min(cs.length, start + hold)
    if (start >= end) continue
    const dir = rnd() < 0.5 ? 1 : -1
    const entry = cs[start].close
    const stop = entry - dir * risk
    let r = null
    for (let i = start; i < end; i++) {
      if (dir > 0 ? cs[i].low <= stop : cs[i].high >= stop) { r = -1; break }
    }
    if (r === null) r = ((cs[end - 1].close - entry) * dir) / risk
    out.push({ resultR: r, feeR: s.feeR })
  }
  return out
}

/**
 * A candidate that returns the wrong shape produces zero resolved signals,
 * which reads exactly like a candidate that never fires. Saying which is which
 * is the difference between "your idea has no setups" and "your code is wrong".
 */
function contractProblem() {
  for (const bar of BARS) {
    for (const cs of Object.values(series[bar] ?? {})) {
      if (cs.length < 250) continue
      let result
      try {
        result = run(cs)
      } catch (e) {
        return `lanza una excepción en ${bar}: ${e.message}`
      }
      if (!result || !Array.isArray(result.signals)) {
        return 'no devuelve { signals: [...] } — no cumple el contrato StrategyResult'
      }
      if (!result.signals.length) continue

      const s = result.signals[0]
      const missing = ['index', 'time', 'side', 'entry', 'stop', 'outcome', 'feeR'].filter(
        (k) => s[k] === undefined,
      )
      if (missing.length) return `a las señales les faltan campos: ${missing.join(', ')}`

      const resolved = result.signals.filter((x) => x.outcome !== 'open')
      if (resolved.length && !resolved.some((x) => Number.isFinite(x.resultR))) {
        return (
          'sus señales resueltas no traen resultR. Probablemente sea un indicador ' +
          'crudo que se adapta en registry.ts, como analyseTraps: el arnés mide el ' +
          'contrato StrategyResult, así que pásale la función adaptada'
        )
      }
      return null // one well-formed sample is enough
    }
  }
  return 'no produce ninguna señal en ninguna temporalidad con los datos del caché'
}

const netR = (s) => (s.length ? s.reduce((a, x) => a + x.resultR - x.feeR, 0) / s.length : 0)
const hitRate = (s) => (s.length ? s.filter((x) => x.resultR > 0).length / s.length : 0)
const f = (x, d = 2) => x.toFixed(d).padStart(6)
const sg = (r) => `${r >= 0 ? '+' : ''}${r.toFixed(3)}`

// ── measure ─────────────────────────────────────────────────────────────────
console.log(`CANDIDATA · ${modulePath} → ${runName}()`)
console.log(`Listón: n≥${MIN_SIGNALS}, ${MIN_TRADABLE_R} R neto en el agregado Y en las dos mitades,`)
console.log(`        y al menos ${MIN_EDGE_OVER_RANDOM} R por encima de una entrada al azar.\n`)
const problem = contractProblem()
if (problem) {
  console.log(`=== NO SE PUEDE MEDIR ===\n  ${problem}`)
  process.exit(2)
}

console.log('  TF     n   acierto     NETO      in     out    azar  ventaja')

const passing = []
for (const bar of BARS) {
  const all = collect(bar)
  if (!all.length) {
    console.log(`  ${bar.padEnd(4)}    0        —       —       —       —       —`)
    continue
  }
  const ins = collect(bar, 'first')
  const out = collect(bar, 'second')
  const control = randomControl(all)

  const measured = netR(all)
  const inR = netR(ins)
  const outR = netR(out)
  const randR = control ? netR(control) : 0
  const edge = measured - randR

  const reasons = []
  if (all.length < MIN_SIGNALS) reasons.push(`n=${all.length}`)
  if (measured < MIN_TRADABLE_R) reasons.push(`agregado ${measured.toFixed(2)}`)
  if (Math.min(inR, outR) < MIN_TRADABLE_R) reasons.push(`mitad floja ${Math.min(inR, outR).toFixed(2)}`)
  if (edge < MIN_EDGE_OVER_RANDOM) reasons.push(`ventaja sobre azar ${edge.toFixed(2)}`)

  if (!reasons.length) passing.push({ bar, measured, inR, outR, n: all.length, wr: hitRate(all) })

  console.log(
    `  ${bar.padEnd(4)} ${String(all.length).padStart(4)}  ${f(hitRate(all) * 100, 1)}%  ${f(measured)} R  ${f(inR)}  ${f(outR)}  ${f(randR)}  ${f(edge)}` +
      (reasons.length ? `   ✗ ${reasons.join(', ')}` : '   ✓'),
  )
}

// ── verdict ─────────────────────────────────────────────────────────────────
console.log('')
if (!passing.length) {
  console.log('=== NO PASA ===')
  console.log('  Ninguna temporalidad clara el listón. No la registres en registry.ts.')
  console.log('  Una estrategia que pierde dinero no merece el espacio de pantalla que')
  console.log('  costaría explicar por qué pierde.')
  process.exitCode = 1
} else {
  console.log('=== PASA ===')
  for (const p of passing) {
    console.log(`  ${p.bar}: ${sg(p.measured)} R neto sobre ${p.n} señales, acierto ${(p.wr * 100).toFixed(1)} %`)
    console.log(`      in ${sg(p.inR)} / out ${sg(p.outR)}`)
  }
  console.log('\n  Para registrarla, copia estas cifras a registry.ts — byTimeframe con lo')
  console.log('  medido en cada TF, outOfSample con la segunda mitad, sampleSize y winRate')
  console.log('  del timeframe nativo — y vuelve a correr `npm run audit`, que es quien')
  console.log('  comprueba que lo declarado y lo medido coinciden.')
}
