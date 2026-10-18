// How much of the trend strategy's edge is left for someone who arrives late? (2026-10-18.)
//
// The Screener's cards list contracts "en tendencia" — a long the rule opened days ago — and their notes say, truthfully, that
// entering a trend already under way was not measured. The reversal's late entry was (the profile's `lateEntry`: +0.31 to
// +0.52 R at every age up to seven days), because its stop and target are fixed when it fires. A trend position has no target
// and its stop moves, so the question needs its own definition. Written here BEFORE any number:
//
//   · The trade is the strategy's own (Canal 20 + EMA 200, `analyseDonchian` with `DONCHIAN_TREND_SETTINGS`), recorded with
//     the rule's own entry and exit. Nothing about it is re-tuned.
//   · A late entrant buys `k` bars after the signal bar, at that bar's CLOSE, and only if the trade is still open after it:
//     the decision uses nothing the entrant could not have known. Trades the stop or an opposite breakout had already
//     closed are not there to enter, which is what the cards show too.
//   · Its stop is the stop IN FORCE at that close (the initial 2 ATR one, or the 8 ATR trail once it overtook it); its exit
//     is the trade's own exit. Its R is measured against ITS OWN risk (entry less that stop), net of a 0.1 % round trip on
//     that risk — a late stop is usually farther away, so the same dollars buy fewer R: the median risk is printed too.
//   · Ages in bars of the strategy's own timeframe, bucketed: 4 h → 1–6 (up to a day), 7–18 (up to 3 days), 19–42 (up to a
//     week), 43–90 (up to 15 days); daily → 1, 2–3, 4–7, 8–15, 16–30.
//   · ONE entry per trade and bucket, at the bucket's first bar (age 1, 7, 19, 43 on 4 h): the trades still open then. The
//     first reading counted every bar of a bucket, which weights a long trade by its length and counts one market move dozens
//     of times; it was corrected before anything was reported, and that is a statistics fix, not a result-driven change.
//   · Longs are the headline (the shorts measured no edge); shorts are printed for completeness.
//   · The bar a bucket must clear is the repo's own: n ≥ 100, mean ≥ MIN_TRADABLE_R net in the aggregate and in both halves
//     by date. The mean without the ten best trades is printed, not required: a trend follower lives on a few.
//   · Counted trials: one definition, four buckets × two periods — read the buckets as a profile, not as eight tests.
//
// npm run late            4 h, the 30-coin board 2022–26 and the 14-coin board of 2018–21 nothing was tuned on
// npm run late trad       daily, the 20 index and sector ETFs the app's equities track follows (raw Yahoo prices)
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { analyseDonchian, DONCHIAN_TREND_SETTINGS } from '../src/lib/indicators/donchianBreakout.ts'
import { atr } from '../src/lib/indicators/ta.ts'
import { MIN_TRADABLE_R } from '../src/lib/indicators/registry.ts'
import { feeInR } from '../src/lib/indicators/types.ts'

const MODE = process.argv[2] ?? 'crypto'
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const median = (xs) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}
const f = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '—')
const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7)
let seed = 29
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

/** 95 % interval of the mean, resampling whole months with replacement: trades of one month share one market. */
function monthInterval(rows, runs = 1500) {
  const byMonth = new Map()
  for (const r of rows) byMonth.set(monthOf(r.time), [...(byMonth.get(monthOf(r.time)) ?? []), r.r])
  const groups = [...byMonth.values()]
  if (groups.length < 6) return [NaN, NaN]
  const draws = []
  for (let k = 0; k < runs; k++) {
    let sum = 0
    let n = 0
    for (let m = 0; m < groups.length; m++) {
      const g = groups[Math.floor(rnd() * groups.length)]
      for (const x of g) sum += x
      n += g.length
    }
    draws.push(sum / n)
  }
  draws.sort((a, b) => a - b)
  return [draws[Math.floor(runs * 0.025)], draws[Math.floor(runs * 0.975)]]
}

/** Every late entry of every closed trade: one row per (trade, age). */
function lateEntries(candles, barMs) {
  const result = analyseDonchian(candles, DONCHIAN_TREND_SETTINGS)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const close = candles.map((c) => c.close)
  const a = atr(high, low, close, DONCHIAN_TREND_SETTINGS.atrLen)
  const { trailAtr } = DONCHIAN_TREND_SETTINGS
  const rows = []
  let replayMismatch = 0
  for (const s of result.signals) {
    if (s.outcome === 'open' || !Number.isFinite(s.resultR) || s.closedIndex === undefined) continue
    const long = s.side === 'long'
    let peak = long ? high[s.index] : low[s.index]
    let stopNow = s.stop
    let exited = false
    const entry = s.entry
    const base = { side: s.side, signalTime: s.time, exit: s.closedPrice, signalR: s.resultR - s.feeR, signalEntry: entry, stopSignal: s.stop }
    for (let j = s.index + 1; j <= s.closedIndex; j++) {
      const hitStop = long ? low[j] <= stopNow : high[j] >= stopNow
      if (hitStop) {
        // The replay must reproduce the strategy's own exit, or the stop path used for the late entrants is wrong.
        if (j !== s.closedIndex || Math.abs(stopNow - s.closedPrice) > 1e-9 * Math.max(1, Math.abs(stopNow))) replayMismatch++
        exited = true
        break
      }
      if (j === s.closedIndex) {
        // Closed by an opposite breakout at this close, not by the stop.
        if (Math.abs(close[j] - s.closedPrice) > 1e-9 * Math.max(1, Math.abs(close[j]))) replayMismatch++
        exited = true
        break
      }
      peak = long ? Math.max(peak, high[j]) : Math.min(peak, low[j])
      stopNow = long ? Math.max(stopNow, peak - trailAtr * a[j]) : Math.min(stopNow, peak + trailAtr * a[j])
      // Still open after bar j: someone could buy at its close, with the stop now in force.
      const entryLate = close[j]
      const risk = long ? entryLate - stopNow : stopNow - entryLate
      if (!(risk > 0)) continue
      const gross = (long ? s.closedPrice - entryLate : entryLate - s.closedPrice) / risk
      rows.push({
        ...base,
        age: j - s.index,
        time: candles[j].time + barMs,
        r: gross - feeInR(entryLate, stopNow, DONCHIAN_TREND_SETTINGS.feeRate),
        riskPct: risk / entryLate,
        // The same trade entered at its signal, for the same survivors: how much the wait cost.
      })
    }
    if (!exited) replayMismatch++
  }
  return { rows, replayMismatch, signals: result.signals.filter((s) => s.outcome !== 'open').length }
}

/** One bucket of one side: one entry per trade, at the bucket's first bar. */
function stats(rows, side, lo) {
  const r = rows.filter((x) => x.side === side && x.age === lo)
  if (!r.length) return null
  const rs = r.map((x) => x.r)
  const cut = median(r.map((x) => x.time))
  const halves = [mean(r.filter((x) => x.time < cut).map((x) => x.r)), mean(r.filter((x) => x.time >= cut).map((x) => x.r))]
  const sorted = [...rs].sort((x, y) => y - x)
  return {
    n: r.length,
    net: mean(rs),
    halves,
    without10: mean(sorted.slice(10)),
    ci: monthInterval(r),
    riskPct: median(r.map((x) => x.riskPct)),
    sameTrades: mean(r.map((x) => x.signalR)),
  }
}

function report(title, rows, buckets, unit) {
  console.log(`\n── ${title}`)
  const bar = (n, all, halves) => n >= 100 && all >= MIN_TRADABLE_R && Math.min(...halves) >= MIN_TRADABLE_R
  for (const side of ['long', 'short']) {
    console.log(`  ${side === 'long' ? 'LARGOS' : 'cortos'}`)
    for (const [label, lo] of buckets) {
      // One entry per trade: the first bar of the bucket, for the trades still open at it.
      const st = stats(rows, side, lo)
      if (!st) {
        console.log(`    ${label.padEnd(18)} sin entradas`)
        continue
      }
      const { n, net, halves, without10, ci: [lo95, hi95], sameTrades } = st
      const pass = bar(n, net, halves)
      console.log(
        `    ${label.padEnd(18)} n=${String(n).padStart(6)}  neto ${f(net).padStart(6)} R  mitades ${f(halves[0])} / ${f(halves[1])}  sin 10 mejores ${f(without10)}  IC meses [${f(lo95)}, ${f(hi95)}]  ` +
          `riesgo mediano ${(st.riskPct * 100).toFixed(1)} %  esas mismas operaciones entradas en la señal ${f(sameTrades)}  ${side === 'long' ? (pass ? '✓ pasa el listón' : '✗ no pasa') : ''}`,
      )
    }
  }
  console.log(`  (una entrada por operación, en la primera vela de cada tramo; edad en ${unit}; listón: n ≥ 100, ≥ ${MIN_TRADABLE_R} R neto en el agregado y en las dos mitades)`)
}

function loadDir(dir, only) {
  if (!existsSync(dir)) return null
  return Object.fromEntries(
    readdirSync(dir)
      .filter((x) => x.endsWith('.json') && !x.startsWith('_'))
      .filter((x) => !only || only.includes(x.replace('.json', '')))
      .map((x) => [x.replace('.json', ''), JSON.parse(readFileSync(`${dir}/${x}`, 'utf8')).filter((c) => c.confirmed !== false)]),
  )
}

function measure(board, barMs, minBars) {
  const rows = []
  let mismatch = 0
  let trades = 0
  for (const c of Object.values(board)) {
    if (c.length < minBars) continue
    const res = lateEntries(c, barMs)
    rows.push(...res.rows)
    mismatch += res.replayMismatch
    trades += res.signals
  }
  return { rows, mismatch, trades }
}

if (MODE === 'crypto') {
  const buckets = [
    ['1–6 velas (≤1 d)', 1, 6],
    ['7–18 (≤3 d)', 7, 18],
    ['19–42 (≤1 sem.)', 19, 42],
    ['43–90 (≤15 d)', 43, 90],
  ]
  console.log('ENTRAR TARDE EN LA TENDENCIA (Canal 20 + EMA 200, 4 h), al cierre de k velas después de la señal, con el stop vigente y la salida de la propia operación\n')
  for (const [name, dir] of [['2022–26 (30 monedas)', './.candles-board-4H'], ['2018–21 (14 monedas, un periodo que nada vio)', './.candles-board-4Hold']]) {
    const board = loadDir(dir)
    if (!board) {
      console.log(`Falta ${dir}`)
      continue
    }
    const { rows, mismatch, trades } = measure(board, 4 * 3_600_000, 700)
    console.log(`${name}: ${trades} operaciones cerradas, ${rows.length} entradas tardías posibles; el repaso del stop coincide con la salida de la estrategia en ${trades - mismatch} de ${trades}`)
    report(name, rows, buckets, 'velas de 4 h')
  }
}

if (MODE === 'trad') {
  const ETFS = ['SPY', 'QQQ', 'IWM', 'MDY', 'EFA', 'EEM', 'EWJ', 'EWZ', 'EWY', 'FXI', 'VGK', 'XLE', 'XLF', 'XLK', 'XLV', 'XLU', 'XLP', 'XLY', 'XLI', 'XLB']
  const board = loadDir('./.research/yahoo-1d-raw', ETFS)
  const buckets = [
    ['1 sesión', 1, 1],
    ['2–3 sesiones', 2, 3],
    ['4–7', 4, 7],
    ['8–15', 8, 15],
    ['16–30', 16, 30],
  ]
  console.log('ENTRAR TARDE EN LA TENDENCIA, ETF de índices y sectores (diario, precios sin ajustar), al cierre de k sesiones después de la señal\n')
  const { rows, mismatch, trades } = measure(board, 86_400_000, 1500)
  console.log(`${trades} operaciones cerradas, ${rows.length} entradas tardías posibles; el repaso del stop coincide en ${trades - mismatch} de ${trades}`)
  report('20 ETF de índices y sectores', rows, buckets, 'sesiones')
}

// npm run late check: the figures the app quotes (DONCHIAN_TREND_EVIDENCE.late, TRAD_TREND_EVIDENCE.late), measured again.
// Exits 1 on drift. The intervals are not checked: they depend on a random draw.
if (MODE === 'check') {
  const { DONCHIAN_TREND_EVIDENCE } = await import('../src/lib/indicators/donchianBreakout.ts')
  const { TRAD_TREND_EVIDENCE } = await import('../src/lib/tradMarkets.ts')
  const ETFS = ['SPY', 'QQQ', 'IWM', 'MDY', 'EFA', 'EEM', 'EWJ', 'EWZ', 'EWY', 'FXI', 'VGK', 'XLE', 'XLF', 'XLK', 'XLV', 'XLU', 'XLP', 'XLY', 'XLI', 'XLB']
  const sets = [
    ['4 h, 30 criptos 2022–26', measure(loadDir('./.candles-board-4H'), 4 * 3_600_000, 700), DONCHIAN_TREND_EVIDENCE.late.buckets],
    ['diario, 20 ETF', measure(loadDir('./.research/yahoo-1d-raw', ETFS), 86_400_000, 1500), TRAD_TREND_EVIDENCE.late.buckets],
  ]
  let drift = 0
  for (const [name, m, quoted] of sets) {
    console.log(`\n${name}`)
    for (const q of quoted) {
      const got = stats(m.rows, 'long', q.from)
      const rowsToCheck = [
        ['n', got.n, q.n, 0],
        ['neto', got.net, q.net, 0.03],
        ['1ª mitad', got.halves[0], q.halves[0], 0.03],
        ['2ª mitad', got.halves[1], q.halves[1], 0.03],
        ['sin 10 mejores', got.without10, q.withoutBest10, 0.03],
        ['riesgo mediano', got.riskPct, q.riskPct, 0.002],
      ]
      const bad = rowsToCheck.filter(([, g, w, tol]) => !(Math.abs(g - w) <= tol + 1e-9))
      drift += bad.length
      console.log(`  ${bad.length ? '✗' : '✓'} desde ${String(q.from).padStart(2)}  ${rowsToCheck.map(([k, g, w]) => `${k} ${Math.round(g * 1000) / 1000} (citado ${w})`).join(' · ')}`)
    }
  }
  console.log(drift ? `\nDESVIACIONES: ${drift} cifras citadas ya no coinciden` : '\ntodas coinciden con lo medido')
  if (drift) process.exitCode = 1
}
