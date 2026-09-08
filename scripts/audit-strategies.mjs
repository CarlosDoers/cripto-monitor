// Audits every strategy the app ships against the backtest profile it claims in
// registry.ts. The UI presents those numbers as measured fact, so if they drift
// they become misinformation with money attached.
//
//   npm run audit
//
// Populate ./.candles first with `npm run candles`. The npm script carries
// --experimental-strip-types: the hook resolves the extensionless imports, but
// Node still needs the flag to execute .ts before 23.6. `erasableSyntaxOnly` in
// tsconfig is what keeps these sources strippable, so do not add an enum or a
// constructor parameter property to anything the audit imports.
//
// The declared figures are read from the registry itself rather than copied
// into this file, so the audit cannot go stale when a profile is updated. Exits
// non-zero when anything is off, so it can gate a deploy.
import { readFileSync, readdirSync } from 'node:fs'
// Use the registry's own run() — that is exactly what the app executes, and it
// is where resultR gets filled in for the reversal adapter.
import {
  MIN_TRADABLE_R,
  profileOf,
  STRATEGIES,
  timeframeVerdict,
} from '../src/lib/indicators/registry.ts'

const DIR = './.candles'
const series = {}
for (const f of readdirSync(DIR)) {
  const [inst, bar] = f.replace('.json', '').split('__')
  series[bar] ??= {}
  series[bar][inst] = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
}

/** Resolved signals for one runner over one timeframe, optionally half the data. */
function collect(run, bar, slice = 'all') {
  const out = []
  for (const cs of Object.values(series[bar] ?? {})) {
    const half = Math.floor(cs.length / 2)
    const data = slice === 'first' ? cs.slice(0, half) : slice === 'second' ? cs.slice(half) : cs
    if (data.length < 250) continue
    try {
      out.push(...run(data).signals.filter((s) => s.outcome !== 'open' && Number.isFinite(s.resultR)))
    } catch (e) {
      console.log(`    (fallo en ${bar}: ${e.message})`)
    }
  }
  return out
}

const netExp = (s) => (s.length ? s.reduce((a, x) => a + x.resultR - x.feeR, 0) / s.length : 0)
const winRate = (s) => (s.length ? s.filter((x) => x.resultR > 0).length / s.length : 0)
const f = (x, d = 2) => x.toFixed(d).padStart(6)
const BARS = ['15m', '1H', '4H', '1D']
const TOL = 0.08

console.log('AUDITORÍA · esperanza NETA en R medida frente a la declarada en la interfaz')
console.log(`Tolerancia ${TOL} R. Umbral de operabilidad ${MIN_TRADABLE_R} R.\n`)

// Two lists, because they are two different kinds of wrong. A declared figure
// that does not match the data is a lie the UI tells next to real money, and it
// fails the run. A timeframe that is positive overall but weak on one half of
// the history is a judgement about what is worth offering — surfaced here, but
// deciding to drop it belongs to whoever owns the product.
const problems = []
const weak = []
for (const strategy of STRATEGIES) {
  for (const p of strategy.presets) {
    const name = `${strategy.key}/${p.key}`
    const profile = profileOf(strategy, p.key)
    const run = (c) => strategy.run(c, p.key)

    console.log(`\n${name}`)
    console.log('  TF     n   acierto    MEDIDO   DECLARADO      in     out   estado')
    for (const bar of BARS) {
      const sigs = collect(run, bar)
      const measured = netExp(sigs)
      const declared = profile.byTimeframe[bar]
      const gap = declared === undefined ? null : measured - declared
      const verdict = timeframeVerdict(profile, bar)
      // In-sample peaks are the trap this project keeps re-finding: the 55-bar
      // channel scored +1.43 R on one half and −0.02 on the other. A timeframe
      // is only offered if BOTH halves clear the bar, not just the aggregate.
      const ins = netExp(collect(run, bar, 'first'))
      const out = netExp(collect(run, bar, 'second'))

      if (declared === undefined) {
        problems.push(`${name} · ${bar}: sin cifra declarada en registry.ts`)
      } else if (Math.abs(gap) > TOL && sigs.length >= 20) {
        problems.push(`${name} · ${bar}: medido ${measured.toFixed(2)} R vs declarado ${declared} R (n=${sigs.length})`)
      }
      // The whole point of the gate: nothing selectable may be a loser.
      if (verdict !== 'blocked' && measured < MIN_TRADABLE_R && sigs.length >= 20) {
        problems.push(`${name} · ${bar}: SELECCIONABLE pero mide ${measured.toFixed(2)} R`)
      }
      if (verdict !== 'blocked' && sigs.length >= 20 && Math.min(ins, out) < MIN_TRADABLE_R) {
        weak.push(
          `${name} · ${bar}: seleccionable, pero una mitad del histórico mide ${Math.min(ins, out).toFixed(2)} R (in ${ins.toFixed(2)} / out ${out.toFixed(2)})`,
        )
      }

      const flag = Math.abs(gap ?? 0) > TOL && sigs.length >= 20 ? '⚠' : ' '
      console.log(
        `  ${bar.padEnd(4)} ${String(sigs.length).padStart(4)}  ${f(winRate(sigs) * 100, 1)}%  ${f(measured)} R   ${declared === undefined ? '     —' : f(declared) + ' R'}  ${f(ins)}  ${f(out)}  ${flag} ${verdict}`,
      )
    }

    // Almost all live on the daily; the opening range only exists on 15 m.
    // Measuring its headline figures on a timeframe where it fires nothing
    // would report a correct profile as broken.
    const native = profile.nativeTimeframe ?? '1D'
    const daily = collect(run, native)
    const oosSigs = collect(run, native, 'second')
    const oos = netExp(oosSigs)
    const wr = winRate(daily)
    console.log(`  fuera de muestra (${native}, 2ª mitad): ${f(oos)} R declarado ${f(profile.outOfSample)} R (n=${oosSigs.length})`)
    console.log(`  n en ${native}: ${daily.length} declarado ${profile.sampleSize} · acierto ${f(wr * 100, 1)}% declarado ${f(profile.winRate * 100, 1)}%`)

    if (Math.abs(oos - profile.outOfSample) > TOL) {
      problems.push(`${name} · fuera de muestra: medido ${oos.toFixed(2)} vs declarado ${profile.outOfSample}`)
    }
    if (Math.abs(daily.length - profile.sampleSize) > Math.max(5, profile.sampleSize * 0.1)) {
      problems.push(`${name} · n en ${native}: medido ${daily.length} vs declarado ${profile.sampleSize}`)
    }
    if (Math.abs(wr - profile.winRate) > 0.03) {
      problems.push(`${name} · acierto: medido ${(wr * 100).toFixed(1)}% vs declarado ${(profile.winRate * 100).toFixed(1)}%`)
    }
  }
}

console.log('\n\n=== DESVIACIONES ===')
if (!problems.length) {
  console.log('  ninguna: la interfaz dice exactamente lo que miden los datos')
} else {
  for (const p of problems) console.log(`  ⚠ ${p}`)
  process.exitCode = 1
}

console.log('\n=== EDGE FLOJO EN UNA MITAD (no falla, pero conviene mirarlo) ===')
if (!weak.length) {
  console.log('  ninguno: todo lo seleccionable aguanta las dos mitades')
} else {
  for (const w of weak) console.log(`  · ${w}`)
}
