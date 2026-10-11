// A second search (2026-10-11): the families the first one did not touch. Rules are written down BEFORE
// the numbers; where a source is loose the reading is mine and is stated at the section.
//
//   npm run derivatives            every section whose data is on disk
//   npm run derivatives basis      dated futures against spot: the carry that can be locked, what it cost,
//                                  and whether the basis or the term structure says anything about BTC after
//                                  (Schmeling, Schrimpf & Todorov, "Crypto carry", BIS WP 1087)
//   npm run derivatives pairs      cointegrated pairs on the whole Binance universe, dead coins included
//                                  (Tadi & Witzany; Fil & Kristoufek) against random pairs with the same rule
//   npm run derivatives iv         Deribit's DVOL: the variance risk premium, what selling variance would have
//                                  earned and lost, and whether implied volatility adds anything to the past
//                                  (Alexander & Imeraj; Almeida, Grith, Miftachov & Wang)
//
// Data, all public and gitignored in ./.research (REFRESH=1 fetches again):
//   Binance's data portal: dated futures (COIN-M since 2020-09, USDT-M since 2021-03) — fetched here;
//   the daily spot candles of `node scripts/fetch-binance-daily.mjs` (BTC, ETH and the pairs universe);
//   Deribit's public API: DVOL, the 30-day implied volatility index of BTC and ETH, since 2021-03.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

const section = process.argv[2] ?? 'all'
const want = (name) => section === 'all' || section === name

// ── helpers ──────────────────────────────────────────────────────────────────
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const sd = (xs) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN
}
const f = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '   — ')
const p = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)} %` : '   — ')
const DAY = 86_400_000
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
let seed = 17
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

function stats(r) {
  let eq = 1
  let peak = 1
  let mdd = 0
  for (const x of r) {
    eq *= 1 + x
    peak = Math.max(peak, eq)
    mdd = Math.min(mdd, eq / peak - 1)
  }
  const s = sd(r)
  return { n: r.length, cagr: r.length ? eq ** (365 / r.length) - 1 : NaN, vol: s * Math.sqrt(365), sharpe: s > 0 ? (mean(r) / s) * Math.sqrt(365) : NaN, mdd, total: eq - 1 }
}
const row = (label, r) => {
  const s = stats(r)
  return `     ${label.padEnd(46)} CAGR ${p(s.cagr).padStart(9)}  vol ${p(s.vol, 0).padStart(6)}  Sharpe ${f(s.sharpe).padStart(6)}  caída máx. ${p(s.mdd, 0).padStart(7)}`
}
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

mkdirSync('./.research', { recursive: true })

// ── Binance's public data portal ─────────────────────────────────────────────
const BUCKET = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision'
const HOST = 'https://data.binance.vision'
async function get(url, binary = false, tries = 4) {
  for (let k = 0; k < tries; k++) {
    try {
      const res = await fetch(url)
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return binary ? Buffer.from(await res.arrayBuffer()) : await res.text()
    } catch (e) {
      if (k === tries - 1) throw new Error(`${url}: ${e.message}`)
      await new Promise((r) => setTimeout(r, 400 * (k + 1)))
    }
  }
}
const tags = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) => m[1])
async function list(prefix, delimiter) {
  const out = []
  let marker = ''
  for (;;) {
    const url = `${BUCKET}?prefix=${encodeURIComponent(prefix)}${delimiter ? `&delimiter=${encodeURIComponent(delimiter)}` : ''}&max-keys=1000${marker ? `&marker=${encodeURIComponent(marker)}` : ''}`
    const xml = await get(url)
    if (!xml) break
    const page = delimiter ? tags(xml, 'Prefix').filter((x) => x !== prefix) : tags(xml, 'Key')
    out.push(...page)
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break
    marker = delimiter ? tags(xml, 'NextMarker')[0] : page[page.length - 1]
    if (!marker) break
  }
  return out
}
function unzip(buf) {
  const method = buf.readUInt16LE(8)
  const size = buf.readUInt32LE(18)
  const head = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28)
  const data = buf.subarray(head, head + size)
  return (method === 8 ? inflateRawSync(data) : data).toString('utf8')
}

/** Daily candles of every BTC and ETH dated future on Binance, both margining styles, cached. */
async function datedFutures() {
  const path = './.research/binance-dated-futures.json'
  if (existsSync(path) && !process.env.REFRESH) return readJson(path)
  const out = {}
  for (const market of ['cm', 'um']) {
    const prefixes = await list(`data/futures/${market}/monthly/klines/`, '/')
    const symbols = prefixes.map((x) => x.split('/').slice(-2)[0]).filter((s) => /^(BTC|ETH)(USD|USDT)_\d{6}$/.test(s))
    for (const symbol of symbols) {
      const keys = (await list(`data/futures/${market}/monthly/klines/${symbol}/1d/`)).filter((k) => k.endsWith('.zip'))
      const rows = []
      for (const key of keys) {
        const zip = await get(`${HOST}/${key}`, true)
        if (!zip) continue
        for (const line of unzip(zip).split('\n')) {
          const c = line.split(',')
          if (c.length < 6 || !/^\d/.test(c[0])) continue
          let t = Number(c[0])
          if (t > 1e14) t = Math.floor(t / 1000)
          rows.push([t, +c[1], +c[2], +c[3], +c[4], +c[5]])
        }
      }
      rows.sort((a, b) => a[0] - b[0])
      out[symbol] = { market, rows }
      console.log(`  ${market} ${symbol}: ${rows.length} velas`)
    }
  }
  writeFileSync(path, JSON.stringify(out))
  return out
}

/** One coin's Binance spot daily closes by day number, from the pairs cache. */
function spotCloses(coin) {
  const path = `./.research/binance-1d/${coin}.json`
  if (!existsSync(path)) return null
  return new Map(readJson(path).map((r) => [Math.round(r[0] / DAY), r[4]]))
}

// ── 1. dated futures: the carry, and what the basis says ─────────────────────
// Reading fixed before any result — 1. A contract's basis on a day is its daily close over that day's
// spot close (Binance USDT spot) minus 1, annualised by the days left to the 08:00 UTC settlement.
// 2. The carry that could be locked: long spot, short the contract, taken the first day it has at most
// 95 days left and held to settlement; the gross return is the basis at entry (the two converge), the
// cost is 0.05 % a side on the future and 0.10 % a side on spot (taker), or 0.04 % / 0.04 % (maker,
// both). 3. What the basis predicts: BTC's next 30 days, from the nearest contract with at least 14 days
// left, by third of its own previous 365 days, one start in 30. 4. As exposure: long BTC when the
// nearest contract's basis is above the median of the previous 365 days, flat otherwise, against holding
// at the same average exposure.
if (want('basis')) {
  console.log('\n=== BASIS Y ESTRUCTURA DE PLAZOS: EL CARRY DE LOS FUTUROS CON VENCIMIENTO ===')
  const all = await datedFutures()
  const FEES = { taker: { fut: 0.0005, spot: 0.001 }, maker: { fut: 0.0004, spot: 0.0004 } }
  for (const coin of ['BTC', 'ETH']) {
    const spot = spotCloses(coin)
    if (!spot) {
      console.log(`  (falta ./.research/binance-1d/${coin}.json: node scripts/fetch-binance-daily.mjs)`)
      continue
    }
    // Every contract of this coin, both margining styles, with its settlement day.
    const contracts = Object.entries(all)
      .filter(([s]) => s.startsWith(`${coin}USD`))
      .map(([symbol, v]) => {
        const code = symbol.split('_')[1]
        const settle = Date.UTC(2000 + Number(code.slice(0, 2)), Number(code.slice(2, 4)) - 1, Number(code.slice(4, 6)), 8)
        return { symbol, market: v.market, settle, byDay: new Map(v.rows.map((r) => [Math.round(r[0] / DAY), r[4]])) }
      })
      .sort((a, b) => a.settle - b.settle)
    if (!contracts.length) continue
    const basisOn = (c, day) => {
      const F = c.byDay.get(day)
      const S = spot.get(day)
      const T = (c.settle - (day + 1) * DAY) / DAY
      if (!F || !S || T < 5) return null
      return { basis: F / S - 1, ann: (F / S - 1) * (365 / T), T }
    }

    // 2. the carry that could be locked, quarter by quarter (COIN-M: the longest history)
    console.log(`\n  ── ${coin} · el carry que se podía fijar (largo spot, corto el futuro, hasta el vencimiento)`)
    const locks = []
    for (const c of contracts.filter((x) => x.market === 'cm')) {
      for (const [day] of [...c.byDay.entries()].sort((a, b) => a[0] - b[0])) {
        const b = basisOn(c, day)
        if (!b || b.T > 95) continue
        locks.push({ symbol: c.symbol, entry: day, ...b })
        break
      }
    }
    const byYear = {}
    for (const l of locks) (byYear[new Date(l.entry * DAY).getUTCFullYear()] ??= []).push(l)
    console.log(`     ${'año'.padEnd(6)} ${'contratos'.padStart(9)} ${'base anualizada'.padStart(18)} ${'neto (taker)'.padStart(14)} ${'neto (maker)'.padStart(14)}`)
    for (const [y, v] of Object.entries(byYear)) {
      const net = (fees) => mean(v.map((l) => l.basis - 2 * fees.fut - 2 * fees.spot).map((r, i) => r * (365 / v[i].T)))
      console.log(
        `     ${y.padEnd(6)} ${String(v.length).padStart(9)} ${p(mean(v.map((l) => l.ann))).padStart(18)} ${p(net(FEES.taker)).padStart(14)} ${p(net(FEES.maker)).padStart(14)}`,
      )
    }
    const allAnn = locks.map((l) => l.ann)
    const netAnn = (fees) => locks.map((l) => (l.basis - 2 * fees.fut - 2 * fees.spot) * (365 / l.T))
    console.log(
      `     todos  ${String(locks.length).padStart(9)} ${p(mean(allAnn)).padStart(18)} ${p(mean(netAnn(FEES.taker))).padStart(14)} ${p(mean(netAnn(FEES.maker))).padStart(14)}   (mínimo ${p(Math.min(...allAnn))}, máximo ${p(Math.max(...allAnn))}; ${locks.filter((l) => l.ann < 0.05).length} de ${locks.length} bajo el 5 %)`,
    )

    // the same money in the perpetual, from the funding actually paid (Binance, ./.funding)
    const fpath = `./.funding/binance/${coin}.json`
    if (existsSync(fpath)) {
      const fund = readJson(fpath).funding
      const byY = {}
      for (const e of fund) (byY[new Date(e.t).getUTCFullYear()] ??= []).push(e.r)
      console.log(
        '     el perpetuo, financiación cobrada por el corto (anual): ' +
          Object.entries(byY)
            .map(([y, v]) => `${y} ${p(v.reduce((a, b) => a + b, 0) * (365 / (v.length / 3)))}`)
            .join('  '),
      )
    }

    // 3 and 4. the nearest contract's basis every day, and BTC after it
    const nearest = (day) => {
      let best = null
      for (const c of contracts) {
        const b = basisOn(c, day)
        if (b && b.T >= 14 && (!best || c.settle < best.settle)) best = { settle: c.settle, ...b }
      }
      return best
    }
    const days = [...spot.keys()].sort((a, b) => a - b)
    const series = []
    for (const day of days) {
      const near = nearest(day)
      if (near && spot.has(day + 1)) series.push({ day, ann: near.ann, price: spot.get(day) })
    }
    if (series.length < 400) continue
    console.log(`\n  ── ${coin} · qué anticipa la base del vencimiento más cercano (${series.length} días, ${iso(series[0].day * DAY)} → ${iso(series[series.length - 1].day * DAY)})`)
    const bySpot = (day, h) => (spot.has(day + h) ? spot.get(day + h) / spot.get(day) - 1 : NaN)
    const groups = [[], [], []]
    for (let k = 365; k < series.length; k += 30) {
      const past = series.slice(k - 365, k).map((x) => x.ann).sort((a, b) => a - b)
      const rank = past.filter((x) => x <= series[k].ann).length / past.length
      const r = bySpot(series[k].day, 30)
      if (Number.isFinite(r)) groups[rank < 1 / 3 ? 0 : rank < 2 / 3 ? 1 : 2].push(r)
    }
    console.log(
      `     ${coin} a 30 días tras una base  baja ${p(mean(groups[0]))} (n=${groups[0].length})   media ${p(mean(groups[1]))} (n=${groups[1].length})   alta ${p(mean(groups[2]))} (n=${groups[2].length})   cualquier día ${p(mean(series.map((x) => bySpot(x.day, 30)).filter(Number.isFinite)))}`,
    )
    // exposure rule
    const r = []
    const bh = []
    const pos = []
    for (let k = 365; k < series.length - 1; k++) {
      if (series[k + 1].day !== series[k].day + 1) continue
      const median = med(series.slice(k - 365, k).map((x) => x.ann))
      const on = series[k].ann > median
      const day = spot.get(series[k + 1].day) / spot.get(series[k].day) - 1
      r.push(on ? day : 0)
      bh.push(day)
      pos.push(on ? 1 : 0)
    }
    const exp = mean(pos)
    const control = bh.map((x) => exp * x)
    const [lo, hi] = sharpeDiffCI(r, control)
    console.log(`     largo con la base sobre su mediana de 365 días (${p(exp, 0)} del tiempo):`)
    console.log(row('regla', r))
    console.log(row('mantener a la misma exposición', control))
    console.log(`     Sharpe regla − control: ${f(stats(r).sharpe - stats(control).sharpe)}  [${f(lo)}, ${f(hi)}]`)

    // Is the basis anything but the trend? The same exposure rule with price over its average, and
    // how often the two are long at the same time.
    for (const len of [50, 200]) {
      const on = []
      const rr = []
      const bb = []
      for (let k = 365; k < series.length - 1; k++) {
        if (series[k + 1].day !== series[k].day + 1) continue
        const d = series[k].day
        let sum = 0
        let n = 0
        for (let j = d - len + 1; j <= d; j++) {
          const v = spot.get(j)
          if (v) {
            sum += v
            n++
          }
        }
        const trend = n > len * 0.9 && spot.get(d) > sum / n
        const median = med(series.slice(k - 365, k).map((x) => x.ann))
        const basisOn = series[k].ann > median
        const day = spot.get(series[k + 1].day) / spot.get(d) - 1
        on.push([trend, basisOn])
        rr.push(trend ? day : 0)
        bb.push(day)
      }
      const exposure = mean(on.map((x) => (x[0] ? 1 : 0)))
      const both = on.filter((x) => x[0] && x[1]).length / Math.max(1, on.filter((x) => x[1]).length)
      const ctrl = bb.map((x) => exposure * x)
      const [l2, h2] = sharpeDiffCI(rr, ctrl)
      console.log(`     para comparar: largo con el precio sobre su media de ${len} días (${p(exposure, 0)} del tiempo): Sharpe ${f(stats(rr).sharpe)} frente a ${f(stats(ctrl).sharpe)} a la misma exposición [${f(l2)}, ${f(h2)}]; con la base alta, el precio está sobre su media el ${p(both, 0)} de los días`)
    }

    // the slope: next contract's annualised basis minus the nearest's
    const slopeSeries = []
    for (const day of days) {
      const live = contracts.map((c) => ({ c, b: basisOn(c, day) })).filter((x) => x.b && x.b.T >= 14).sort((a, b) => a.b.T - b.b.T)
      const near = live[0]
      const far = live.find((x) => x.b.T >= (near?.b.T ?? 0) + 30)
      if (near && far && spot.has(day + 30)) slopeSeries.push({ day, slope: far.b.ann - near.b.ann })
    }
    if (slopeSeries.length > 500) {
      const g = [[], [], []]
      for (let k = 365; k < slopeSeries.length; k += 30) {
        const past = slopeSeries.slice(k - 365, k).map((x) => x.slope).sort((a, b) => a - b)
        const rank = past.filter((x) => x <= slopeSeries[k].slope).length / past.length
        g[rank < 1 / 3 ? 0 : rank < 2 / 3 ? 1 : 2].push(bySpot(slopeSeries[k].day, 30))
      }
      console.log(
        `     pendiente de la curva (siguiente − más cercano), ${coin} a 30 días con pendiente  baja ${p(mean(g[0]))} (n=${g[0].length})   media ${p(mean(g[1]))} (n=${g[1].length})   alta ${p(mean(g[2]))} (n=${g[2].length})`,
      )
    }
  }
}

// ── 2. cointegrated pairs ────────────────────────────────────────────────────
// Sources: Tadi & Witzany (2023), Tadi & Kortchemski (2021), Fil & Kristoufek (2020): pairs chosen by
// Engle-Granger on crypto, traded on the spread's z-score. Their weak point, by their own critics, is
// that costs and the selection are ignored; both are in here. Fixed before any result:
//   · Universe each month: the 30 Binance spot pairs with most dollar volume of the previous 30 days
//     (dead coins included), with a full formation window of closes.
//   · Formation: the previous 180 days. For each pair OLS of log price A on log price B → beta, the
//     residual, and Engle-Granger's t on its AR(1) (no constant; 5 % critical value −3.34).
//   · Choice: the 5 pairs with the lowest t at or under −3.34 whose half-life is 2 to 30 days.
//   · Trading: the next 30 days, spread z = residual / formation sd; open when |z| ≥ 2 against the
//     sign, close at |z| ≤ 0.5 (or at 4: the stop), and at the last close of the window. A position
//     is 1 long A and beta short B in log terms, earning the spread's daily change.
//   · Cost: 0.05 % a side on both legs' notional (1 + beta) at entry and again at exit; shorting
//     funding is ignored (it was +0.01 % a day: small, and a cost to the long-short only on average).
//   · Capital: one unit of gross notional per pair; the month's return is the mean over the five.
//   · Control: the same rule on 5 random pairs of the same universe, with no cointegration filter.
if (want('pairs')) {
  console.log('\n=== PARES COINTEGRADOS (Engle-Granger, universo de Binance con las monedas muertas) ===')
  const dir = './.research/binance-1d'
  if (!existsSync(dir)) {
    console.log('  (falta ./.research/binance-1d: node scripts/fetch-binance-daily.mjs)')
  } else {
    const STABLE_OR_WRAPPED = /^(WBTC|WBETH|BETH|RENBTC|BTCB|PAXG|XAUT|WBNB|STETH|CBBTC)$/
    const coins = []
    for (const file of readdirSync(dir)) {
      const name = file.replace('.json', '')
      if (STABLE_OR_WRAPPED.test(name)) continue
      const rows = readJson(`${dir}/${file}`)
      if (rows.length < 250) continue
      const closes = new Map(rows.map((r) => [Math.round(r[0] / DAY), r[4]]))
      const qv = new Map(rows.map((r) => [Math.round(r[0] / DAY), r[6]]))
      coins.push({ name, closes, qv })
    }
    console.log(`  ${coins.length} pares con al menos 250 días`)

    const logs = (c, from, to) => {
      const v = []
      for (let d = from; d <= to; d++) {
        const x = c.closes.get(d)
        if (!(x > 0)) return null
        v.push(Math.log(x))
      }
      return v
    }
    /** Engle-Granger on one pair: beta, alpha, residual sd, t of the AR(1) coefficient and half-life. */
    function cointegration(y, x) {
      const n = y.length
      const mx = mean(x)
      const my = mean(y)
      let sxy = 0
      let sxx = 0
      for (let i = 0; i < n; i++) {
        sxy += (x[i] - mx) * (y[i] - my)
        sxx += (x[i] - mx) ** 2
      }
      const beta = sxy / sxx
      const alpha = my - beta * mx
      const e = y.map((v, i) => v - alpha - beta * x[i])
      let num = 0
      let den = 0
      for (let i = 1; i < n; i++) {
        num += e[i - 1] * (e[i] - e[i - 1])
        den += e[i - 1] ** 2
      }
      const gamma = num / den
      let rss = 0
      for (let i = 1; i < n; i++) rss += (e[i] - e[i - 1] - gamma * e[i - 1]) ** 2
      const se = Math.sqrt(rss / (n - 2) / den)
      const phi = 1 + gamma
      return { beta, alpha, sigma: sd(e), t: gamma / se, halfLife: phi > 0 && phi < 1 ? -Math.LN2 / Math.log(phi) : Infinity }
    }

    const FEE = 0.0005
    /** One month of one pair under the rule; returns the trades' net and gross returns per unit of gross notional. */
    function tradeMonth(a, b, from, to, fit, entryZ) {
      const trades = []
      let open = null
      const spreadAt = (d) => {
        const ya = a.closes.get(d)
        const yb = b.closes.get(d)
        return ya > 0 && yb > 0 ? Math.log(ya) - fit.beta * Math.log(yb) - fit.alpha : NaN
      }
      const gross = 1 + Math.abs(fit.beta)
      let prev = spreadAt(from - 1)
      for (let d = from; d <= to; d++) {
        const s = spreadAt(d)
        if (!Number.isFinite(s) || !Number.isFinite(prev)) {
          // A hole in the data (a pair that stopped): close what is open at the last known spread.
          if (open) {
            trades.push({ gross: open.pnl / gross, net: open.pnl / gross - 2 * FEE, day: d })
            open = null
          }
          break
        }
        if (open) open.pnl += open.side * (s - prev)
        const z = s / fit.sigma
        if (open) {
          const stop = Math.abs(z) >= 4
          if (Math.abs(z) <= 0.5 || stop || d === to) {
            trades.push({ gross: open.pnl / gross, net: open.pnl / gross - 2 * FEE, day: d, stop })
            open = null
          }
        } else if (Math.abs(z) >= entryZ && d < to && Math.abs(z) < 4) {
          open = { side: -Math.sign(z), pnl: 0 }
        }
        prev = s
      }
      return trades
    }

    const months = []
    for (let y = 2018; y <= 2026; y++) for (let m = 0; m < 12; m++) {
      const start = Date.UTC(y, m, 1) / DAY
      const end = Date.UTC(y, m + 1, 1) / DAY - 1
      if (start > Date.UTC(2018, 5, 1) / DAY && end <= Date.UTC(2026, 8, 30) / DAY) months.push([start, end])
    }

    function run(formation, entryZ, K = 5, controlDraws = 0) {
      const monthly = []
      const control = []
      const allTrades = []
      const picks = []
      for (const [start, end] of months) {
        const from = start - formation
        const to = start - 1
        const universe = coins
          .map((c) => {
            let q = 0
            let k = 0
            for (let d = to - 29; d <= to; d++) {
              const v = c.qv.get(d)
              if (v) {
                q += v
                k++
              }
            }
            return { c, q: k >= 25 ? q / k : 0 }
          })
          .filter((x) => x.q > 0)
          .sort((a, b) => b.q - a.q)
          .slice(0, 30)
          .map((x) => ({ c: x.c, y: logs(x.c, from, to) }))
          .filter((x) => x.y)
        if (universe.length < 12) continue
        const candidates = []
        for (let i = 0; i < universe.length; i++) {
          for (let j = i + 1; j < universe.length; j++) {
            const fit = cointegration(universe[i].y, universe[j].y)
            if (fit.beta > 0.2 && fit.beta < 5 && fit.sigma > 0) candidates.push({ a: universe[i].c, b: universe[j].c, fit })
          }
        }
        const chosen = candidates
          .filter((x) => x.fit.t <= -3.34 && x.fit.halfLife >= 2 && x.fit.halfLife <= 30)
          .sort((x, y) => x.fit.t - y.fit.t)
          .slice(0, K)
        const monthReturn = (list) => {
          if (!list.length) return 0
          const per = list.map((x) => {
            const trades = tradeMonth(x.a, x.b, start, end, x.fit, entryZ)
            allTrades.push(...trades.map((t) => ({ ...t, chosen: list === chosenRef })))
            return trades.reduce((s, t) => s + t.net, 0)
          })
          return mean(per)
        }
        const chosenRef = chosen
        monthly.push({ start, r: monthReturn(chosen), n: chosen.length })
        picks.push(chosen.length)
        if (controlDraws) {
          const draws = []
          for (let k = 0; k < controlDraws; k++) {
            const list = []
            while (list.length < K && candidates.length) list.push(candidates[Math.floor(rnd() * candidates.length)])
            const per = list.map((x) => tradeMonth(x.a, x.b, start, end, x.fit, entryZ).reduce((s, t) => s + t.net, 0))
            draws.push(mean(per))
          }
          control.push(mean(draws))
        }
      }
      return { monthly, control, trades: allTrades.filter((t) => t.chosen), picks }
    }
    const summary = (label, rs) => {
      const m = Math.sqrt(12)
      return `     ${label.padEnd(44)} media mensual ${p(mean(rs), 2).padStart(9)}  Sharpe ${f((mean(rs) / sd(rs)) * m).padStart(6)}  meses + ${(100 * rs.filter((x) => x > 0).length / rs.length).toFixed(0).padStart(3)} %  peor mes ${p(Math.min(...rs), 1)}`
    }

    const main = run(180, 2, 5, 20)
    const rs = main.monthly.map((x) => x.r)
    const half = Math.floor(rs.length / 2)
    console.log(`\n  ── como se describe: formación 180 días, entrada |z| ≥ 2, 5 pares · ${rs.length} meses, ${mean(main.picks).toFixed(1)} pares elegidos de media`)
    console.log(summary('pares cointegrados', rs))
    console.log(summary('pares al azar, misma regla', main.control))
    console.log(`     mitades (media mensual): ${p(mean(rs.slice(0, half)), 2)} / ${p(mean(rs.slice(half)), 2)}   al azar ${p(mean(main.control.slice(0, half)), 2)} / ${p(mean(main.control.slice(half)), 2)}`)
    const t = main.trades
    console.log(
      `     operaciones: ${t.length}  bruto por operación ${p(mean(t.map((x) => x.gross)), 2)}  neto ${p(mean(t.map((x) => x.net)), 2)}  acierto ${(100 * t.filter((x) => x.net > 0).length / t.length).toFixed(0)} %  con stop ${t.filter((x) => x.stop).length}`,
    )
    const years = {}
    main.monthly.forEach((x) => (years[new Date(x.start * DAY).getUTCFullYear()] ??= []).push(x.r))
    console.log('     por año (media mensual): ' + Object.entries(years).map(([y, v]) => `${y} ${p(mean(v), 1)}`).join('  '))

    console.log('\n  Vecindad (cada celda cambia una cosa; media mensual / Sharpe anualizado de los meses):')
    for (const formation of [120, 180, 250]) {
      const cells = []
      for (const z of [1.5, 2, 2.5]) {
        const o = run(formation, z, 5, 0).monthly.map((x) => x.r)
        cells.push(`z ${z}: ${p(mean(o), 2)} / ${f((mean(o) / sd(o)) * Math.sqrt(12))}`)
      }
      console.log(`     formación ${String(formation).padEnd(4)} ${cells.join('   ')}`)
    }
  }
}

// ── 3. Deribit's DVOL ────────────────────────────────────────────────────────
// DVOL is Deribit's 30-day implied volatility index (annualised, in points), built from options like the
// VIX, daily since 2021-03. Fixed before any result:
//   · VRP, the premium, as DVOL at the day's close less the volatility realised over the NEXT 30 days
//     (standard deviation of daily log returns × √365, Binance spot), in points, every 30 days so the
//     windows do not overlap; and as the payoff of selling a 30-day variance swap, (IV² − RV²) / (2 IV),
//     in points of volatility per unit of vega — what the seller keeps and what it can lose.
//   · What implied volatility adds: forward 30-day RV regressed on the past 30-day RV and on DVOL
//     (OLS, non-overlapping), with each alone, to see whether DVOL carries anything the past does not.
//   · What it says about the price: BTC's next 30 days by third of DVOL against its previous 365 days.
if (want('iv')) {
  console.log('\n=== VOLATILIDAD IMPLÍCITA: DVOL DE DERIBIT ===')
  async function dvol(currency) {
    const path = `./.research/deribit-dvol-${currency}.json`
    if (existsSync(path) && !process.env.REFRESH) return readJson(path)
    const out = new Map()
    for (let start = Date.UTC(2021, 0, 1); start < Date.now(); start += 800 * DAY) {
      const url = `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${currency}&start_timestamp=${start}&end_timestamp=${start + 800 * DAY}&resolution=1D`
      const j = JSON.parse(await get(url))
      for (const r of j.result?.data ?? []) out.set(Math.round(r[0] / DAY), r[4])
    }
    const rows = [...out.entries()].sort((a, b) => a[0] - b[0])
    writeFileSync(path, JSON.stringify(rows))
    return rows
  }
  const ols = (X, y) => {
    // normal equations with an intercept, by Gauss-Jordan; X is an array of columns
    const k = X.length + 1
    const n = y.length
    const A = Array.from({ length: k }, () => new Array(k + 1).fill(0))
    for (let i = 0; i < n; i++) {
      const v = [1, ...X.map((c) => c[i])]
      for (let a = 0; a < k; a++) {
        for (let b = 0; b < k; b++) A[a][b] += v[a] * v[b]
        A[a][k] += v[a] * y[i]
      }
    }
    for (let c = 0; c < k; c++) {
      let piv = c
      for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
      ;[A[c], A[piv]] = [A[piv], A[c]]
      for (let r = 0; r < k; r++) {
        if (r === c) continue
        const m = A[r][c] / A[c][c]
        for (let b = c; b <= k; b++) A[r][b] -= m * A[c][b]
      }
    }
    const beta = A.map((r, i) => r[k] / r[i])
    const fitted = y.map((_, i) => beta[0] + X.reduce((s, c, j) => s + beta[j + 1] * c[i], 0))
    const my = mean(y)
    const r2 = 1 - y.reduce((s, v, i) => s + (v - fitted[i]) ** 2, 0) / y.reduce((s, v) => s + (v - my) ** 2, 0)
    return { beta, r2 }
  }

  for (const coin of ['BTC', 'ETH']) {
    const spot = spotCloses(coin)
    if (!spot) {
      console.log(`  (falta ./.research/binance-1d/${coin}.json: node scripts/fetch-binance-daily.mjs)`)
      continue
    }
    const iv = new Map(await dvol(coin))
    const days = [...iv.keys()].filter((d) => spot.has(d)).sort((a, b) => a - b)
    const realised = (from, to) => {
      const r = []
      for (let d = from + 1; d <= to; d++) {
        if (!spot.has(d) || !spot.has(d - 1)) return NaN
        r.push(Math.log(spot.get(d) / spot.get(d - 1)))
      }
      return sd(r) * Math.sqrt(365) * 100
    }
    const rows = []
    for (const d of days) {
      const past = realised(d - 30, d)
      const fut = realised(d, d + 30)
      if (Number.isFinite(past) && Number.isFinite(fut)) rows.push({ d, iv: iv.get(d), past, fut, ret: spot.get(d + 30) / spot.get(d) - 1 })
    }
    if (rows.length < 100) continue
    console.log(`\n  ── ${coin} · ${rows.length} días con DVOL y 30 días de futuro · ${iso(rows[0].d * DAY)} → ${iso(rows[rows.length - 1].d * DAY)}`)
    console.log(`     DVOL medio ${mean(rows.map((x) => x.iv)).toFixed(1)}   volatilidad realizada los 30 días siguientes, media ${mean(rows.map((x) => x.fut)).toFixed(1)}   prima media ${f(mean(rows.map((x) => x.iv - x.fut)), 1)} puntos`)
    const step = rows.filter((_, k) => k % 30 === 0)
    const pnl = step.map((x) => (x.iv ** 2 - x.fut ** 2) / (2 * x.iv))
    let eq = 0
    let peak = 0
    let mdd = 0
    for (const v of pnl) {
      eq += v
      peak = Math.max(peak, eq)
      mdd = Math.min(mdd, eq - peak)
    }
    console.log(
      `     vender varianza a 30 días (${step.length} periodos sin solape): media ${f(mean(pnl), 1)} puntos de vol, mediana ${f(med(pnl), 1)}, ganó ${(100 * pnl.filter((x) => x > 0).length / pnl.length).toFixed(0)} %, peor ${f(Math.min(...pnl), 1)} (empezó el ${iso(step[pnl.indexOf(Math.min(...pnl))].d * DAY)}), percentil 10 ${f(quantile(pnl, 0.1), 1)}; acumulado ${f(eq, 0)} y peor caída ${f(mdd, 0)} puntos`,
    )
    const byYear = {}
    step.forEach((x, i) => (byYear[new Date(x.d * DAY).getUTCFullYear()] ??= []).push(pnl[i]))
    console.log('     por año (media de la prima vendida): ' + Object.entries(byYear).map(([y, v]) => `${y} ${f(mean(v), 1)} (${v.length})`).join('  '))
    const half = Math.floor(pnl.length / 2)
    console.log(`     mitades: ${f(mean(pnl.slice(0, half)), 1)} / ${f(mean(pnl.slice(half)), 1)}`)

    // what DVOL adds to the past
    const sub = rows.filter((_, k) => k % 30 === 0)
    const y = sub.map((x) => x.fut)
    const past = ols([sub.map((x) => x.past)], y)
    const impl = ols([sub.map((x) => x.iv)], y)
    const both = ols([sub.map((x) => x.past), sub.map((x) => x.iv)], y)
    console.log(
      `     volatilidad futura sobre: la pasada R² ${past.r2.toFixed(2)} · DVOL R² ${impl.r2.toFixed(2)} · las dos R² ${both.r2.toFixed(2)} (coeficientes: pasada ${both.beta[1].toFixed(2)}, DVOL ${both.beta[2].toFixed(2)}; n=${sub.length})`,
    )

    // what it says about the price
    const groups = [[], [], []]
    for (let k = 365; k < rows.length; k += 30) {
      const hist = rows.slice(Math.max(0, k - 365), k).map((x) => x.iv).sort((a, b) => a - b)
      if (hist.length < 200) continue
      const rank = hist.filter((x) => x <= rows[k].iv).length / hist.length
      groups[rank < 1 / 3 ? 0 : rank < 2 / 3 ? 1 : 2].push(rows[k].ret)
    }
    if (groups.every((g) => g.length > 3)) {
      console.log(`     ${coin} a 30 días con DVOL  bajo ${p(mean(groups[0]))} (n=${groups[0].length})   medio ${p(mean(groups[1]))} (n=${groups[1].length})   alto ${p(mean(groups[2]))} (n=${groups[2].length})`)
    }
  }
}
