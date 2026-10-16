// Ideas this repo had never measured, written down BEFORE any number (2026-10-16).
//
// The question was "what has nobody tested that might work?". The honest starting point is the base rate:
// nearly every family measured here lost, and the one edge that holds is the long side of a trend on crypto.
// So the search goes where the account can trade and the repo had not looked. OKX's board lists 76 equity and
// ETF X-Perps (AAPL, TSLA, SPY, QQQ, SOXL, SOXS …) and four commodities (XAU, XAG, CL, BZ), all listed in the
// last six months — too young to measure on their own, but what they track has 25 years of free daily history
// (`node scripts/fetch-yahoo.mjs` → ./.research/yahoo-1d). Six ideas, each with its mechanism, its rules, its
// control and its bar fixed here. A result is reported whatever it says; a rule changed after a bad number is
// a new trial, counted, never a correction.
//
// The bar is the repo's own (`npm run try`): n ≥ 100 (30 for the survivor-free crypto cuts), the edge net of cost
// in the aggregate AND in both halves of the history, a control that places the same trades at random, the
// result still positive without its ten best trades, and a Deflated Sharpe Ratio ≥ 95 % after the trials of the
// family. Halves are the entries before / after the group's MEDIAN entry date, not per instrument.
//
//   T  trend      The shipped trend rules, unchanged, on other markets. `donchian/trend` (Canal 20 + EMA 200,
//                 2 ATR stop, 8 ATR trail, long above / short below) and the EMA 200 cross (stop-and-reverse,
//                 2 ATR stop), on DAILY bars, 0.1 % round trip (the X-Perp taker both ways: conservative for
//                 ETFs). Mechanism: trend following is the best documented premium across asset classes
//                 (Moskowitz–Ooi–Pedersen 2012, Hurst–Ooi–Pedersen 2017), and 25 years × dozens of markets
//                 gives the power four years of crypto never had. Four groups: the four commodities OKX lists
//                 (through GLD, SLV, USO, BNO: physical or rolled funds, no splice gaps), 41 diversified ETFs
//                 (equity indices, sectors, bonds, currencies, other commodities, REITs), the single stocks
//                 OKX lists (a SURVIVOR selection — today's popular names — so longs are read next to shorts
//                 and next to the random control, and never alone), and continuous futures as a cross-check
//                 (unadjusted for rolls). Trials counted: 2 strategies × 4 groups = 8.
//
//   R  rsi2       Connors' RSI(2) pullback in its home market. Long when the close is above its 200-day SMA
//                 and RSI(2) (Wilder) < 10 at the close; entry at that close; out at the first close above the
//                 5-day SMA or after 10 days; no stop (the original has none), 0.1 % round trip. Result in
//                 percent per trade, not R. Control: the same number of trades on random days of the same
//                 instrument that closed above the 200-day SMA, held as long. The repo measured this family on
//                 crypto (+0.01 R, deleted); this asks whether it works where it was published. Groups: equity
//                 index and sector ETFs, and the stocks OKX lists. Trials: thresholds 5 / 10 / 15 → 3 (10 is the
//                 primary).
//
//   M  tom        Turn of the month. Long at the close of the second-to-last trading day of a month, out at the
//                 close of the third trading day of the next: the last day and the first three, four returns.
//                 Mechanism: payroll, pension and fund flows at month ends (McConnell–Xu 2008, 31 countries).
//                 Control: the mean of every other four-day window. Unit: the month. SPY, QQQ and the other
//                 equity-index ETFs; 0.1 % round trip per month. Trials: 1.
//
//   L  letf       Both legs of a leveraged ETF pair, short. A 3× fund resets daily, so over a month its return
//                 is not 3× the index's: it loses ~(L²−L)/2·σ² a year to compounding, and the bear fund does
//                 the same. Short equal dollars of both and the first-order index exposure cancels while the
//                 decay does not. A perp has no borrow cost — only funding, which at the 0.01 % / 8 h baseline
//                 PAYS shorts — so on OKX the trade is cheaper than anywhere with a stock loan; SOXL and SOXS
//                 are both listed. Rules: first trading day of each month, short N dollars of each leg, out at
//                 the next first trading day; taker 0.05 % a side on each leg; funding scenarios — none, and
//                 the punitive one (the shorts PAY 0.01 % / 8 h on each leg's notional, 11 % a year), which is
//                 the one the verdict reads. Result as a percentage of gross notional (2N). 19 pairs since
//                 2008–2019. Bar (written now): ≥ +0.30 % a month under the punitive funding, both halves
//                 positive, ≥ 60 % of the pairs positive, the worst 1 % of months no worse than −30 % of
//                 gross, a month-block 95 % interval above zero. Variants: weekly rebalance, and a monthly
//                 one with a stop at −10 % of gross → 3 trials. A short pair is short convexity: what it
//                 earns is a premium for a tail, and the tail is what this reports.
//
//   D  dumps      Buying a crash. Mirror of `npm run pump`: Binance USDT pairs, dead ones included, the 30 with
//                 the most 30-day dollar volume each day; a dump is a day whose close-to-close return is at or
//                 below −12 % (variant −20 %). Entry at the close of the NEXT day (the dump is known at the
//                 close), out 1, 3 or 7 days later; primary −12 %, hold 3. Result minus the band's mean over the
//                 same days; cost 0.1 % plus 0.3 % of slippage on a crashed coin. Splits: BTC's return that day
//                 (≥ −2 % idiosyncratic, ≤ −5 % market-wide), halves, years, alive vs dead. Unit: the day
//                 (events on one day averaged first). Trials: 2 thresholds × 3 holds × 2 entries (the close of
//                 the dump itself, as a second variant) = 12. Bar: ≥ +0.5 % net per event-day, both halves
//                 positive, t ≥ 2.5 (a day-clustered t, because of the 12 trials), positive without the ten best
//                 days.
//
//   G  grid       What a grid bot earns. Long arithmetic grid, 30 cells over ±15 % of the start price, capital
//                 split equally per cell, maker 0.02 % a fill, the base position bought at taker 0.05 %; a
//                 window ends after 30 days or when price leaves the range (marked there). 33 coins of 1 h since
//                 2021-12, a start every 15 days. Control: the same coin's hourly returns resampled in whole days
//                 with the mean removed, which keeps volatility and fat tails and removes drift and trend —
//                 where a grid's expectation is exactly minus its fees. The question is what the real path adds
//                 to that, and what it takes away at the tail. Trials: 1.
//
// npm run novel trend|rsi2|tom|letf|dumps|grid
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { analyseDonchian, DONCHIAN_TREND_SETTINGS } from '../src/lib/indicators/donchianBreakout.ts'
import { analyseEmaCross } from '../src/lib/indicators/emaCross.ts'
import { ema, rsi, sma } from '../src/lib/indicators/ta.ts'
import { deflate, DSR_LEVEL } from '../src/lib/indicators/deflated.ts'
import { MIN_TRADABLE_R } from '../src/lib/indicators/registry.ts'
import { UNIVERSE } from './fetch-yahoo.mjs'

const MODE = process.argv[2] ?? 'trend'
const DAY = 86_400_000

// ── small helpers ───────────────────────────────────────────────────────────────────────────────────────
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const sd = (xs) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const sg = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '—')
const pc = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)} %` : '—')
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[s.length >> 1] : NaN
}
let seed = 20261016
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7)
const yearOf = (ms) => new Date(ms).getUTCFullYear()

/** Mean and 95 % interval resampling calendar months — entries on one day are not independent. */
function monthBootstrap(rows, value = (r) => r.r, key = (r) => monthOf(r.time), runs = 1500) {
  const by = new Map()
  for (const r of rows) {
    const k = key(r)
    if (!by.has(k)) by.set(k, [0, 0])
    const a = by.get(k)
    a[0] += value(r)
    a[1] += 1
  }
  const cells = [...by.values()]
  if (cells.length < 6) return [NaN, NaN]
  const draws = []
  for (let i = 0; i < runs; i++) {
    let s = 0
    let n = 0
    for (let k = 0; k < cells.length; k++) {
      const c = cells[Math.floor(rnd() * cells.length)]
      s += c[0]
      n += c[1]
    }
    draws.push(s / n)
  }
  draws.sort((a, b) => a - b)
  return [draws[Math.floor(runs * 0.025)], draws[Math.floor(runs * 0.975)]]
}

function loadYahoo(sym) {
  const path = `./.research/yahoo-1d/${sym.replace(/[^A-Za-z0-9.=-]/g, '_')}.json`
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}
if (!existsSync('./.research/yahoo-1d')) {
  console.log('Falta ./.research/yahoo-1d: node scripts/fetch-yahoo.mjs')
  process.exit(1)
}

/** The same trades with the entry thrown away (see `try-strategy.mjs`): same risk distance and holding time, random start and side. */
function randomControl(trades, sameSide = false) {
  const holds = trades.map((t) => t.hold).filter((h) => h > 0)
  if (!holds.length) return []
  const hold = median(holds)
  const out = []
  for (const t of trades) {
    const cs = t.candles
    const start = t.index + Math.floor(rnd() * Math.max(1, hold))
    const end = Math.min(cs.length, start + hold)
    if (start >= end || !(t.risk > 0)) continue
    // `sameSide` keeps each trade's direction: in a market that drifts up a random LONG earns the drift, and
    // only a control that keeps the side can say whether the signal added anything to it.
    const dir = sameSide ? (t.side === 'long' ? 1 : -1) : rnd() < 0.5 ? 1 : -1
    const entry = cs[start].close
    const stop = entry - dir * t.risk
    let r = null
    for (let i = start; i < end; i++) {
      if (dir > 0 ? cs[i].low <= stop : cs[i].high >= stop) {
        r = -1
        break
      }
    }
    if (r === null) r = ((cs[end - 1].close - entry) * dir) / t.risk
    out.push(r - t.fee)
  }
  return out
}

// ── T: the trend rules on other markets ─────────────────────────────────────────────────────────────────
const TREND_STRATEGIES = [
  ['Canal 20 + EMA 200', (c) => analyseDonchian(c, DONCHIAN_TREND_SETTINGS)],
  ['Cruce EMA 200', (c) => analyseEmaCross(c)],
]

function tradesOf(symbols, run, minBars = 1500) {
  const out = []
  for (const sym of symbols) {
    const c = loadYahoo(sym)
    if (!c || c.length < minBars) continue
    for (const s of run(c).signals) {
      if (s.outcome === 'open' || !Number.isFinite(s.resultR)) continue
      out.push({
        sym,
        side: s.side,
        time: s.time,
        r: s.resultR - s.feeR,
        gross: s.resultR,
        fee: s.feeR,
        index: s.index,
        hold: (s.closedIndex ?? s.index) - s.index,
        risk: Math.abs(s.entry - s.stop),
        candles: c,
      })
    }
  }
  return out
}

function describeGroup(label, trades, trials, { minN = 100, threshold = MIN_TRADABLE_R } = {}) {
  if (!trades.length) return console.log(`  ${label.padEnd(34)} sin operaciones`)
  const rs = trades.map((t) => t.r)
  const cut = median(trades.map((t) => t.time))
  const first = trades.filter((t) => t.time < cut).map((t) => t.r)
  const second = trades.filter((t) => t.time >= cut).map((t) => t.r)
  const control = randomControl(trades)
  const sameSide = (side) => mean(randomControl(trades.filter((t) => t.side === side), true))
  const sorted = [...rs].sort((a, b) => b - a)
  const without10 = mean(sorted.slice(10))
  const [lo, hi] = monthBootstrap(trades)
  const d = deflate(rs, trials)
  const longs = trades.filter((t) => t.side === 'long').map((t) => t.r)
  const shorts = trades.filter((t) => t.side === 'short').map((t) => t.r)
  const reasons = []
  if (trades.length < minN) reasons.push(`n=${trades.length}`)
  if (mean(rs) < threshold) reasons.push(`agregado ${sg(mean(rs))}`)
  if (Math.min(mean(first), mean(second)) < threshold) reasons.push(`mitad floja ${sg(Math.min(mean(first), mean(second)))}`)
  if (mean(rs) - mean(control) < 0.05) reasons.push(`ventaja sobre azar ${sg(mean(rs) - mean(control))}`)
  if (!(without10 > 0)) reasons.push(`sin las 10 mejores ${sg(without10)}`)
  if (!(d.dsr >= DSR_LEVEL)) reasons.push(`DSR ${(d.dsr * 100).toFixed(0)} %`)
  console.log(
    `  ${label.padEnd(34)} n=${String(trades.length).padStart(5)}  neto ${sg(mean(rs)).padStart(6)} R  mitades ${sg(mean(first))} / ${sg(mean(second))}  azar ${sg(mean(control))}  sin 10 mejores ${sg(without10)}  IC meses [${sg(lo)}, ${sg(hi)}]  largos ${sg(mean(longs))} (${longs.length}) cortos ${sg(mean(shorts))} (${shorts.length})  DSR ${(d.dsr * 100).toFixed(0)} %` +
      (reasons.length ? `\n      ✗ ${reasons.join(' · ')}` : '\n      ✓ pasa el listón') +
      `\n      contra un azar DEL MISMO LADO: largos ${sg(mean(longs))} frente a ${sg(sameSide('long'))}, cortos ${sg(mean(shorts))} frente a ${sg(sameSide('short'))}`,
  )
  return { n: trades.length, net: mean(rs), pass: !reasons.length }
}

if (MODE === 'trend') {
  const GROUPS = [
    ['las 4 materias primas de OKX', UNIVERSE.commodityOkx, 1500],
    ['ETF diversificados (41)', [...UNIVERSE.commodityOther, ...UNIVERSE.equityIndex, ...UNIVERSE.sectors, ...UNIVERSE.bonds, ...UNIVERSE.fx, ...UNIVERSE.reit], 1500],
    ['acciones que lista OKX (superv.)', UNIVERSE.okxStocks, 1800],
    ['futuros continuos (control)', UNIVERSE.futures, 1500],
  ]
  const TRIALS = TREND_STRATEGIES.length * GROUPS.length
  console.log(`LAS REGLAS DE TENDENCIA TAL COMO ESTÁN, EN OTROS MERCADOS (velas diarias, comisión 0,1 %, ${TRIALS} pruebas contadas)\n`)
  for (const [name, run] of TREND_STRATEGIES) {
    console.log(`── ${name}`)
    for (const [label, syms, minBars] of GROUPS) describeGroup(label, tradesOf(syms, run, minBars), TRIALS)
    console.log('')
  }
  // The four OKX commodities one by one, and the largest groups by decade: where does a pooled number come from?
  const [donchianName, donchianRun] = TREND_STRATEGIES[0]
  console.log(`── ${donchianName}: una a una (materias primas de OKX) y por década`)
  for (const sym of UNIVERSE.commodityOkx) {
    const t = tradesOf([sym], donchianRun)
    const c = loadYahoo(sym)
    console.log(`  ${sym.padEnd(6)} ${new Date(c[0].time).toISOString().slice(0, 10)} → n=${String(t.length).padStart(3)}  neto ${sg(mean(t.map((x) => x.r)))} R  largos ${sg(mean(t.filter((x) => x.side === 'long').map((x) => x.r)))} cortos ${sg(mean(t.filter((x) => x.side === 'short').map((x) => x.r)))}`)
  }
  const pooled = GROUPS.slice(0, 2).flatMap(([, syms, minBars]) => tradesOf(syms, donchianRun, minBars))
  for (const [from, to] of [[2000, 2009], [2010, 2019], [2020, 2026]]) {
    const t = pooled.filter((x) => yearOf(x.time) >= from && yearOf(x.time) <= to)
    console.log(`  ${from}–${to}  commodities + ETF: n=${String(t.length).padStart(5)}  neto ${sg(mean(t.map((x) => x.r)))} R`)
  }

  // Where does the diversified result come from? One line per kind of asset, the same rule.
  console.log(`\n── ${donchianName}: por tipo de activo (ETF diversificados)`)
  const KINDS = [
    ['índices de renta variable', UNIVERSE.equityIndex],
    ['sectores de EE. UU.', UNIVERSE.sectors],
    ['bonos', UNIVERSE.bonds],
    ['divisas', UNIVERSE.fx],
    ['otras materias primas', UNIVERSE.commodityOther],
    ['inmobiliario', UNIVERSE.reit],
  ]
  for (const [label, syms] of KINDS) {
    const t = tradesOf(syms, donchianRun)
    const L = t.filter((x) => x.side === 'long').map((x) => x.r)
    const S = t.filter((x) => x.side === 'short').map((x) => x.r)
    console.log(`  ${label.padEnd(28)} n=${String(t.length).padStart(5)}  neto ${sg(mean(t.map((x) => x.r)))} R  largos ${sg(mean(L))} (${L.length})  cortos ${sg(mean(S))} (${S.length})`)
  }

  // Calendar years of the diversified set: how many are positive, and what it did in the bad ones.
  console.log(`\n── ${donchianName}: año a año (ETF diversificados + las 4 materias primas), entradas de cada año`)
  const wide = tradesOf([...UNIVERSE.commodityOkx, ...UNIVERSE.commodityOther, ...UNIVERSE.equityIndex, ...UNIVERSE.sectors, ...UNIVERSE.bonds, ...UNIVERSE.fx, ...UNIVERSE.reit], donchianRun)
  const years = [...new Set(wide.map((x) => yearOf(x.time)))].sort()
  let positive = 0
  const line = []
  for (const y of years) {
    const t = wide.filter((x) => yearOf(x.time) === y)
    const m = mean(t.map((x) => x.r))
    if (m > 0) positive++
    line.push(`${y}: ${sg(m, 2)} (${t.length})`)
  }
  console.log('  ' + line.join('   '))
  console.log(`  ${positive} de ${years.length} años positivos`)

  // Cost: the daily stop sits 2 ATR away, so a fee is a small part of R; the check is the X-Perp's, at ×2 and ×3.
  console.log(`\n── ${donchianName}: sensibilidad a la comisión (ETF diversificados)`)
  for (const k of [1, 2, 3]) {
    const t = wide.map((x) => ({ ...x, r: x.gross - x.fee * k }))
    console.log(`  comisión ×${k} (${(0.1 * k).toFixed(1)} % ida y vuelta): neto ${sg(mean(t.map((x) => x.r)))} R`)
  }
}


// ── T (variant): the same trend rule, longs only ─────────────────────────────────────────────────────────
// Added after the first run showed the shorts adding nothing (−0.16 R on the diversified set against −0.13
// for a random short): the single change to the rule, counted as a ninth trial.
if (MODE === 'trend-long') {
  const TRIALS = 9
  const wide = [...UNIVERSE.commodityOther, ...UNIVERSE.equityIndex, ...UNIVERSE.sectors, ...UNIVERSE.bonds, ...UNIVERSE.fx, ...UNIVERSE.reit]
  console.log(`CANAL 20 + EMA 200, SOLO LARGOS (variante contada: ${TRIALS} pruebas en total)\n`)
  const only = (symbols, minBars) => tradesOf(symbols, TREND_STRATEGIES[0][1], minBars).filter((t) => t.side === 'long')
  describeGroup('ETF diversificados (41), largos', only(wide, 1500), TRIALS)
  describeGroup('las 4 materias primas de OKX, largos', only(UNIVERSE.commodityOkx, 1500), TRIALS)
  describeGroup('acciones que lista OKX, largos', only(UNIVERSE.okxStocks, 1800), TRIALS)
  // The ETF set without the equity-like ones, so the result does not rest on the one market that went up.
  describeGroup('bonos, divisas y materias, largos', only([...UNIVERSE.bonds, ...UNIVERSE.fx, ...UNIVERSE.commodityOther, ...UNIVERSE.commodityOkx], 1500), TRIALS)
}

// ── R: RSI(2) pullback where it was published ────────────────────────────────────────────────────────────
function rsi2Trades(symbols, threshold, minBars = 1500) {
  const out = []
  for (const sym of symbols) {
    const c = loadYahoo(sym)
    if (!c || c.length < minBars) continue
    const close = c.map((x) => x.close)
    const trend = sma(close, 200)
    const fast = sma(close, 5)
    const r2 = rsi(close, 2)
    const eligible = []
    for (let i = 200; i < c.length; i++) if (close[i] > trend[i]) eligible.push(i)
    let i = 200
    while (i < c.length - 1) {
      if (close[i] > trend[i] && r2[i] < threshold) {
        let j = i + 1
        while (j < c.length - 1 && !(close[j] > fast[j]) && j - i < 10) j++
        if (j >= c.length) break
        out.push({ sym, time: c[i].time, hold: j - i, r: close[j] / close[i] - 1 - 0.001, eligible, close })
        i = j + 1
      } else i++
    }
  }
  return out
}

/** Random entries on days that closed above the 200-day SMA, as long as each trade was held. */
function rsi2Control(trades) {
  const out = []
  for (const t of trades) {
    const day = t.eligible[Math.floor(rnd() * t.eligible.length)]
    const end = Math.min(t.close.length - 1, day + t.hold)
    out.push(t.close[end] / t.close[day] - 1 - 0.001)
  }
  return out
}

function describePct(label, trades, trials, { minN = 100, perTrade = 0.003, edge = 0.0015 } = {}) {
  if (!trades.length) return console.log(`  ${label}: sin operaciones`)
  const rs = trades.map((t) => t.r)
  const cut = median(trades.map((t) => t.time))
  const first = trades.filter((t) => t.time < cut).map((t) => t.r)
  const second = trades.filter((t) => t.time >= cut).map((t) => t.r)
  const control = rsi2Control(trades)
  const sorted = [...rs].sort((a, b) => b - a)
  const without10 = mean(sorted.slice(10))
  const [lo, hi] = monthBootstrap(trades)
  const d = deflate(rs, trials)
  const reasons = []
  if (trades.length < minN) reasons.push(`n=${trades.length}`)
  if (mean(rs) < perTrade) reasons.push(`agregado ${pc(mean(rs))}`)
  if (Math.min(mean(first), mean(second)) < perTrade) reasons.push(`mitad floja ${pc(Math.min(mean(first), mean(second)))}`)
  if (mean(rs) - mean(control) < edge) reasons.push(`ventaja sobre azar ${pc(mean(rs) - mean(control))}`)
  if (!(without10 > 0)) reasons.push(`sin las 10 mejores ${pc(without10)}`)
  if (!(d.dsr >= DSR_LEVEL)) reasons.push(`DSR ${(d.dsr * 100).toFixed(0)} %`)
  const hit = rs.filter((x) => x > 0).length / rs.length
  console.log(
    `  ${label.padEnd(30)} n=${String(trades.length).padStart(5)}  neto ${pc(mean(rs)).padStart(8)}/op  acierto ${(hit * 100).toFixed(0)} %  mitades ${pc(mean(first))} / ${pc(mean(second))}  azar ${pc(mean(control))}  sin 10 mejores ${pc(without10)}  IC meses [${pc(lo)}, ${pc(hi)}]  mantiene ${mean(trades.map((t) => t.hold)).toFixed(1)} d  DSR ${(d.dsr * 100).toFixed(0)} %` +
      (reasons.length ? `\n      ✗ ${reasons.join(' · ')}` : '\n      ✓ pasa el listón'),
  )
}

if (MODE === 'rsi2') {
  const TRIALS = 3
  console.log(`RSI(2) AL RETROCESO EN SU MERCADO (cierre sobre la media de 200 días, RSI(2) bajo el umbral, sale sobre la media de 5 días o a los 10 días; 0,1 % ida y vuelta; ${TRIALS} umbrales contados)\n`)
  const GROUPS = [
    ['ETF de índices y sectores (20)', [...UNIVERSE.equityIndex, ...UNIVERSE.sectors], 1500],
    ['acciones que lista OKX (superv.)', UNIVERSE.okxStocks, 1800],
  ]
  for (const threshold of [10, 5, 15]) {
    console.log(`── umbral ${threshold}${threshold === 10 ? ' (el principal)' : ''}`)
    for (const [label, syms, minBars] of GROUPS) describePct(label, rsi2Trades(syms, threshold, minBars), TRIALS)
    console.log('')
  }
  // By decade: the literature says it faded after 2010.
  console.log('── umbral 10, por década (ETF de índices y sectores)')
  const t = rsi2Trades([...UNIVERSE.equityIndex, ...UNIVERSE.sectors], 10)
  for (const [from, to] of [[2000, 2009], [2010, 2019], [2020, 2026]]) {
    const x = t.filter((r) => yearOf(r.time) >= from && yearOf(r.time) <= to)
    console.log(`  ${from}–${to}  n=${String(x.length).padStart(5)}  neto ${pc(mean(x.map((r) => r.r)))}/op  acierto ${((x.filter((r) => r.r > 0).length / (x.length || 1)) * 100).toFixed(0)} %`)
  }
}

// ── M: turn of the month ─────────────────────────────────────────────────────────────────────────────────
if (MODE === 'tom') {
  console.log('CAMBIO DE MES: largo al cierre del penúltimo día hábil, fuera al cierre del tercer día hábil del mes siguiente (cuatro rentabilidades); 0,1 % ida y vuelta por mes\n')
  const monthly = new Map()
  const perEtf = []
  for (const sym of UNIVERSE.equityIndex) {
    const c = loadYahoo(sym)
    if (!c || c.length < 1500) continue
    const keys = c.map((x) => monthOf(x.time))
    const starts = new Map()
    const ends = new Map()
    for (let i = 0; i < c.length; i++) {
      if (!starts.has(keys[i])) starts.set(keys[i], i)
      ends.set(keys[i], i)
    }
    const inWindow = new Array(c.length).fill(false)
    const rows = []
    const months = [...starts.keys()]
    for (let m = 0; m < months.length - 1; m++) {
      const last = ends.get(months[m])
      const nextFirst = starts.get(months[m + 1])
      // Skip the first and the last (incomplete) month of the series.
      if (m === 0 || last < 1 || nextFirst + 2 >= c.length) continue
      const entry = last - 1
      const exit = nextFirst + 2
      rows.push({ month: months[m + 1], time: c[exit].time, r: c[exit].close / c[entry].close - 1 })
      for (let k = entry; k < exit; k++) inWindow[k] = true
    }
    // Every other four-day window.
    const others = []
    for (let i = 0; i + 4 < c.length; i++) if (!inWindow.slice(i, i + 4).some(Boolean)) others.push(c[i + 4].close / c[i].close - 1)
    const base = mean(others)
    perEtf.push({ sym, rows, base })
    for (const r of rows) {
      if (!monthly.has(r.month)) monthly.set(r.month, { time: r.time, rs: [] })
      monthly.get(r.month).rs.push(r.r - 0.001 - base)
    }
  }
  const show = (label, rows, base) => {
    const net = rows.map((r) => r.r - 0.001)
    const cut = median(rows.map((r) => r.time))
    const a = rows.filter((r) => r.time < cut).map((r) => r.r - 0.001)
    const b = rows.filter((r) => r.time >= cut).map((r) => r.r - 0.001)
    const ex = net.map((x) => x - base)
    const t = mean(ex) / (sd(ex) / Math.sqrt(ex.length))
    console.log(`  ${label.padEnd(8)} meses ${String(rows.length).padStart(4)}  neto ${pc(mean(net))}/mes  resto de ventanas de 4 días ${pc(base)}  exceso ${pc(mean(ex))}  t ${sg(t, 1)}  mitades ${pc(mean(a))} / ${pc(mean(b))}  acierto ${((net.filter((x) => x > 0).length / net.length) * 100).toFixed(0)} %`)
  }
  for (const e of perEtf) show(e.sym, e.rows, e.base)
  // One observation per month for the equal-weighted average of the ETFs available: the ETFs share the market, so pooling them would multiply n for nothing.
  const avg = [...monthly.entries()].sort().map(([month, v]) => ({ month, time: v.time, r: mean(v.rs) + 0 }))
  const ex = avg.map((r) => r.r)
  const cut = median(avg.map((r) => r.time))
  console.log(`\n  media de los ETF, una observación por mes: ${avg.length} meses, exceso neto sobre el resto de ventanas ${pc(mean(ex))}/mes, t ${sg(mean(ex) / (sd(ex) / Math.sqrt(ex.length)), 1)}, mitades ${pc(mean(avg.filter((r) => r.time < cut).map((r) => r.r)))} / ${pc(mean(avg.filter((r) => r.time >= cut).map((r) => r.r)))}`)
  for (const [from, to] of [[1995, 2004], [2005, 2014], [2015, 2026]]) {
    const x = avg.filter((r) => yearOf(r.time) >= from && yearOf(r.time) <= to)
    console.log(`  ${from}–${to}: ${x.length} meses, exceso neto ${pc(mean(x.map((r) => r.r)))}/mes`)
  }
}

// ── L: both legs of a leveraged pair, short ──────────────────────────────────────────────────────────────
const PAIRS = [
  ['SOXL', 'SOXS'], ['TQQQ', 'SQQQ'], ['UPRO', 'SPXU'], ['SPXL', 'SPXS'], ['TNA', 'TZA'], ['TECL', 'TECS'],
  ['FAS', 'FAZ'], ['LABU', 'LABD'], ['YINN', 'YANG'], ['ERX', 'ERY'], ['NUGT', 'DUST'], ['UCO', 'SCO'],
  ['BOIL', 'KOLD'], ['EDC', 'EDZ'], ['TMF', 'TMV'], ['UDOW', 'SDOW'], ['URTY', 'SRTY'], ['WEBL', 'WEBS'], ['JNUG', 'JDST'],
]
/** Per leg and per side: taker 0.05 %. A rebalance closes and reopens both legs: four fills of N against a gross of 2N. */
const LETF_FEE_PER_REBALANCE = (4 * 0.0005) / 2
/** Funding at the 0.01 % / 8 h baseline, per calendar day, on each leg's notional. */
const FUNDING_PER_DAY = 0.0003

function alignedPair(a, b) {
  const A = loadYahoo(a)
  const B = loadYahoo(b)
  if (!A || !B) return null
  const mb = new Map(B.map((x) => [x.time, x]))
  const rows = A.filter((x) => mb.has(x.time)).map((x) => ({ time: x.time, a: x.close, b: mb.get(x.time).close }))
  return rows.length > 500 ? rows : null
}

/**
 * One pair, one rebalance schedule. `keyOf` names the period of a date (a month, a week); the first trading day of each
 * period is the rebalance. Returns one result per period, on gross notional, for three funding scenarios.
 */
function pairPeriods(rows, keyOf, { stop = null } = {}) {
  const firsts = []
  let last = null
  for (let i = 0; i < rows.length; i++) {
    const k = keyOf(rows[i].time)
    if (k !== last) {
      firsts.push(i)
      last = k
    }
  }
  const out = []
  for (let p = 0; p < firsts.length - 1; p++) {
    const i0 = firsts[p]
    const i1 = firsts[p + 1]
    let exit = i1
    if (stop !== null) {
      // Marked every day since entry; out at the first close that has lost `stop` of gross.
      for (let j = i0 + 1; j <= i1; j++) {
        const pnl = -(rows[j].a / rows[i0].a - 1 + (rows[j].b / rows[i0].b - 1)) / 2
        if (pnl <= -stop) {
          exit = j
          break
        }
      }
    }
    const pnl = -(rows[exit].a / rows[i0].a - 1 + (rows[exit].b / rows[i0].b - 1)) / 2
    const days = (rows[exit].time - rows[i0].time) / DAY
    // Held to the end of the period, an early exit still pays funding only while it was open.
    const fund = FUNDING_PER_DAY * days
    out.push({
      time: rows[i0].time,
      none: pnl - LETF_FEE_PER_REBALANCE,
      pay: pnl - LETF_FEE_PER_REBALANCE - fund,
      receive: pnl - LETF_FEE_PER_REBALANCE + fund,
      stopped: exit !== i1,
    })
  }
  return out
}

const weekOf = (ms) => {
  const d = new Date(ms)
  // ISO-ish: Monday of the week, as a date string.
  const day = (d.getUTCDay() + 6) % 7
  return new Date(ms - day * DAY).toISOString().slice(0, 10)
}

function drawdown(series) {
  let peak = 0
  let cum = 0
  let worst = 0
  for (const x of series) {
    cum += x
    peak = Math.max(peak, cum)
    worst = Math.min(worst, cum - peak)
  }
  return worst
}

function reportLetf(label, keyOf, opts, trials, periodsPerYear) {
  console.log(`\n── ${label}`)
  console.log(`   ${'par'.padEnd(11)} ${'periodos'.padStart(8)} ${'sin fin.'.padStart(9)} ${'PAGANDO'.padStart(9)} ${'cobrando'.padStart(9)} ${'DT'.padStart(7)} ${'peor'.padStart(8)} ${'caída'.padStart(8)} ${'>0'.padStart(5)}`)
  const pooled = new Map()
  const perPair = []
  for (const [bull, bear] of PAIRS) {
    const rows = alignedPair(bull, bear)
    if (!rows) continue
    const res = pairPeriods(rows, keyOf, opts)
    const pay = res.map((r) => r.pay)
    perPair.push({ name: `${bull}/${bear}`, res })
    console.log(
      `   ${(bull + '/' + bear).padEnd(11)} ${String(res.length).padStart(8)} ${pc(mean(res.map((r) => r.none))).padStart(9)} ${pc(mean(pay)).padStart(9)} ${pc(mean(res.map((r) => r.receive))).padStart(9)} ${pc(sd(pay), 1).padStart(7)} ${pc(Math.min(...pay), 1).padStart(8)} ${pc(drawdown(pay), 0).padStart(8)} ${((pay.filter((x) => x > 0).length / pay.length) * 100).toFixed(0).padStart(4)}%`,
    )
    for (const r of res) {
      const k = r.time
      if (!pooled.has(k)) pooled.set(k, [])
      pooled.get(k).push(r)
    }
  }
  const dates = [...pooled.keys()].sort((a, b) => a - b)
  const series = dates.map((t) => ({ time: t, r: mean(pooled.get(t).map((x) => x.pay)), none: mean(pooled.get(t).map((x) => x.none)), n: pooled.get(t).length }))
  const r = series.map((x) => x.r)
  const cut = median(dates)
  const all = [...pooled.values()].flat().map((x) => x.pay)
  const sortedAll = [...all].sort((a, b) => a - b)
  const [lo, hi] = monthBootstrap(series.map((x) => ({ ...x })), (x) => x.r, (x) => monthOf(x.time))
  const positivePairs = perPair.filter((p) => mean(p.res.map((x) => x.pay)) > 0).length
  const d = deflate(r, trials)
  console.log(`   conjunto (media de los pares disponibles cada periodo): ${series.length} periodos`)
  console.log(`     sin financiación ${pc(mean(series.map((x) => x.none)))}/periodo · PAGANDO financiación ${pc(mean(r))}/periodo (≈ ${pc(mean(r) * periodsPerYear, 0)} al año sobre el nominal bruto) · DT ${pc(sd(r), 1)} · Sharpe anual ${sg((mean(r) / sd(r)) * Math.sqrt(periodsPerYear), 2)}`)
  console.log(`     mitades ${pc(mean(r.filter((_, i) => dates[i] < cut)))} / ${pc(mean(r.filter((_, i) => dates[i] >= cut)))} · IC por meses [${pc(lo)}, ${pc(hi)}] · pares positivos ${positivePairs} de ${perPair.length} · DSR ${(d.dsr * 100).toFixed(0)} %`)
  console.log(`     el 1 % peor de todos los periodos-par: ${pc(sortedAll[Math.floor(sortedAll.length * 0.01)], 1)} · el peor: ${pc(sortedAll[0], 1)} · periodos-par por debajo de −20 %: ${sortedAll.filter((x) => x < -0.2).length} de ${sortedAll.length} · caída máxima de la serie conjunta ${pc(drawdown(r), 0)}`)
  const stopped = [...pooled.values()].flat().filter((x) => x.stopped).length
  if (opts.stop) console.log(`     parados por el stop: ${stopped} de ${sortedAll.length} periodos-par`)
  const verdict = []
  if (mean(r) < 0.003 * (periodsPerYear === 12 ? 1 : 12 / periodsPerYear)) verdict.push('media bajo +0,30 % al mes pagando financiación')
  if (Math.min(mean(r.filter((_, i) => dates[i] < cut)), mean(r.filter((_, i) => dates[i] >= cut))) <= 0) verdict.push('una mitad no es positiva')
  if (positivePairs / perPair.length < 0.6) verdict.push('menos del 60 % de los pares positivos')
  if (sortedAll[Math.floor(sortedAll.length * 0.01)] < -0.3) verdict.push('el 1 % peor pasa de −30 % del nominal')
  if (!(lo > 0)) verdict.push('el intervalo baja de cero')
  console.log(verdict.length ? `     ✗ ${verdict.join(' · ')}` : '     ✓ pasa el listón')
  return { perPair, series }
}

if (MODE === 'letf') {
  const TRIALS = 3
  console.log(`LAS DOS PATAS DE UN PAR APALANCADO, EN CORTO (partes iguales en dólares; resultado sobre el nominal bruto; comisión taker 0,05 % por lado y pata; ${TRIALS} variantes contadas)`)
  console.log('«PAGANDO»: el corto abona 0,01 % cada 8 h por pata (11 % al año), el escenario con el que se juzga.')
  reportLetf('A · rebalanceo mensual (el principal)', monthOf, {}, TRIALS, 12)
  reportLetf('B · rebalanceo semanal', weekOf, {}, TRIALS, 52)
  reportLetf('C · mensual con stop: fuera al perder el 10 % del nominal bruto', monthOf, { stop: 0.1 }, TRIALS, 12)
}

// ── D: buying a crash, dead coins included ───────────────────────────────────────────────────────────────
const STABLE = /^(USDC|TUSD|FDUSD|BUSD|USDP|DAI|AEUR|EUR|EURI|USDS|USD1|PYUSD|XUSD|UST|USTC|USDD|GUSD|SUSD|LUSD|FRAX|USDE|RLUSD|BFUSD)$/
const WRAPPED = /^(WBTC|WBETH|BETH|RENBTC|BTCB|PAXG|XAUT|WBNB|STETH|CBBTC)$/

function loadBinance() {
  const DIR = './.research/binance-1d'
  if (!existsSync(DIR)) {
    console.log('Falta ./.research/binance-1d: node scripts/fetch-binance-daily.mjs')
    process.exit(1)
  }
  const coins = []
  const add = (name, rows) => {
    if (rows.length < 100) return
    const days = new Map(rows.map((r, i) => [Math.round(r[0] / DAY), i]))
    const close = rows.map((r) => r[4])
    const qv30 = new Array(rows.length).fill(0)
    let acc = 0
    for (let i = 0; i < rows.length; i++) {
      acc += rows[i][6]
      if (i >= 30) acc -= rows[i - 30][6]
      qv30[i] = i >= 29 ? acc / 30 : 0
    }
    coins.push({ name, days, close, open: rows.map((r) => r[1]), high: rows.map((r) => r[2]), qv30, last: Math.round(rows[rows.length - 1][0] / DAY), n: rows.length })
  }
  for (const file of readdirSync(DIR)) {
    const name = file.replace('.json', '')
    if (WRAPPED.test(name) || STABLE.test(name)) continue
    const rows = JSON.parse(readFileSync(`${DIR}/${file}`, 'utf8'))
    // A hole of more than two days is a suspension, a migration or a ticker reused for another asset: LUNA's file runs
    // from Terra's collapse (0.0001 $) into Terra 2.0 (18 $) after an 18-day gap, a +17 739 900 % "day". Each stretch is
    // its own coin, so the old one ends at its last price instead of being spliced onto a different asset (found
    // 2026-10-16: the short side of `dumps` came back at −14 703 % until the series were cut).
    let from = 0
    let k = 0
    for (let i = 1; i <= rows.length; i++) {
      if (i === rows.length || rows[i][0] - rows[i - 1][0] > 2 * DAY) {
        add(k === 0 ? name : `${name}#${k}`, rows.slice(from, i))
        from = i
        k++
      }
    }
  }
  return coins
}

if (MODE === 'dumps') {
  const coins = loadBinance()
  const lastDay = Math.max(...coins.map((c) => c.last))
  const firstDay = Math.round(Date.UTC(2018, 0, 1) / DAY)
  const btc = coins.find((c) => c.name === 'BTC')
  const dead = (c) => c.last < lastDay - 30
  console.log(`${coins.length} pares sin estables ni envueltos, ${coins.filter(dead).length} dejaron de cotizar · del ${new Date(firstDay * DAY).toISOString().slice(0, 10)} al ${new Date(lastDay * DAY).toISOString().slice(0, 10)}`)
  const COST = 0.004

  /** One observation per day that had at least one dump in the band of the 30 most traded pairs. */
  function dumpDays({ threshold, hold, lag }) {
    const out = []
    for (let d = firstDay; d + lag + hold + 1 <= lastDay; d++) {
      const rows = []
      for (const c of coins) {
        const i = c.days.get(d)
        const j = c.days.get(d - 1)
        if (i === undefined || j === undefined || i < 90 || !(c.qv30[i] > 0)) continue
        const e = c.days.get(d + lag)
        if (e === undefined) continue
        const x = c.days.get(d + lag + hold)
        const exit = x !== undefined ? c.close[x] : c.last < d + lag + hold ? c.close[c.n - 1] : undefined
        if (exit === undefined) continue
        rows.push({ c, qv: c.qv30[i], r1: c.close[i] / c.close[j] - 1, fwd: exit / c.close[e] - 1 })
      }
      rows.sort((a, b) => b.qv - a.qv)
      const band = rows.slice(0, 30)
      if (band.length < 20) continue
      const dumps = band.filter((x) => x.r1 <= threshold)
      if (!dumps.length) continue
      const all = mean(band.map((x) => x.fwd))
      const bi = btc.days.get(d)
      const bj = btc.days.get(d - 1)
      out.push({
        time: d * DAY,
        abs: mean(dumps.map((x) => x.fwd)),
        ex: mean(dumps.map((x) => x.fwd)) - all,
        n: dumps.length,
        btc: bi !== undefined && bj !== undefined ? btc.close[bi] / btc.close[bj] - 1 : NaN,
        deadShare: dumps.filter((x) => dead(x.c)).length / dumps.length,
      })
    }
    return out
  }

  const TRIALS = 12
  const row = (label, days) => {
    if (days.length < 8) return console.log(`  ${label.padEnd(34)} (solo ${days.length} días con caídas)`)
    const ex = days.map((x) => x.ex)
    const cut = median(days.map((x) => x.time))
    const sorted = [...ex].sort((a, b) => b - a)
    const t = mean(ex) / (sd(ex) / Math.sqrt(ex.length))
    console.log(
      `  ${label.padEnd(34)} días ${String(days.length).padStart(4)} (${mean(days.map((x) => x.n)).toFixed(1)} caídas/día)  exceso ${pc(mean(ex)).padStart(8)}  t ${sg(t, 1).padStart(5)}  días+ ${((ex.filter((x) => x > 0).length / ex.length) * 100).toFixed(0)}%  neto ${pc(mean(ex) - COST).padStart(8)}  absoluto ${pc(mean(days.map((x) => x.abs))).padStart(8)}  mitades ${pc(mean(ex.filter((_, i) => days[i].time < cut)), 1)} / ${pc(mean(ex.filter((_, i) => days[i].time >= cut)), 1)}  sin 10 mejores ${pc(mean(sorted.slice(10)))}`,
    )
    return { days, t, net: mean(ex) - COST }
  }

  console.log(`\nCOMPRAR UNA CAÍDA (el cierre a −12 % o −20 % o peor, entre las 30 más negociadas; exceso sobre la media de esas 30 los mismos días; coste ${(COST * 100).toFixed(1)} %; ${TRIALS} variantes contadas)`)
  const results = {}
  for (const lag of [1, 0]) {
    console.log(`\n── entrando ${lag === 1 ? 'al cierre del día siguiente (lo realista)' : 'al cierre del propio día de la caída'}`)
    for (const threshold of [-0.12, -0.2]) {
      for (const hold of [1, 3, 7]) {
        const days = dumpDays({ threshold, hold, lag })
        results[`${lag}|${threshold}|${hold}`] = days
        row(`${(threshold * 100).toFixed(0)} %, ${hold} d`, days)
      }
    }
  }
  const primary = results['1|-0.12|3']
  console.log('\n── el principal (−12 %, entrada al día siguiente, 3 días), cortado')
  row('caída propia (BTC ≥ −2 %)', primary.filter((x) => x.btc >= -0.02))
  row('de todo el mercado (BTC ≤ −5 %)', primary.filter((x) => x.btc <= -0.05))
  row('BTC entre −5 % y −2 %', primary.filter((x) => x.btc < -0.02 && x.btc > -0.05))
  const years = [...new Set(primary.map((x) => yearOf(x.time)))].sort()
  for (const y of years) row(`año ${y}`, primary.filter((x) => yearOf(x.time) === y))
  console.log(`  parte de las caídas que acabaron en un par muerto: ${pc(mean(primary.map((x) => x.deadShare)), 1)}`)
}

// Where does the crash-continuation come from? (diagnostic of `dumps`, read before any rule is written for the short side)
if (MODE === 'dumps-who') {
  const coins = loadBinance()
  const lastDay = Math.max(...coins.map((c) => c.last))
  const firstDay = Math.round(Date.UTC(2018, 0, 1) / DAY)
  const dead = (c) => c.last < lastDay - 30
  const events = []
  for (let d = firstDay; d + 5 <= lastDay; d++) {
    const rows = []
    for (const c of coins) {
      const i = c.days.get(d)
      const j = c.days.get(d - 1)
      if (i === undefined || j === undefined || i < 90 || !(c.qv30[i] > 0)) continue
      const e = c.days.get(d + 1)
      if (e === undefined) continue
      const x = c.days.get(d + 4)
      const exit = x !== undefined ? c.close[x] : c.last < d + 4 ? c.close[c.n - 1] : undefined
      if (exit === undefined) continue
      rows.push({ c, qv: c.qv30[i], r1: c.close[i] / c.close[j] - 1, fwd: exit / c.close[e] - 1 })
    }
    rows.sort((a, b) => b.qv - a.qv)
    const band = rows.slice(0, 30)
    if (band.length < 20) continue
    const all = mean(band.map((x) => x.fwd))
    for (const x of band) if (x.r1 <= -0.2) events.push({ date: new Date(d * DAY).toISOString().slice(0, 10), coin: x.c.name, r1: x.r1, fwd: x.fwd, ex: x.fwd - all, dead: dead(x.c), day: d })
  }
  console.log(`${events.length} caídas de −20 % o peor (cada moneda y día), 3 días después de entrar al día siguiente`)
  const byYear = new Map()
  for (const e of events) {
    const y = e.date.slice(0, 4)
    if (!byYear.has(y)) byYear.set(y, [])
    byYear.get(y).push(e)
  }
  for (const [y, es] of [...byYear].sort()) console.log(`  ${y}  ${String(es.length).padStart(3)} caídas  exceso medio ${pc(mean(es.map((e) => e.ex)))}  mediana ${pc(median(es.map((e) => e.ex)))}  mueren después ${es.filter((e) => e.dead).length}`)
  const sorted = [...events].sort((a, b) => a.ex - b.ex)
  console.log('  las 12 peores (exceso):', sorted.slice(0, 12).map((e) => `${e.coin} ${e.date} ${pc(e.ex, 0)}`).join(' · '))
  console.log('  las 6 mejores (exceso):', sorted.slice(-6).map((e) => `${e.coin} ${e.date} ${pc(e.ex, 0)}`).join(' · '))
  const alive = events.filter((e) => !e.dead)
  const dying = events.filter((e) => e.dead)
  console.log(`  pares que seguían vivos 30 días después del final de los datos: n=${alive.length}  exceso medio ${pc(mean(alive.map((e) => e.ex)))}  mediana ${pc(median(alive.map((e) => e.ex)))}`)
  console.log(`  pares que acabaron muertos: n=${dying.length}  exceso medio ${pc(mean(dying.map((e) => e.ex)))}  mediana ${pc(median(dying.map((e) => e.ex)))}`)
  console.log(`  todas: exceso medio ${pc(mean(events.map((e) => e.ex)))}  mediana ${pc(median(events.map((e) => e.ex)))}  ${((events.filter((e) => e.ex < 0).length / events.length) * 100).toFixed(0)} % negativas`)
  const trimmed = [...events].sort((a, b) => a.ex - b.ex).slice(Math.floor(events.length * 0.05), Math.ceil(events.length * 0.95))
  console.log(`  recortando el 5 % de cada cola: ${pc(mean(trimmed.map((e) => e.ex)))}`)
  // Episodes: days with several dumps at once are one event of the market, not several.
  const perDay = new Map()
  for (const e of events) perDay.set(e.day, (perDay.get(e.day) ?? 0) + 1)
  const multi = [...perDay.values()].filter((n) => n >= 4).length
  console.log(`  días distintos con alguna caída: ${perDay.size}; con 4 o más a la vez: ${multi}`)
}

// ── D2: SHORT after the crash (written 2026-10-16 after `dumps` and `dumps-who`, BEFORE its first number) ──
// The long side lost, and lost more the deeper the crash: −2.4 % a coin over the next three days against the
// band at −20 %, negative in all eight years, in live pairs (−1.8 %) as in dead ones (−4.4 %). That is a
// reading of a table, so the short side is a new idea with its own rules and four counted trials (the
// threshold −20 / −12 % × the hold 3 / 7 days) on top of the twelve already spent on the data:
//   · event: a close-to-close return at or below the threshold, among the 30 pairs with the most 30-day dollar
//     volume (the same band; liquid enough to have a perpetual);
//   · SHORT at the close of the next day; out at the close `hold` days later, or at a stop 10 % above the entry
//     checked on each later day's HIGH (a gap through it fills at the open) — the squeeze after a crash is the
//     risk of this trade and the data shows a +110 % one;
//   · cost 0.1 % round trip + 0.3 % slippage + funding paid by the short at 0.05 % / 8 h (0.15 % a day: after a
//     crash funding is usually negative, so shorts pay), 0.85 % for three days and 1.45 % for seven;
//   · a pair that stops trading closes at its last price;
//   · control: the same short, same rules, on the same day's other pairs of the band (the universe falls over
//     time, so shorting anything may pay) — the signal has to beat that, not zero;
//   · unit: the day (events averaged within it); bar: ≥ +1.0 % net AND ≥ +1.0 % over the band, both halves
//     positive, a day-clustered t ≥ 2.5, positive without the ten best days for the short (the ten largest
//     gains out), and no year holding more than half of the total.
if (MODE === 'dumps-short') {
  const coins = loadBinance()
  const lastDay = Math.max(...coins.map((c) => c.last))
  const firstDay = Math.round(Date.UTC(2018, 0, 1) / DAY)
  const STOP = 0.1
  const FIXED = 0.004
  const FUNDING_DAY = 0.0015

  /** The short taken at the close of the day `e` (an index into the coin's rows) and held up to `hold` days. */
  function shortReturn(c, e, hold, stopOn = true) {
    const entry = c.close[e]
    const stop = entry * (1 + STOP)
    for (let k = 1; k <= hold; k++) {
      const i = e + k
      if (i >= c.n) return { r: -(c.close[c.n - 1] / entry - 1), days: k - 1, stopped: false }
      if (stopOn && c.open[i] >= stop) return { r: -(c.open[i] / entry - 1), days: k, stopped: true }
      if (stopOn && c.high[i] >= stop) return { r: -STOP, days: k, stopped: true }
      if (k === hold) return { r: -(c.close[i] / entry - 1), days: hold, stopped: false }
    }
  }

  function shortDays({ threshold, hold, stopOn = true }) {
    const out = []
    for (let d = firstDay; d + 2 + hold <= lastDay; d++) {
      const rows = []
      for (const c of coins) {
        const i = c.days.get(d)
        const j = c.days.get(d - 1)
        if (i === undefined || j === undefined || i < 90 || !(c.qv30[i] > 0)) continue
        const e = c.days.get(d + 1)
        if (e === undefined) continue
        const t = shortReturn(c, e, hold, stopOn)
        rows.push({ c, qv: c.qv30[i], r1: c.close[i] / c.close[j] - 1, ...t, cost: FIXED + FUNDING_DAY * t.days })
      }
      rows.sort((a, b) => b.qv - a.qv)
      const band = rows.slice(0, 30)
      if (band.length < 20) continue
      const dumps = band.filter((x) => x.r1 <= threshold)
      if (!dumps.length) continue
      const rest = band.filter((x) => x.r1 > threshold)
      const net = (xs) => mean(xs.map((x) => x.r - x.cost))
      const bi = btc.days.get(d)
      const bj = btc.days.get(d - 1)
      out.push({
        time: d * DAY,
        net: net(dumps),
        band: net(rest),
        ex: net(dumps) - net(rest),
        n: dumps.length,
        stopped: dumps.filter((x) => x.stopped).length / dumps.length,
        btc: bi !== undefined && bj !== undefined ? btc.close[bi] / btc.close[bj] - 1 : NaN,
        hits: dumps.filter((x) => x.r - x.cost > 0).length / dumps.length,
      })
    }
    return out
  }
  const btc = coins.find((c) => c.name === 'BTC')
  const TRIALS = 16
  function report(label, days) {
    if (days.length < 8) return console.log(`  ${label.padEnd(30)} (solo ${days.length} días)`)
    const net = days.map((x) => x.net)
    const ex = days.map((x) => x.ex)
    const cut = median(days.map((x) => x.time))
    const sortedGain = [...net].sort((a, b) => b - a)
    const t = mean(net) / (sd(net) / Math.sqrt(net.length))
    const tEx = mean(ex) / (sd(ex) / Math.sqrt(ex.length))
    const d = deflate(net, TRIALS)
    const total = {}
    for (const x of days) total[yearOf(x.time)] = (total[yearOf(x.time)] ?? 0) + x.net
    const sum = Object.values(total).reduce((a, b) => a + b, 0)
    const topYear = Math.max(...Object.values(total)) / sum
    const reasons = []
    if (mean(net) < 0.01) reasons.push(`neto ${pc(mean(net))}`)
    if (mean(ex) < 0.01) reasons.push(`sobre la banda ${pc(mean(ex))}`)
    const h1 = mean(net.filter((_, i) => days[i].time < cut))
    const h2 = mean(net.filter((_, i) => days[i].time >= cut))
    if (Math.min(h1, h2) <= 0) reasons.push('una mitad no es positiva')
    if (!(t >= 2.5)) reasons.push(`t ${sg(t, 1)}`)
    if (!(mean(sortedGain.slice(10)) > 0)) reasons.push(`sin 10 mejores ${pc(mean(sortedGain.slice(10)))}`)
    if (sum > 0 && topYear > 0.5) reasons.push(`un año tiene el ${(topYear * 100).toFixed(0)} %`)
    if (!(d.dsr >= DSR_LEVEL)) reasons.push(`DSR ${(d.dsr * 100).toFixed(0)} %`)
    console.log(
      `  ${label.padEnd(30)} días ${String(days.length).padStart(4)} (${mean(days.map((x) => x.n)).toFixed(1)}/día)  NETO ${pc(mean(net)).padStart(8)}  banda ${pc(mean(days.map((x) => x.band))).padStart(8)}  sobre la banda ${pc(mean(ex)).padStart(8)} (t ${sg(tEx, 1)})  t ${sg(t, 1)}  acierto ${(mean(days.map((x) => x.hits)) * 100).toFixed(0)} %  paradas ${(mean(days.map((x) => x.stopped)) * 100).toFixed(0)} %  mitades ${pc(h1, 1)} / ${pc(h2, 1)}  sin 10 mejores ${pc(mean(sortedGain.slice(10)))}  DSR ${(d.dsr * 100).toFixed(0)} %` +
        (reasons.length ? `\n      ✗ ${reasons.join(' · ')}` : '\n      ✓ pasa el listón'),
    )
    return { days, total }
  }
  console.log('VENDER EN CORTO TRAS LA CAÍDA (entrada al cierre del día siguiente, stop +10 % sobre máximos diarios, coste 0,4 % + financiación 0,15 %/día; 16 pruebas contadas)\n')
  const keep = {}
  for (const threshold of [-0.2, -0.12]) {
    for (const hold of [3, 7]) {
      keep[`${threshold}|${hold}`] = report(`${(threshold * 100).toFixed(0)} %, ${hold} d`, shortDays({ threshold, hold }))
    }
  }
  console.log('\n── el principal (−20 %, 3 días) sin stop, para ver lo que el stop cuesta o ahorra')
  report('−20 %, 3 d, sin stop', shortDays({ threshold: -0.2, hold: 3, stopOn: false }))
  const k = keep['-0.2|3']
  console.log('\n── el principal, por año y por régimen de BTC')
  for (const y of [...new Set(k.days.map((x) => yearOf(x.time)))].sort()) report(`año ${y}`, k.days.filter((x) => yearOf(x.time) === y))
  report('caída propia (BTC ≥ −2 %)', k.days.filter((x) => x.btc >= -0.02))
  report('de todo el mercado (BTC ≤ −5 %)', k.days.filter((x) => x.btc <= -0.05))
}

// Diagnostic of `trend-long`: is the long edge still there in the last years? (read after the first runs, not a trial)
if (MODE === 'trend-years') {
  const wide = [...UNIVERSE.commodityOkx, ...UNIVERSE.commodityOther, ...UNIVERSE.equityIndex, ...UNIVERSE.sectors, ...UNIVERSE.bonds, ...UNIVERSE.fx, ...UNIVERSE.reit]
  const donchian = TREND_STRATEGIES[0][1]
  const longs = tradesOf(wide, donchian).filter((t) => t.side === 'long')
  const randLong = (ts) => mean(randomControl(ts, true))
  console.log(`CANAL 20 + EMA 200, SOLO LARGOS, ETF diversificados + 4 materias primas: año a año (n entradas, neto, azar del mismo lado)\n`)
  const years = [...new Set(longs.map((t) => yearOf(t.time)))].sort()
  for (const y of years) {
    const t = longs.filter((x) => yearOf(x.time) === y)
    if (t.length < 10) continue
    console.log(`  ${y}  n=${String(t.length).padStart(3)}  neto ${sg(mean(t.map((x) => x.r))).padStart(6)} R  azar ${sg(randLong(t)).padStart(6)}  acierto ${((t.filter((x) => x.r > 0).length / t.length) * 100).toFixed(0)} %`)
  }
  for (const [label, from, to] of [['2000–2009', 2000, 2009], ['2010–2016', 2010, 2016], ['2017–2021', 2017, 2021], ['2022–2026', 2022, 2026], ['2024–2026', 2024, 2026]]) {
    const t = longs.filter((x) => yearOf(x.time) >= from && yearOf(x.time) <= to)
    const [lo, hi] = monthBootstrap(t)
    const s = [...t.map((x) => x.r)].sort((a, b) => b - a)
    console.log(`  ${label}  n=${String(t.length).padStart(4)}  neto ${sg(mean(t.map((x) => x.r)))} R  azar ${sg(randLong(t))}  IC meses [${sg(lo)}, ${sg(hi)}]  sin 10 mejores ${sg(mean(s.slice(10)))}`)
  }
  // Which names carry the recent years?
  const recent = longs.filter((x) => yearOf(x.time) >= 2022)
  const by = new Map()
  for (const t of recent) {
    if (!by.has(t.sym)) by.set(t.sym, [])
    by.get(t.sym).push(t.r)
  }
  const rank = [...by.entries()].map(([sym, rs]) => [sym, mean(rs), rs.length]).sort((a, b) => b[1] - a[1])
  console.log('\n  2022–2026, por ETF (neto, n): ' + rank.map(([s, m, n]) => `${s} ${sg(m, 1)} (${n})`).join(' · '))
  console.log(`  ETF con neto > 0 en 2022–2026: ${rank.filter((r) => r[1] > 0).length} de ${rank.length}`)
}

// ── G: what a grid bot earns ─────────────────────────────────────────────────────────────────────────────
// Bar, written before the first number: the real path must beat the control (the same coin's own days
// shuffled and mirrored, which keeps volatility and removes drift and trend) by at least +1.0 % of capital per
// 30-day window, with a month-bootstrap interval above zero, in both halves, under BOTH ways of ordering a bar's
// high and low (an hourly candle does not say which came first) — and the real mean has to be positive after
// fees. On a driftless random walk a grid's expectation is exactly minus its fees; anything above that is
// mean reversion at the grid's scale, and anything below it is the drift of the inventory it holds.
function gridWindow(bars, s, { range = 0.15, cells = 30, maker = 0.0002, taker = 0.0005, horizon = 720, prudent = false } = {}) {
  const P0 = bars[s].close
  const lo = P0 * (1 - range)
  const step = (P0 * 2 * range) / cells
  const per = 1 / cells
  const held = new Array(cells).fill(false)
  const qty = new Array(cells).fill(0)
  let cash = 1
  let cycles = 0
  let fees = 0
  for (let k = 0; k < cells; k++) {
    // Cells entirely above the start price are bought at once, at market, to be sold on their way up.
    if (lo + step * k >= P0) {
      held[k] = true
      qty[k] = per / P0
      cash -= per * (1 + taker)
      fees += per * taker
    }
  }
  const touched = new Array(cells).fill(false)
  const down = (pa, pb) => {
    const kmax = Math.min(cells - 1, Math.floor((pa - lo) / step))
    const kmin = Math.max(0, Math.ceil((pb - lo) / step))
    for (let k = kmax; k >= kmin; k--) {
      if (held[k] || (prudent && touched[k])) continue
      held[k] = true
      touched[k] = true
      qty[k] = per / (lo + step * k)
      cash -= per * (1 + maker)
      fees += per * maker
    }
  }
  const up = (pa, pb) => {
    const jmin = Math.max(1, Math.ceil((pa - lo) / step))
    const jmax = Math.min(cells, Math.floor((pb - lo) / step))
    for (let j = jmin; j <= jmax; j++) {
      const k = j - 1
      if (!held[k] || (prudent && touched[k])) continue
      held[k] = false
      touched[k] = true
      const proceeds = qty[k] * (lo + step * j)
      cash += proceeds * (1 - maker)
      fees += proceeds * maker
      cycles++
    }
  }
  const move = (a, b) => (b < a ? down(a, b) : b > a ? up(a, b) : undefined)
  let p = P0
  let end = Math.min(bars.length - 1, s + horizon)
  let why = 'tiempo'
  for (let i = s + 1; i <= end; i++) {
    const b = bars[i]
    if (prudent) touched.fill(false)
    const path = b.close >= b.open ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close]
    for (const x of path) {
      move(p, x)
      p = x
    }
    if (b.close < lo || b.close > lo + step * cells) {
      end = i
      why = b.close < lo ? 'rompe abajo' : 'rompe arriba'
      break
    }
  }
  const pEnd = bars[end].close
  let inventory = 0
  for (let k = 0; k < cells; k++) if (held[k]) inventory += qty[k] * pEnd
  // The inventory still held is valued at the end price less the taker fee to close it.
  const equity = cash + inventory * (1 - taker)
  return { pnl: equity - 1, cycles, fees, why, end, time: bars[s].time, bars: end - s }
}

/** A path of whole days drawn from the coin's own history, each day mirrored at random: volatility kept, drift and trend gone. */
function syntheticBars(pool, days) {
  const out = [{ time: 0, open: 1, high: 1, low: 1, close: 1 }]
  let S = 1
  for (let d = 0; d < days; d++) {
    const block = pool[Math.floor(rnd() * pool.length)]
    const flip = rnd() < 0.5
    for (const r of block) {
      const o = flip ? S / r[0] : S * r[0]
      const h = flip ? S / r[2] : S * r[1]
      const l = flip ? S / r[1] : S * r[2]
      const c = flip ? S / r[3] : S * r[3]
      out.push({ time: 0, open: o, high: h, low: l, close: c })
      S = c
    }
  }
  return out
}

if (MODE === 'grid') {
  const DIR = './.candles-board-1H'
  const START_EVERY = 15 * 24
  const CONTROLS = 3
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  const btc = JSON.parse(readFileSync(`${DIR}/BTC.json`, 'utf8')).filter((c) => c.confirmed !== false)
  const btcAt = new Map(btc.map((c, i) => [c.time, i]))
  const results = { optimista: [], prudente: [] }
  const control = { optimista: [], prudente: [] }
  for (const f of files) {
    const coin = f.replace('.json', '')
    const bars = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')).filter((c) => c.confirmed !== false)
    if (bars.length < 24 * 90) continue
    // The pool of full days: ratios of each hour to the previous close.
    const pool = []
    for (let i = 1; i + 24 <= bars.length; i++) {
      // A full UTC day: it starts at 00:00 and its 24 candles are contiguous with the one before.
      if (new Date(bars[i].time).getUTCHours() !== 0) continue
      const block = []
      let ok = true
      for (let j = i; j < i + 24; j++) {
        const prev = bars[j - 1].close
        if (bars[j].time - bars[j - 1].time !== 3_600_000) ok = false
        block.push([bars[j].open / prev, bars[j].high / prev, bars[j].low / prev, bars[j].close / prev])
      }
      if (ok) pool.push(block)
      i += 23
    }
    if (pool.length < 60) continue
    for (let s = 24 * 5; s + 24 * 10 < bars.length; s += START_EVERY) {
      const bi = btcAt.get(bars[s].time)
      const btc30 = bi !== undefined && bi + 720 < btc.length ? btc[bi + 720].close / btc[bi].close - 1 : NaN
      for (const mode of ['optimista', 'prudente']) {
        const r = gridWindow(bars, s, { prudent: mode === 'prudente' })
        results[mode].push({ ...r, coin, btc30, time: bars[s].time })
      }
      for (let k = 0; k < CONTROLS; k++) {
        const syn = syntheticBars(pool, 30)
        for (const mode of ['optimista', 'prudente']) {
          const r = gridWindow(syn, 0, { prudent: mode === 'prudente' })
          control[mode].push({ ...r, coin, time: bars[s].time })
        }
      }
    }
  }
  const stat = (xs) => {
    const p = xs.map((x) => x.pnl)
    const sorted = [...p].sort((a, b) => a - b)
    return `n=${String(p.length).padStart(5)}  media ${pc(mean(p)).padStart(8)}  mediana ${pc(median(p)).padStart(8)}  >0 ${((p.filter((x) => x > 0).length / p.length) * 100).toFixed(0)} %  p5 ${pc(sorted[Math.floor(p.length * 0.05)], 1)}  peor ${pc(sorted[0], 1)}  ciclos ${mean(xs.map((x) => x.cycles)).toFixed(1)}  comisiones ${pc(mean(xs.map((x) => x.fees)))}  rompe abajo ${((xs.filter((x) => x.why === 'rompe abajo').length / xs.length) * 100).toFixed(0)} % / arriba ${((xs.filter((x) => x.why === 'rompe arriba').length / xs.length) * 100).toFixed(0)} %`
  }
  console.log(`REJILLA LARGA DE 30 CELDAS A ±15 %, VENTANAS DE 30 DÍAS (como mucho; termina si el precio cierra fuera), capital repartido a partes iguales, maker 0,02 % por ejecución\n`)
  for (const mode of ['optimista', 'prudente']) {
    console.log(`── recorrido de cada vela: ${mode === 'optimista' ? 'optimista (baja al mínimo y sube al máximo en velas alcistas, y al revés)' : 'prudente (una celda ejecuta como mucho una vez por vela)'}`)
    console.log(`   real      ${stat(results[mode])}`)
    console.log(`   control   ${stat(control[mode])}`)
    const real = results[mode]
    const cut = median(real.map((x) => x.time))
    const diffByHalf = (pred) => mean(real.filter(pred).map((x) => x.pnl)) - mean(control[mode].filter((x) => pred(x)).map((x) => x.pnl))
    const [lo, hi] = (() => {
      // month-block bootstrap of the difference of means
      const months = [...new Set([...real, ...control[mode]].map((x) => monthOf(x.time)))]
      const draws = []
      const byR = new Map(months.map((m) => [m, []]))
      const byC = new Map(months.map((m) => [m, []]))
      real.forEach((x) => byR.get(monthOf(x.time)).push(x.pnl))
      control[mode].forEach((x) => byC.get(monthOf(x.time)).push(x.pnl))
      for (let i = 0; i < 1000; i++) {
        const a = []
        const b = []
        for (let k = 0; k < months.length; k++) {
          const m = months[Math.floor(rnd() * months.length)]
          a.push(...byR.get(m))
          b.push(...byC.get(m))
        }
        if (a.length && b.length) draws.push(mean(a) - mean(b))
      }
      draws.sort((x, y) => x - y)
      return [draws[Math.floor(draws.length * 0.025)], draws[Math.floor(draws.length * 0.975)]]
    })()
    console.log(`   real − control: ${pc(mean(real.map((x) => x.pnl)) - mean(control[mode].map((x) => x.pnl)))} por ventana (IC por meses [${pc(lo)}, ${pc(hi)}]) · mitades ${pc(diffByHalf((x) => x.time < cut))} / ${pc(diffByHalf((x) => x.time >= cut))}`)
    const ok = mean(real.map((x) => x.pnl)) > 0 && mean(real.map((x) => x.pnl)) - mean(control[mode].map((x) => x.pnl)) >= 0.01 && lo > 0 && Math.min(diffByHalf((x) => x.time < cut), diffByHalf((x) => x.time >= cut)) > 0
    console.log(ok ? '   ✓ pasa el listón' : '   ✗ no pasa el listón')
  }
  // The real windows, cut by what the market did: a grid is the inventory it ends up holding.
  const real = results.optimista
  console.log('\n── real (optimista) según lo que hizo BTC en esos 30 días')
  for (const [label, from, to] of [['BTC cae más de 10 %', -9, -0.1], ['BTC entre −10 % y +10 %', -0.1, 0.1], ['BTC sube más de 10 %', 0.1, 9]]) {
    const t = real.filter((x) => Number.isFinite(x.btc30) && x.btc30 >= from && x.btc30 < to)
    console.log(`   ${label.padEnd(26)} ${stat(t)}`)
  }
  console.log('\n── real (optimista) por año')
  for (const y of [...new Set(real.map((x) => yearOf(x.time)))].sort()) console.log(`   ${y}  ${stat(real.filter((x) => yearOf(x.time) === y))}`)
}

// ── T (portfolio): what the long-only trend rule is worth as an account, not as an average trade ────────
// Not a trial: the same trades as `trend-long`, each sized so that 1 R is 0.25 % of equity (not compounded),
// marked every day at the close, summed across the open ones. Reported next to SPY held.
if (MODE === 'trend-portfolio') {
  const RISK = 0.0025
  const symbols = [...UNIVERSE.commodityOkx, ...UNIVERSE.commodityOther, ...UNIVERSE.equityIndex, ...UNIVERSE.sectors, ...UNIVERSE.bonds, ...UNIVERSE.fx, ...UNIVERSE.reit]
  const daily = new Map() // day -> { pnl, exposure, open }
  const bump = (day) => {
    if (!daily.has(day)) daily.set(day, { pnl: 0, exposure: 0, open: 0 })
    return daily.get(day)
  }
  let used = 0
  for (const sym of symbols) {
    const c = loadYahoo(sym)
    if (!c || c.length < 1500) continue
    used++
    for (const s of analyseDonchian(c, DONCHIAN_TREND_SETTINGS).signals) {
      if (s.side !== 'long' || s.outcome === 'open' || !Number.isFinite(s.resultR)) continue
      const risk = Math.abs(s.entry - s.stop)
      let prev = -s.feeR
      bump(c[s.index].time).pnl += prev * RISK
      for (let i = s.index + 1; i <= s.closedIndex; i++) {
        const r = i === s.closedIndex ? s.resultR - s.feeR : (c[i].close - s.entry) / risk - s.feeR
        const d = bump(c[i].time)
        d.pnl += (r - prev) * RISK
        if (i < s.closedIndex) {
          d.exposure += RISK * (c[i].close / risk)
          d.open += 1
        }
        prev = r
      }
    }
  }
  const days = [...daily.keys()].sort((a, b) => a - b)
  const spy = loadYahoo('SPY')
  const spyRet = new Map(spy.map((x, i) => [x.time, i ? x.close / spy[i - 1].close - 1 : 0]))
  const stats = (label, from, to, series) => {
    const rows = days.filter((d) => yearOf(d) >= from && yearOf(d) <= to)
    if (!rows.length) return
    const r = rows.map((d) => series(d))
    let eq = 1
    let peak = 1
    let dd = 0
    for (const x of r) {
      eq *= 1 + x
      peak = Math.max(peak, eq)
      dd = Math.min(dd, eq / peak - 1)
    }
    const yrs = rows.length / 252
    console.log(`  ${label.padEnd(26)} ${from}–${to}: ${pc(Math.pow(eq, 1 / yrs) - 1, 1)} al año · volatilidad ${pc(sd(r) * Math.sqrt(252), 1)} · Sharpe ${sg((mean(r) / sd(r)) * Math.sqrt(252), 2)} · caída máxima ${pc(dd, 1)}`)
  }
  console.log(`CARTERA: ${used} series, Canal 20 + EMA 200 solo largos, 1 R = ${(RISK * 100).toFixed(2)} % del capital, marcada cada día, 0,1 % de comisión\n`)
  const exposure = days.filter((d) => yearOf(d) >= 2008).map((d) => daily.get(d).exposure)
  const open = days.filter((d) => yearOf(d) >= 2008).map((d) => daily.get(d).open)
  console.log(`  desde 2008: exposición bruta media ${pc(mean(exposure), 0)} del capital (máxima ${pc(Math.max(...exposure), 0)}), posiciones abiertas de media ${mean(open).toFixed(1)} (máx ${Math.max(...open)})`)
  for (const [a, b] of [[2008, 2026], [2008, 2014], [2015, 2021], [2022, 2026]]) {
    stats('tendencia (cartera)', a, b, (d) => daily.get(d).pnl)
    stats('SPY comprado y mantenido', a, b, (d) => spyRet.get(d) ?? 0)
  }
  // Year by year, the account and SPY.
  console.log('\n  año a año (cartera / SPY):')
  const years = [...new Set(days.map(yearOf))].filter((y) => y >= 2008).sort()
  console.log('  ' + years.map((y) => {
    const rows = days.filter((d) => yearOf(d) === y)
    const a = rows.reduce((e, d) => e * (1 + daily.get(d).pnl), 1) - 1
    const b = rows.reduce((e, d) => e * (1 + (spyRet.get(d) ?? 0)), 1) - 1
    return `${y}: ${pc(a, 1)} / ${pc(b, 0)}`
  }).join('   '))
  // Correlation with SPY, monthly.
  const monthly = new Map()
  for (const d of days) {
    if (yearOf(d) < 2008) continue
    const k = monthOf(d)
    if (!monthly.has(k)) monthly.set(k, [0, 0])
    const m = monthly.get(k)
    m[0] += daily.get(d).pnl
    m[1] += spyRet.get(d) ?? 0
  }
  const A = [...monthly.values()].map((x) => x[0])
  const B = [...monthly.values()].map((x) => x[1])
  const ma = mean(A)
  const mb = mean(B)
  const corr = mean(A.map((x, i) => (x - ma) * (B[i] - mb))) / (sd(A) * sd(B))
  console.log(`\n  correlación mensual con SPY: ${sg(corr, 2)} (${A.length} meses)`)
}

// ── T (context): do the two filters that worked on crypto work on ETFs? ─────────────────────────────────
// A replication, not a search: the two filters and their directions were fixed on crypto (2026-10-15) and are
// applied as they are, to the long trades of `trend-long`: VOLUME — the entry candle's volume at least 1.5× the mean
// of the 20 before it (expected BETTER) — and REGIME — SPY above its own 200-day SMA at the entry close, for the
// equity-like groups (expected BETTER; the analogue of "BTC above its EMA 200"). No new trial: a difference that
// does not hold the sign in both halves of both groups is a failed replication, whatever its size.
if (MODE === 'trend-context') {
  const spy = loadYahoo('SPY')
  const spyTrend = sma(spy.map((x) => x.close), 200)
  const spyIdx = new Map(spy.map((x, i) => [x.time, i]))
  const above = (time) => {
    // The last SPY close on or before the entry day.
    let t = time
    for (let k = 0; k < 6 && !spyIdx.has(t); k++) t -= DAY
    const i = spyIdx.get(t)
    return i !== undefined && Number.isFinite(spyTrend[i]) ? spy[i].close > spyTrend[i] : null
  }
  const withContext = (symbols, minBars) => {
    const out = []
    for (const sym of symbols) {
      const c = loadYahoo(sym)
      if (!c || c.length < minBars) continue
      for (const s of analyseDonchian(c, DONCHIAN_TREND_SETTINGS).signals) {
        if (s.side !== 'long' || s.outcome === 'open' || !Number.isFinite(s.resultR)) continue
        let sum = 0
        let n = 0
        for (let k = 1; k <= 20 && s.index - k >= 0; k++) {
          sum += c[s.index - k].vol
          n++
        }
        const ratio = n === 20 && sum > 0 ? c[s.index].vol / (sum / 20) : NaN
        out.push({ sym, time: c[s.index].time, r: s.resultR - s.feeR, volume: Number.isFinite(ratio) ? ratio >= 1.5 : null, regime: above(c[s.index].time) })
      }
    }
    return out
  }
  const GROUPS = [
    ['ETF de índices y sectores', [...UNIVERSE.equityIndex, ...UNIVERSE.sectors], true],
    ['acciones que lista OKX (superv.)', UNIVERSE.okxStocks, true],
    ['bonos, divisas y materias primas', [...UNIVERSE.bonds, ...UNIVERSE.fx, ...UNIVERSE.commodityOther, ...UNIVERSE.commodityOkx], false],
  ]
  const line = (label, yes, no) => {
    if (yes.length < 15 || no.length < 15) return console.log(`    ${label.padEnd(26)} (muestra corta: ${yes.length} / ${no.length})`)
    const [lo, hi] = (() => {
      const months = [...new Set([...yes, ...no].map((x) => monthOf(x.time)))]
      const draws = []
      const a = new Map(months.map((m) => [m, []]))
      const b = new Map(months.map((m) => [m, []]))
      yes.forEach((x) => a.get(monthOf(x.time)).push(x.r))
      no.forEach((x) => b.get(monthOf(x.time)).push(x.r))
      for (let i = 0; i < 1000; i++) {
        const A = []
        const B = []
        for (let k = 0; k < months.length; k++) {
          const m = months[Math.floor(rnd() * months.length)]
          A.push(...a.get(m))
          B.push(...b.get(m))
        }
        if (A.length && B.length) draws.push(mean(A) - mean(B))
      }
      draws.sort((x, y) => x - y)
      return [draws[Math.floor(draws.length * 0.025)], draws[Math.floor(draws.length * 0.975)]]
    })()
    const cut = median([...yes, ...no].map((x) => x.time))
    const half = (xs, pred) => mean(xs.filter(pred).map((x) => x.r))
    const d1 = half(yes, (x) => x.time < cut) - half(no, (x) => x.time < cut)
    const d2 = half(yes, (x) => x.time >= cut) - half(no, (x) => x.time >= cut)
    const holds = d1 > 0 && d2 > 0 && mean(yes.map((x) => x.r)) > mean(no.map((x) => x.r))
    console.log(`    ${label.padEnd(26)} sí ${sg(mean(yes.map((x) => x.r)))} R (n=${yes.length})  no ${sg(mean(no.map((x) => x.r)))} R (n=${no.length})  diferencia ${sg(mean(yes.map((x) => x.r)) - mean(no.map((x) => x.r)))} [${sg(lo)}, ${sg(hi)}]  mitades ${sg(d1)} / ${sg(d2)}  ${holds ? '✓ se replica' : '✗ no se replica'}`)
  }
  console.log('REPLICACIÓN EN ETF Y ACCIONES DE LOS DOS FILTROS DE CRIPTO (largos de Canal 20 + EMA 200 diario; las direcciones esperadas estaban fijadas: mejor con volumen ≥ 1,5× y mejor con SPY sobre su media de 200 días)\n')
  for (const [label, syms, equityLike] of GROUPS) {
    const t = withContext(syms, label.startsWith('acciones') ? 1800 : 1500)
    console.log(`── ${label}: ${t.length} largos`)
    line('volumen ≥ 1,5× la media', t.filter((x) => x.volume === true), t.filter((x) => x.volume === false))
    if (equityLike) line('SPY sobre su media de 200 d', t.filter((x) => x.regime === true), t.filter((x) => x.regime === false))
  }
}

// ── S: stocks' regime and the VIX as context for the crypto trend entries ──────────────────────────────
// Written before the first number. Two variables, each with ONE definition and ONE expected direction (risk-on is
// better): SPY above its 200-day SMA; the VIX below its own 50-day mean (volatility falling). Both read at the last
// daily close BEFORE the entry's UTC date (lag one day: nothing that was not yet known). Applied to the long entries of
// the two shipped trend rules (Canal 20 + EMA 200 and the EMA 200 cross) on 4 h, in both periods (2022–26 and the
// 2018–21 board nothing was tuned on). Control: the same split with the macro series shifted circularly by 200 random
// offsets of 60 to 700 days — a slowly moving binary filter improves any trend system in some periods by luck, and the
// question is whether the real alignment beats the shifted ones. A variable counts only if the sign holds in all four
// cells (2 rules × 2 periods) AND the real improvement is above the 95th percentile of the shifted ones in at least
// three. 8 cells counted.
if (MODE === 'macro') {
  const spy = loadYahoo('SPY')
  const vix = loadYahoo('^VIX')
  const spyS = sma(spy.map((x) => x.close), 200)
  const vixS = sma(vix.map((x) => x.close), 50)
  const stateSeries = (rows, line, rule) => {
    const out = new Map()
    rows.forEach((x, i) => {
      if (Number.isFinite(line[i])) out.set(x.time, rule(x.close, line[i]))
    })
    return out
  }
  const VARS = [
    ['SPY sobre su media de 200 d', stateSeries(spy, spyS, (c, m) => c > m)],
    ['VIX bajo su media de 50 d', stateSeries(vix, vixS, (c, m) => c < m)],
  ]
  const firstDay = Math.min(...[...VARS[0][1].keys()])
  const lastDay = Math.max(...[...VARS[0][1].keys()])
  const stateAt = (series, ms, shift = 0) => {
    // The last known value strictly before the UTC date of the entry, shifted circularly by `shift` days.
    const span = Math.round((lastDay - firstDay) / DAY) + 1
    let d = Math.floor(ms / DAY) * DAY - DAY
    d = firstDay + ((((d - firstDay) / DAY + shift) % span) + span) % span * DAY
    for (let k = 0; k < 6; k++) {
      if (series.has(d)) return series.get(d)
      d -= DAY
    }
    return null
  }
  const load = (dir) =>
    readdirSync(dir)
      .filter((x) => x.endsWith('.json') && !x.startsWith('_'))
      .map((x) => [x.replace('.json', ''), JSON.parse(readFileSync(`${dir}/${x}`, 'utf8')).filter((c) => c.confirmed !== false)])
  const PERIODS = [['2022–26', './.candles-board-4H'], ['2018–21', './.candles-board-4Hold']]
  const RULES = [['Canal 20 + EMA 200', (c) => analyseDonchian(c, DONCHIAN_TREND_SETTINGS)], ['Cruce EMA 200', (c) => analyseEmaCross(c)]]
  const H4 = 4 * 3_600_000
  console.log('CONTEXTO MACRO PARA LAS ENTRADAS LARGAS DE TENDENCIA EN CRIPTO (4 h; dirección esperada fijada: mejor con riesgo apetecido)\n')
  const verdict = new Map(VARS.map(([name]) => [name, { signs: 0, cells: 0, beats: 0 }]))
  for (const [period, dir] of PERIODS) {
    const board = load(dir)
    for (const [ruleName, run] of RULES) {
      const trades = []
      for (const [coin, c] of board) {
        if (c.length < 700) continue
        for (const s of run(c).signals) {
          if (s.side !== 'long' || s.outcome === 'open' || !Number.isFinite(s.resultR)) continue
          trades.push({ coin, time: c[s.index].time + H4, r: s.resultR - s.feeR })
        }
      }
      console.log(`── ${period} · ${ruleName}: ${trades.length} largos`)
      for (const [name, series] of VARS) {
        const diff = (shift) => {
          const yes = []
          const no = []
          for (const t of trades) {
            const st = stateAt(series, t.time, shift)
            if (st === null) continue
            ;(st ? yes : no).push(t.r)
          }
          return yes.length >= 20 && no.length >= 20 ? [mean(yes) - mean(no), yes.length, no.length, mean(yes), mean(no)] : null
        }
        const real = diff(0)
        if (!real) {
          console.log(`    ${name}: muestra corta`)
          continue
        }
        const shifted = []
        for (let k = 0; k < 200; k++) {
          const off = (rnd() < 0.5 ? -1 : 1) * Math.floor(60 + rnd() * 640)
          const d = diff(off)
          if (d) shifted.push(d[0])
        }
        shifted.sort((a, b) => a - b)
        const pct = shifted.filter((x) => x < real[0]).length / shifted.length
        const v = verdict.get(name)
        v.cells++
        if (real[0] > 0) v.signs++
        if (pct >= 0.95) v.beats++
        console.log(`    ${name.padEnd(28)} sí ${sg(real[3])} R (n=${real[1]})  no ${sg(real[4])} R (n=${real[2]})  diferencia ${sg(real[0])}  percentil entre 200 copias desplazadas: ${(pct * 100).toFixed(0)} %`)
      }
    }
  }
  console.log('\nVEREDICTO')
  for (const [name, v] of verdict) console.log(`  ${name}: signo positivo en ${v.signs} de ${v.cells} celdas, por encima del percentil 95 de las copias en ${v.beats} · ${v.signs === v.cells && v.beats >= 3 ? '✓ cuenta' : '✗ no cuenta'}`)
}

// ── C: how alike the ETF trend book and the crypto trend book are ───────────────────────────────────────
// Not a trial: the monthly R of the long-only ETF book against the crypto trend book of the same months, trades
// booked on the month they close, 2022-01 → 2026-09.
if (MODE === 'combo') {
  const monthR = (trades) => {
    const m = new Map()
    for (const t of trades) m.set(monthOf(t.closed), (m.get(monthOf(t.closed)) ?? 0) + t.r)
    return m
  }
  const etfSyms = [...UNIVERSE.commodityOkx, ...UNIVERSE.commodityOther, ...UNIVERSE.equityIndex, ...UNIVERSE.sectors, ...UNIVERSE.bonds, ...UNIVERSE.fx, ...UNIVERSE.reit]
  const etf = []
  for (const sym of etfSyms) {
    const c = loadYahoo(sym)
    if (!c || c.length < 1500) continue
    for (const s of analyseDonchian(c, DONCHIAN_TREND_SETTINGS).signals) {
      if (s.side === 'long' && s.outcome !== 'open' && Number.isFinite(s.resultR)) etf.push({ closed: s.closedTime, r: s.resultR - s.feeR })
    }
  }
  const crypto = { both: [], long: [] }
  const dir = './.candles-board-4H'
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
    const c = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')).filter((x) => x.confirmed !== false)
    if (c.length < 700) continue
    for (const s of analyseDonchian(c, DONCHIAN_TREND_SETTINGS).signals) {
      if (s.outcome === 'open' || !Number.isFinite(s.resultR)) continue
      const t = { closed: s.closedTime, r: s.resultR - s.feeR }
      crypto.both.push(t)
      if (s.side === 'long') crypto.long.push(t)
    }
  }
  const E = monthR(etf)
  const months = [...new Set([...crypto.both.map((t) => monthOf(t.closed))])].sort().filter((m) => m >= '2022-03' && m <= '2026-09' && E.has(m))
  const corr = (a, b) => {
    const ma = mean(a)
    const mb = mean(b)
    return mean(a.map((x, i) => (x - ma) * (b[i] - mb))) / (sd(a) * sd(b))
  }
  console.log(`${months.length} meses en común (2022-03 → 2026-09)`)
  for (const [label, book] of [['cripto, largos y cortos', crypto.both], ['cripto, solo largos', crypto.long]]) {
    const C = monthR(book)
    const a = months.map((m) => E.get(m) ?? 0)
    const b = months.map((m) => C.get(m) ?? 0)
    // Equal risk: each book's monthly R scaled by its own standard deviation.
    const mix = a.map((x, i) => x / sd(a) + b[i] / sd(b))
    const sharpe = (xs) => (mean(xs) / sd(xs)) * Math.sqrt(12)
    console.log(`  ETF largos con ${label}: correlación mensual ${sg(corr(a, b), 2)} · Sharpe anual de los R mensuales: ETF ${sg(sharpe(a), 2)}, cripto ${sg(sharpe(b), 2)}, a partes iguales de riesgo ${sg(sharpe(mix), 2)}`)
  }
}

// ── P: the trend of a RATIO (relative strength), not its reversion ──────────────────────────────────────
// Written before the first number. The repo measured alt/BTC by z-score (mean reversion: −0.17 R on 4 h, −0.20 on
// the daily) and the cross-section's closeness to the 90-day high (relative strength persists, +1.69 % a week on the
// survivor-free universe, mostly age). What it never measured is the shipped trend rules applied to the ratio itself:
// Canal 20 + EMA 200 and the EMA 200 cross, unchanged, on ALT/BTC candles — long the alt and short BTC when the ratio
// trends up, the mirror when it trends down — two legs, so 0.2 % round trip. The candles of a ratio have no real
// high or low (the bar's extremes of two assets do not happen together), so each is built with no wicks: open = the
// ratio of the opens, close = the ratio of the closes, high and low the larger and smaller of the two. Boards: 32 coins
// of 4 h and of the daily since 2022, and 14 coins of 4 h and the daily in 2018–21 (nothing was tuned on them). Bar:
// `npm run try` (n ≥ 30, ≥ +0.10 R in the aggregate and in both halves, +0.05 R over random, DSR ≥ 95 % after 4 trials).
// `npm run novel ratio-build`, then `TRY_DIR=./.candles-ratio-4H TRY_BAR=4H npm run try -- scripts/ideas-ratio.mjs --export analyseRatioDonchian --trials 4`
if (MODE === 'ratio-build') {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  for (const [source, target] of [
    ['./.candles-board-4H', './.candles-ratio-4H'],
    ['./.candles-board-1D', './.candles-ratio-1D'],
    ['./.candles-board-4Hold', './.candles-ratio-4Hold'],
    ['./.candles-board-1Dold', './.candles-ratio-1Dold'],
  ]) {
    if (!existsSync(source)) {
      console.log(`  (falta ${source})`)
      continue
    }
    mkdirSync(target, { recursive: true })
    const read = (f) => JSON.parse(readFileSync(`${source}/${f}`, 'utf8')).filter((c) => c.confirmed !== false)
    const btc = read('BTC.json')
    const byTime = new Map(btc.map((c) => [c.time, c]))
    let made = 0
    for (const f of readdirSync(source).filter((x) => x.endsWith('.json') && !x.startsWith('_') && x !== 'BTC.json')) {
      const rows = []
      for (const c of read(f)) {
        const b = byTime.get(c.time)
        if (!b) continue
        const o = c.open / b.open
        const cl = c.close / b.close
        rows.push({ time: c.time, open: o, high: Math.max(o, cl), low: Math.min(o, cl), close: cl, vol: 1, confirmed: true })
      }
      if (rows.length >= 700) {
        writeFileSync(`${target}/${f}`, JSON.stringify(rows))
        made++
      }
    }
    console.log(`  ${target}: ${made} cocientes`)
  }
}

// ── P (review): the checks `npm run battery` runs, for a candidate whose candles are ratios ─────────────
// `battery` reads its own dollar boards, so it cannot judge ratio candles; these are its checks, written for the
// ratio, plus the one that matters most for a pair: how much of it is the market's direction (an alt has a beta above
// 1 to BTC, so long-alt / short-BTC is net long the market whenever the ratio trends up with it).
if (MODE === 'ratio') {
  const SETS = [
    ['4H 2022–26', './.candles-ratio-4H', './.candles-board-4H', 4 * 3_600_000],
    ['4H 2018–21', './.candles-ratio-4Hold', './.candles-board-4Hold', 4 * 3_600_000],
    ['1D 2022–26', './.candles-ratio-1D', './.candles-board-1D', DAY],
  ]
  const read = (dir) =>
    Object.fromEntries(
      readdirSync(dir)
        .filter((x) => x.endsWith('.json') && !x.startsWith('_'))
        .map((x) => [x.replace('.json', ''), JSON.parse(readFileSync(`${dir}/${x}`, 'utf8')).filter((c) => c.confirmed !== false)]),
    )
  const RULE = (c) => analyseDonchian(c, { ...DONCHIAN_TREND_SETTINGS, feeRate: 0.002 })
  const sharpeM = (xs) => (mean(xs) / sd(xs)) * Math.sqrt(12)

  for (const [label, ratioDir, boardDir, barMs] of SETS) {
    if (!existsSync(ratioDir) || !existsSync(boardDir)) continue
    const ratios = read(ratioDir)
    const board = read(boardDir)
    const btc = board.BTC
    const btcIdx = new Map(btc.map((c, i) => [c.time, i]))
    const btcLine = ema(btc.map((c) => c.close), 200)
    const trades = []
    for (const [coin, rc] of Object.entries(ratios)) {
      const dollar = board[coin]
      if (!dollar) continue
      const dIdx = new Map(dollar.map((c, i) => [c.time, i]))
      for (const s of RULE(rc).signals) {
        if (s.outcome === 'open' || !Number.isFinite(s.resultR)) continue
        const t0 = rc[s.index].time
        const t1 = rc[s.closedIndex].time
        const a0 = dIdx.get(t0)
        const a1 = dIdx.get(t1)
        const b0 = btcIdx.get(t0)
        const b1 = btcIdx.get(t1)
        if ([a0, a1, b0, b1].some((x) => x === undefined)) continue
        const rAlt = dollar[a1].close / dollar[a0].close - 1
        const rBtc = btc[b1].close / btc[b0].close - 1
        const dir = s.side === 'long' ? 1 : -1
        const stopPct = Math.abs(s.entry - s.stop) / s.entry
        trades.push({
          coin,
          side: s.side,
          time: t0 + barMs,
          closed: t1 + barMs,
          r: s.resultR - s.feeR,
          fee: s.feeR,
          gross: s.resultR,
          pair: dir * (rAlt - rBtc),
          rBtc,
          rAlt,
          stopPct,
          // BTC above its own EMA 200 at the entry close, on the same bar grid.
          btcUp: btc[b0].close > btcLine[b0],
        })
      }
    }
    const rs = trades.map((t) => t.r)
    const sorted = [...rs].sort((a, b) => b - a)
    const [lo, hi] = monthBootstrap(trades.map((t) => ({ ...t, time: t.time })))
    console.log(`\n══ ${label}: ${trades.length} operaciones en ${new Set(trades.map((t) => t.coin)).size} cocientes, neto ${sg(mean(rs))} R, acierto ${((rs.filter((x) => x > 0).length / rs.length) * 100).toFixed(1)} %`)
    console.log(`   sin las 10 / 20 / 50 mejores: ${sg(mean(sorted.slice(10)))} / ${sg(mean(sorted.slice(20)))} / ${sg(mean(sorted.slice(50)))} · IC por meses [${sg(lo)}, ${sg(hi)}] · parada media ${pc(mean(trades.map((t) => t.stopPct)), 2)}`)
    for (const k of [0.66, 2, 3]) console.log(`   comisión ×${k} (${(0.2 * k).toFixed(2)} % ida y vuelta): neto ${sg(mean(trades.map((t) => t.gross - t.fee * k)))} R`)
    const side = (s) => trades.filter((t) => t.side === s)
    console.log(`   largos (largo alt / corto BTC): n=${side('long').length} neto ${sg(mean(side('long').map((t) => t.r)))} R · cortos (corto alt / largo BTC): n=${side('short').length} neto ${sg(mean(side('short').map((t) => t.r)))} R`)
    const years = [...new Set(trades.map((t) => yearOf(t.time)))].sort()
    console.log('   por año: ' + years.map((y) => `${y} ${sg(mean(trades.filter((t) => yearOf(t.time) === y).map((t) => t.r)), 2)} (${trades.filter((t) => yearOf(t.time) === y).length})`).join(' · '))
    const byCoin = new Map()
    for (const t of trades) byCoin.set(t.coin, [...(byCoin.get(t.coin) ?? []), t.r])
    const ranked = [...byCoin.entries()].map(([c, x]) => [c, mean(x), x.length]).sort((a, b) => b[1] - a[1])
    console.log(`   monedas con neto > 0: ${ranked.filter((x) => x[1] > 0).length} de ${ranked.length} · mejores ${ranked.slice(0, 4).map((x) => `${x[0]} ${sg(x[1], 2)}`).join(', ')} · peores ${ranked.slice(-4).map((x) => `${x[0]} ${sg(x[1], 2)}`).join(', ')}`)
    // The market's direction inside the pair.
    const up = trades.filter((t) => t.btcUp)
    const dn = trades.filter((t) => !t.btcUp)
    console.log(`   BTC sobre su EMA 200 al entrar: largos ${sg(mean(up.filter((t) => t.side === 'long').map((t) => t.r)))} (${up.filter((t) => t.side === 'long').length}), cortos ${sg(mean(up.filter((t) => t.side === 'short').map((t) => t.r)))} (${up.filter((t) => t.side === 'short').length}) · BTC bajo: largos ${sg(mean(dn.filter((t) => t.side === 'long').map((t) => t.r)))} (${dn.filter((t) => t.side === 'long').length}), cortos ${sg(mean(dn.filter((t) => t.side === 'short').map((t) => t.r)))} (${dn.filter((t) => t.side === 'short').length})`)
    // P&L of the pair in percent of one leg, and how much of it BTC's move explains.
    const x = trades.map((t) => t.rBtc * (t.side === 'long' ? 1 : -1))
    const y = trades.map((t) => t.pair)
    const mx = mean(x)
    const my = mean(y)
    const beta = mean(x.map((v, i) => (v - mx) * (y[i] - my))) / (sd(x) ** 2)
    const alpha = my - beta * mx
    console.log(`   P&L del par (equilibrado en dólares al entrar) por operación: ${pc(mean(y))} (mediana ${pc(median(y))}); contra el movimiento de BTC en la dirección de la operación: pendiente ${sg(beta, 2)}, resto ${pc(alpha)} por operación`)
    console.log(`   ejemplos del par: alt ${pc(mean(trades.map((t) => t.rAlt * (t.side === 'long' ? 1 : -1))))} · BTC (corto del par si es largo) ${pc(-mean(x))}`)
    // Monthly R against the shipped trend book on dollar prices.
    const crypto = []
    for (const c of Object.values(board)) {
      if (c.length < 700) continue
      for (const s of analyseDonchian(c, DONCHIAN_TREND_SETTINGS).signals) {
        if (s.outcome !== 'open' && Number.isFinite(s.resultR)) crypto.push({ closed: s.closedTime + barMs, r: s.resultR - s.feeR })
      }
    }
    const monthly = (arr, key) => {
      const m = new Map()
      for (const t of arr) m.set(monthOf(t[key]), (m.get(monthOf(t[key])) ?? 0) + t.r)
      return m
    }
    const A = monthly(trades, 'closed')
    const B = monthly(crypto, 'closed')
    const months = [...A.keys()].filter((m) => B.has(m)).sort()
    const a = months.map((m) => A.get(m))
    const b = months.map((m) => B.get(m))
    const ma = mean(a)
    const mb = mean(b)
    const corr = mean(a.map((v, i) => (v - ma) * (b[i] - mb))) / (sd(a) * sd(b))
    const mix = a.map((v, i) => v / sd(a) + b[i] / sd(b))
    console.log(`   mensual contra el Canal 20 + EMA 200 en dólares: correlación ${sg(corr, 2)} (${months.length} meses) · Sharpe de los R mensuales: cociente ${sg(sharpeM(a), 2)}, dólares ${sg(sharpeM(b), 2)}, a partes iguales de riesgo ${sg(sharpeM(mix), 2)}`)
  }
}

// ── P (wicks): the ratio candles had none, and a stop that only sees opens and closes is a flattering stop ──
// Added after `ratio` (a diagnostic, not a trial): the first candles took the ratio's high and low as the larger and
// smaller of its open and close. Rebuilt from the 1 h board, three ways, and the rule run unchanged on each:
//   plano     the first version: open and close of the 4 h bar only;
//   horas     each hour's ratio of closes, so the 4 h high and low are the extremes of its four hourly ratios — what a
//             stop watched every hour would have seen;
//   extremo   the worst case at every hour: the alt's high over BTC's low for the top, its low over BTC's high for the
//             bottom, as if both legs' extremes came together (they do not — they are positively correlated — so this
//             is a bound the real stop cannot be worse than).
// What is compared is the PERCENT a trade makes (R × the stop's distance), because the stop's distance changes with
// the candles, and so does what one R is.
if (MODE === 'ratio-wicks') {
  const HOUR = 3_600_000
  const read = (dir) =>
    Object.fromEntries(
      readdirSync(dir)
        .filter((x) => x.endsWith('.json') && !x.startsWith('_'))
        .map((x) => [x.replace('.json', ''), JSON.parse(readFileSync(`${dir}/${x}`, 'utf8')).filter((c) => c.confirmed !== false)]),
    )
  const h1 = read('./.candles-board-1H')
  const h4 = read('./.candles-board-4H')
  const btc1 = new Map(h1.BTC.map((c) => [c.time, c]))
  const built = { plano: {}, horas: {}, extremo: {} }
  for (const [coin, c4] of Object.entries(h4)) {
    if (coin === 'BTC' || !h1[coin]) continue
    const own = new Map(h1[coin].map((c) => [c.time, c]))
    const rows = { plano: [], horas: [], extremo: [] }
    const btc4 = new Map(h4.BTC.map((c) => [c.time, c]))
    for (const c of c4) {
      const b4 = btc4.get(c.time)
      if (!b4) continue
      const hours = []
      for (let k = 0; k < 4; k++) {
        const a = own.get(c.time + k * HOUR)
        const b = btc1.get(c.time + k * HOUR)
        if (!a || !b) break
        hours.push([a, b])
      }
      if (hours.length < 4) continue
      const O = hours[0][0].open / hours[0][1].open
      const C = hours[3][0].close / hours[3][1].close
      const hi = [O, C]
      const lo = [O, C]
      const hiX = [O, C]
      const loX = [O, C]
      for (const [a, b] of hours) {
        const o = a.open / b.open
        const cl = a.close / b.close
        hi.push(o, cl)
        lo.push(o, cl)
        hiX.push(a.high / b.low)
        loX.push(a.low / b.high)
      }
      rows.plano.push({ time: c.time, open: O, high: Math.max(O, C), low: Math.min(O, C), close: C, vol: 1, confirmed: true })
      rows.horas.push({ time: c.time, open: O, high: Math.max(...hi), low: Math.min(...lo), close: C, vol: 1, confirmed: true })
      rows.extremo.push({ time: c.time, open: O, high: Math.max(...hiX, O, C), low: Math.min(...loX, O, C), close: C, vol: 1, confirmed: true })
    }
    for (const k of Object.keys(rows)) if (rows[k].length >= 700) built[k][coin] = rows[k]
  }
  console.log('VELAS DE COCIENTE CON MECHAS (4 h, 2022–26, reconstruidas desde las velas de 1 h); misma regla, 0,2 % ida y vuelta\n')
  console.log(`  ${'variante'.padEnd(10)} ${'n'.padStart(5)} ${'neto R'.padStart(8)} ${'mitades'.padStart(15)} ${'parada'.padStart(8)} ${'% por op. (neto)'.padStart(17)} ${'acierto'.padStart(8)} ${'largos / cortos (R)'.padStart(22)}`)
  for (const k of ['plano', 'horas', 'extremo']) {
    const trades = []
    for (const [coin, c] of Object.entries(built[k])) {
      for (const s of analyseDonchian(c, { ...DONCHIAN_TREND_SETTINGS, feeRate: 0.002 }).signals) {
        if (s.outcome === 'open' || !Number.isFinite(s.resultR)) continue
        const stopPct = Math.abs(s.entry - s.stop) / s.entry
        trades.push({ coin, side: s.side, time: c[s.index].time, r: s.resultR - s.feeR, pct: s.resultR * stopPct - 0.002, stopPct })
      }
    }
    const cut = median(trades.map((t) => t.time))
    const L = trades.filter((t) => t.side === 'long')
    const S = trades.filter((t) => t.side === 'short')
    console.log(
      `  ${k.padEnd(10)} ${String(trades.length).padStart(5)} ${sg(mean(trades.map((t) => t.r))).padStart(8)} ${(sg(mean(trades.filter((t) => t.time < cut).map((t) => t.r))) + ' / ' + sg(mean(trades.filter((t) => t.time >= cut).map((t) => t.r)))).padStart(15)} ${pc(mean(trades.map((t) => t.stopPct)), 2).padStart(8)} ${pc(mean(trades.map((t) => t.pct))).padStart(17)} ${((trades.filter((t) => t.r > 0).length / trades.length) * 100).toFixed(1).padStart(7)}% ${(sg(mean(L.map((t) => t.r))) + ' / ' + sg(mean(S.map((t) => t.r)))).padStart(22)}`,
    )
  }
}

// ── P (resolution): where does the ratio's edge go as the candle approaches the truth? ──────────────────
// A diagnostic (not a trial) after `ratio-wicks`: from the 4 h bar's open and close only (+0.62 R) to the extremes of its
// four hourly ratios (+0.30 R). The same 4 h bars are rebuilt here from FINER data on the same coins, so the only thing
// that changes is how much of the bar's excursion the stop can see: plano (open and close), 1 h, 15 m and — for ETH/BTC,
// the one pair with minutes — 1 m. If the figure keeps falling as the resolution rises, the edge was the blindness.
if (MODE === 'ratio-res') {
  const ALTS_15 = ['ADA', 'AVAX', 'BCH', 'DOGE', 'DOT', 'LINK', 'LTC', 'NEAR', 'UNI', 'XRP']
  const readJson = (path) => JSON.parse(readFileSync(path, 'utf8')).filter((c) => c.confirmed !== false)
  const fine = {}
  for (const c of ALTS_15) fine[c] = readJson(`./.candles-board-15m/${c}.json`)
  fine.ETH = readJson('./.candles/ETH_USDT__15m.json')
  fine.SOL = readJson('./.candles/SOL_USDT__15m.json')
  const btcFine = readJson('./.candles/BTC_USDT__15m.json')
  const FOUR_H = 4 * 3_600_000
  /** 4 h ratio candles whose extremes are those of the ratio sampled every `step` bars of the fine series. */
  function build(alt, btc, step, barMs, unitMs) {
    const b = new Map(btc.map((c) => [c.time, c]))
    const rows = []
    const byBar = new Map()
    for (const a of alt) {
      const bt = b.get(a.time)
      if (!bt) continue
      const k = Math.floor(a.time / barMs) * barMs
      if (!byBar.has(k)) byBar.set(k, [])
      byBar.get(k).push([a, bt])
    }
    const per = barMs / unitMs
    for (const [t, items] of [...byBar].sort((x, y) => x[0] - y[0])) {
      if (items.length < per) continue
      const O = items[0][0].open / items[0][1].open
      const C = items[items.length - 1][0].close / items[items.length - 1][1].close
      let hi = Math.max(O, C)
      let lo = Math.min(O, C)
      // Sampled every `step` fine bars: the ratio of the closes at those moments (and of the opens), nothing finer.
      for (let i = step - 1; i < items.length; i += step) {
        const cl = items[i][0].close / items[i][1].close
        hi = Math.max(hi, cl)
        lo = Math.min(lo, cl)
      }
      rows.push({ time: t, open: O, high: hi, low: lo, close: C, vol: 1, confirmed: true })
    }
    return rows
  }
  const measure = (label, series) => {
    const trades = []
    for (const c of Object.values(series)) {
      if (c.length < 700) continue
      for (const s of analyseDonchian(c, { ...DONCHIAN_TREND_SETTINGS, feeRate: 0.002 }).signals) {
        if (s.outcome === 'open' || !Number.isFinite(s.resultR)) continue
        const stopPct = Math.abs(s.entry - s.stop) / s.entry
        trades.push({ r: s.resultR - s.feeR, pct: s.resultR * stopPct - 0.002, stopPct, time: c[s.index].time })
      }
    }
    if (!trades.length) return console.log(`  ${label}: sin operaciones`)
    const cut = median(trades.map((t) => t.time))
    console.log(`  ${label.padEnd(34)} n=${String(trades.length).padStart(4)}  neto ${sg(mean(trades.map((t) => t.r))).padStart(6)} R  mitades ${sg(mean(trades.filter((t) => t.time < cut).map((t) => t.r)))} / ${sg(mean(trades.filter((t) => t.time >= cut).map((t) => t.r)))}  parada ${pc(mean(trades.map((t) => t.stopPct)), 2)}  por operación ${pc(mean(trades.map((t) => t.pct)))}`)
  }
  console.log('LA MISMA REGLA SOBRE VELAS DE 4 h DE COCIENTE, A VARIAS RESOLUCIONES (12 monedas contra BTC, 15 m desde 2022)\n')
  const series = { plano: {}, '1 h': {}, '15 m': {} }
  for (const coin of Object.keys(fine)) {
    series.plano[coin] = build(fine[coin], btcFine, 16, FOUR_H, 900_000).map((c) => ({ ...c, high: Math.max(c.open, c.close), low: Math.min(c.open, c.close) }))
    series['1 h'][coin] = build(fine[coin], btcFine, 4, FOUR_H, 900_000)
    series['15 m'][coin] = build(fine[coin], btcFine, 1, FOUR_H, 900_000)
  }
  measure('plano (apertura y cierre de 4 h)', series.plano)
  measure('extremos cada hora', series['1 h'])
  measure('extremos cada 15 minutos', series['15 m'])
  console.log('\nETH/BTC con velas de 1 minuto (octubre de 2024 a octubre de 2026)')
  const eth1m = readJson('./.candles-board-1m/ETH.json')
  const btc1m = readJson('./.candles-board-1m/BTC.json')
  const lim = (xs) => xs.filter((c) => c.time >= Date.parse('2024-10-11T00:00:00Z'))
  const e = lim(eth1m)
  const b = lim(btc1m)
  const eth15 = lim(fine.ETH)
  const one = {
    plano: build(e, b, 240, FOUR_H, 60_000).map((c) => ({ ...c, high: Math.max(c.open, c.close), low: Math.min(c.open, c.close) })),
    '1 h': build(e, b, 60, FOUR_H, 60_000),
    '15 m': build(e, b, 15, FOUR_H, 60_000),
    '1 m': build(e, b, 1, FOUR_H, 60_000),
  }
  for (const [k, c] of Object.entries(one)) measure(`ETH/BTC · ${k}`, { ETH: c })
  void eth15
}

// Diagnostic of `trend-long`: the contracts OKX actually lists, one by one, long entries only (not a trial).
if (MODE === 'trend-listed') {
  const LISTED = ['SPY', 'QQQ', 'EWY', 'EWZ', 'GLD', 'SLV', 'USO', 'BNO', 'SOXL', 'KORU', 'AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA']
  const donchian = TREND_STRATEGIES[0][1]
  console.log('CANAL 20 + EMA 200 DIARIO, SOLO LARGOS, EN LOS CONTRATOS QUE LISTA OKX (historia del subyacente)\n')
  console.log(`  ${'símbolo'.padEnd(8)} ${'desde'.padEnd(11)} ${'n'.padStart(3)} ${'neto R'.padStart(8)} ${'azar'.padStart(7)} ${'acierto'.padStart(8)} ${'entradas/año'.padStart(13)}  última señal`)
  for (const sym of LISTED) {
    const c = loadYahoo(sym)
    if (!c) continue
    const all = donchian(c)
    const t = tradesOf([sym], donchian, 700).filter((x) => x.side === 'long')
    if (!t.length) {
      console.log(`  ${sym.padEnd(8)} ${new Date(c[0].time).toISOString().slice(0, 10)} sin operaciones`)
      continue
    }
    const years = (c[c.length - 1].time - c[620].time) / (365 * DAY)
    const last = [...all.signals].reverse().find((s) => s.side === 'long')
    console.log(
      `  ${sym.padEnd(8)} ${new Date(c[0].time).toISOString().slice(0, 10)} ${String(t.length).padStart(3)} ${sg(mean(t.map((x) => x.r))).padStart(8)} ${sg(mean(randomControl(t, true))).padStart(7)} ${(((t.filter((x) => x.r > 0).length / t.length) * 100).toFixed(0) + ' %').padStart(8)} ${(t.length / years).toFixed(1).padStart(13)}  ${last ? new Date(last.time).toISOString().slice(0, 10) + (last.outcome === 'open' ? ' (abierta)' : '') : '—'}`,
    )
  }
  // How many long entries a week would a scan of every listed contract with history raise?
  const listedAll = [...UNIVERSE.commodityOkx, 'SPY', 'QQQ', 'EWY', 'EWZ', 'SOXL', 'KORU', ...UNIVERSE.okxStocks]
  let entries = 0
  let series = 0
  for (const sym of listedAll) {
    const c = loadYahoo(sym)
    if (!c || c.length < 1000) continue
    const t = tradesOf([sym], donchian, 1000).filter((x) => x.side === 'long' && x.time >= Date.now() - 5 * 365 * DAY)
    entries += t.length
    series++
  }
  console.log(`\n  ${series} contratos con historia: ${entries} entradas largas en los últimos 5 años, ${(entries / 260).toFixed(1)} a la semana de media`)
}
