// Can funding be traded, and does it move differently from what the app
// already trades?
//
//   npm run funding:fetch   (once, with `npm run dev` up)
//   npm run funding
//
// Three ideas, written down before anything was measured, each at the
// parameters it is usually told with:
//
//   1. CARRY — hold the coin and short the same amount of its perpetual. Price
//      cancels; what is left is the funding the short collects. Entered when
//      the last 7 days paid more than 10 % a year, left when they paid nothing.
//   2. CONTRARIAN — when a coin's last 3 days of funding sit in the top tenth of
//      its own past year, the crowd is long: short it for 7 days. Bottom tenth,
//      long. Funding paid or collected over the hold is part of the result.
//   3. CROSS-SECTION — every 7 days, long the fifth of the board with the
//      lowest funding over the last week and short the fifth with the highest,
//      equal weight, dollar neutral. Both legs collect funding by construction;
//      the question is what the prices do to it.
//
// Then the check that motivated all of it: do the monthly results correlate
// with the reversal, the Donchian and the opening range?
//
// Costs are this account's, from /account/trade-fee: futures 0.02 % maker /
// 0.05 % taker a side, spot 0.20 % / 0.35 %. Every futures trade here is
// priced at taker.
//
// Data: Binance USDT perpetuals since 2022 (funding and daily candles), checked
// against the ~3 months of X-Perp funding OKX will serve. The coin list is
// today's liquid X-Perp board, which is survivorship: nothing that died since
// 2022 is in it.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { deflate } from '../src/lib/indicators/deflated.ts'
import { STRATEGIES } from '../src/lib/indicators/registry.ts'
import { CARRY_EVIDENCE } from '../src/lib/carry.ts'

/** What this run measured, checked at the end against what the page quotes. */
const measured = { correlation: {} }

const DIR = './.funding'
if (!existsSync(DIR)) {
  console.error('Falta ./.funding: corre primero `npm run funding:fetch` con `npm run dev` levantado.')
  process.exit(2)
}
const DAY = 86_400_000
const WEEK = 7 * DAY
const TAKER = 0.0005
const SPOT_MAKER = 0.002
const SPOT_TAKER = 0.0035

const pct = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)} %` : '—')
const num = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '—')
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const sd = (xs) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const corr = (x, y) => {
  const mx = mean(x)
  const my = mean(y)
  const c = mean(x.map((v, i) => (v - mx) * (y[i] - my)))
  return c / (sd(x) * sd(y))
}
let seed = 11
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
/** 95 % interval of the mean, resampling whole groups (days or weeks). */
function bootstrap(groups, runs = 4000) {
  const flat = (gs) => gs.flat()
  const out = []
  for (let b = 0; b < runs; b++) {
    const pick = []
    for (let i = 0; i < groups.length; i++) pick.push(groups[Math.floor(rnd() * groups.length)])
    out.push(mean(flat(pick)))
  }
  out.sort((a, b) => a - b)
  return [out[Math.floor(runs * 0.025)], out[Math.floor(runs * 0.975)]]
}

// ── load ─────────────────────────────────────────────────────────────────────
const coins = {}
for (const f of readdirSync(`${DIR}/binance`)) {
  const d = JSON.parse(readFileSync(`${DIR}/binance/${f}`, 'utf8'))
  if (!d || d.candles.length < 120) continue
  const sym = f.replace('.json', '')
  const events = d.funding.sort((a, b) => a.t - b.t)
  const times = events.map((e) => e.t)
  const prefix = [0]
  for (const e of events) prefix.push(prefix.at(-1) + e.r)
  // Close of the day that ends at T, keyed by T (00:00 UTC).
  const closeAt = new Map(d.candles.map((c) => [c.time + DAY, c.close]))
  coins[sym] = { times, prefix, closeAt, first: d.candles[0].time + DAY, last: d.candles.at(-1).time + DAY }
}
/** Index of the first event strictly after t. */
function upper(times, t) {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (times[m] <= t) lo = m + 1
    else hi = m
  }
  return lo
}
/** Sum of funding rates with a < t ≤ b: what a long pays over (a, b]. */
const fundingSum = (c, a, b) => c.prefix[upper(c.times, b)] - c.prefix[upper(c.times, a)]

const START = Date.parse('2022-01-01T00:00:00Z') + 30 * DAY
const END = Math.max(...Object.values(coins).map((c) => c.last))
console.log(`FINANCIACIÓN · ${Object.keys(coins).length} perpetuos de Binance, ${new Date(START).toISOString().slice(0, 10)} → ${new Date(END).toISOString().slice(0, 10)}`)

// ── 0. Does Binance describe what the X-Perps pay? ───────────────────────────
console.log('\n=== 0. ¿PAGAN LOS X-PERP LO MISMO QUE BINANCE? (últimos ~3 meses) ===')
{
  const rows = []
  const pooledX = []
  const pooledB = []
  for (const f of readdirSync(`${DIR}/xperp`)) {
    const sym = f.replace('.json', '')
    const c = coins[sym]
    if (!c) continue
    const x = JSON.parse(readFileSync(`${DIR}/xperp/${f}`, 'utf8'))
    if (x.funding.length < 60) continue
    const t0 = Math.ceil(x.funding[0].t / DAY) * DAY
    const t1 = Math.floor(x.funding.at(-1).t / DAY) * DAY
    const xs = []
    const bs = []
    for (let t = t0 + DAY; t <= t1; t += DAY) {
      xs.push(x.funding.filter((e) => e.t > t - DAY && e.t <= t).reduce((s, e) => s + e.r, 0))
      bs.push(fundingSum(c, t - DAY, t))
    }
    pooledX.push(...xs)
    pooledB.push(...bs)
    rows.push({ sym, days: xs.length, x: mean(xs) * 365, b: mean(bs) * 365, r: corr(xs, bs) })
  }
  console.log('  moneda   días   X-Perp (anual)   Binance (anual)   correlación diaria')
  for (const r of rows) {
    console.log(`  ${r.sym.padEnd(7)} ${String(r.days).padStart(5)}   ${pct(r.x).padStart(12)}   ${pct(r.b).padStart(14)}   ${num(r.r).padStart(10)}`)
  }
  measured.xperpBinanceCorrelation = corr(pooledX, pooledB)
  console.log(`  TODAS          ${pct(mean(pooledX) * 365).padStart(12)}   ${pct(mean(pooledB) * 365).padStart(14)}   ${num(corr(pooledX, pooledB)).padStart(10)}`)
}

// ── 1. Carry ─────────────────────────────────────────────────────────────────
console.log('\n=== 1. CARRY · spot + corto en el perpetuo, cobrando la financiación ===')
console.log('  Entra si los últimos 7 días pagaron > 10 % anual; sale si pagaron ≤ 0.')
console.log('  Rendimiento anual sobre el nominal cubierto, neto de comisiones.\n')
const carryDaily = {} // day → [net return of each coin in carry that day] (hold-what-you-own costs)
{
  const scenarios = [
    { key: 'own', label: 'ya tienes la moneda', cost: 2 * TAKER },
    { key: 'spotMaker', label: 'compras spot (límite)', cost: 2 * (SPOT_MAKER + TAKER) },
    { key: 'spotTaker', label: 'compras spot (mercado)', cost: 2 * (SPOT_TAKER + TAKER) },
  ]
  const res = {}
  const half = (START + END) / 2
  for (const [sym, c] of Object.entries(coins)) {
    let inPos = false
    const days = { all: 0, first: 0, second: 0 }
    const income = { all: 0, first: 0, second: 0 }
    let trips = { all: 0, first: 0, second: 0 }
    let always = 0
    let alwaysDays = 0
    for (let t = Math.max(START, c.first + 30 * DAY); t + DAY <= c.last; t += DAY) {
      const trailing = (fundingSum(c, t - WEEK, t) * 365) / 7
      const part = t < half ? 'first' : 'second'
      if (!inPos && trailing > 0.1) {
        inPos = true
        trips = { ...trips, all: trips.all + 1, [part]: trips[part] + 1 }
      } else if (inPos && trailing <= 0) inPos = false
      const next = fundingSum(c, t, t + DAY)
      always += next
      alwaysDays++
      if (inPos) {
        days.all++
        days[part]++
        income.all += next
        income[part] += next
        ;(carryDaily[t] ??= []).push(next)
      }
    }
    res[sym] = { days, income, trips, always: (always / alwaysDays) * 365 }
  }
  const years = (d) => d / 365
  console.log('  moneda   días dentro  ciclos   siempre corto   ' + scenarios.map((s) => s.label.padStart(24)).join(''))
  const pooled = { days: 0, income: 0, trips: 0 }
  for (const [sym, r] of Object.entries(res)) {
    pooled.days += r.days.all
    pooled.income += r.income.all
    pooled.trips += r.trips.all
    const cells = scenarios.map((s) =>
      pct(r.days.all ? (r.income.all - r.trips.all * s.cost) / years(r.days.all) : NaN).padStart(24),
    )
    console.log(`  ${sym.padEnd(7)} ${String(r.days.all).padStart(10)}  ${String(r.trips.all).padStart(6)}   ${pct(r.always).padStart(13)}   ${cells.join('')}`)
  }
  measured.ownApr = (pooled.income - pooled.trips * scenarios[0].cost) / years(pooled.days)
  measured.spotLimitApr = (pooled.income - pooled.trips * scenarios[1].cost) / years(pooled.days)
  measured.coins = Object.keys(res).length
  measured.halves = []
  const cellsAll = scenarios.map((s) => pct((pooled.income - pooled.trips * s.cost) / years(pooled.days)).padStart(24))
  console.log(`  TODAS   ${String(pooled.days).padStart(10)}  ${String(pooled.trips).padStart(6)}   ${''.padStart(13)}   ${cellsAll.join('')}`)
  for (const part of ['first', 'second']) {
    let d = 0
    let inc = 0
    let tr = 0
    for (const r of Object.values(res)) {
      d += r.days[part]
      inc += r.income[part]
      tr += r.trips[part]
    }
    measured.halves.push((inc - tr * scenarios[0].cost) / years(d))
    console.log(`  ${part === 'first' ? '1ª mitad' : '2ª mitad'}                          ` + scenarios.map((s) => pct((inc - tr * s.cost) / years(d)).padStart(24)).join(''))
  }
  // By year, for the cheapest scenario.
  const byYear = {}
  for (const [t, xs] of Object.entries(carryDaily)) {
    const y = new Date(+t).getUTCFullYear()
    ;(byYear[y] ??= []).push(mean(xs))
  }
  console.log('  por año (bruto, cartera igual-ponderada de lo que esté dentro): ' + Object.entries(byYear).map(([y, xs]) => `${y} ${pct(mean(xs) * 365)}`).join(' · '))
}

// ── 1b. The same rule, on the X-Perps themselves ─────────────────────────────
// Binance only says what carry paid there. These three months are what the
// contracts this account can trade actually paid, under the same rule.
console.log('\n=== 1b. CARRY EN LOS X-PERP · misma regla, los ~3 meses que guarda OKX ===')
{
  let days = 0
  let income = 0
  let trips = 0
  let allDays = 0
  let allIncome = 0
  const perCoin = []
  for (const f of readdirSync(`${DIR}/xperp`)) {
    const x = JSON.parse(readFileSync(`${DIR}/xperp/${f}`, 'utf8'))
    if (x.funding.length < 60) continue
    const ev = x.funding
    const sumIn = (a, b) => ev.filter((e) => e.t > a && e.t <= b).reduce((s2, e) => s2 + e.r, 0)
    const t0 = Math.ceil(ev[0].t / DAY) * DAY + WEEK
    const t1 = Math.floor(ev.at(-1).t / DAY) * DAY
    let inPos = false
    let d = 0
    let inc = 0
    let tr = 0
    for (let t = t0; t + DAY <= t1; t += DAY) {
      const trailing = (sumIn(t - WEEK, t) * 365) / 7
      if (!inPos && trailing > 0.1) {
        inPos = true
        tr++
      } else if (inPos && trailing <= 0) inPos = false
      const next = sumIn(t, t + DAY)
      allDays++
      allIncome += next
      if (inPos) {
        d++
        inc += next
      }
    }
    days += d
    income += inc
    trips += tr
    perCoin.push({ sym: f.replace('.json', ''), d, apr: d ? ((inc - tr * 2 * TAKER) / d) * 365 : NaN })
  }
  console.log(`  ${perCoin.length} contratos · ${days} días dentro de ${allDays} · ${trips} ciclos`)
  console.log(`  siempre corto: ${pct((allIncome / allDays) * 365)} anual · con la regla, ya teniendo la moneda: ${pct(((income - trips * 2 * TAKER) / days) * 365)}` +
    ` · comprando spot (límite): ${pct(((income - trips * 2 * (SPOT_MAKER + TAKER)) / days) * 365)} · (mercado): ${pct(((income - trips * 2 * (SPOT_TAKER + TAKER)) / days) * 365)}`)
  measured.xperpOwnApr = ((income - trips * 2 * TAKER) / days) * 365
  measured.xperpSpotLimitApr = ((income - trips * 2 * (SPOT_MAKER + TAKER)) / days) * 365
  measured.xperpBtcApr = perCoin.find((c) => c.sym === 'BTC')?.apr
  const neg = perCoin.filter((c) => c.apr < 0).map((c) => `${c.sym} ${pct(c.apr)}`)
  console.log(`  contratos negativos con la regla (ya teniendo la moneda): ${neg.length ? neg.join(' · ') : 'ninguno'}`)
}

// ── 1c. Is 10 % a lucky threshold? ───────────────────────────────────────────
console.log('\n=== 1c. CARRY · umbral de entrada vecino (Binance, ya teniendo la moneda / comprando spot límite) ===')
for (const enter of [0.05, 0.1, 0.2, 0.3]) {
  let days = 0
  let income = 0
  let trips = 0
  const halfT = (START + END) / 2
  const part = { first: [0, 0, 0], second: [0, 0, 0] }
  for (const c of Object.values(coins)) {
    let inPos = false
    for (let t = Math.max(START, c.first + 30 * DAY); t + DAY <= c.last; t += DAY) {
      const trailing = (fundingSum(c, t - WEEK, t) * 365) / 7
      const h = t < halfT ? part.first : part.second
      if (!inPos && trailing > enter) {
        inPos = true
        trips++
        h[2]++
      } else if (inPos && trailing <= 0) inPos = false
      if (inPos) {
        const next = fundingSum(c, t, t + DAY)
        days++
        income += next
        h[0]++
        h[1] += next
      }
    }
  }
  const apr = (inc, d, tr, cost) => ((inc - tr * cost) / d) * 365
  console.log(
    `  entra > ${String(enter * 100).padStart(2)} %: ${pct(apr(income, days, trips, 2 * TAKER))} / ${pct(apr(income, days, trips, 2 * (SPOT_MAKER + TAKER)))}` +
      ` · mitades ${pct(apr(part.first[1], part.first[0], part.first[2], 2 * TAKER))} / ${pct(apr(part.second[1], part.second[0], part.second[2], 2 * TAKER))}` +
      ` · ${days} días-moneda dentro`,
  )
}

// ── 2. Contrarian ────────────────────────────────────────────────────────────
console.log('\n=== 2. CONTRARIA · financiación extrema → posición opuesta 7 días ===')
const contrarianByWeek = {}
{
  const trades = []
  const baseline = { long: [], short: [] }
  for (const [sym, c] of Object.entries(coins)) {
    const hist = []
    let busyUntil = 0
    for (let t = c.first + 4 * DAY; t + WEEK <= c.last; t += DAY) {
      const s3 = fundingSum(c, t - 3 * DAY, t)
      const past = hist.filter((h) => h.t > t - 365 * DAY).map((h) => h.v)
      hist.push({ t, v: s3 })
      const p0 = c.closeAt.get(t)
      const p1 = c.closeAt.get(t + WEEK)
      if (!p0 || !p1 || t < START) continue
      const ret = p1 / p0 - 1
      const fund = fundingSum(c, t, t + WEEK)
      // What each side makes on any day: the control for the signal.
      baseline.long.push(ret - fund - 2 * TAKER)
      baseline.short.push(-ret + fund - 2 * TAKER)
      if (past.length < 180 || t < busyUntil) continue
      const sorted = [...past].sort((a, b) => a - b)
      const hi = sorted[Math.floor(sorted.length * 0.9)]
      const lo = sorted[Math.floor(sorted.length * 0.1)]
      let side = null
      if (s3 >= hi) side = 'short'
      else if (s3 <= lo) side = 'long'
      if (!side) continue
      const net = (side === 'long' ? ret - fund : -ret + fund) - 2 * TAKER
      trades.push({ sym, t, side, net, fund: side === 'long' ? -fund : fund })
      ;(contrarianByWeek[Math.floor(t / WEEK)] ??= []).push(net)
      busyUntil = t + WEEK
    }
  }
  const half = (START + END) / 2
  const show = (label, xs, base) => {
    const weeks = {}
    for (const x of xs) (weeks[Math.floor(x.t / WEEK)] ??= []).push(x.net)
    const [lo, hi] = bootstrap(Object.values(weeks))
    const f = xs.filter((x) => x.t < half).map((x) => x.net)
    const s = xs.filter((x) => x.t >= half).map((x) => x.net)
    console.log(
      `  ${label.padEnd(8)} n=${String(xs.length).padStart(4)}  neto ${pct(mean(xs.map((x) => x.net)))} por operación de 7 días` +
        `  (1ª ${pct(mean(f))} / 2ª ${pct(mean(s))})  IC95 [${pct(lo)}, ${pct(hi)}]` +
        `  · mismo lado cualquier día ${pct(mean(base))} → ventaja ${pct(mean(xs.map((x) => x.net)) - mean(base))}` +
        `  · de ella, financiación ${pct(mean(xs.map((x) => x.fund)))}`,
    )
  }
  show('largos', trades.filter((x) => x.side === 'long'), baseline.long)
  show('cortos', trades.filter((x) => x.side === 'short'), baseline.short)
  measured.contrarianShortWeekly = mean(trades.filter((x) => x.side === 'short').map((x) => x.net))
  show('todo', trades, [...baseline.long, ...baseline.short])
  const d = deflate(trades.map((x) => x.net), 1)
  console.log(`  Sharpe por operación ${num(d.sharpe, 3)} · PSR ${(d.psr * 100).toFixed(1)} %`)
}

// ── 3. Cross-section ─────────────────────────────────────────────────────────
console.log('\n=== 3. CARTERA NEUTRAL · largo la financiación baja, corto la alta, cada 7 días ===')
function crossSection({ lookback = 7, frac = 0.2, minCoins = 10 } = {}) {
  const weeks = []
  let prev = new Map()
  for (let t = START; t + WEEK <= END; t += WEEK) {
    const board = []
    for (const [sym, c] of Object.entries(coins)) {
      // A month listed before it can be ranked: the first weeks of a new perp
      // carry launch-day funding that says nothing about the crowd.
      if (t < c.first + 30 * DAY) continue
      const p0 = c.closeAt.get(t)
      const p1 = c.closeAt.get(t + WEEK)
      if (!p0 || !p1) continue
      board.push({ sym, signal: fundingSum(c, t - lookback * DAY, t), ret: p1 / p0 - 1, fund: fundingSum(c, t, t + WEEK) })
    }
    if (board.length < minCoins) {
      prev = new Map()
      continue
    }
    board.sort((a, b) => a.signal - b.signal)
    const k = Math.max(1, Math.floor(board.length * frac))
    const w = new Map()
    for (const x of board.slice(0, k)) w.set(x.sym, 1 / k)
    for (const x of board.slice(-k)) w.set(x.sym, -1 / k)
    let price = 0
    let funding = 0
    for (const x of board) {
      const wi = w.get(x.sym) ?? 0
      price += wi * x.ret
      // A long pays the rate, a short collects it.
      funding += -wi * x.fund
    }
    let turnover = 0
    for (const sym of new Set([...w.keys(), ...prev.keys()])) turnover += Math.abs((w.get(sym) ?? 0) - (prev.get(sym) ?? 0))
    const cost = turnover * TAKER
    weeks.push({ t, price, funding, cost, net: price + funding - cost, n: board.length })
    prev = w
  }
  return weeks
}
function report(label, weeks, trials) {
  const nets = weeks.map((w) => w.net)
  const half = weeks[Math.floor(weeks.length / 2)]?.t ?? 0
  const f = weeks.filter((w) => w.t < half).map((w) => w.net)
  const s = weeks.filter((w) => w.t >= half).map((w) => w.net)
  const [lo, hi] = bootstrap(nets.map((x) => [x]))
  let peak = 0
  let eq = 0
  let dd = 0
  for (const x of nets) {
    eq += x
    peak = Math.max(peak, eq)
    dd = Math.min(dd, eq - peak)
  }
  const d = deflate(nets, trials)
  console.log(
    `  ${label.padEnd(26)} ${String(weeks.length).padStart(3)} sem · anual ${pct(mean(nets) * 52).padStart(9)}` +
      ` (precio ${pct(mean(weeks.map((w) => w.price)) * 52)}, financiación ${pct(mean(weeks.map((w) => w.funding)) * 52)}, costes ${pct(-mean(weeks.map((w) => w.cost)) * 52)})` +
      ` · mitades ${pct(mean(f) * 52)} / ${pct(mean(s) * 52)} · IC95 anual [${pct(lo * 52)}, ${pct(hi * 52)}]` +
      ` · Sharpe anual ${num((mean(nets) / sd(nets)) * Math.sqrt(52))} · peor caída ${pct(dd)} · DSR ${(d.dsr * 100).toFixed(0)} % (aguanta ${d.survives})`,
  )
  return weeks
}
const TRIALS_XS = 4
const main = report('7 días · quintiles', crossSection(), TRIALS_XS)
report('3 días · quintiles', crossSection({ lookback: 3 }), TRIALS_XS)
report('30 días · quintiles', crossSection({ lookback: 30 }), TRIALS_XS)
report('7 días · tercios', crossSection({ frac: 1 / 3 }), TRIALS_XS)
{
  const byYear = {}
  for (const w of main) (byYear[new Date(w.t).getUTCFullYear()] ??= []).push(w.net)
  console.log('  por año (7 días · quintiles): ' + Object.entries(byYear).map(([y, xs]) => `${y} ${pct(mean(xs) * 52)}`).join(' · '))
}

// ── 4. Diversification ───────────────────────────────────────────────────────
console.log('\n=== 4. ¿SE MUEVE DISTINTO DE LO QUE YA HAY? correlación de resultados mensuales ===')
{
  const monthOf = (t) => new Date(t).toISOString().slice(0, 7)
  const series = {}
  const add = (name, t, v) => {
    series[name] ??= {}
    series[name][monthOf(t)] = (series[name][monthOf(t)] ?? 0) + v
  }
  for (const w of main) add('cartera neutral', w.t, w.net)
  for (const [t, xs] of Object.entries(contrarianByWeek)) for (const x of xs) add('contraria', +t * WEEK, x)
  for (const [t, xs] of Object.entries(carryDaily)) add('carry', +t, mean(xs))
  const btc = coins.BTC
  for (let t = START; t + DAY <= END; t += DAY) {
    const a = btc.closeAt.get(t)
    const b = btc.closeAt.get(t + DAY)
    if (a && b) add('BTC (comprar y mantener)', t, b / a - 1)
  }
  const CANDLES = './.candles'
  const files = readdirSync(CANDLES)
  for (const s of STRATEGIES) {
    const profile = s.presets[0]?.backtest ?? s.backtest
    const tf = profile.nativeTimeframe ?? '1D'
    for (const f of files.filter((x) => x.endsWith(`__${tf}.json`))) {
      const cs = JSON.parse(readFileSync(`${CANDLES}/${f}`, 'utf8'))
      if (cs.length < 250) continue
      for (const sig of s.run(cs, s.presets[0]?.key).signals) {
        if (sig.outcome === 'open') continue
        add(`${s.label} (${tf})`, sig.closedTime ?? sig.time, (sig.resultR ?? 0) - sig.feeR)
      }
    }
  }
  const names = Object.keys(series)
  const months = Object.keys(series['cartera neutral']).filter((m) => names.every((n) => m in (series[n] ?? {})) || true)
  console.log('  ' + ''.padEnd(26) + names.map((n) => n.slice(0, 14).padStart(15)).join(''))
  for (const a of names) {
    const cells = names.map((b) => {
      const common = months.filter((m) => m in series[a] && m in series[b])
      if (common.length < 12) return '—'.padStart(15)
      const r = corr(common.map((m) => series[a][m]), common.map((m) => series[b][m]))
      if (a === 'carry' && b.startsWith('Reversión')) measured.correlation.reversal = r
      if (a === 'carry' && b.startsWith('Ruptura')) measured.correlation.donchian = r
      if (a === 'carry' && b.startsWith('Apertura')) measured.correlation.opening = r
      return num(r).padStart(15)
    })
    console.log(`  ${a.padEnd(26)}${cells.join('')}`)
  }
}

// ── 5. Does the page quote what was measured? ────────────────────────────────
console.log('\n=== DESVIACIONES · lo que cita la página de Financiación (CARRY_EVIDENCE) ===')
{
  const problems = []
  const check = (name, got, want, tol) => {
    if (!Number.isFinite(got) || Math.abs(got - want) > tol) problems.push(`${name}: medido ${num(got, 4)} vs declarado ${want}`)
  }
  const e = CARRY_EVIDENCE
  check('ownApr', measured.ownApr, e.ownApr, 0.005)
  check('spotLimitApr', measured.spotLimitApr, e.spotLimitApr, 0.005)
  check('halves[0]', measured.halves[0], e.halves[0], 0.005)
  check('halves[1]', measured.halves[1], e.halves[1], 0.005)
  check('coins', measured.coins, e.coins, 0)
  check('xperpOwnApr', measured.xperpOwnApr, e.xperpOwnApr, 0.005)
  check('xperpSpotLimitApr', measured.xperpSpotLimitApr, e.xperpSpotLimitApr, 0.005)
  check('xperpBtcApr', measured.xperpBtcApr, e.xperpBtcApr, 0.005)
  check('xperpBinanceCorrelation', measured.xperpBinanceCorrelation, e.xperpBinanceCorrelation, 0.02)
  check('correlation.reversal', measured.correlation.reversal, e.correlation.reversal, 0.02)
  check('correlation.donchian', measured.correlation.donchian, e.correlation.donchian, 0.02)
  check('correlation.opening', measured.correlation.opening, e.correlation.opening, 0.02)
  check('contrarianShortWeekly', measured.contrarianShortWeekly, e.contrarianShortWeekly, 0.001)
  if (!problems.length) console.log('  ninguna: la página dice exactamente lo que miden los datos')
  for (const p of problems) console.log(`  ⚠ ${p}`)
  if (problems.length) process.exitCode = 1
}
