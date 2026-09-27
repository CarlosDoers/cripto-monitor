// Does anything in the app look at the future, and does what the browser
// computes agree with what the audit measured?
//
//   npm run lookahead
//
// Needs ./.candles populated by `npm run candles`. Writes nothing.
//
// The method is Freqtrade's (freqtrade.io, "lookahead-analysis" and
// "recursive-analysis"), rewritten for this app's StrategyResult contract —
// the idea, not the code (theirs is GPL-3.0). Three checks:
//
// 1. MIRA EL FUTURO / REPINTA. Each sampled signal is recomputed on the
//    candles up to and including its own bar. If it is missing there, the full
//    backtest only found it by reading later bars — the audit's numbers would
//    be unobtainable live. And every signal the truncated run produces must
//    still exist in the full run; one that does not is a signal the UI would
//    show and later withdraw. SMC structure breaks get the same treatment,
//    since the port claims "nothing repaints".
//
// 2. HISTORIA DEL NAVEGADOR. The audit measures on the deep cache; the app runs
//    each strategy on ~1 200 fetched bars (4 pages × 300, plus `archiveBars`).
//    Recursive indicators — RMA, EMA, ATR — carry their seed forward, so the
//    same last bar can read differently. The recent signals of both runs are
//    compared one by one, and the overlays on the last bar by relative size.
//
// 3. SCREENER. `technicals()` gets 200 daily bars (`useDailyBoard`). Its
//    fields are recomputed with five times the history at 25 end dates per
//    instrument; any field that flips is reported with how often.
//
// Exit code 1 when check 1 finds any bias. Checks 2 and 3 describe a drift and
// only fail when a whole recent signal differs.
import { readFileSync, readdirSync } from 'node:fs'
import { STRATEGIES, appliesTo, profileOf } from '../src/lib/indicators/registry.ts'
import { analyseSmc } from '../src/lib/indicators/smc.ts'
import { ema } from '../src/lib/indicators/ta.ts'
import { technicals } from '../src/lib/screener.ts'

const DIR = './.candles'
const BARS = ['15m', '1H', '4H', '1D']
/** What `useCandleHistory` fetches: 4 pages of 300. */
const BROWSER_BARS = 1200
/** What `useDailyBoard` fetches for the Screener. */
const SCREENER_BARS = 200
/** Truncated reruns are O(n) each; the last stretch of history is plenty to find a bias. */
const LOOKAHEAD_WINDOW = 12_000
const SAMPLES_PER_SERIES = 12
/** Recent enough that the user would see it on the chart. */
const RECENT = 300

const series = {}
for (const f of readdirSync(DIR)) {
  const [inst, bar] = f.replace('.json', '').split('__')
  series[bar] ??= {}
  series[bar][inst] = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
}

const same = (a, b) =>
  a.time === b.time &&
  a.side === b.side &&
  Math.abs(a.entry - b.entry) <= 1e-9 * Math.abs(a.entry) &&
  Math.abs(a.stop - b.stop) <= 1e-9 * Math.abs(a.stop)
/**
 * The browser comparison cannot demand identity: an ATR stop is an RMA, and an
 * RMA seeded 1 200 bars ago differs from one seeded years ago in the seventh
 * digit (1884,1456 against 1884,1458 on ETH). Same bar, same side, same entry,
 * and a stop within 0,01 % is the same trade; the drift is reported apart.
 */
const STOP_TOLERANCE = 1e-4
const sameTrade = (a, b) =>
  a.time === b.time &&
  a.side === b.side &&
  Math.abs(a.entry - b.entry) <= 1e-9 * Math.abs(a.entry) &&
  Math.abs(a.stop - b.stop) <= STOP_TOLERANCE * Math.abs(a.stop)
const describe = (s) => `${new Date(s.time).toISOString().slice(0, 16)} ${s.side} @${s.entry}`

/** Evenly spaced picks, so a sample covers the whole window rather than its start. */
function spread(list, n) {
  if (list.length <= n) return list
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * (list.length - 1)) / (n - 1))])
}

let biased = 0

// ── 1. lookahead / repaint ──────────────────────────────────────────────────
console.log('=== 1. ¿MIRA EL FUTURO O REPINTA? ===')
console.log('  Cada señal se recalcula con las velas hasta la suya incluida.\n')
console.log('  estrategia            TF    revisadas  futuro  repinta')
for (const strategy of STRATEGIES) {
  for (const preset of strategy.presets) {
    const profile = profileOf(strategy, preset.key)
    for (const bar of BARS) {
      if (!appliesTo(profile, bar)) continue
      let checked = 0
      let future = 0
      let repaint = 0
      const examples = []
      for (const [inst, full] of Object.entries(series[bar] ?? {})) {
        const cs = full.slice(-(LOOKAHEAD_WINDOW + (strategy.archiveBars ?? 0)))
        const reference = strategy.run(cs, preset.key).signals
        for (const s of spread(reference, SAMPLES_PER_SERIES)) {
          const truncated = strategy.run(cs.slice(0, s.index + 1), preset.key).signals
          checked++
          if (!truncated.some((t) => same(t, s))) {
            future++
            if (examples.length < 3) examples.push(`${inst} ${describe(s)}: no aparece con los datos de su momento`)
          }
          for (const t of truncated) {
            if (!reference.some((r) => same(r, t))) {
              repaint++
              if (examples.length < 3) examples.push(`${inst} ${describe(t)}: aparece y luego desaparece`)
            }
          }
        }
      }
      biased += future + repaint
      console.log(
        `  ${`${strategy.key}/${preset.key}`.padEnd(20)}  ${bar.padEnd(4)} ${String(checked).padStart(9)}  ${String(future).padStart(6)}  ${String(repaint).padStart(7)}` +
          (future + repaint ? '   ✗' : '   ✓'),
      )
      for (const e of examples) console.log(`      ${e}`)
    }
  }
}

// SMC: the claim is that a break is confirmed on its own bar and never withdrawn.
{
  let checked = 0
  let future = 0
  let repaint = 0
  const key = (e) => `${e.index}:${e.kind}:${e.scale}:${e.bias}`
  for (const bar of BARS) {
    for (const full of Object.values(series[bar] ?? {})) {
      const cs = full.slice(-6000)
      const reference = analyseSmc(cs).structures
      const keys = new Set(reference.map(key))
      for (const e of spread(reference, SAMPLES_PER_SERIES)) {
        const truncated = analyseSmc(cs.slice(0, e.index + 1)).structures
        checked++
        if (!truncated.some((t) => key(t) === key(e))) future++
        repaint += truncated.filter((t) => !keys.has(key(t))).length
      }
    }
  }
  biased += future + repaint
  console.log(
    `  ${'smc (BOS/CHoCH)'.padEnd(20)}  todas ${String(checked).padStart(8)}  ${String(future).padStart(6)}  ${String(repaint).padStart(7)}` +
      (future + repaint ? '   ✗' : '   ✓'),
  )
}

// ── 2. browser history vs deep cache ────────────────────────────────────────
console.log('\n=== 2. HISTORIA DEL NAVEGADOR FRENTE AL CACHÉ ===')
console.log(`  La app calcula con ~${BROWSER_BARS} velas; el audit, con todo el caché.`)
console.log(`  Señales de las últimas ${RECENT} velas, una por una, y líneas de la última vela.\n`)
console.log('  estrategia            TF    señales  distintas  desvío stop  mayor desvío de línea')
let recentMismatch = 0
for (const strategy of STRATEGIES) {
  for (const preset of strategy.presets) {
    const profile = profileOf(strategy, preset.key)
    for (const bar of BARS) {
      if (!appliesTo(profile, bar)) continue
      let compared = 0
      let differ = 0
      let worst = { gap: 0, label: '' }
      let stopDrift = 0
      for (const [inst, cs] of Object.entries(series[bar] ?? {})) {
        const bars = BROWSER_BARS + (strategy.archiveBars ?? 0)
        if (cs.length <= bars + RECENT) continue
        const deep = strategy.run(cs, preset.key)
        const browser = strategy.run(cs.slice(-bars), preset.key)
        const cutoff = cs.at(-RECENT).time
        const a = deep.signals.filter((s) => s.time >= cutoff)
        const b = browser.signals.filter((s) => s.time >= cutoff)
        compared += Math.max(a.length, b.length)
        differ += a.filter((s) => !b.some((t) => sameTrade(s, t))).length + b.filter((s) => !a.some((t) => sameTrade(s, t))).length
        for (const s of a) {
          const t = b.find((x) => sameTrade(s, x))
          if (t) stopDrift = Math.max(stopDrift, Math.abs(s.stop - t.stop) / Math.abs(s.stop))
        }
        for (const o of deep.overlays) {
          const other = browser.overlays.find((p) => p.key === o.key)
          const x = o.values.at(-1)
          const y = other?.values.at(-1)
          if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0) continue
          const gap = Math.abs(x - y) / Math.abs(x)
          if (gap > worst.gap) worst = { gap, label: `${o.label ?? o.key} en ${inst}` }
        }
      }
      recentMismatch += differ
      console.log(
        `  ${`${strategy.key}/${preset.key}`.padEnd(20)}  ${bar.padEnd(4)} ${String(compared).padStart(8)}  ${String(differ).padStart(9)}  ${`${(stopDrift * 100).toFixed(5)} %`.padStart(11)}  ` +
          (worst.label ? `${(worst.gap * 100).toFixed(5)} % (${worst.label})` : '—') +
          (differ ? '   ✗' : '   ✓'),
      )
    }
  }
}

// EMA: the Medias toggle refuses to draw below SEED_FACTOR × length. How far
// off would it be at each length? Daily and 4 h, last bar, worst instrument.
console.log('\n  Medias exponenciales, diferencia en la última vela frente a toda la historia:')
for (const length of [50, 200]) {
  const row = []
  for (const factor of [1.5, 2, 3, 5]) {
    let worst = 0
    for (const bar of ['4H', '1D']) {
      for (const cs of Object.values(series[bar] ?? {})) {
        const n = Math.round(length * factor)
        if (cs.length < n * 3) continue
        const closes = cs.map((c) => c.close)
        const deep = ema(closes, length).at(-1)
        const short = ema(closes.slice(-n), length).at(-1)
        worst = Math.max(worst, Math.abs(deep - short) / deep)
      }
    }
    row.push(`${factor}× → ${(worst * 100).toFixed(3)} %`)
  }
  console.log(`    EMA ${String(length).padEnd(3)}  ${row.join('   ')}`)
}

// ── 3. screener ─────────────────────────────────────────────────────────────
/** The deep cache's daily holds ~1 800 bars, so the long run is 1 000 — still five times the Screener's. */
const SCREENER_DEEP = 1000
console.log(`\n=== 3. SCREENER: ${SCREENER_BARS} VELAS DIARIAS FRENTE A ${SCREENER_DEEP} ===`)
const toRows = (cs) =>
  cs.map((c) => [String(c.time), String(c.open), String(c.high), String(c.low), String(c.close), String(c.vol ?? 0), String(c.vol ?? 0), '0', '1'])
const FIELDS = {
  'RSI 14 (±1 punto)': (t, u) => Math.abs(t.rsi14 - u.rsi14) > 1,
  'Precio vs media 20': (t, u) => Math.abs(t.vsSma20 - u.vsSma20) > 1e-9,
  'Precio vs media 50': (t, u) => Math.abs(t.vsSma50 - u.vsSma50) > 1e-9,
  'ATR 14 (±2 %)': (t, u) => Math.abs(t.atrPct / u.atrPct - 1) > 0.02,
  'Tendencia (medias)': (t, u) => t.trend !== u.trend,
  'SMC estructura principal': (t, u) => t.smc.swing !== u.smc.swing,
  'SMC estructura interna': (t, u) => t.smc.internal !== u.smc.internal,
  'SMC última ruptura': (t, u) =>
    (t.smc.last?.kind ?? '') + (t.smc.last?.barsAgo ?? '') !== (u.smc.last?.kind ?? '') + (u.smc.last?.barsAgo ?? ''),
  'Reversión (activa/vigila)': (t, u) => t.reversal !== u.reversal,
}
const flips = Object.fromEntries(Object.keys(FIELDS).map((k) => [k, 0]))
let samples = 0
for (const cs of Object.values(series['1D'] ?? {})) {
  if (cs.length < SCREENER_DEEP + 24 * 20) continue
  for (let k = 0; k < 25; k++) {
    const end = cs.length - k * 20
    const market = { last: cs[end - 1].close, volumeUsd: 0 }
    const short = technicals(toRows(cs.slice(end - SCREENER_BARS, end)), market)
    const long = technicals(toRows(cs.slice(end - SCREENER_DEEP, end)), market)
    if (!short || !long) continue
    samples++
    for (const [name, differs] of Object.entries(FIELDS)) if (differs(short, long)) flips[name]++
  }
}
console.log(`  ${samples} comparaciones (instrumentos con historia suficiente × 25 fechas)\n`)
for (const [name, n] of Object.entries(flips)) {
  console.log(`  ${name.padEnd(28)} ${String(n).padStart(3)} de ${samples}  ${n === 0 ? '✓' : `(${((n / samples) * 100).toFixed(0)} %)`}`)
}

// ── verdict ─────────────────────────────────────────────────────────────────
console.log('')
if (biased) {
  console.log(`=== FALLA: ${biased} señales miran el futuro o repintan ===`)
  process.exitCode = 1
} else {
  console.log('=== NINGUNA SEÑAL MIRA EL FUTURO NI REPINTA ===')
}
if (recentMismatch) {
  console.log(`  Ojo: ${recentMismatch} señales recientes difieren entre el navegador y el caché.`)
}
