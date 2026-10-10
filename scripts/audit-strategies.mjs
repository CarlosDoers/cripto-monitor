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
  MEASURED_THROUGH,
  MIN_TRADABLE_R,
  profileOf,
  STRATEGIES,
  timeframeVerdict,
} from '../src/lib/indicators/registry.ts'
import { deflate, DSR_LEVEL } from '../src/lib/indicators/deflated.ts'
import { feeInR } from '../src/lib/indicators/types.ts'

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

// The declared figures carry the day their data ended. A cache that ends on
// another day is measuring something they were not declared from.
let cacheEnd = 0
for (const bySeries of Object.values(series)) for (const cs of Object.values(bySeries)) cacheEnd = Math.max(cacheEnd, cs.at(-1)?.time ?? 0)
const cacheEndDay = new Date(cacheEnd).toISOString().slice(0, 10)
const dayGap = Math.round((Date.parse(cacheEndDay) - Date.parse(MEASURED_THROUGH)) / 86_400_000)

console.log('AUDITORÍA · esperanza NETA en R medida frente a la declarada en la interfaz')
console.log(`Tolerancia ${TOL} R. Umbral de operabilidad ${MIN_TRADABLE_R} R.`)
console.log(`Caché hasta ${cacheEndDay} · cifras declaradas con datos hasta ${MEASURED_THROUGH} (MEASURED_THROUGH).\n`)

// Two lists, because they are two different kinds of wrong. A declared figure
// that does not match the data is a lie the UI tells next to real money, and it
// fails the run. A timeframe that is positive overall but weak on one half of
// the history is a judgement about what is worth offering — surfaced here, but
// deciding to drop it belongs to whoever owns the product.
const problems = []
if (Math.abs(dayGap) > 1) {
  problems.push(
    dayGap > 0
      ? `el caché llega a ${cacheEndDay} y las cifras se declararon con datos hasta ${MEASURED_THROUGH}: redeclara lo que mida este audit y mueve MEASURED_THROUGH`
      : `el caché acaba en ${cacheEndDay}, antes de ${MEASURED_THROUGH}: falta refrescarlo (npm run candles) para comprobar lo declarado`,
  )
}
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
      // The halves are declared too, because the gate reads them: a timeframe
      // is only selectable if both clear the bar. Declared halves that drift
      // from the data would open or close a timeframe on a false number.
      const halves = profile.halves?.[bar]
      if (halves && sigs.length >= 20) {
        if (Math.abs(halves[0] - ins) > TOL || Math.abs(halves[1] - out) > TOL) {
          problems.push(
            `${name} · ${bar}: mitades medidas ${ins.toFixed(2)} / ${out.toFixed(2)} vs declaradas ${halves[0]} / ${halves[1]}`,
          )
        }
      } else if (measured >= MIN_TRADABLE_R && sigs.length >= 20) {
        problems.push(`${name} · ${bar}: supera el umbral pero no declara sus mitades (in ${ins.toFixed(2)} / out ${out.toFixed(2)})`)
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

// Would the shipped edges survive the searches that found them? Informative,
// not a failure: the audit's job is that the labels are true, and the sweeps
// behind each strategy did not keep a count of every variant tried. What it
// can say is how many variants each edge could have been the best of and
// still clear 95 % — the reader compares that with how hard it was searched
// for (the opening range: 648 configurations).
console.log('\n\n=== ¿SOBREVIVE A LA BÚSQUEDA? (Sharpe deflactado, Bailey y López de Prado) ===')
console.log(`  Probabilidad de que la ventaja sea real con una sola variante probada (PSR), y cuántas`)
console.log(`  variantes podría haber sido la mejor sin bajar del ${DSR_LEVEL * 100} %. Cotas altas: operaciones`)
console.log('  en distintos instrumentos el mismo día no son independientes.\n')
console.log('  estrategia            TF       n   Sharpe/op    PSR   aguanta hasta')
for (const strategy of STRATEGIES) {
  for (const p of strategy.presets) {
    const profile = profileOf(strategy, p.key)
    for (const bar of BARS) {
      if (timeframeVerdict(profile, bar) === 'blocked') continue
      const sigs = collect((c) => strategy.run(c, p.key), bar)
      if (sigs.length < 20) continue
      const d = deflate(sigs.map((x) => x.resultR - x.feeR))
      console.log(
        `  ${`${strategy.key}/${p.key}`.padEnd(20)}  ${bar.padEnd(4)} ${String(sigs.length).padStart(5)}  ${f(d.sharpe, 3)}    ${f(d.psr * 100, 1)}%   ${d.survives ? `${d.survives.toLocaleString('es-ES')} variantes` : 'ninguna'}`,
      )
    }
  }
}

// Late entry. A strategy that declares `lateEntry` is saying its signals stay
// worth taking for `maxAge` bars — the Resumen shows signals of any age up to
// that. Measured here the way the panel uses it: enter at the close of bar k
// with the signal's own stop and target, only while neither has been hit, and
// net of the fee on the new, narrower-or-wider risk.
const FEE = 0.001
for (const strategy of STRATEGIES) {
  for (const p of strategy.presets) {
    const profile = profileOf(strategy, p.key)
    const late = profile.lateEntry
    if (!late) continue
    const name = `${strategy.key}/${p.key}`
    const native = profile.nativeTimeframe ?? '1D'
    const byAge = {}
    for (const cs of Object.values(series[native] ?? {})) {
      if (cs.length < 250) continue
      const halfTime = cs[Math.floor(cs.length / 2)].time
      for (const s of strategy.run(cs, p.key).signals) {
        if (s.outcome === 'open' || s.target === undefined) continue
        const long = s.side === 'long'
        for (let k = 1; k <= late.maxAge; k++) {
          const i = s.index + k
          if (s.closedIndex === undefined || i >= s.closedIndex) break
          const entry = cs[i].close
          const risk = long ? entry - s.stop : s.stop - entry
          const reward = long ? s.target - entry : entry - s.target
          if (!(risk > 0) || !(reward > 0)) break
          const r = (s.outcome === 'win' ? reward / risk : -1) - feeInR(entry, s.stop, FEE)
          ;(byAge[k] ??= []).push({ r, first: s.time < halfTime })
        }
      }
    }
    console.log(`\n\n=== ENTRADA TARDÍA · ${name} (${native}) ===`)
    console.log('  Entrar k velas después de la señal, con su stop y su objetivo, si aún no se tocaron.\n')
    console.log('   k     n     NETO      in     out')
    let floor = Infinity
    for (let k = 1; k <= late.maxAge; k++) {
      const all = byAge[k] ?? []
      const r = netExp(all.map((x) => ({ resultR: x.r, feeR: 0 })))
      const ins = netExp(all.filter((x) => x.first).map((x) => ({ resultR: x.r, feeR: 0 })))
      const out = netExp(all.filter((x) => !x.first).map((x) => ({ resultR: x.r, feeR: 0 })))
      floor = Math.min(floor, r)
      const bad = all.length < 20 || Math.min(r, ins, out) < MIN_TRADABLE_R
      if (bad) problems.push(`${name} · entrada tardía k=${k}: ${r.toFixed(2)} R (in ${ins.toFixed(2)} / out ${out.toFixed(2)}, n=${all.length}) bajo el umbral`)
      console.log(`  ${String(k).padStart(2)}  ${String(all.length).padStart(4)}  ${f(r)} R  ${f(ins)}  ${f(out)}${bad ? '  ⚠' : ''}`)
    }
    console.log(`  peor edad: ${f(floor)} R declarado ${f(late.floor)} R`)
    if (Math.abs(floor - late.floor) > TOL) {
      problems.push(`${name} · entrada tardía: peor edad medida ${floor.toFixed(2)} R vs declarada ${late.floor}`)
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
