// Can the two trend strategies that ship be made better by *not* taking some of their entries?
// (2026-10-15.) Five filters, each with its direction and its reason written down BEFORE any number,
// each tested on both strategies (the Donchian + EMA 200 preset and the EMA 200 cross, which share
// about a fifth of their entries) and on both periods (2022–26 and the 2018–21 board nothing was tuned
// on). A filter is only worth having if the sign holds in all four cells; five were tried, so one
// that reaches significance in one cell is what chance gives.
//
//   F1 weekend      the entry candle closes on a Saturday or Sunday (UTC).
//                   Expected WORSE: thin books, false breakouts — the opening range lost 0.17 R at weekends.
//   F2 volume       the entry candle's volume is at least 1.5× the mean of the 20 before it.
//                   Expected BETTER: a breakout with participation.
//   F3 against BTC  a long while BTC is under its own EMA 200 (4 h), or a short while it is over it.
//                   Expected WORSE: the alt trade fights the market's regime.
//   F4 extended     the close is in the top third of distance from the EMA 200, in ATRs, in the trade's
//                   direction, among that strategy's entries in that period.
//                   Expected WORSE: late in the move.
//   F5 crowded      the funding paid over the previous 3 days is in the top third, signed for the side
//                   (a long into high funding, a short into very negative). 2022–26 only (Binance history).
//                   Expected WORSE: the crowd is already in.
//
// npm run improve            the five filters, both strategies, both periods
// npm run improve controls   volume against weekend and time of day, thresholds, by year, by side, 1 h
// npm run improve survivors  the Donchian + EMA 200 on Binance daily pairs, dead ones included
// npm run improve evidence   what the Screener tags and the tracking ledger quote, checked: exits 1 on drift
// npm run improve curves     what a trade of each strategy is worth at each age (src/lib/ledgerAge.ts)
// npm run improve calibrate  the ledger's band replayed on the history: how much wider than independence it must be
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { analyseDonchian, DONCHIAN_SETTINGS, DONCHIAN_TREND_SETTINGS } from '../src/lib/indicators/donchianBreakout.ts'
import { analyseEmaCross } from '../src/lib/indicators/emaCross.ts'
import { atr, ema } from '../src/lib/indicators/ta.ts'
// The definitions of "volume", "BTC's regime" and "weekend" are the app's own: the tags on the Screener's
// cards, the tracking ledger and this script all measure with the same functions.
import { btcRegime, closesAtWeekend, CONTEXT_EVIDENCE, volumeRatio, withRegime } from '../src/lib/entryContext.ts'
import { AGE_CURVES, NOISE_INFLATION } from '../src/lib/ledgerAge.ts'
import { REFERENCE } from '../src/lib/ledger.ts'
import { strategyByKey } from '../src/lib/indicators/registry.ts'

const H4 = 4 * 3_600_000
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const f = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '—')
let seed = 11
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

const PERIODS = [
  ['2022-26', './.candles-board-4H'],
  ['2018-21', './.candles-board-4Hold'],
]
const STRATEGIES = [
  ['Donchian + EMA 200', (c) => analyseDonchian(c, DONCHIAN_TREND_SETTINGS)],
  ['EMA 200 (cruce)', (c) => analyseEmaCross(c)],
]

function load(dir) {
  if (!existsSync(dir)) return null
  return Object.fromEntries(
    readdirSync(dir)
      .filter((x) => x.endsWith('.json') && !x.startsWith('_'))
      .map((x) => [x.replace('.json', ''), JSON.parse(readFileSync(`${dir}/${x}`, 'utf8')).filter((c) => c.confirmed !== false)]),
  )
}
function fundingOf(coin) {
  const path = `./.funding/binance/${coin}.json`
  if (!existsSync(path)) return null
  const rows = JSON.parse(readFileSync(path, 'utf8')).funding
  return rows.map((x) => [x.t, x.r])
}
/** Funding paid over the 3 days before `ms`, as a plain sum of the settlements. */
function funding3d(series, ms) {
  let lo = 0
  let hi = series.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (series[m][0] <= ms) lo = m + 1
    else hi = m
  }
  if (hi < 9) return NaN
  let s = 0
  for (let k = hi - 9; k < hi; k++) s += series[k][1]
  return s
}

const monthKey = (ms) => new Date(ms).toISOString().slice(0, 7)

/** Trades of one strategy over a whole board, each with the features known at its entry candle. */
function trades(dir, run, barMs = H4, regimeDir = dir, only = null) {
  const board = load(dir)
  if (!board) return null
  // BTC's regime is always read on its 4 h candles, whatever the bar of the entry.
  const regimeBoard = regimeDir === dir ? board : load(regimeDir)
  if (!regimeBoard?.BTC) return null
  const regime = btcRegime(regimeBoard.BTC)
  const slots = Math.round(86_400_000 / barMs)
  const out = []
  for (const [coin, c] of Object.entries(board)) {
    if (c.length < 700 || (only && !only.includes(coin))) continue
    const res = run(c)
    const line = ema(c.map((x) => x.close), 200)
    const unit = atr(c.map((x) => x.high), c.map((x) => x.low), c.map((x) => x.close), 14)
    const fund = fundingOf(coin)
    for (const s of res.signals) {
      if (s.outcome === 'open' || !Number.isFinite(s.resultR)) continue
      const i = s.index
      const closeMs = c[i].time + barMs
      const vr = volumeRatio(c, i)
      // The same slot of the day over the previous 20 days: a candle at New York's open is always heavier than the all-slot mean.
      let same = 0
      let sameN = 0
      for (let k = 1; k <= 20 && i - k * slots >= 0; k++) {
        same += c[i - k * slots].vol
        sameN++
      }
      same = sameN === 20 ? same / 20 : NaN
      const aligned = withRegime(s.side, regime.aboveAt(closeMs))
      const dist = (s.side === 'long' ? 1 : -1) * ((c[i].close - line[i]) / unit[i])
      out.push({
        coin,
        side: s.side,
        r: s.resultR - s.feeR,
        month: monthKey(closeMs),
        weekend: closesAtWeekend(closeMs),
        volume: Number.isFinite(vr) ? vr >= 1.5 : null,
        ratio: vr,
        slotRatio: same > 0 && Number.isFinite(vr) ? c[i].vol / same : NaN,
        block: Math.floor(new Date(closeMs).getUTCHours() / 4),
        against: aligned === null ? null : !aligned,
        dist,
        funding: fund ? (s.side === 'long' ? 1 : -1) * funding3d(fund, closeMs) : NaN,
      })
    }
  }
  return out
}

/** 95 % interval of mean(A) − mean(B) resampling calendar months, which is how entries on one day are not independent. */
function diffCI(a, b, runs = 1500) {
  const months = [...new Set([...a, ...b].map((x) => x.month))]
  const byA = new Map(months.map((m) => [m, []]))
  const byB = new Map(months.map((m) => [m, []]))
  a.forEach((x) => byA.get(x.month).push(x.r))
  b.forEach((x) => byB.get(x.month).push(x.r))
  const diffs = []
  for (let k = 0; k < runs; k++) {
    const sa = []
    const sb = []
    for (let j = 0; j < months.length; j++) {
      const m = months[Math.floor(rnd() * months.length)]
      sa.push(...byA.get(m))
      sb.push(...byB.get(m))
    }
    if (sa.length && sb.length) diffs.push(mean(sa) - mean(sb))
  }
  diffs.sort((x, y) => x - y)
  return [diffs[Math.floor(diffs.length * 0.025)], diffs[Math.floor(diffs.length * 0.975)]]
}

// ── What a trade is worth at each age (used by `curves` and `evidence` below) ──
const AGE_GRID = [0, 1, 2, 3, 4, 6, 8, 12, 18, 24, 36, 48, 72, 96, 144, 192, 288, 384, 576, 864, 1152, 1728, 2400]
const AGE_TRACKS = [
  ['donchian/fast@4H', './.candles-board-4H', (c) => analyseDonchian(c, DONCHIAN_SETTINGS), null],
  ['donchian/trend@4H', './.candles-board-4H', (c) => analyseDonchian(c, DONCHIAN_TREND_SETTINGS), null],
  ['ema200/base@4H', './.candles-board-4H', (c) => analyseEmaCross(c), null],
  ['donchian/trend@1H', './.candles-board-1H', (c) => analyseDonchian(c, DONCHIAN_TREND_SETTINGS), null],
  ['reversal/tuned@1D', './.candles-board-1D', (c) => strategyByKey('reversal').run(c, 'tuned'), ['BTC', 'ETH', 'SOL']],
]

function ageCurve(dir, run, only) {
  const board = load(dir)
  if (!board) return null
  const sdOf = (xs, m) => Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1))
  const byAge = AGE_GRID.map(() => [])
  const closedShare = AGE_GRID.map(() => [0, 0])
  let trades = 0
  for (const [coin, c] of Object.entries(board)) {
    if (c.length < 700 || (only && !only.includes(coin))) continue
    for (const s of run(c).signals) {
      const risk = Math.abs(s.entry - s.stop)
      if (!(risk > 0) || (s.outcome !== 'open' && !Number.isFinite(s.resultR))) continue
      trades++
      const dirn = s.side === 'long' ? 1 : -1
      AGE_GRID.forEach((a, k) => {
        const j = s.index + a
        if (j >= c.length) return
        const ended = s.closedIndex !== undefined && s.closedIndex <= j
        // Entered at the close of bar `index`: at age a it is worth its final result if it has ended by bar
        // index + a, else the close of that bar against the entry — net of the round trip either way.
        byAge[k].push(ended ? s.resultR - s.feeR : (dirn * (c[j].close - s.entry)) / risk - s.feeR)
        closedShare[k][0] += ended ? 1 : 0
        closedShare[k][1]++
      })
    }
  }
  const out = { bars: [], mean: [], sd: [], n: [], closed: [], trades }
  AGE_GRID.forEach((a, k) => {
    const xs = byAge[k]
    // Past the history the trades reach, a handful of long ones would be read as the curve.
    if (xs.length < 100) return
    const m = mean(xs)
    out.bars.push(a)
    out.mean.push(Math.round(m * 1000) / 1000)
    out.sd.push(Math.round(sdOf(xs, m) * 100) / 100)
    out.n.push(xs.length)
    out.closed.push(closedShare[k][0] / closedShare[k][1])
  })
  return out
}


const FILTERS = [
  ['F1 fin de semana', 'peor', (t) => t.weekend],
  ['F2 volumen ≥ 1,5×', 'mejor', (t) => t.volume],
  ['F3 contra el régimen de BTC', 'peor', (t) => t.against],
  ['F4 extendida', 'peor', null], // third of the distribution, per cell
  ['F5 financiación abarrotada', 'peor', null],
]

const CONTROLS = process.argv[2] === 'controls'
let held = 0
let cells = 0
for (const [sname, run] of CONTROLS ? [] : STRATEGIES) {
  console.log(`\n══════ ${sname}`)
  for (const [pname, dir] of PERIODS) {
    const T = trades(dir, run)
    if (!T) {
      console.log(`  ${pname}: falta ${dir}`)
      continue
    }
    console.log(`\n  ── ${pname} · ${T.length} operaciones · media ${f(mean(T.map((t) => t.r)))} R · longs ${f(mean(T.filter((t) => t.side === 'long').map((t) => t.r)))} (${T.filter((t) => t.side === 'long').length}) · shorts ${f(mean(T.filter((t) => t.side === 'short').map((t) => t.r)))} (${T.filter((t) => t.side === 'short').length})`)
    console.log(`     ${'filtro'.padEnd(30)} ${'esperado'.padEnd(8)} ${'con'.padStart(14)} ${'sin'.padStart(14)} ${'diferencia [IC 95 %]'.padStart(26)}  ¿en la dirección?`)
    for (const [name, expected, pick] of FILTERS) {
      let A
      let B
      if (name.startsWith('F4')) {
        const d = T.map((t) => t.dist).filter(Number.isFinite).sort((x, y) => x - y)
        const cut = d[Math.floor(d.length * (2 / 3))]
        A = T.filter((t) => t.dist >= cut)
        B = T.filter((t) => t.dist < cut)
      } else if (name.startsWith('F5')) {
        const known = T.filter((t) => Number.isFinite(t.funding))
        if (known.length < 200) {
          console.log(`     ${name.padEnd(30)} ${expected.padEnd(8)} (sin historial de financiación en este periodo)`)
          continue
        }
        const d = known.map((t) => t.funding).sort((x, y) => x - y)
        const cut = d[Math.floor(d.length * (2 / 3))]
        A = known.filter((t) => t.funding >= cut)
        B = known.filter((t) => t.funding < cut)
      } else {
        const known = T.filter((t) => pick(t) !== null)
        A = known.filter((t) => pick(t))
        B = known.filter((t) => !pick(t))
      }
      if (A.length < 30 || B.length < 30) {
        console.log(`     ${name.padEnd(30)} ${expected.padEnd(8)} (con ${A.length}, sin ${B.length}: muestra corta)`)
        continue
      }
      const d = mean(A.map((t) => t.r)) - mean(B.map((t) => t.r))
      const [lo, hi] = diffCI(A, B)
      const ok = expected === 'peor' ? d < 0 : d > 0
      cells++
      if (ok) held++
      const sig = lo > 0 || hi < 0 ? ' *' : ''
      console.log(
        `     ${name.padEnd(30)} ${expected.padEnd(8)} ${(f(mean(A.map((t) => t.r))) + ' (' + A.length + ')').padStart(14)} ${(f(mean(B.map((t) => t.r))) + ' (' + B.length + ')').padStart(14)} ${(f(d) + ' [' + f(lo) + ', ' + f(hi) + ']').padStart(26)}  ${ok ? 'sí' : 'NO'}${sig}`,
      )
    }
  }
}
if (!CONTROLS) console.log(`\n${held} de ${cells} celdas van en la dirección escrita de antemano (con azar, la mitad). * = intervalo por meses sin el cero.`)

// ── Controls for F2 and F3 (`npm run improve controls`): is volume a weekend / time-of-day filter in disguise,
// is the threshold a lone cell, and what does each filter do to the total R, not only to the mean?
if (CONTROLS) {
  const SETS = [
    ['2022-26 · 4 h', './.candles-board-4H', H4],
    ['2018-21 · 4 h', './.candles-board-4Hold', H4],
    ['2022-26 · 1 h', './.candles-board-1H', 3_600_000],
  ]
  const sum = (xs) => xs.reduce((a, t) => a + t.r, 0)
  const line = (label, A, B) => {
    if (A.length < 30 || B.length < 30) return console.log(`     ${label.padEnd(36)} (con ${A.length}, sin ${B.length}: muestra corta)`)
    const mA = mean(A.map((t) => t.r))
    const mB = mean(B.map((t) => t.r))
    const [lo, hi] = diffCI(A, B, 800)
    console.log(
      `     ${label.padEnd(36)} con ${f(mA)} (${String(A.length).padStart(5)}, ΣR ${f(sum(A), 0).padStart(5)}) · sin ${f(mB)} (${String(B.length).padStart(5)}, ΣR ${f(sum(B), 0).padStart(5)}) · dif ${f(mA - mB)} [${f(lo)}, ${f(hi)}]${lo > 0 || hi < 0 ? ' *' : ''}`,
    )
  }
  for (const [sname, run] of STRATEGIES) {
    console.log(`\n══════ ${sname}`)
    for (const [pname, dir, bar] of SETS) {
      const T = trades(dir, run, bar, './.candles-board-4H')
      if (!T) {
        console.log(`  ${pname}: falta ${dir}`)
        continue
      }
      const ok = (t) => Number.isFinite(t.ratio)
      console.log(`\n  ── ${pname} · ${T.length} operaciones · media ${f(mean(T.map((t) => t.r)))} · ΣR ${f(sum(T), 0)}`)
      const V = T.filter(ok)
      console.log('   F2 — volumen')
      line('1,5× (el escrito)', V.filter((t) => t.ratio >= 1.5), V.filter((t) => t.ratio < 1.5))
      for (const th of [1.0, 1.25, 2.0, 3.0]) line(`umbral ${th.toFixed(2)}×`, V.filter((t) => t.ratio >= th), V.filter((t) => t.ratio < th))
      const wk = V.filter((t) => !t.weekend)
      line('solo laborables, 1,5×', wk.filter((t) => t.ratio >= 1.5), wk.filter((t) => t.ratio < 1.5))
      const S = V.filter((t) => Number.isFinite(t.slotRatio))
      line('misma franja del día, 1,5×', S.filter((t) => t.slotRatio >= 1.5), S.filter((t) => t.slotRatio < 1.5))
      const wkS = S.filter((t) => !t.weekend)
      line('laborables + misma franja, 1,5×', wkS.filter((t) => t.slotRatio >= 1.5), wkS.filter((t) => t.slotRatio < 1.5))
      console.log('   franja de cierre (UTC) · media de todas · con volumen ≥ 1,5× · sin')
      for (let b = 0; b < 6; b++) {
        const inB = V.filter((t) => t.block === b)
        const hi = inB.filter((t) => t.ratio >= 1.5)
        const lo = inB.filter((t) => t.ratio < 1.5)
        console.log(`     ${String(b * 4).padStart(2, '0')}–${String(b * 4 + 4).padStart(2, '0')} h  n=${String(inB.length).padStart(5)}  ${f(mean(inB.map((t) => t.r)))}   ≥1,5×: ${f(mean(hi.map((t) => t.r)))} (${hi.length})   <1,5×: ${f(mean(lo.map((t) => t.r)))} (${lo.length})`)
      }
      console.log('   F3 — régimen de BTC, por lado')
      const K = T.filter((t) => t.against !== null)
      for (const side of ['long', 'short']) {
        const x = K.filter((t) => t.side === side)
        line(`${side}s: contra el régimen`, x.filter((t) => t.against), x.filter((t) => !t.against))
      }
      console.log('   juntos')
      const both = K.filter(ok)
      line('F2 y a favor de BTC', both.filter((t) => t.ratio >= 1.5 && !t.against), both.filter((t) => !(t.ratio >= 1.5 && !t.against)))
      line('F2 dentro de «a favor de BTC»', both.filter((t) => !t.against && t.ratio >= 1.5), both.filter((t) => !t.against && t.ratio < 1.5))
      line('F2 dentro de «contra BTC»', both.filter((t) => t.against && t.ratio >= 1.5), both.filter((t) => t.against && t.ratio < 1.5))
      line('F3 dentro de «volumen ≥ 1,5×»', both.filter((t) => t.ratio >= 1.5 && t.against), both.filter((t) => t.ratio >= 1.5 && !t.against))
      console.log('   por año de cierre · todas · longs a favor de BTC · longs contra · volumen ≥ 1,5× · menos')
      for (const y of [...new Set(T.map((t) => t.month.slice(0, 4)))].sort()) {
        const Y = T.filter((t) => t.month.startsWith(y))
        const la = Y.filter((t) => t.side === 'long' && t.against === false)
        const lc = Y.filter((t) => t.side === 'long' && t.against === true)
        const hv = Y.filter((t) => t.ratio >= 1.5)
        const lv = Y.filter((t) => t.ratio < 1.5)
        console.log(`     ${y}  n=${String(Y.length).padStart(5)} ${f(mean(Y.map((t) => t.r)))}   a favor ${f(mean(la.map((t) => t.r)))} (${la.length})   contra ${f(mean(lc.map((t) => t.r)))} (${lc.length})   ≥1,5× ${f(mean(hv.map((t) => t.r)))} (${hv.length})   < ${f(mean(lv.map((t) => t.r)))} (${lv.length})`)
      }
    }
  }
}

// ── Out of the sample every earlier cell was read from (`npm run improve survivors`): Binance's daily USDT pairs,
// the ones that stopped trading included, the Donchian + EMA 200 preset on the daily bar, BTC's daily EMA 200 as the regime.
if (process.argv[2] === 'survivors') {
  const dir = './.research/binance-1d'
  if (!existsSync(dir)) {
    console.log('falta ./.research/binance-1d: node scripts/fetch-binance-daily.mjs')
    process.exit(1)
  }
  const DAY = 86_400_000
  const SKIP = /(UP|DOWN|BULL|BEAR)$|^(USDC|TUSD|BUSD|DAI|PAX|USDP|FDUSD|USDT|EUR|GBP|AUD|TRY|BRL|UST|USTC|SUSD|AEUR|EURI|XUSD|USD1|BFUSD|RLUSD|PYUSD)$/
  const raw = {}
  for (const fl of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const coin = fl.replace('.json', '')
    if (SKIP.test(coin)) continue
    const j = JSON.parse(readFileSync(`${dir}/${fl}`, 'utf8'))
    const rows = Array.isArray(j) ? j : (j.rows ?? j.candles ?? [])
    const all = rows.map((r) => ({ time: r[0] > 1e14 ? r[0] / 1000 : r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], vol: +r[5], confirmed: true }))
    // A hole of more than two days is a suspension, a migration or a ticker reused for another asset (LUNA's file runs from
    // Terra's collapse into Terra 2.0): each stretch is its own pair, so a strategy never runs across the splice (2026-10-16).
    for (let from = 0, i = 1, k = 0; i <= all.length; i++) {
      if (i < all.length && all[i].time - all[i - 1].time <= 2 * DAY) continue
      raw[k++ === 0 ? coin : `${coin}#${k - 1}`] = all.slice(from, i)
      from = i
    }
  }
  const btc = raw.BTC
  const btcEma = ema(btc.map((c) => c.close), 200)
  const bull = new Map(btc.map((c, i) => [c.time, Number.isFinite(btcEma[i]) ? c.close > btcEma[i] : null]))
  const lastBtc = btc.at(-1).time
  const out = []
  let used = 0
  let dead = 0
  let markedToLast = 0
  for (const [coin, c] of Object.entries(raw)) {
    if (c.length < 700) continue
    used++
    if (lastBtc - c.at(-1).time > 30 * DAY) dead++
    const gone = lastBtc - c.at(-1).time > 30 * DAY
    const res = analyseDonchian(c, DONCHIAN_TREND_SETTINGS)
    for (const s of res.signals) {
      if (s.index < 20) continue
      let resultR = s.resultR
      if (s.outcome === 'open') {
        // A coin that stopped trading closes at its last price, the rule the cross-section measurement uses;
        // one still trading has a trade that has not ended and is left out.
        if (!gone) continue
        const risk = Math.abs(s.entry - s.stop)
        resultR = ((s.side === 'long' ? 1 : -1) * (c.at(-1).close - s.entry)) / risk
        markedToLast++
      }
      if (!Number.isFinite(resultR)) continue
      const i = s.index
      let avg = 0
      for (let k = i - 20; k < i; k++) avg += c[k].vol
      avg /= 20
      const b = bull.get(c[i].time)
      const closeMs = c[i].time + DAY
      out.push({
        coin,
        side: s.side,
        r: resultR - s.feeR,
        month: monthKey(closeMs),
        against: b === null || b === undefined ? null : s.side === 'long' ? !b : b,
        ratio: avg > 0 ? c[i].vol / avg : NaN,
      })
    }
  }
  console.log(`Binance spot, diario, Donchian + EMA 200: ${used} pares con ≥ 700 días, ${dead} dejaron de cotizar; ${out.length} operaciones (${markedToLast} abiertas en monedas muertas, al último cierre), media ${f(mean(out.map((t) => t.r)))}`)
  const sum = (xs) => xs.reduce((a, t) => a + t.r, 0)
  const row = (label, A) => console.log(`     ${label.padEnd(32)} n=${String(A.length).padStart(5)}  media ${f(mean(A.map((t) => t.r)))}  ΣR ${f(sum(A), 0)}`)
  const K = out.filter((t) => t.against !== null)
  for (const side of ['long', 'short']) {
    row(`${side}s a favor de BTC`, K.filter((t) => t.side === side && !t.against))
    row(`${side}s contra BTC`, K.filter((t) => t.side === side && t.against))
  }
  const la = K.filter((t) => t.side === 'long' && !t.against)
  const lc = K.filter((t) => t.side === 'long' && t.against)
  const [lo, hi] = diffCI(la, lc, 1500)
  console.log(`     longs a favor − contra: ${f(mean(la.map((t) => t.r)) - mean(lc.map((t) => t.r)))} [${f(lo)}, ${f(hi)}]`)
  const sa = K.filter((t) => t.side === 'short' && !t.against)
  const sc = K.filter((t) => t.side === 'short' && t.against)
  const [slo, shi] = diffCI(sa, sc, 1500)
  console.log(`     shorts a favor − contra: ${f(mean(sa.map((t) => t.r)) - mean(sc.map((t) => t.r)))} [${f(slo)}, ${f(shi)}]`)
  const V = out.filter((t) => Number.isFinite(t.ratio))
  const hv = V.filter((t) => t.ratio >= 1.5)
  const lv = V.filter((t) => t.ratio < 1.5)
  const [vlo, vhi] = diffCI(hv, lv, 1500)
  console.log(`     F2 volumen ≥ 1,5× − menos: ${f(mean(hv.map((t) => t.r)) - mean(lv.map((t) => t.r)))} [${f(vlo)}, ${f(vhi)}]  (${hv.length} / ${lv.length})`)
  console.log('   por año de cierre: todas · longs a favor · longs contra · shorts a favor · shorts contra · ≥1,5× · menos')
  for (const y of [...new Set(out.map((t) => t.month.slice(0, 4)))].sort()) {
    const Y = out.filter((t) => t.month.startsWith(y))
    const g = (side, ag) => Y.filter((t) => t.side === side && t.against === ag)
    const m = (xs) => `${f(mean(xs.map((t) => t.r)))} (${xs.length})`
    console.log(`     ${y}  ${m(Y).padEnd(14)} ${m(g('long', false)).padEnd(14)} ${m(g('long', true)).padEnd(14)} ${m(g('short', false)).padEnd(14)} ${m(g('short', true)).padEnd(14)} ${m(Y.filter((t) => t.ratio >= 1.5)).padEnd(14)} ${m(Y.filter((t) => t.ratio < 1.5))}`)
  }
}

// ── The figures the app quotes (`npm run improve evidence`): the tags' CONTEXT_EVIDENCE and the ledger's
// reference per strategy, measured with the app's own functions. Exits non-zero when what the interface
// says has drifted from what this measures, like `npm run ematouch` does for the touch scan.
if (process.argv[2] === 'evidence') {
  const H1 = 3_600_000
  const sd = (xs) => {
    const m = mean(xs)
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
  }
  const TRACKS = [
    ['donchian/fast@4H', './.candles-board-4H', (c) => analyseDonchian(c, DONCHIAN_SETTINGS), H4, null],
    ['donchian/trend@4H', './.candles-board-4H', (c) => analyseDonchian(c, DONCHIAN_TREND_SETTINGS), H4, null],
    ['ema200/base@4H', './.candles-board-4H', (c) => analyseEmaCross(c), H4, null],
    ['donchian/trend@1H', './.candles-board-1H', (c) => analyseDonchian(c, DONCHIAN_TREND_SETTINGS), H1, null],
    ['reversal/tuned@1D', './.candles-board-1D', (c) => strategyByKey('reversal').run(c, 'tuned'), 86_400_000, ['BTC', 'ETH', 'SOL']],
  ]
  const split = (xs, pick) => {
    const a = xs.filter((t) => pick(t) === true)
    const b = xs.filter((t) => pick(t) === false)
    return { with: mean(a.map((t) => t.r)), without: mean(b.map((t) => t.r)), nWith: a.length, nWithout: b.length }
  }
  const measured = {}
  const reference = {}
  console.log('Referencia por estrategia (neto de 0,1 % ida y vuelta):')
  for (const [key, dir, run, bar, only] of TRACKS) {
    const T = trades(dir, run, bar, './.candles-board-4H', only)
    if (!T) {
      console.log(`  ${key}: falta ${dir}`)
      continue
    }
    const r = T.map((t) => t.r)
    const longs = T.filter((t) => t.side === 'long').map((t) => t.r)
    const shorts = T.filter((t) => t.side === 'short').map((t) => t.r)
    console.log(
      `  ${key.padEnd(20)} n=${String(T.length).padStart(6)}  media ${f(mean(r), 3)}  sd ${sd(r).toFixed(3)}  longs ${f(mean(longs))} (${longs.length})  shorts ${f(mean(shorts))} (${shorts.length})`,
    )
    reference[key] = { n: T.length, net: mean(r), sd: sd(r), longs: mean(longs), shorts: mean(shorts) }
    const known = T.filter((t) => Number.isFinite(t.ratio))
    measured[key] = {
      volume: split(known, (t) => t.ratio >= 1.5),
      longs: split(T.filter((t) => t.side === 'long' && t.against !== null), (t) => !t.against),
      shorts: split(T.filter((t) => t.side === 'short' && t.against !== null), (t) => !t.against),
      weekend: split(T, (t) => t.weekend),
    }
  }
  let drift = 0
  const near = (label, got, quoted, tolerance) => {
    const bad = !(Math.abs(got - quoted) <= tolerance)
    if (bad) drift++
    console.log(`     ${bad ? '✗' : '✓'} ${label.padEnd(34)} medido ${f(got)}  citado ${f(quoted)}`)
  }
  for (const [key, quoted] of Object.entries(CONTEXT_EVIDENCE)) {
    const m = measured[key]
    console.log(`\n  ${key} · ${quoted.sample}`)
    if (!m) {
      drift++
      console.log('     ✗ sin datos para medirla')
      continue
    }
    for (const part of ['volume', 'longs', 'shorts']) {
      near(`${part} con`, m[part].with, quoted[part].with, 0.02)
      near(`${part} sin`, m[part].without, quoted[part].without, 0.02)
      near(`${part} n con`, m[part].nWith, quoted[part].nWith, Math.max(25, quoted[part].nWith * 0.02))
      near(`${part} n sin`, m[part].nWithout, quoted[part].nWithout, Math.max(25, quoted[part].nWithout * 0.02))
    }
    // The weekend split is read on the close of the candle: with it, without it.
    near('fin de semana con', m.weekend.with, quoted.weekend.with, 0.02)
    near('fin de semana sin', m.weekend.without, quoted.weekend.without, 0.02)
  }
  // The ledger's yardstick per strategy (src/lib/ledger.ts REFERENCE).
  for (const [key, quoted] of Object.entries(REFERENCE)) {
    const m = reference[key]
    console.log(`\n  ${key} · referencia del seguimiento (${quoted.sample})`)
    if (!m) {
      drift++
      console.log('     ✗ sin datos para medirla')
      continue
    }
    near('media neta', m.net, quoted.net, 0.02)
    near('desviación', m.sd, quoted.sd, Math.max(0.1, quoted.sd * 0.05))
    near('operaciones', m.n, quoted.n, Math.max(25, quoted.n * 0.02))
    near('longs', m.longs, quoted.longs, 0.03)
    near('shorts', m.shorts, quoted.shorts, 0.03)
  }

  // What is measured but not quoted yet, ready to paste.
  for (const [key, m] of Object.entries(measured)) {
    if (CONTEXT_EVIDENCE[key]) continue
    const r2 = (x) => Math.round(x * 100) / 100
    const fmt = (v) => `{ with: ${r2(v.with)}, without: ${r2(v.without)}, nWith: ${v.nWith}, nWithout: ${v.nWithout} }`
    console.log(`\n  ${key} (sin citar):`)
    for (const part of ['volume', 'longs', 'shorts', 'weekend']) console.log(`     ${part}: ${fmt(m[part])},`)
  }
  // The age curves the ledger compares live trades with (src/lib/ledgerAge.ts).
  for (const [key, dir, run, only] of AGE_TRACKS) {
    const quoted = AGE_CURVES[key]
    const got = ageCurve(dir, run, only)
    console.log(`\n  ${key} · curva por edad`)
    if (!quoted || !got) {
      drift++
      console.log('     ✗ sin curva citada o sin datos para medirla')
      continue
    }
    let bad = 0
    quoted.bars.forEach((a, i) => {
      const k = got.bars.indexOf(a)
      if (k < 0) return void bad++
      if (Math.abs(got.mean[k] - quoted.mean[i]) > 0.03) bad++
      if (Math.abs(got.sd[k] - quoted.sd[i]) > Math.max(0.1, quoted.sd[i] * 0.05)) bad++
    })
    if (bad) drift++
    console.log(`     ${bad ? '✗' : '✓'} ${quoted.bars.length} edades, ${bad ? `${bad} desviadas` : 'todas dentro de 0,03 R y del 5 % de la desviación'}`)
  }
  // The band's inflation (src/lib/ledgerAge.ts NOISE_INFLATION): the replay of the live statistic on the history.
  for (const [key, dir, run, only] of AGE_TRACKS) {
    const quoted = NOISE_INFLATION[key]
    const got = calibration(key, dir, run, only, [7, 14, 30, 60])
    console.log(`\n  ${key} · amplitud de la banda`)
    if (quoted === undefined || !got?.pooled) {
      drift++
      console.log('     ✗ sin factor citado o sin ventanas para medirlo')
      continue
    }
    near('factor de la banda (k95)', got.pooled.k95, quoted, 0.35)
  }
  console.log(`\n  Cifras que cita la interfaz (CONTEXT_EVIDENCE, AGE_CURVES, NOISE_INFLATION): ${drift ? `${drift} DESVIADAS` : 'coinciden con lo medido'}`)
  if (drift) process.exitCode = 1
}

// ── What a trade of each strategy is worth at each age (`npm run improve curves`) ───────────────────────
// A live ledger is young. Its closed trades are mostly the losers — a trend follower cuts them fast and lets the
// winners run — so the mean of what has closed is far below the strategy's mean, and means nothing yet. The fair
// comparison is each trade against what the history's trades were worth *at the same age*, marked to the close
// of that bar when still open. This prints that curve for each track, ready to paste into src/lib/ledgerAge.ts.
if (process.argv[2] === 'curves') {
  for (const [key, dir, run, only] of AGE_TRACKS) {
    const c = ageCurve(dir, run, only)
    if (!c) {
      console.log(`${key}: falta ${dir}`)
      continue
    }
    console.log(`\n${key}  (${c.trades} operaciones)`)
    console.log('  edad (velas) · n · media · sd · cerradas')
    c.bars.forEach((a, i) => console.log(`  ${String(a).padStart(5)} ${String(c.n[i]).padStart(7)}  ${f(c.mean[i], 3)}  ${c.sd[i].toFixed(2)}  ${(c.closed[i] * 100).toFixed(0)} %`))
    console.log(`  '${key}': { bars: ${JSON.stringify(c.bars)}, mean: ${JSON.stringify(c.mean)}, sd: ${JSON.stringify(c.sd)} },`)
  }
}

// ── Is the ledger's band honest? (`npm run improve calibrate`) ───────────────────────────────────────
// The reading compares live trades with the history's at the same age, and its band assumes they are independent.
// They are not: signals fired the same day on twenty contracts share one market. So the statistic is replayed on
// the history itself — every window of W days, all the entries that began in it, read at its end exactly as the
// view reads a ledger — and what its z-scores look like is measured. If their spread is 1, the band is right; if
// it is 2.4, the band has to be 2.4 times wider to mean what it says.
function calibration(key, dir, run, only, windows) {
  const DAY = 86_400_000
  const barOf = { '4H': 4 * 3_600_000, '1H': 3_600_000, '1D': DAY }
  const curveAt = (age) => {
    const c = AGE_CURVES[key]
    if (age <= c.bars[0]) return { mean: c.mean[0], sd: c.sd[0] }
    const last = c.bars.length - 1
    if (age >= c.bars[last]) return { mean: c.mean[last], sd: c.sd[last] }
    let hi = 1
    while (c.bars[hi] < age) hi++
    const t = (age - c.bars[hi - 1]) / (c.bars[hi] - c.bars[hi - 1])
    return { mean: c.mean[hi - 1] + t * (c.mean[hi] - c.mean[hi - 1]), sd: c.sd[hi - 1] + t * (c.sd[hi] - c.sd[hi - 1]) }
  }
  const board = load(dir)
  if (!board) return null
  const barMs = barOf[key.split('@')[1]]
  const all = []
  let first = Infinity
  let last = -Infinity
  for (const [coin, c] of Object.entries(board)) {
    if (c.length < 700 || (only && !only.includes(coin))) continue
    const idx = new Map(c.map((x, i) => [x.time, i]))
    for (const s of run(c).signals) {
      const risk = Math.abs(s.entry - s.stop)
      if (!(risk > 0) || (s.outcome !== 'open' && !Number.isFinite(s.resultR))) continue
      const at = c[s.index].time + barMs
      all.push({ c, idx, s, risk, at, dirn: s.side === 'long' ? 1 : -1 })
      first = Math.min(first, at)
      last = Math.max(last, c.at(-1).time + barMs)
    }
  }
  const perWindow = []
  const pooled = []
  for (const W of windows) {
    const zs = []
    // On the track's own grid (the daily bar closes at 16:00 UTC), stepping a day at a time.
    for (let t0 = first; t0 + W * DAY <= last; t0 += DAY) {
      const t1 = t0 + W * DAY
      let n = 0
      let dev = 0
      let variance = 0
      for (const x of all) {
        if (x.at <= t0 || x.at > t1) continue
        // The last candle that had closed by t1 on this contract.
        const j = x.idx.get(t1 - barMs)
        if (j === undefined) continue
        const ended = x.s.closedIndex !== undefined && x.s.closedIndex <= j
        const r = ended ? x.s.resultR - x.s.feeR : (x.dirn * (x.c[j].close - x.s.entry)) / x.risk - x.s.feeR
        const e = curveAt(j - x.s.index)
        dev += r - e.mean
        variance += e.sd ** 2
        n++
      }
      if (n >= 5) zs.push(dev / n / (Math.sqrt(variance) / n))
    }
    if (zs.length < 10) continue
    const m = mean(zs)
    const sdz = Math.sqrt(zs.reduce((a, b) => a + (b - m) ** 2, 0) / (zs.length - 1))
    const abs = zs.map(Math.abs).sort((a, b) => a - b)
    perWindow.push({ W, n: zs.length, sd: sdz, mean: m, out: zs.filter((z) => Math.abs(z) > 1.96).length / zs.length, k95: abs[Math.floor(abs.length * 0.95)] / 1.96 })
    if (W >= 7 && W <= 60) pooled.push(...zs)
  }
  if (!pooled.length) return { trades: all.length, perWindow, pooled: null }
  const abs = pooled.map(Math.abs).sort((a, b) => a - b)
  const m = mean(pooled)
  return {
    trades: all.length,
    perWindow,
    pooled: {
      sd: Math.sqrt(pooled.reduce((a, b) => a + (b - m) ** 2, 0) / (pooled.length - 1)),
      k95: abs[Math.floor(abs.length * 0.95)] / 1.96,
      k99: abs[Math.floor(abs.length * 0.99)] / 2.576,
    },
  }
}

if (process.argv[2] === 'calibrate') {
  for (const [key, dir, run, only] of AGE_TRACKS) {
    const c = calibration(key, dir, run, only, [2, 4, 7, 14, 30, 60, 120, 240, 365])
    if (!c) continue
    console.log(`\n${key}  (${c.trades} operaciones)`)
    console.log('  ventana (días) · ventanas · sd de z · media de z · fuera de ±1,96 · k95')
    for (const w of c.perWindow) {
      console.log(`  ${String(w.W).padStart(5)} ${String(w.n).padStart(9)} ${w.sd.toFixed(2).padStart(8)} ${f(w.mean).padStart(8)} ${(w.out * 100).toFixed(0).padStart(8)} %   k95 ${w.k95.toFixed(2)}`)
    }
    if (c.pooled) console.log(`  → 7 a 60 días juntas: sd ${c.pooled.sd.toFixed(2)}, k95 ${c.pooled.k95.toFixed(2)}, k99 ${c.pooled.k99.toFixed(2)}`)
  }
}
