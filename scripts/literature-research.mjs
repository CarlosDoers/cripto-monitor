// What a search of the literature and of retail's favourite claims found, in one
// place (2026-10-11). Rules are written down BEFORE the numbers; where a source is
// loose the reading here is mine and is stated at the section.
//
//   npm run research              every section whose data is on disk
//   npm run research ensemble     Zarattini, Pagani & Barbon (2025): nine Donchian lookbacks, long only,
//                                 volatility-targeted — on BTC, ETH and the 14 coins with full history
//   npm run research factors      cross-section of the board: momentum, reversal, trend, lottery, volatility,
//                                 liquidity (Liu-Tsyvinski-Wu 2022, Zaremba et al. 2021, Fieberg et al. 2025)
//   npm run research cme          the "CME gap always fills" claim, on spot BTC and ETH hourly bars
//   npm run research fng          the Fear & Greed index as a contrarian signal (alternative.me, since 2018)
//   npm run research stable       growth of the stablecoin supply (DefiLlama) as a predictor of BTC
//   npm run research mvrv         market value to realised value (Coin Metrics community data) as a predictor
//   npm run research survivor     the cross-section again on every pair Binance ever listed, dead ones included
//                                 (needs `node scripts/fetch-binance-daily.mjs`), with the checks that say what
//                                 the one factor that survives is made of: windows, lag, weekdays, age, regime
//
// Data: the daily boards (`node scripts/fetch-board.mjs 1D`, `BOARD_OLD=1 … 1D`), the audit's `.candles`
// for the hourly bars, and three free public APIs cached in ./.research (gitignored; REFRESH=1 re-fetches).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { RELATIVE_STRENGTH_EVIDENCE } from '../src/lib/relativeStrength.ts'
import { resolveTrade } from '../src/lib/indicators/tradeKit.ts'

const section = process.argv[2] ?? 'all'
const want = (name) => section === 'all' || section === name

// ── helpers ──────────────────────────────────────────────────────────────────
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const sd = (xs) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const f = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '   — ')
const p = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)} %` : '   — ')
const DAY = 86_400_000
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)
let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** One coin's daily candles: the 2018–21 board followed by the 2021–26 one, no duplicates. */
function daily(coin) {
  const out = []
  for (const dir of ['./.candles-board-1Dold', './.candles-board-1D']) {
    const path = `${dir}/${coin}.json`
    if (existsSync(path)) out.push(...readJson(path))
  }
  out.sort((a, b) => a.time - b.time)
  return out.filter((c, i) => c.confirmed !== false && (i === 0 || c.time > out[i - 1].time))
}
function boardCoins(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((x) => x.endsWith('.json') && !x.startsWith('_'))
    .map((x) => x.replace('.json', ''))
}

/** Statistics of a series of daily returns (365 days a year: crypto does not close). */
function stats(r) {
  const n = r.length
  let eq = 1
  let peak = 1
  let mdd = 0
  for (const x of r) {
    eq *= 1 + x
    peak = Math.max(peak, eq)
    mdd = Math.min(mdd, eq / peak - 1)
  }
  const s = sd(r)
  return {
    n,
    cagr: n ? eq ** (365 / n) - 1 : NaN,
    vol: s * Math.sqrt(365),
    sharpe: s > 0 ? (mean(r) / s) * Math.sqrt(365) : NaN,
    mdd,
    total: eq - 1,
  }
}
const row = (label, r) => {
  const s = stats(r)
  return `     ${label.padEnd(46)} CAGR ${p(s.cagr).padStart(9)}  vol ${p(s.vol, 0).padStart(6)}  Sharpe ${f(s.sharpe).padStart(6)}  caída máx. ${p(s.mdd, 0).padStart(7)}`
}
/** 95 % interval of Sharpe(a) − Sharpe(b) resampling 20-day blocks of days (both series share the days). */
function sharpeDiffCI(a, b, block = 20, runs = 2000) {
  const n = a.length
  const diffs = []
  for (let k = 0; k < runs; k++) {
    const ra = []
    const rb = []
    while (ra.length < n) {
      const s0 = Math.floor(rnd() * (n - block))
      for (let j = 0; j < block; j++) {
        ra.push(a[s0 + j])
        rb.push(b[s0 + j])
      }
    }
    diffs.push(stats(ra).sharpe - stats(rb).sharpe)
  }
  diffs.sort((x, y) => x - y)
  return [diffs[Math.floor(runs * 0.025)], diffs[Math.floor(runs * 0.975)]]
}

async function cached(name, url, pick) {
  mkdirSync('./.research', { recursive: true })
  const path = `./.research/${name}.json`
  if (existsSync(path) && !process.env.REFRESH) return readJson(path)
  const out = await pick(url)
  writeFileSync(path, JSON.stringify(out))
  return out
}

/** Binance spot 1 h bars of one symbol, from the public data portal's monthly files, up to `until`. */
async function binanceHourly(symbol, since, until) {
  const key = `binance-1h-${symbol}`
  mkdirSync('./.research', { recursive: true })
  const path = `./.research/${key}.json`
  if (existsSync(path) && !process.env.REFRESH) return readJson(path)
  const bars = []
  const start = new Date(since)
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); Date.UTC(y, m, 1) < until; m++) {
    if (m > 11) {
      m = 0
      y++
    }
    const name = `${symbol}-1h-${y}-${String(m + 1).padStart(2, '0')}`
    const res = await fetch(`https://data.binance.vision/data/spot/monthly/klines/${symbol}/1h/${name}.zip`)
    if (!res.ok) continue
    const buf = Buffer.from(await res.arrayBuffer())
    const size = buf.readUInt32LE(18)
    const head = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28)
    const text = (buf.readUInt16LE(8) === 8 ? inflateRawSync(buf.subarray(head, head + size)) : buf.subarray(head, head + size)).toString('utf8')
    for (const line of text.split('\n')) {
      const c = line.split(',')
      if (c.length < 6 || !/^\d/.test(c[0])) continue
      let t = Number(c[0])
      if (t > 1e14) t = Math.floor(t / 1000)
      if (t < until) bars.push({ time: t, open: +c[1], high: +c[2], low: +c[3], close: +c[4], vol: +c[5] })
    }
  }
  bars.sort((a, b) => a.time - b.time)
  writeFileSync(path, JSON.stringify(bars))
  return bars
}

// ── 1. the Donchian ensemble ─────────────────────────────────────────────────
// Source: "Catching Crypto Trends: A Tactical Approach for Bitcoin and Altcoins", Zarattini, Pagani &
// Barbon (SSRN 5209907, 2025). What its public summary says: an ensemble of Donchian channels over nine
// lookbacks (examples 5 to 360 days), "classic long-only breakout", volatility-based sizing to 25 % a
// year, allocation capped at 200 %, net of fees; BTC since 2015 CAGR 30 %, Sharpe 1.56, drawdown 19 %;
// the top 20 most liquid names rotated monthly, Sharpe above 1.5. The full text was not reachable, so:
//
// Reading fixed before any result — 1. lookbacks 5, 10, 20, 30, 60, 90, 150, 250, 360 days. 2. For
// each, long when the close is above the highest high of the previous L days, flat when it is below
// the lowest low of those L days. 3. Signal s = share of the nine that are long. 4. Weight
// w = min(2, s × 25 % / σ), σ the 30-day standard deviation of daily returns × √365, known at the
// close; the weight earns the next day's return. 5. Cost 0.05 % a side of the weight changed (taker).
// Variants, counted: exit at the middle of the channel instead of its far band; σ over 20 and 60 days.
if (want('ensemble')) {
  console.log('\n=== CONJUNTO DE CANALES DONCHIAN CON VOLATILIDAD OBJETIVO (Zarattini, Pagani y Barbon, 2025) ===')
  const LOOKBACKS = [5, 10, 20, 30, 60, 90, 150, 250, 360]

  const states = (c, L, exitMode) => {
    const n = c.length
    const st = new Array(n).fill(NaN)
    let on = 0
    for (let i = L; i < n; i++) {
      let hi = -Infinity
      let lo = Infinity
      for (let j = i - L; j < i; j++) {
        hi = Math.max(hi, c[j].high)
        lo = Math.min(lo, c[j].low)
      }
      const exitLevel = exitMode === 'mid' ? (hi + lo) / 2 : lo
      if (i === L) on = c[i].close > (hi + lo) / 2 ? 1 : 0
      else if (!on && c[i].close > hi) on = 1
      else if (on && c[i].close < exitLevel) on = 0
      st[i] = on
    }
    return st
  }

  /** Daily net returns of the ensemble on one coin, with the dates they belong to and the weights used. */
  function run(c, { lookbacks = LOOKBACKS, exitMode = 'band', volLen = 30, target = 0.25, cap = 2, side = 0.0005 } = {}) {
    const n = c.length
    const all = lookbacks.map((L) => states(c, L, exitMode))
    // Every variant is evaluated over the same days: from the longest lookback of the full ensemble.
    const start = Math.max(360, ...lookbacks, volLen + 1)
    const ret = (i) => c[i].close / c[i - 1].close - 1
    const out = { time: [], r: [], bh: [], w: [], tv: [] }
    let prevW = 0
    for (let i = start; i < n - 1; i++) {
      const s = mean(all.map((a) => (a[i] === 1 ? 1 : 0)))
      const window = []
      for (let j = i - volLen + 1; j <= i; j++) window.push(Math.log(c[j].close / c[j - 1].close))
      const sigma = sd(window) * Math.sqrt(365)
      const w = Math.min(cap, (s * target) / sigma)
      const day = ret(i + 1)
      out.time.push(c[i + 1].time)
      out.r.push(w * day - Math.abs(w - prevW) * side)
      out.bh.push(day)
      out.w.push(w)
      out.tv.push(Math.min(cap, target / sigma) * day)
      prevW = w
    }
    return out
  }

  const report = (label, o) => {
    console.log(`  ── ${label} · ${iso(o.time[0])} → ${iso(o.time[o.time.length - 1])} · ${o.r.length} días · exposición media ${mean(o.w).toFixed(2)}`)
    const avg = mean(o.w)
    const control = o.bh.map((x) => avg * x)
    console.log(row('mantener', o.bh))
    console.log(row('mantener con la misma volatilidad objetivo', o.tv))
    console.log(row('mantener con la misma exposición media', control))
    console.log(row('CONJUNTO (el descrito)', o.r))
    const [lo, hi] = sharpeDiffCI(o.r, control)
    console.log(`     Sharpe del conjunto − mantener a la misma exposición: ${f(stats(o.r).sharpe - stats(control).sharpe)}  [${f(lo)}, ${f(hi)}]`)
    const half = Math.floor(o.r.length / 2)
    console.log(
      `     mitades (Sharpe): conjunto ${f(stats(o.r.slice(0, half)).sharpe)} / ${f(stats(o.r.slice(half)).sharpe)}   mantener ${f(stats(o.bh.slice(0, half)).sharpe)} / ${f(stats(o.bh.slice(half)).sharpe)}`,
    )
    const years = {}
    o.time.forEach((t, i) => (years[new Date(t).getUTCFullYear()] ??= { r: [], bh: [] }, years[new Date(t).getUTCFullYear()].r.push(o.r[i]), years[new Date(t).getUTCFullYear()].bh.push(o.bh[i])))
    console.log(
      '     por año (total conjunto / total mantener): ' +
        Object.entries(years)
          .map(([y, v]) => `${y} ${p(stats(v.r).total, 0)}/${p(stats(v.bh).total, 0)}`)
          .join('  '),
    )
  }

  for (const coin of ['BTC', 'ETH']) {
    const c = daily(coin)
    if (c.length < 800) continue
    report(`${coin}`, run(c))
  }
  const btc = daily('BTC')
  console.log('\n  Variantes contadas sobre BTC (cada una cambia una cosa):')
  report('BTC · salida en el centro del canal', run(btc, { exitMode: 'mid' }))
  report('BTC · volatilidad a 20 días', run(btc, { volLen: 20 }))
  report('BTC · volatilidad a 60 días', run(btc, { volLen: 60 }))
  console.log('\n  El Donchian de 20 días solo (lo más parecido a lo que ya se ofrece), mismas reglas de tamaño:')
  report('BTC · solo la ventana de 20 días', run(btc, { lookbacks: [20] }))

  // The rotation: the coins with the whole history, each its own ensemble, equal weight.
  const names = boardCoins('./.candles-board-1D').filter((x) => daily(x).length >= 1700)
  const per = names.map((x) => [x, run(daily(x))])
  const dates = new Map()
  for (const [, o] of per) o.time.forEach((t, i) => (dates.get(t) ?? dates.set(t, []).get(t)).push([o.r[i], o.bh[i], o.w[i], o.tv[i]]))
  const days = [...dates.entries()].filter(([, v]) => v.length >= Math.ceil(names.length * 0.8)).sort((a, b) => a[0] - b[0])
  const pool = { time: days.map(([t]) => t), r: days.map(([, v]) => mean(v.map((x) => x[0]))), bh: days.map(([, v]) => mean(v.map((x) => x[1]))), w: days.map(([, v]) => mean(v.map((x) => x[2]))), tv: days.map(([, v]) => mean(v.map((x) => x[3]))) }
  console.log(`\n  Cesta: ${names.length} monedas con historia completa (${names.join(', ')}), pesos iguales — hoy ${names.length} supervivientes.`)
  report('CESTA', pool)
}

// Factor values at index i of one coin's daily candles (closes known at that day), shared by both tests.
const sma = (c, i, L) => mean(c.slice(i - L + 1, i + 1).map((b) => b.close))
const FACTORS = {
  'momentum 1 sem.': (c, i) => c[i].close / c[i - 7].close - 1,
  'momentum 2 sem.': (c, i) => c[i].close / c[i - 14].close - 1,
  'momentum 4 sem.': (c, i) => c[i].close / c[i - 28].close - 1,
  'momentum 8 sem.': (c, i) => c[i].close / c[i - 56].close - 1,
  'momentum 12 sem.': (c, i) => c[i].close / c[i - 84].close - 1,
  'rentabilidad del último día': (c, i) => c[i].close / c[i - 1].close - 1,
  'cerca del máximo de 90 días': (c, i) => c[i].close / Math.max(...c.slice(i - 89, i + 1).map((b) => b.high)),
  'MAX 30 días (lotería)': (c, i) => Math.max(...c.slice(i - 29, i + 1).map((b, k, a) => (k ? b.close / a[k - 1].close - 1 : -1))),
  'volatilidad 30 días': (c, i) => sd(c.slice(i - 29, i + 1).map((b, k, a) => (k ? Math.log(b.close / a[k - 1].close) : 0)).slice(1)),
  'volumen en dólares 30 días': (c, i) => Math.log(mean(c.slice(i - 29, i + 1).map((b) => (b.qv ?? (b.vol ?? 0) * b.close))) + 1),
  'tendencia (medias bajo el precio)': (c, i) => [10, 20, 50, 100, 200].filter((L) => i >= L && c[i].close > sma(c, i, L)).length,
}

// ── 2. the cross-section ─────────────────────────────────────────────────────
// Sources: Liu, Tsyvinski & Wu (2022, J. Finance) — size, momentum (1 to 4 weeks) and volume factors;
// Zaremba et al. (2021) — daily reversal in most coins, momentum in the most liquid; Fieberg et al.
// (2025, JFQA) — a trend factor combining moving-average signals across horizons.
//
// Fixed before any result: every Sunday close (days where floor(day number / 7) changes, 00:00 UTC
// labelled) rank the coins that have at least 120 days of history and a price today and in a week;
// long the top third, short the bottom third, equal weight, held a week; weekly return from the daily
// closes. The factor values use only closes up to that day. Cost: 0.05 % a side of the weight
// changed. Factors: momentum over 1, 2, 4, 8 and 12 weeks; the last day's return (reversal);
// nearness to the 90-day high; the largest daily return of the last 30 days (MAX, "lottery");
// volatility over 30 days; average dollar volume over 30 days; and a trend count, the number of
// the 10 / 20 / 50 / 100 / 200-day averages the close is above.
if (want('factors')) {
  console.log('\n=== SECCIÓN CRUZADA: MOMENTUM, REVERSIÓN, TENDENCIA, LOTERÍA, VOLATILIDAD Y LIQUIDEZ ===')
  const periods = [
    ['2021-11 → 2026-10 (la cesta actual)', (t) => t >= Date.UTC(2021, 10, 1)],
    ['2018-01 → 2021-10 (un periodo que nadie ha tocado, 14 monedas)', (t) => t < Date.UTC(2021, 10, 1)],
  ]
  const coins = [...new Set([...boardCoins('./.candles-board-1D'), ...boardCoins('./.candles-board-1Dold')])]
  const data = new Map(coins.map((x) => [x, daily(x)]))
  const byDay = new Map() // coin → Map(dayNumber → index)
  for (const [x, c] of data) byDay.set(x, new Map(c.map((b, i) => [Math.round(b.time / DAY), i])))

  const MIN_HISTORY = 120
  const tvalue = (xs) => mean(xs) / (sd(xs) / Math.sqrt(xs.length))
  const side = 0.0005

  for (const [label, inPeriod] of periods) {
    const dayNums = []
    for (const c of data.values()) for (const b of c) if (inPeriod(b.time)) dayNums.push(Math.round(b.time / DAY))
    const lo = Math.min(...dayNums)
    const hi = Math.max(...dayNums)
    const rebalance = []
    for (let d = lo; d + 7 <= hi; d++) if (d % 7 === 0) rebalance.push(d)
    console.log(`\n  ── ${label} · ${rebalance.length} semanas`)
    console.log(
      `     ${'factor'.padEnd(34)} ${'L − S / sem.'.padStart(11)} ${'anual'.padStart(8)} ${'t'.padStart(6)} ${'sem. +'.padStart(7)} ${'neto'.padStart(9)} ${'mitades'.padStart(15)}  ${'largo − todas'.padStart(13)}  monedas`,
    )
    for (const [name, fn] of Object.entries(FACTORS)) {
      const weeks = []
      let prev = new Map()
      for (const d of rebalance) {
        const rows = []
        for (const [coin, c] of data) {
          const idx = byDay.get(coin).get(d)
          const next = byDay.get(coin).get(d + 7)
          if (idx === undefined || next === undefined || idx < MIN_HISTORY) continue
          const v = fn(c, idx)
          if (!Number.isFinite(v)) continue
          rows.push({ coin, v, r: c[next].close / c[idx].close - 1 })
        }
        if (rows.length < 6) continue
        rows.sort((a, b) => b.v - a.v)
        const k = Math.floor(rows.length / 3)
        const top = rows.slice(0, k)
        const bottom = rows.slice(rows.length - k)
        const w = new Map()
        top.forEach((x) => w.set(x.coin, 1 / k))
        bottom.forEach((x) => w.set(x.coin, (w.get(x.coin) ?? 0) - 1 / k))
        let turnover = 0
        for (const key of new Set([...w.keys(), ...prev.keys()])) turnover += Math.abs((w.get(key) ?? 0) - (prev.get(key) ?? 0))
        prev = w
        const ls = mean(top.map((x) => x.r)) - mean(bottom.map((x) => x.r))
        weeks.push({ d, ls, net: ls - turnover * side, longEx: mean(top.map((x) => x.r)) - mean(rows.map((x) => x.r)), n: rows.length })
      }
      if (weeks.length < 20) {
        console.log(`     ${name.padEnd(34)} (solo ${weeks.length} semanas)`)
        continue
      }
      const ls = weeks.map((x) => x.ls)
      const half = Math.floor(weeks.length / 2)
      console.log(
        `     ${name.padEnd(34)} ${p(mean(ls), 2).padStart(11)} ${p(mean(ls) * 52, 0).padStart(8)} ${f(tvalue(ls), 1).padStart(6)} ${(100 * ls.filter((x) => x > 0).length / ls.length).toFixed(0).padStart(6)}% ${p(mean(weeks.map((x) => x.net)), 2).padStart(9)} ${(p(mean(ls.slice(0, half)), 2) + ' / ' + p(mean(ls.slice(half)), 2)).padStart(15)}  ${p(mean(weeks.map((x) => x.longEx)), 2).padStart(13)}  ${mean(weeks.map((x) => x.n)).toFixed(0)}`,
      )
    }
  }
  console.log('\n  Con once factores, un t de 2,7 es lo que da la suerte en uno de ellos al 5 % (Bonferroni); no es un resultado: es el listón.')
  console.log('  Las monedas son las que sobrevivieron: eso favorece al largo y al momentum, y es un sesgo que esta cesta no puede quitar.')
}

// ── 3. the CME gap ───────────────────────────────────────────────────────────
// The claim: Bitcoin's CME futures close Friday 16:00 Chicago and reopen Sunday 17:00; the spot market
// does not stop, so the reopening price differs from the Friday close — a gap — and "gaps always fill".
// There is no CME data here, so spot at those two moments is the proxy (the basis, a fraction of a
// percent, is the noise). Fixed before any result: gap = Sunday 17:00 CT open / Friday 16:00 CT close − 1
// in the 1 h bars of BTC and ETH spot; only gaps of at least 0.3 %, 0.5 % and 1 %. "Fills" = price touches
// the Friday close within 1, 3 and 7 days. The control is the level the same distance on the OTHER side
// of the open (the gap's extension): if the gap pulled, the fill would be touched more often than that.
// Trade: at the Sunday open toward the Friday close, target the close, stop the same distance the other
// way (1 : 1), time stop 3 days, 0.1 % round trip; the control is the mirrored trade.
if (want('cme')) {
  console.log('\n=== EL «GAP DEL CME» SE CIERRA SIEMPRE ===')
  const chicago = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hour12: false })
  const clock = (ms) => {
    const parts = Object.fromEntries(chicago.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    return { dow: parts.weekday, hour: Number(parts.hour) % 24 }
  }
  const okx = (file) => async () => (existsSync(file) ? readJson(file).filter((b) => b.confirmed !== false) : null)
  const OKX_FROM = Date.UTC(2021, 11, 30)
  const sources = [
    ['BTC · OKX spot', okx('.candles/BTC_USDT__1H.json')],
    ['ETH · OKX spot', okx('.candles/ETH_USDT__1H.json')],
    // A period nothing here has seen: Binance's own spot hourly bars, up to where OKX's begin.
    ['BTC · Binance spot, 2017-08 → 2021-12', () => binanceHourly('BTCUSDT', Date.UTC(2017, 7, 1), OKX_FROM)],
    ['ETH · Binance spot, 2017-08 → 2021-12', () => binanceHourly('ETHUSDT', Date.UTC(2017, 7, 1), OKX_FROM)],
  ]
  for (const [name, loadBars] of sources) {
    const bars = await loadBars()
    if (!bars || bars.length < 1000) continue
    // Pair each Friday 16:00 CT bar with the Sunday 17:00 CT bar that follows it.
    const events = []
    for (let i = 0; i < bars.length - 1; i++) {
      const c = clock(bars[i].time)
      if (c.dow !== 'Fri' || c.hour !== 16) continue
      let j = i + 1
      while (j < bars.length && !(clock(bars[j].time).dow === 'Sun' && clock(bars[j].time).hour === 17)) {
        if (bars[j].time - bars[i].time > 4 * DAY) break
        j++
      }
      if (j >= bars.length || clock(bars[j].time).dow !== 'Sun') continue
      if (bars[j].time - bars[i].time !== 49 * 3_600_000 && bars[j].time - bars[i].time !== 48 * 3_600_000 && bars[j].time - bars[i].time !== 50 * 3_600_000) continue
      events.push({ i, j, close: bars[i].open, open: bars[j].open })
    }
    console.log(`\n  ── ${name} · ${events.length} fines de semana · ${iso(bars[0].time)} → ${iso(bars[bars.length - 1].time)}`)
    const touched = (from, level, hours) => {
      for (let k = from; k < Math.min(bars.length, from + hours); k++) if (bars[k].low <= level && level <= bars[k].high) return true
      return false
    }
    for (const min of [0.003, 0.005, 0.01]) {
      const sel = events.filter((e) => Math.abs(e.open / e.close - 1) >= min)
      if (sel.length < 10) continue
      const line = [`≥ ${(min * 100).toFixed(1)} %`.padEnd(8), `n=${String(sel.length).padStart(3)}`]
      for (const h of [24, 72, 168]) {
        const fill = sel.filter((e) => touched(e.j, e.close, h)).length / sel.length
        const ext = sel.filter((e) => touched(e.j, e.open + (e.open - e.close), h)).length / sel.length
        line.push(`${h / 24} d: se cierra ${(100 * fill).toFixed(0)} % · la extensión ${(100 * ext).toFixed(0)} %`)
      }
      console.log('     ' + line.join('   '))
      // the trade and its mirror
      const trades = (mirror) =>
        sel
          .map((e) => {
            const gapUp = e.open > e.close
            const dist = Math.abs(e.open - e.close)
            const towardFill = mirror ? gapUp : !gapUp // true = go long
            const side = towardFill ? 'long' : 'short'
            const entry = e.open
            const target = side === 'long' ? entry + dist : entry - dist
            const stop = side === 'long' ? entry - dist : entry + dist
            const sig = resolveTrade(bars, { index: e.j, side, entry, stop, target, maxBars: 72, intrabar: true }, { feeRate: 0.001 })
            if (sig.outcome === 'open' || !Number.isFinite(sig.resultR)) return null
            return { gross: sig.resultR, net: sig.resultR - sig.feeR, fee: sig.feeR }
          })
          .filter(Boolean)
      const a = trades(false)
      const b = trades(true)
      const hit = (xs) => xs.filter((x) => x.gross > 0).length / xs.length
      console.log(
        `        operar el cierre (1 : 1, 3 días): acierto ${(100 * hit(a)).toFixed(0)} %  bruto ${f(mean(a.map((x) => x.gross)))}  neto ${f(mean(a.map((x) => x.net)))} R   coste ${f(mean(a.map((x) => x.fee)))} R   |   el espejo: acierto ${(100 * hit(b)).toFixed(0)} %  bruto ${f(mean(b.map((x) => x.gross)))}  neto ${f(mean(b.map((x) => x.net)))} R`,
      )
    }

    // The mirror — keep going the way the weekend went — is the only cell that paid. What it is:
    // 1. by year and side; 2. the same trade after ANY 49-hour move of at least 0.5 %, started at
    // 17:00 Chicago on each weekday: if Sunday is no different, it is short-term momentum, not a gap.
    const cont = (from, ref, minMove) => {
      const move = bars[from].open / bars[ref].open - 1
      if (Math.abs(move) < minMove) return null
      const dist = Math.abs(bars[from].open - bars[ref].open)
      const side = move > 0 ? 'long' : 'short'
      const entry = bars[from].open
      const sig = resolveTrade(
        bars,
        { index: from, side, entry, stop: side === 'long' ? entry - dist : entry + dist, target: side === 'long' ? entry + dist : entry - dist, maxBars: 72, intrabar: true },
        { feeRate: 0.001 },
      )
      if (sig.outcome === 'open' || !Number.isFinite(sig.resultR)) return null
      return { gross: sig.resultR, net: sig.resultR - sig.feeR, side, t: bars[from].time }
    }
    const weekend = events
      .map((e) => cont(e.j, e.i, 0.005))
      .filter(Boolean)
    const summary = (xs) => `n=${String(xs.length).padStart(3)}  acierto ${(100 * xs.filter((x) => x.gross > 0).length / xs.length).toFixed(0)} %  bruto ${f(mean(xs.map((x) => x.gross)))}  neto ${f(mean(xs.map((x) => x.net)))} R`
    console.log(`\n     continuar el movimiento del fin de semana (≥ 0,5 %): ${summary(weekend)}`)
    const years = {}
    for (const x of weekend) (years[new Date(x.t).getUTCFullYear()] ??= []).push(x)
    console.log('        por año:  ' + Object.entries(years).map(([y, v]) => `${y} ${summary(v)}`).join('\n                  '))
    console.log(`        al alza: ${summary(weekend.filter((x) => x.side === 'long'))}\n        a la baja: ${summary(weekend.filter((x) => x.side === 'short'))}`)
    const half = Math.floor(weekend.length / 2)
    console.log(`        mitades: ${f(mean(weekend.slice(0, half).map((x) => x.net)))} / ${f(mean(weekend.slice(half).map((x) => x.net)))} R neto`)
    const dowName = { Sun: 'dom', Mon: 'lun', Tue: 'mar', Wed: 'mié', Thu: 'jue', Fri: 'vie', Sat: 'sáb' }
    const byDow = {}
    for (let k = 49; k < bars.length; k++) {
      const c = clock(bars[k].time)
      if (c.hour !== 17) continue
      if (bars[k].time - bars[k - 49].time !== 49 * 3_600_000) continue
      const x = cont(k, k - 49, 0.005)
      if (x) (byDow[c.dow] ??= []).push(x)
    }
    console.log('     el mismo movimiento de 49 h, empezado a las 17:00 de Chicago cada día de la semana:')
    for (const d of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) if (byDow[d]) console.log(`        ${dowName[d]}  ${summary(byDow[d])}`)
  }
}

// ── 4. Fear & Greed ──────────────────────────────────────────────────────────
// alternative.me's daily index (0–100) since 2018-02-01. Fixed before any result: the day's value is
// known by its own 16:00 UTC close (the OKX daily bar's close), so entries are at that close and the
// next day's return is the first earned. Event study: days on which the index first falls to or below 15,
// 20 and 25 (the previous day above it), forward BTC return over 7, 30 and 90 days against every day's
// average, and independent episodes (at least 30 days apart). Rules, as exposure to BTC from the
// next day: S1 long from ≤ 25 until ≥ 50; S2 long from ≤ 25 until ≥ 75; S3 always long except flat from
// ≥ 75 until back at ≤ 55. Compared with holding at the same average exposure.
if (want('fng')) {
  console.log('\n=== FEAR & GREED COMO SEÑAL CONTRARIA (alternative.me) ===')
  const fng = await cached('fng', 'https://api.alternative.me/fng/?limit=0&format=json', async (u) => {
    const j = await (await fetch(u)).json()
    return j.data.map((x) => [Number(x.timestamp) * 1000, Number(x.value)]).sort((a, b) => a[0] - b[0])
  })
  const btc = daily('BTC')
  const byDate = new Map(fng.map(([t, v]) => [Math.round(t / DAY), v]))
  // The OKX daily bar labelled by its open (16:00 UTC the day before) closes at open + 24 h.
  const idx = []
  for (let i = 0; i < btc.length; i++) {
    const closeMs = btc[i].time + DAY
    const day = Math.round((closeMs - 16 * 3_600_000) / DAY)
    const v = byDate.get(day)
    if (v !== undefined) idx.push({ i, v, day })
  }
  console.log(`  ${idx.length} días con índice y precio · ${iso(btc[idx[0].i].time + DAY)} → ${iso(btc[idx[idx.length - 1].i].time + DAY)} · valor medio ${mean(idx.map((x) => x.v)).toFixed(0)}`)
  const fwd = (i, h) => (i + h < btc.length ? btc[i + h].close / btc[i].close - 1 : NaN)
  const base = Object.fromEntries([7, 30, 90].map((h) => [h, mean(idx.map((x) => fwd(x.i, h)).filter(Number.isFinite))]))
  console.log(`  rentabilidad media de BTC a 7 / 30 / 90 días en cualquier día: ${p(base[7])} / ${p(base[30])} / ${p(base[90])}`)
  for (const th of [15, 20, 25]) {
    const firsts = idx.filter((x, k) => x.v <= th && (k === 0 || idx[k - 1].v > th))
    const eps = []
    for (const x of firsts) if (!eps.length || x.i - eps[eps.length - 1].i >= 30) eps.push(x)
    const cols = [7, 30, 90].map((h) => {
      const v = eps.map((x) => fwd(x.i, h)).filter(Number.isFinite)
      const wins = v.filter((r) => r > 0).length
      return `${h} d ${p(mean(v))} (${wins}/${v.length} ≥ 0)`
    })
    console.log(`  primer día ≤ ${th}: ${firsts.length} entradas, ${eps.length} episodios independientes   ${cols.join('   ')}`)
  }
  const rules = {
    'S1 · largo de ≤ 25 hasta ≥ 50': (v, on) => (on ? v < 50 : v <= 25),
    'S2 · largo de ≤ 25 hasta ≥ 75': (v, on) => (on ? v < 75 : v <= 25),
    'S3 · siempre largo salvo de ≥ 75 hasta ≤ 55': (v, on) => (on ? v > 55 : v < 75),
  }
  for (const [label, rule] of Object.entries(rules)) {
    let on = label.startsWith('S3')
    const r = []
    const bh = []
    const pos = []
    for (let k = 0; k < idx.length - 1; k++) {
      const { i, v } = idx[k]
      on = rule(v, on)
      if (idx[k + 1].i !== i + 1) continue
      const day = btc[i + 1].close / btc[i].close - 1
      r.push(on ? day : 0)
      bh.push(day)
      pos.push(on ? 1 : 0)
    }
    const exp = mean(pos)
    const control = bh.map((x) => exp * x)
    const [lo, hi] = sharpeDiffCI(r, control)
    console.log(`  ${label}  (${p(exp, 0)} del tiempo expuesto)`)
    console.log(row('regla', r))
    console.log(row('mantener a la misma exposición', control))
    console.log(`     Sharpe regla − control: ${f(stats(r).sharpe - stats(control).sharpe)}  [${f(lo)}, ${f(hi)}]`)
  }
}

// ── 5. stablecoin supply ─────────────────────────────────────────────────────
// DefiLlama's total circulating stablecoins in dollars, daily since 2017-11. The idea: new dollars on
// the exchanges precede buying. Fixed before any result: g = growth over 30 days, known at the
// day's close and entered one day later; each day g is ranked among all earlier days (expanding, at
// least a year) and split in thirds; BTC's next 7- and 30-day return by third, taking one start in
// 7 or 30 so the windows do not overlap; and the plain correlation of g with the 30 days before
// and the 30 days after.
if (want('stable')) {
  console.log('\n=== OFERTA DE STABLECOINS Y BITCOIN (DefiLlama) ===')
  const raw = await cached('stablecoins', 'https://stablecoins.llama.fi/stablecoincharts/all', async (u) => (await (await fetch(u)).json()).map((x) => [Number(x.date) * 1000, x.totalCirculatingUSD?.peggedUSD ?? x.totalCirculating?.peggedUSD]))
  const supply = new Map(raw.filter((x) => Number.isFinite(x[1])).map(([t, v]) => [Math.round(t / DAY), v]))
  const btc = daily('BTC')
  const rows = []
  for (let i = 31; i < btc.length; i++) {
    const day = Math.round((btc[i].time + DAY - 16 * 3_600_000) / DAY)
    const now = supply.get(day - 1)
    const then = supply.get(day - 31)
    // Before 2019 the supply was a few hundred million and its growth 10 % a day: not the same thing.
    if (!now || !then || then < 1e9) continue
    rows.push({ i, g: now / then - 1 })
  }
  console.log(`  ${rows.length} días · ${iso(btc[rows[0].i].time)} → ${iso(btc[rows[rows.length - 1].i].time)} · crecimiento medio a 30 días ${p(mean(rows.map((x) => x.g)))}, mediana ${p([...rows.map((x) => x.g)].sort((a, b) => a - b)[Math.floor(rows.length / 2)])}`)
  const corr = (a, b) => {
    const ma = mean(a)
    const mb = mean(b)
    return mean(a.map((x, k) => (x - ma) * (b[k] - mb))) / (sd(a) * sd(b))
  }
  const back = (i, h) => btc[i].close / btc[i - h].close - 1
  const ahead = (i, h) => (i + h < btc.length ? btc[i + h].close / btc[i].close - 1 : NaN)
  const ok = rows.filter((x) => x.i >= 31 && x.i + 30 < btc.length)
  console.log(`  correlación de g con BTC los 30 días ANTES: ${f(corr(ok.map((x) => x.g), ok.map((x) => back(x.i, 30))))}    con los 30 días DESPUÉS: ${f(corr(ok.map((x) => x.g), ok.map((x) => ahead(x.i, 30))))}`)
  for (const h of [7, 30]) {
    const groups = [[], [], []]
    for (let k = 365; k < rows.length; k += h) {
      const past = rows.slice(k - 365, k).map((x) => x.g).sort((a, b) => a - b)
      const rank = past.filter((x) => x <= rows[k].g).length / past.length
      const r = ahead(rows[k].i, h)
      if (!Number.isFinite(r)) continue
      groups[rank < 1 / 3 ? 0 : rank < 2 / 3 ? 1 : 2].push(r)
    }
    console.log(
      `  BTC a ${h} días tras un crecimiento de oferta  bajo ${p(mean(groups[0]))} (n=${groups[0].length})   medio ${p(mean(groups[1]))} (n=${groups[1].length})   alto ${p(mean(groups[2]))} (n=${groups[2].length})`,
    )
  }
}

// ── 6. MVRV ──────────────────────────────────────────────────────────────────
// Market value over realised value (Coin Metrics community data, BTC, daily since 2010): above 3 "hot",
// below 1 "the market is under what holders paid". Fixed before any result: days on which MVRV is at or
// below 1 (and, separately, at or above 3 and 3.5), entered one day after, forward return over 90 and
// 180 days from Coin Metrics' own price, by era, with the number of independent episodes (at least 60
// days apart) — a cycle indicator has a handful of cycles, and that number is the result.
if (want('mvrv')) {
  console.log('\n=== MVRV (VALOR DE MERCADO / VALOR REALIZADO) DE BITCOIN ===')
  const rows = await cached('mvrv-btc', 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics', async (u) => {
    const out = []
    let url = `${u}?assets=btc&metrics=CapMVRVCur,PriceUSD&frequency=1d&page_size=10000`
    while (url) {
      const j = await (await fetch(url)).json()
      for (const x of j.data) out.push([Date.parse(x.time), Number(x.CapMVRVCur), Number(x.PriceUSD)])
      url = j.next_page_url
    }
    return out.filter((x) => Number.isFinite(x[1]) && Number.isFinite(x[2]))
  })
  console.log(`  ${rows.length} días · ${iso(rows[0][0])} → ${iso(rows[rows.length - 1][0])}`)
  const eras = [
    ['2011 → 2017', (t) => t < Date.UTC(2018, 0, 1)],
    ['2018 → 2026', (t) => t >= Date.UTC(2018, 0, 1)],
  ]
  for (const [label, inEra] of eras) {
    const idx = rows.map((x, i) => i).filter((i) => inEra(rows[i][0]))
    const base = (h) => mean(idx.map((i) => (i + 1 + h < rows.length ? rows[i + 1 + h][2] / rows[i + 1][2] - 1 : NaN)).filter(Number.isFinite))
    console.log(`  ── ${label} · rentabilidad media a 90 / 180 días en cualquier día ${p(base(90))} / ${p(base(180))}`)
    for (const [name, test] of [['MVRV ≤ 1', (v) => v <= 1], ['MVRV ≤ 1,2', (v) => v <= 1.2], ['MVRV ≥ 3', (v) => v >= 3], ['MVRV ≥ 3,5', (v) => v >= 3.5]]) {
      const days = idx.filter((i) => test(rows[i][1]))
      const eps = []
      for (const i of days) if (!eps.length || i - eps[eps.length - 1] >= 60) eps.push(i)
      const cols = [90, 180].map((h) => {
        const all = days.map((i) => (i + 1 + h < rows.length ? rows[i + 1 + h][2] / rows[i + 1][2] - 1 : NaN)).filter(Number.isFinite)
        const first = eps.map((i) => (i + 1 + h < rows.length ? rows[i + 1 + h][2] / rows[i + 1][2] - 1 : NaN)).filter(Number.isFinite)
        return `${h} d: todos los días ${p(mean(all), 0)} (n=${all.length}) · primer día de cada episodio ${p(mean(first), 0)} (${first.filter((x) => x > 0).length}/${first.length} ≥ 0)`
      })
      console.log(`     ${name.padEnd(12)} ${days.length} días, ${eps.length} episodios · ${cols.join('   ')}`)
    }
  }
  // As a rule: long from MVRV ≤ 1.2 until it reaches 2 (or 3); flat otherwise. Against holding at the
  // same average exposure, from 2012 (the first year with a price worth the name) and from 2018.
  for (const [from, label] of [[Date.UTC(2012, 0, 1), '2012 → 2026'], [Date.UTC(2018, 0, 1), '2018 → 2026']]) {
    for (const exit of [2, 3]) {
      let on = false
      const r = []
      const bh = []
      const pos = []
      for (let k = 1; k < rows.length - 1; k++) {
        if (rows[k][0] < from) continue
        if (!on && rows[k - 1][1] <= 1.2) on = true
        else if (on && rows[k - 1][1] >= exit) on = false
        const day = rows[k][2] / rows[k - 1][2] - 1
        r.push(on ? day : 0)
        bh.push(day)
        pos.push(on ? 1 : 0)
      }
      const exp = mean(pos)
      const control = bh.map((x) => exp * x)
      const [lo, hi] = sharpeDiffCI(r, control)
      console.log(`  regla ${label}: largo de ≤ 1,2 hasta ≥ ${exit}  (${p(exp, 0)} del tiempo expuesto)`)
      console.log(row('regla', r))
      console.log(row('mantener a la misma exposición', control))
      console.log(`     Sharpe regla − control: ${f(stats(r).sharpe - stats(control).sharpe)}  [${f(lo)}, ${f(hi)}]`)
    }
  }
}

// ── 7. the same cross-section on a universe with the dead coins in it ────────
// The board above holds only the coins that are liquid TODAY. Here every USDT spot pair Binance listed,
// delisted ones included (LUNA, FTT, …; `node scripts/fetch-binance-daily.mjs`), and each Sunday the
// universe is the N pairs with the most dollar volume over the previous 30 days — what could have been
// traded then. A pair that stops trading inside the week is closed at its last price: the blow-ups of
// former winners are in the long leg. Same factors, same thirds, same cost; N = 30, 50 and 100.
if (want('survivor')) {
  console.log('\n=== SECCIÓN CRUZADA SIN SESGO DE SUPERVIVIENTES (Binance, con las monedas muertas) ===')
  const dir = './.research/binance-1d'
  if (!existsSync(dir)) {
    console.log('  (falta ./.research/binance-1d: node scripts/fetch-binance-daily.mjs)')
  } else {
    const SKIP = /^(WBTC|WBETH|BETH|RENBTC|BTCB|PAXG|XAUT|WBNB|STETH|CBBTC|BNSOL|SOLV|LDO2)$/
    const coinsB = []
    for (const file of readdirSync(dir)) {
      const name = file.replace('.json', '')
      if (SKIP.test(name)) continue
      const arr = readJson(`${dir}/${file}`)
      if (arr.length < 120) continue
      const c = arr.map(([t, o, h, l, cl, v, qv]) => ({ time: t, open: o, high: h, low: l, close: cl, vol: v, qv }))
      const days = new Map(c.map((b, i) => [Math.round(b.time / DAY), i]))
      // trailing 30-day mean of dollar volume
      const qv30 = new Array(c.length).fill(0)
      let acc = 0
      for (let i = 0; i < c.length; i++) {
        acc += c[i].qv
        if (i >= 30) acc -= c[i - 30].qv
        qv30[i] = i >= 29 ? acc / 30 : 0
      }
      coinsB.push({ name, c, days, qv30, last: Math.round(c[c.length - 1].time / DAY) })
    }
    const firstDay = Math.min(...coinsB.map((x) => Math.round(x.c[0].time / DAY)))
    const lastDay = Math.max(...coinsB.map((x) => x.last))
    const dead = coinsB.filter((x) => x.last < lastDay - 30).length
    console.log(`  ${coinsB.length} pares · ${iso(firstDay * DAY)} → ${iso(lastDay * DAY)} · ${dead} dejaron de cotizar antes del final`)
    const reb = []
    for (let d = Math.ceil((Date.UTC(2018, 0, 1) / DAY) / 7) * 7; d + 7 <= lastDay; d += 7) reb.push(d)

    // ── what the factor nearest its high is made of ────────────────────────
    const btcB = coinsB.find((x) => x.name === 'BTC')
    const btcSma200 = (d) => {
      const i = btcB.days.get(d)
      return i === undefined || i < 200 ? NaN : mean(btcB.c.slice(i - 199, i + 1).map((b) => b.close))
    }
    /** Weekly rows of one factor on the top-N universe; `opts.tail` the share in each leg, `opts.floor` a cap on a week's loss per coin. */
    const weeksOf = (N, score, opts = {}) => {
      const tail = opts.tail ?? 1 / 3
      const lag = opts.lag ?? 0
      const schedule = opts.offset === undefined ? reb : reb.map((d) => d + opts.offset)
      const out = []
      let prev = new Map()
      for (const d of schedule) {
        const rows = []
        for (const x of coinsB) {
          const idx = x.days.get(d)
          if (idx === undefined || idx < (opts.minHistory ?? 90) || !(x.qv30[idx] > 0)) continue
          if (opts.aliveOnly && x.last < lastDay - 30) continue
          if (opts.only && !opts.only.has(x.name)) continue
          if (opts.exclude && opts.exclude.has(x.name)) continue
          if (opts.maxHistory !== undefined && idx >= opts.maxHistory) continue
          // Signals are read at day d's close; with a lag the trade is made at the close of d + lag.
          const entry = x.days.get(d + lag)
          if (entry === undefined) continue
          let exit
          const next = x.days.get(d + lag + 7)
          if (next !== undefined) exit = x.c[next].close
          else if (x.last < d + lag + 7) exit = x.c[x.c.length - 1].close
          else continue
          rows.push({ coin: x.name, qv: x.qv30[idx], c: x.c, idx, r: exit / x.c[entry].close - 1, died: next === undefined })
        }
        rows.sort((a, b) => b.qv - a.qv)
        const universe = rows.slice(opts.from ?? 0, N)
        if (universe.length < Math.min(N - (opts.from ?? 0), 9)) continue
        const scored = universe.map((u) => ({ ...u, v: score(u.c, u.idx, u, universe) })).filter((u) => Number.isFinite(u.v))
        if (scored.length < 9) continue
        scored.sort((a, b) => b.v - a.v)
        const k = Math.max(1, Math.floor(scored.length * tail))
        const top = scored.slice(0, k)
        const bottom = scored.slice(scored.length - k)
        const ret = (u) => (opts.floor !== undefined ? Math.max(opts.floor, u.r) : u.r)
        const w = new Map()
        top.forEach((u) => w.set(u.coin, 1 / k))
        bottom.forEach((u) => w.set(u.coin, (w.get(u.coin) ?? 0) - 1 / k))
        let turnover = 0
        for (const key of new Set([...w.keys(), ...prev.keys()])) turnover += Math.abs((w.get(key) ?? 0) - (prev.get(key) ?? 0))
        prev = w
        const long = mean(top.map(ret))
        const short = mean(bottom.map(ret))
        out.push({ d, ls: long - short, long, uni: mean(scored.map(ret)), net: long - short - turnover * 0.0005, bull: btcSma200(d) < (btcB.c[btcB.days.get(d)]?.close ?? NaN), deaths: bottom.filter((u) => u.died).length, top: top.map((u) => u.coin), bottom: bottom.map((u) => u.coin) })
      }
      return out
    }
    const brief = (label, weeks, key = 'ls') => {
      const v = weeks.map((w) => w[key])
      const half = Math.floor(v.length / 2)
      const sorted = [...v].sort((a, b) => b - a)
      console.log(
        `     ${label.padEnd(58)} ${p(mean(v), 2).padStart(8)}  t ${f(mean(v) / (sd(v) / Math.sqrt(v.length)), 1).padStart(5)}  sem.+ ${(100 * v.filter((x) => x > 0).length / v.length).toFixed(0).padStart(3)} %  mitades ${p(mean(v.slice(0, half)), 2)} / ${p(mean(v.slice(half)), 2)}  sin las 10 mejores ${p(mean(sorted.slice(10)), 2)}`,
      )
    }
    const nearHigh = (L) => (c, i) => c[i].close / Math.max(...c.slice(i - Math.min(L, i) + 1, i + 1).map((b) => b.high))
    const vol30 = FACTORS['volatilidad 30 días']
    console.log('\n  ── el factor «cerca del máximo», por dentro (30 pares) ──')
    console.log('     ventana del máximo (largo tercio superior − inferior):')
    for (const L of [20, 30, 60, 90, 180, 365]) brief(`  máximo de ${L} días`, weeksOf(30, nearHigh(L)))
    console.log('     tamaño de cada pata:')
    brief('  quintiles (20 % arriba − 20 % abajo)', weeksOf(30, nearHigh(90), { tail: 0.2 }))
    brief('  mitades', weeksOf(30, nearHigh(90), { tail: 0.5 }))
    console.log('     ¿es solo la volatilidad? el factor DENTRO de cada tercio de volatilidad (misma semana, mismas monedas):')
    for (const [name, pick] of [['tercio menos volátil', (a) => a.slice(a.length - Math.floor(a.length / 3))], ['tercio medio', (a) => a.slice(Math.floor(a.length / 3), a.length - Math.floor(a.length / 3))], ['tercio más volátil', (a) => a.slice(0, Math.floor(a.length / 3))]]) {
      const score = (c, i, u, universe) => {
        const withVol = universe.map((x) => ({ x, v: vol30(x.c, x.idx) })).filter((y) => Number.isFinite(y.v)).sort((a, b) => b.v - a.v)
        const bucket = pick(withVol).map((y) => y.x)
        return bucket.includes(u) ? nearHigh(90)(c, i) : NaN
      }
      brief(`  ${name}`, weeksOf(30, score))
    }
    console.log('     por régimen de BTC (cierre sobre su media de 200 días el domingo):')
    const all = weeksOf(30, nearHigh(90))
    brief('  BTC sobre la media de 200 días', all.filter((w) => !w.bull))
    brief('  BTC bajo la media de 200 días', all.filter((w) => w.bull))
    console.log('     sin ayudas que no existen en la vida real:')
    brief('  una moneda no puede perder más de un 50 % en la semana', weeksOf(30, nearHigh(90), { floor: -0.5 }))
    const withDeaths = all.filter((w) => w.deaths > 0)
    console.log(`     semanas con una moneda que dejó de cotizar en la pata corta: ${withDeaths.length} de ${all.length}`)
    brief('  solo las semanas sin muertes en la pata corta', all.filter((w) => w.deaths === 0))
    console.log('     ejecución y calendario:')
    brief('  entrando un día más tarde (cierre de d + 1)', weeksOf(30, nearHigh(90), { lag: 1 }))
    console.log('     el mismo factor rebalanceado cada día de la semana (L − S medio por semana):')
    {
      const names = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
      const cells = []
      for (let o = 0; o < 7; o++) {
        const v = weeksOf(30, nearHigh(90), { offset: o }).map((w) => w.ls)
        cells.push(`${names[(o + 4) % 7]} ${p(mean(v), 2)} (t ${f(mean(v) / (sd(v) / Math.sqrt(v.length)), 1)})`)
      }
      console.log('       ' + cells.join('   '))
    }
    brief('  solo monedas con al menos un año de historia', weeksOf(30, nearHigh(90), { minHistory: 365 }))
    brief('  solo monedas con al menos dos años de historia', weeksOf(30, nearHigh(90), { minHistory: 730 }))
    {
      // What the perpetuals would have charged: each week's funding of the coins in each leg
      // (Binance USDT-M, ./.funding, 32 coins since 2022). The long pays it, the short collects it.
      const fdir = './.funding/binance'
      const fund = new Map()
      if (existsSync(fdir)) {
        for (const file of readdirSync(fdir)) {
          const j = readJson(`${fdir}/${file}`)
          const byDay = new Map()
          for (const e of j.funding) {
            const k = Math.floor(e.t / DAY)
            byDay.set(k, (byDay.get(k) ?? 0) + e.r)
          }
          fund.set(file.replace('.json', ''), byDay)
        }
      }
      const week = (coin, d) => {
        const m = fund.get(coin)
        if (!m) return NaN
        let total = 0
        for (let k = 0; k < 7; k++) {
          const v = m.get(d + k)
          if (v === undefined) return NaN
          total += v
        }
        return total
      }
      const rows = []
      let covered = 0
      let legs = 0
      for (const w of all) {
        if (w.d * DAY < Date.UTC(2022, 0, 1)) continue
        const lf = w.top.map((c) => week(c, w.d))
        const sf = w.bottom.map((c) => week(c, w.d))
        legs += w.top.length + w.bottom.length
        covered += lf.filter(Number.isFinite).length + sf.filter(Number.isFinite).length
        const L = lf.filter(Number.isFinite)
        const S = sf.filter(Number.isFinite)
        if (L.length >= 2 && S.length >= 2) rows.push({ long: mean(L), short: mean(S), ls: w.ls })
      }
      if (rows.length) {
        console.log(
          `     financiación de los perpetuos (2022 →, ${rows.length} semanas, ${(100 * covered / legs).toFixed(0)} % de las patas con dato): la pata larga paga ${p(mean(rows.map((r) => r.long)), 3)} y la corta ${p(mean(rows.map((r) => r.short)), 3)} por semana → efecto en la cartera larga-corta ${p(mean(rows.map((r) => r.short - r.long)), 3)} por semana (el L − S de esas semanas: ${p(mean(rows.map((r) => r.ls)), 2)})`,
        )
      }
    }
    {
      // The OKX board above showed +0.22 % for this factor; is that the universe or the data?
      const okxNames = new Set([...boardCoins('./.candles-board-1D'), ...boardCoins('./.candles-board-1Dold')])
      const since = (ws, y) => ws.filter((w) => w.d * DAY >= Date.UTC(y, 10, 1))
      console.log('     la misma regla sobre la cesta actual de OKX (los nombres de la cesta, con los datos de Binance):')
      brief('  cesta de OKX, 2018 →', weeksOf(100, nearHigh(90), { only: okxNames }))
      brief('  cesta de OKX, noviembre de 2021 →', since(weeksOf(100, nearHigh(90), { only: okxNames }), 2021))
      brief('  los 30 con más volumen, noviembre de 2021 →', since(all, 2021))
      brief('  los 30 con más volumen, sin las que hoy están en la cesta de OKX', weeksOf(30, nearHigh(90), { only: new Set(coinsB.map((x) => x.name).filter((n) => !okxNames.has(n))) }))
    }
    console.log('     por tamaño: el factor en cada franja del ranking por volumen en dólares (tercio − tercio dentro de la franja):')
    for (const [from, to] of [[0, 10], [0, 15], [0, 20], [10, 30], [0, 30], [20, 50], [30, 60], [50, 100]]) {
      brief(`  puestos ${from + 1} a ${to}`, weeksOf(to, nearHigh(90), { from }))
    }
    console.log('     quitando monedas concretas del universo (y volviendo a elegir los 30 con más volumen):')
    brief('  sin BTC ni ETH', weeksOf(30, nearHigh(90), { exclude: new Set(['BTC', 'ETH']) }))
    brief('  sin BTC, ETH, BNB, XRP, SOL', weeksOf(30, nearHigh(90), { exclude: new Set(['BTC', 'ETH', 'BNB', 'XRP', 'SOL']) }))
    {
      const v = all.map((w) => w.ls)
      const runs = 4000
      const block = 8
      const means = []
      for (let r = 0; r < runs; r++) {
        const pick = []
        while (pick.length < v.length) {
          const s0 = Math.floor(rnd() * (v.length - block))
          for (let j = 0; j < block; j++) pick.push(v[s0 + j])
        }
        means.push(mean(pick))
      }
      means.sort((a, b) => a - b)
      console.log(`     intervalo al 95 % de la media semanal (bloques de 8 semanas): [${p(means[Math.floor(runs * 0.025)], 2)}, ${p(means[Math.floor(runs * 0.975)], 2)}]`)
    }
    {
      // Is the OKX basket's zero a property of "long-lived survivors", or a thin draw? Random baskets of
      // 16 names from the pairs that were listed all along and are still trading.
      const pool = coinsB.filter((x) => x.last >= lastDay - 30 && x.c.length >= 1500).map((x) => x.name)
      const draws = []
      for (let r = 0; r < 150; r++) {
        const pick = new Set()
        while (pick.size < 16) pick.add(pool[Math.floor(rnd() * pool.length)])
        const v = weeksOf(100, nearHigh(90), { only: pick }).map((w) => w.ls)
        if (v.length > 100) draws.push(mean(v))
      }
      draws.sort((a, b) => a - b)
      console.log(
        `     cestas al azar de 16 nombres entre las ${pool.length} que cotizaban desde hace 4 años y siguen (${draws.length} sorteos): mediana ${p(draws[Math.floor(draws.length / 2)], 2)}, percentil 10 ${p(draws[Math.floor(draws.length * 0.1)], 2)}, percentil 90 ${p(draws[Math.floor(draws.length * 0.9)], 2)}; ${(100 * draws.filter((x) => x <= 0.0005).length / draws.length).toFixed(0)} % de los sorteos sale ≤ +0,05 %`,
      )
    }
    console.log('     por edad de la moneda (días cotizando al elegirla), dentro de los 100 con más volumen, solo ese grupo:')
    for (const [lo, hi] of [[90, 365], [365, 730], [730, 1460], [1460, 99999]]) {
      const ws = weeksOf(100, nearHigh(90), { minHistory: lo, maxHistory: hi })
      if (ws.length > 60) brief(`  de ${lo} a ${hi === 99999 ? '…' : hi} días (${ws.length} semanas)`, ws)
      else console.log(`       de ${lo} a ${hi} días: solo ${ws.length} semanas con nombres suficientes`)
    }
    console.log('     la edad como factor (largo las más antiguas, corto las más recientes, tercio − tercio):')
    for (const N of [30, 50, 100]) {
      const ws = weeksOf(N, (c, i) => i)
      brief(`  los ${N} con más volumen`, ws)
    }
    brief('  los 30 con más volumen, solo noviembre de 2021 →', weeksOf(30, (c, i) => i).filter((w) => w.d * DAY >= Date.UTC(2021, 10, 1)))
    {
      // The figures the Screener's "Fuerza relativa" card quotes, against what this data gives today.
      const E = RELATIVE_STRENGTH_EVIDENCE
      const st = (ws, key = 'ls') => {
        const v = ws.map((w) => w[key])
        const half = Math.floor(v.length / 2)
        const sorted = [...v].sort((a, b) => b - a)
        return {
          n: v.length,
          mean: mean(v) * 100,
          t: mean(v) / (sd(v) / Math.sqrt(v.length)),
          pos: v.filter((x) => x > 0).length / v.length,
          h1: mean(v.slice(0, half)) * 100,
          h2: mean(v.slice(half)) * 100,
          trimmed: mean(sorted.slice(10)) * 100,
        }
      }
      const main = st(all)
      const yearly = {}
      for (const w of all) (yearly[new Date(w.d * DAY).getUTCFullYear()] ??= []).push(w.ls)
      const yearsPositive = Object.values(yearly).filter((v) => mean(v) > 0).length
      const net = mean(all.map((w) => w.net)) * 100
      const w20 = st(weeksOf(30, nearHigh(20))).mean
      const w365 = st(weeksOf(30, nearHigh(365))).mean
      const longOnly = st(all.map((w) => ({ ...w, longEx: w.long - w.uni })), 'longEx')
      const above = st(all.filter((w) => !w.bull))
      const below = st(all.filter((w) => w.bull))
      const age = st(weeksOf(30, (c, i) => i))
      const rows = [
        ['semanas', main.n, E.weeks, 0],
        ['L − S por semana', main.mean, E.perWeek, 0.03],
        ['t', main.t, E.t, 0.1],
        ['semanas positivas', main.pos, E.positive, 0.01],
        ['años positivos', yearsPositive, E.yearsPositive, 0],
        ['primera mitad', main.h1, E.halves[0], 0.03],
        ['segunda mitad', main.h2, E.halves[1], 0.03],
        ['sin las 10 mejores', main.trimmed, E.withoutBest10, 0.03],
        ['neto de comisiones', net, E.net, 0.03],
        ['máximo de 365 días', w365, E.windows[0], 0.03],
        ['máximo de 20 días', w20, E.windows[1], 0.03],
        ['solo largo − universo', longOnly.mean, E.longOnly.perWeek, 0.03],
        ['solo largo, t', longOnly.t, E.longOnly.t, 0.1],
        ['BTC sobre la media de 200 días', above.mean, E.regime.above, 0.03],
        ['BTC bajo la media de 200 días', below.mean, E.regime.below, 0.03],
        ['edad como factor', age.mean, E.age.perWeek, 0.03],
        ['edad como factor, t', age.t, E.age.t, 0.1],
      ]
      const off = rows.filter(([, got, want, tol]) => !(Math.abs(got - want) <= tol + 1e-9))
      console.log('\n  ── las cifras que cita la tarjeta «Fuerza relativa» del Screener (src/lib/relativeStrength.ts) ──')
      for (const [name, got, want, tol] of rows) {
        const ok = Math.abs(got - want) <= tol + 1e-9
        console.log(`     ${ok ? '✓' : '✗'} ${name.padEnd(34)} medido ${f(got, 2).padStart(8)}   citado ${f(want, 2).padStart(8)}`)
      }
      if (off.length) {
        console.log(`  DESVIACIONES: ${off.length} cifras citadas ya no coinciden con los datos; actualiza RELATIVE_STRENGTH_EVIDENCE (y la Guía).`)
        process.exitCode = 1
      }
    }
    console.log('     ¿vive de las monedas que murieron? solo las que siguen cotizando al final (como la cesta de OKX):')
    brief('  solo supervivientes (30 pares por volumen entre ellos)', weeksOf(30, nearHigh(90), { aliveOnly: true }))
    brief('  solo supervivientes, solo 2022-2026', weeksOf(30, nearHigh(90), { aliveOnly: true }).filter((w) => w.d * DAY >= Date.UTC(2022, 0, 1)))
    brief('  todas (con las muertas), solo 2022-2026', all.filter((w) => w.d * DAY >= Date.UTC(2022, 0, 1)))
    {
      const ls = all.map((w) => w.ls)
      let eq = 1
      let peak = 1
      let mdd = 0
      for (const x of ls) {
        eq *= 1 + 0.5 * x
        peak = Math.max(peak, eq)
        mdd = Math.min(mdd, eq / peak - 1)
      }
      console.log(`     la cartera larga-corta con 0,5 en cada pata (exposición bruta 1): ${p(eq ** (52 / ls.length) - 1, 0)} al año, Sharpe ${f((mean(ls) / sd(ls)) * Math.sqrt(52))}, caída máx. ${p(mdd, 0)}, peor semana ${p(Math.min(...ls) * 0.5, 0)}`)
    }
    console.log('     solo largo (tercio superior), en absoluto, frente a mantener el universo entero y BTC:')
    {
      const long = all.map((w) => w.long)
      const uni = all.map((w) => w.uni)
      const w52 = (xs) => {
        let eq = 1
        let peak = 1
        let mdd = 0
        for (const x of xs) {
          eq *= 1 + x
          peak = Math.max(peak, eq)
          mdd = Math.min(mdd, eq / peak - 1)
        }
        return `${p(eq ** (52 / xs.length) - 1, 0).padStart(7)} al año  Sharpe ${f((mean(xs) / sd(xs)) * Math.sqrt(52)).padStart(5)}  caída máx. ${p(mdd, 0)}`
      }
      const btcWeekly = all.map((w) => {
        const i = btcB.days.get(w.d)
        const j = btcB.days.get(w.d + 7)
        return btcB.c[j].close / btcB.c[i].close - 1
      })
      console.log(`       tercio superior   ${w52(long)}`)
      console.log(`       universo (30)     ${w52(uni)}`)
      console.log(`       BTC               ${w52(btcWeekly)}`)
    }

    for (const N of [30, 50, 100]) {
      console.log(`\n  ── universo: los ${N} pares con más volumen en dólares de los 30 días previos · ${reb.length} semanas`)
      console.log(`     ${'factor'.padEnd(34)} ${'L − S / sem.'.padStart(11)} ${'anual'.padStart(8)} ${'t'.padStart(6)} ${'sem. +'.padStart(7)} ${'neto'.padStart(9)} ${'mitades'.padStart(15)}  ${'largo − todas'.padStart(13)}  mediana  sin las 10 mejores`)
      const keep = new Map()
      for (const [name, fn] of Object.entries(FACTORS)) {
        const weeks = []
        let prev = new Map()
        for (const d of reb) {
          const rows = []
          for (const x of coinsB) {
            const idx = x.days.get(d)
            if (idx === undefined || idx < 90 || !(x.qv30[idx] > 0)) continue
            let exit
            const next = x.days.get(d + 7)
            if (next !== undefined) exit = x.c[next].close
            else if (x.last < d + 7) exit = x.c[x.c.length - 1].close
            else continue
            rows.push({ coin: x.name, qv: x.qv30[idx], c: x.c, idx, r: exit / x.c[idx].close - 1 })
          }
          rows.sort((a, b) => b.qv - a.qv)
          const universe = rows.slice(0, N)
          if (universe.length < Math.min(N, 12)) continue
          const scored = universe.map((u) => ({ ...u, v: fn(u.c, u.idx) })).filter((u) => Number.isFinite(u.v))
          if (scored.length < 9) continue
          scored.sort((a, b) => b.v - a.v)
          const k = Math.floor(scored.length / 3)
          const top = scored.slice(0, k)
          const bottom = scored.slice(scored.length - k)
          const w = new Map()
          top.forEach((u) => w.set(u.coin, 1 / k))
          bottom.forEach((u) => w.set(u.coin, (w.get(u.coin) ?? 0) - 1 / k))
          let turnover = 0
          for (const key of new Set([...w.keys(), ...prev.keys()])) turnover += Math.abs((w.get(key) ?? 0) - (prev.get(key) ?? 0))
          prev = w
          const ls = mean(top.map((u) => u.r)) - mean(bottom.map((u) => u.r))
          weeks.push({ d, ls, net: ls - turnover * 0.0005, longEx: mean(top.map((u) => u.r)) - mean(scored.map((u) => u.r)) })
        }
        const ls = weeks.map((x) => x.ls)
        keep.set(name, weeks)
        const half = Math.floor(weeks.length / 2)
        const sorted = [...ls].sort((a, b) => b - a)
        const t = mean(ls) / (sd(ls) / Math.sqrt(ls.length))
        console.log(
          `     ${name.padEnd(34)} ${p(mean(ls), 2).padStart(11)} ${p(mean(ls) * 52, 0).padStart(8)} ${f(t, 1).padStart(6)} ${(100 * ls.filter((x) => x > 0).length / ls.length).toFixed(0).padStart(6)}% ${p(mean(weeks.map((x) => x.net)), 2).padStart(9)} ${(p(mean(ls.slice(0, half)), 2) + ' / ' + p(mean(ls.slice(half)), 2)).padStart(15)}  ${p(mean(weeks.map((x) => x.longEx)), 2).padStart(13)}  ${p(sorted[Math.floor(sorted.length / 2)], 2).padStart(7)}  ${p(mean(sorted.slice(10)), 2).padStart(7)}`,
        )
      }
      // By year and as a long-only screen (top third minus the whole universe), for the factors that stood out.
      const years = [...new Set(reb.map((d) => new Date(d * DAY).getUTCFullYear()))]
      console.log('     por año — L − S medio por semana:')
      console.log(`       ${''.padEnd(32)} ${years.map((y) => String(y).padStart(7)).join('')}`)
      for (const name of ['cerca del máximo de 90 días', 'MAX 30 días (lotería)', 'volatilidad 30 días', 'momentum 2 sem.', 'momentum 4 sem.', 'tendencia (medias bajo el precio)']) {
        const weeks = keep.get(name) ?? []
        console.log(`       ${name.padEnd(32)} ${years.map((y) => { const v = weeks.filter((w) => new Date(w.d * DAY).getUTCFullYear() === y).map((w) => w.ls); return (v.length ? p(mean(v), 1) : '—').padStart(7) }).join('')}`)
      }
      console.log('     el tercio superior, solo largo, menos el universo entero (semanal):')
      for (const name of ['cerca del máximo de 90 días', 'momentum 2 sem.', 'tendencia (medias bajo el precio)']) {
        const ex = (keep.get(name) ?? []).map((w) => w.longEx)
        const sorted = [...ex].sort((a, b) => a - b)
        const half = Math.floor(ex.length / 2)
        console.log(
          `       ${name.padEnd(32)} media ${p(mean(ex), 2)}  mediana ${p(sorted[Math.floor(sorted.length / 2)], 2)}  t ${f(mean(ex) / (sd(ex) / Math.sqrt(ex.length)), 1)}  semanas + ${(100 * ex.filter((x) => x > 0).length / ex.length).toFixed(0)} %  mitades ${p(mean(ex.slice(0, half)), 2)} / ${p(mean(ex.slice(half)), 2)}  sin las 10 mejores ${p(mean(sorted.slice(0, -10)), 2)}`,
        )
      }
    }
  }
}
