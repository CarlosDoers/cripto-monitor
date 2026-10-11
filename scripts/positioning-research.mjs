// Positioning: open interest, long/short ratios, taker flow — what the crowd's leverage says about what
// comes next (2026-10-11). Rules are written down BEFORE the numbers; where the sources are loose the
// reading is mine and is stated at the section.
//
//   npm run positioning            every section whose data is on disk
//   npm run positioning ts         BTC and ETH, 2020-09 → 2026-09: the open interest against price, how
//                                  fast it grows, the accounts' and top traders' ratios, the takers,
//                                  and what a collapse of open interest (a liquidation proxy) is followed by
//   npm run positioning xs         the same measures as a weekly long-short across the liquid perpetuals
//                                  (needs `POSITIONING_COINS` fetched: see the section)
//
// Sources: arXiv 2402.03953 (price volatility is negatively related to open interest on centralised
// venues), arXiv 2607.27070 (seven BTC liquidation cascades: no single early-warning variable held) —
// Binance's per-event liquidation dumps were discontinued, so the open interest is the proxy — and the
// retail claims on long/short ratios, none of which came with a sample size.
//
// Data: Binance's public data portal, USDT-M "metrics" (5-minute open interest and ratios, daily files
// since 2020-09) and the monthly funding of the perpetual; the daily spot candles of
// `node scripts/fetch-binance-daily.mjs`. Cached in ./.research (gitignored; REFRESH=1 fetches again).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

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
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
mkdirSync('./.research/binance-metrics', { recursive: true })

/** Welch's t of one group's mean against another's. */
function welch(a, b) {
  if (a.length < 3 || b.length < 3) return NaN
  return (mean(a) - mean(b)) / Math.sqrt(sd(a) ** 2 / a.length + sd(b) ** 2 / b.length)
}
// ── the data portal ──────────────────────────────────────────────────────────
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
async function keysUnder(prefix) {
  const out = []
  let marker = ''
  for (;;) {
    const xml = await get(`${BUCKET}?prefix=${encodeURIComponent(prefix)}&max-keys=1000${marker ? `&marker=${encodeURIComponent(marker)}` : ''}`)
    if (!xml) break
    const page = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1])
    out.push(...page)
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !page.length) break
    marker = page[page.length - 1]
  }
  return out.filter((k) => k.endsWith('.zip'))
}
function unzip(buf) {
  const method = buf.readUInt16LE(8)
  const size = buf.readUInt32LE(18)
  const head = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28)
  const data = buf.subarray(head, head + size)
  return (method === 8 ? inflateRawSync(data) : data).toString('utf8')
}
async function pool(items, size, fn) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (queue.length) await fn(queue.shift())
    }),
  )
}

/**
 * One day per symbol out of the 5-minute metrics: the open interest in coins and in dollars at the last
 * record of the day (23:55 UTC, so it lines up with a 00:00 UTC daily close), the accounts' and the top
 * traders' ratios at that moment, and the mean taker buy/sell volume ratio over the day.
 */
async function metrics(symbol) {
  const path = `./.research/binance-metrics/${symbol}.json`
  if (existsSync(path) && !process.env.REFRESH) return readJson(path)
  const keys = await keysUnder(`data/futures/um/daily/metrics/${symbol}/`)
  const days = []
  await pool(keys, 24, async (key) => {
    const zip = await get(`${HOST}/${key}`, true)
    if (!zip) return
    const rows = unzip(zip).split('\n').filter((l) => /^\d{4}-/.test(l))
    if (rows.length < 100) return
    const c = rows[rows.length - 1].split(',')
    const day = Math.round(Date.parse(`${c[0].replace(' ', 'T')}Z`) / DAY)
    const taker = rows.map((l) => Number(l.split(',')[7])).filter((v) => Number.isFinite(v) && v > 0)
    days.push({ day, oiCoin: +c[2], oiUsd: +c[3], topAcc: +c[4], topPos: +c[5], global: +c[6], taker: mean(taker) })
  })
  days.sort((a, b) => a.day - b.day)
  writeFileSync(path, JSON.stringify(days))
  console.log(`  ${symbol}: ${days.length} días de métricas (${days.length ? `${iso(days[0].day * DAY)} → ${iso(days[days.length - 1].day * DAY)}` : '—'})`)
  return days
}
async function funding(symbol) {
  const path = `./.research/binance-metrics/${symbol}-funding.json`
  if (existsSync(path) && !process.env.REFRESH) return readJson(path)
  const keys = await keysUnder(`data/futures/um/monthly/fundingRate/${symbol}/`)
  const byDay = new Map()
  await pool(keys, 12, async (key) => {
    const zip = await get(`${HOST}/${key}`, true)
    if (!zip) return
    for (const l of unzip(zip).split('\n')) {
      const c = l.split(',')
      if (!/^\d/.test(c[0])) continue
      const day = Math.floor(Number(c[0]) / DAY)
      byDay.set(day, (byDay.get(day) ?? 0) + Number(c[2]))
    }
  })
  const out = [...byDay.entries()].sort((a, b) => a[0] - b[0])
  writeFileSync(path, JSON.stringify(out))
  return out
}
function spotCloses(coin) {
  const path = `./.research/binance-1d/${coin}.json`
  if (!existsSync(path)) return null
  return new Map(readJson(path).map((r) => [Math.round(r[0] / DAY), r[4]]))
}

// ── 1. time series on BTC and ETH ────────────────────────────────────────────
// Fixed before any result. Each day t is read at its 00:00 UTC close; everything after is forward.
//  A. Price against open interest: P7 = spot's 7-day return, O7 = the open interest in COINS over the
//     same 7 days (coins, so the price does not move it). Four quadrants by sign; BTC's next 7 days from
//     each, one start in 7.
//  B. Leverage building: O30 = open interest in coins over 30 days, by third against its previous 365
//     days; the next 7 days' realised volatility and worst drawdown, and return.
//  C. The crowd: the global accounts' long/short ratio and the top traders' positions ratio, by third
//     of their previous 365 days; the next 1 and 7 days' return.
//  D. The takers: the day's mean taker buy/sell volume ratio, by third; the next day's return.
//  E. A collapse of open interest — the proxy for liquidations: the day's change in coins at or below
//     −7 % (BTC's, ETH's, whichever is the series), split by whether price fell or rose that day;
//     returns over the next 1, 3 and 7 days, against every day, on independent events (at least 7 days
//     apart).
//  F. Crowded and expensive: open interest in coins above its previous 365 days' 80th percentile and
//     the day's funding (three settlements) above 0.03 % — the next 7 days.
if (want('ts')) {
  console.log('\n=== POSICIONAMIENTO: OPEN INTEREST, RATIOS LARGO/CORTO Y TAKERS (BTC y ETH) ===')
  for (const coin of ['BTC', 'ETH']) {
    const spot = spotCloses(coin)
    if (!spot) {
      console.log(`  (falta ./.research/binance-1d/${coin}.json: node scripts/fetch-binance-daily.mjs)`)
      continue
    }
    const raw = await metrics(`${coin}USDT`)
    const fund = new Map(await funding(`${coin}USDT`))
    const rows = raw
      .filter((r) => spot.has(r.day) && r.oiCoin > 0)
      .map((r) => ({ ...r, price: spot.get(r.day), fund: fund.get(r.day) }))
    if (rows.length < 500) continue
    const byDay = new Map(rows.map((r) => [r.day, r]))
    console.log(`\n  ── ${coin} · ${rows.length} días · ${iso(rows[0].day * DAY)} → ${iso(rows[rows.length - 1].day * DAY)}`)
    const fwd = (r, h) => (spot.has(r.day + h) ? spot.get(r.day + h) / r.price - 1 : NaN)
    const vol = (r, h) => {
      const x = []
      for (let d = r.day + 1; d <= r.day + h; d++) {
        if (!spot.has(d) || !spot.has(d - 1)) return NaN
        x.push(Math.log(spot.get(d) / spot.get(d - 1)))
      }
      return sd(x) * Math.sqrt(365) * 100
    }
    const worst = (r, h) => {
      let low = Infinity
      for (let d = r.day + 1; d <= r.day + h; d++) if (spot.has(d)) low = Math.min(low, spot.get(d))
      return Number.isFinite(low) ? low / r.price - 1 : NaN
    }
    const back = (r, h) => byDay.get(r.day - h)
    const everyDay7 = rows.map((r) => fwd(r, 7)).filter(Number.isFinite)
    const base = mean(everyDay7)
    console.log(`     a 7 días en cualquier día: ${p(base)}   volatilidad a 7 días ${mean(rows.map((r) => vol(r, 7)).filter(Number.isFinite)).toFixed(0)}`)

    // A. quadrants
    const quad = { '↑ precio ↑ OI': [], '↑ precio ↓ OI': [], '↓ precio ↑ OI': [], '↓ precio ↓ OI': [] }
    for (let k = 0; k < rows.length; k += 7) {
      const r = rows[k]
      const b = back(r, 7)
      const a = fwd(r, 7)
      if (!b || !Number.isFinite(a)) continue
      const dP = r.price / b.price - 1
      const dO = r.oiCoin / b.oiCoin - 1
      quad[`${dP >= 0 ? '↑' : '↓'} precio ${dO >= 0 ? '↑' : '↓'} OI`].push(a)
    }
    console.log('     A. precio y open interest en 7 días → BTC a 7 días:')
    for (const [name, v] of Object.entries(quad)) {
      const rest = Object.entries(quad).filter(([k]) => k !== name).flatMap(([, x]) => x)
      console.log(`        ${name.padEnd(16)} n=${String(v.length).padStart(3)}  ${p(mean(v)).padStart(9)}  t ${f(welch(v, rest), 1)}`)
    }

    // B. leverage building
    const thirds = (series, key) => {
      const groups = [[], [], []]
      for (let k = 365; k < series.length; k += 7) {
        const past = series.slice(k - 365, k).map(key).filter(Number.isFinite).sort((x, y) => x - y)
        const now = key(series[k])
        if (!Number.isFinite(now) || past.length < 200) continue
        const rank = past.filter((x) => x <= now).length / past.length
        groups[rank < 1 / 3 ? 0 : rank < 2 / 3 ? 1 : 2].push(series[k])
      }
      return groups
    }
    const o30 = rows.map((r) => {
      const b = back(r, 30)
      return { ...r, o30: b ? r.oiCoin / b.oiCoin - 1 : NaN }
    })
    const gB = thirds(o30, (r) => r.o30)
    console.log('     B. open interest en coins, cambio a 30 días, por tercios de sus 365 días → a 7 días:')
    for (const [name, g] of [['bajo', gB[0]], ['medio', gB[1]], ['alto', gB[2]]]) {
      console.log(
        `        ${name.padEnd(6)} n=${String(g.length).padStart(3)}  retorno ${p(mean(g.map((r) => fwd(r, 7)).filter(Number.isFinite))).padStart(9)}  volatilidad ${mean(g.map((r) => vol(r, 7)).filter(Number.isFinite)).toFixed(0).padStart(3)}  peor caída ${p(mean(g.map((r) => worst(r, 7)).filter(Number.isFinite)))}`,
      )
    }

    // C and D
    const ratios = [
      ['C. cuentas globales, largo/corto', (r) => r.global],
      ['C. top traders, posiciones', (r) => r.topPos],
      ['C. top traders, cuentas', (r) => r.topAcc],
      ['D. takers, compra/venta del día', (r) => r.taker],
    ]
    for (const [name, key] of ratios) {
      const g = thirds(rows, key)
      if (g.some((x) => x.length < 8)) continue
      const cell = (x, h) => `${p(mean(x.map((r) => fwd(r, h)).filter(Number.isFinite)), 2)}`
      console.log(
        `     ${name}: 1 día  bajo ${cell(g[0], 1)} · medio ${cell(g[1], 1)} · alto ${cell(g[2], 1)}   |   7 días  bajo ${cell(g[0], 7)} · medio ${cell(g[1], 7)} · alto ${cell(g[2], 7)}   (n ${g.map((x) => x.length).join('/')}; t alto − bajo a 7 d ${f(welch(g[2].map((r) => fwd(r, 7)).filter(Number.isFinite), g[0].map((r) => fwd(r, 7)).filter(Number.isFinite)), 1)})`,
      )
    }

    // E. collapse of open interest
    console.log('     E. el open interest cae un 7 % o más en un día (proxy de liquidaciones), retorno posterior:')
    const events = rows.filter((r) => {
      const b = back(r, 1)
      return b && r.oiCoin / b.oiCoin - 1 <= -0.07
    })
    const split = (label, list) => {
      const eps = []
      for (const r of list) if (!eps.length || r.day - eps[eps.length - 1].day >= 7) eps.push(r)
      const cell = (h) => `${h} d ${p(mean(eps.map((r) => fwd(r, h)).filter(Number.isFinite)), 1)} (${eps.map((r) => fwd(r, h)).filter((x) => x > 0).length}/${eps.filter((r) => Number.isFinite(fwd(r, h))).length} ≥ 0)`
      console.log(`        ${label.padEnd(30)} ${String(eps.length).padStart(3)} eventos   ${cell(1)}   ${cell(3)}   ${cell(7)}`)
    }
    split('con el precio cayendo ese día', events.filter((r) => r.price < (back(r, 1)?.price ?? Infinity)))
    split('con el precio subiendo ese día', events.filter((r) => r.price >= (back(r, 1)?.price ?? 0)))
    console.log(`        cualquier día: 1 d ${p(mean(rows.map((r) => fwd(r, 1)).filter(Number.isFinite)), 1)}   3 d ${p(mean(rows.map((r) => fwd(r, 3)).filter(Number.isFinite)), 1)}   7 d ${p(base, 1)}`)

    // F. crowded and expensive
    const fRows = rows.filter((r) => Number.isFinite(r.fund))
    if (fRows.length > 500) {
      const crowd = []
      for (let k = 365; k < rows.length; k += 7) {
        const r = rows[k]
        if (!Number.isFinite(r.fund)) continue
        const past = rows.slice(k - 365, k).map((x) => x.oiCoin).sort((a, b) => a - b)
        const high = r.oiCoin >= past[Math.floor(past.length * 0.8)]
        if (high && r.fund >= 0.0003) crowd.push(r)
      }
      const a = crowd.map((r) => fwd(r, 7)).filter(Number.isFinite)
      console.log(`     F. open interest alto (> p80 de 365 d) y financiación ≥ 0,03 % al día: ${a.length} semanas, a 7 días ${p(mean(a))} (cualquier semana ${p(base)}), peor caída a 7 d ${p(mean(crowd.map((r) => worst(r, 7)).filter(Number.isFinite)))}`)
    }
  }
}

// ── 2. the cross-section ─────────────────────────────────────────────────────
// The same readings as a weekly long-short, top third minus bottom third by factor, 0.05 % a side:
// the open interest's 7- and 30-day change in coins, and the open interest in dollars over the pair's
// 30-day dollar volume ("how levered per unit of trading"). Needs the metrics of the liquid perpetuals:
// POSITIONING_COINS=BNB,XRP,SOL,... node scripts/positioning-research.mjs xs fetches them (about a
// minute a coin). The universe is the coins fetched, each week, with a price and metrics.
if (want('xs') && process.env.POSITIONING_COINS !== undefined) {
  console.log('\n=== POSICIONAMIENTO EN SECCIÓN CRUZADA ===')
  const coins = process.env.POSITIONING_COINS.split(',').filter(Boolean)
  const data = []
  for (const coin of coins) {
    const spot = spotCloses(coin)
    if (!spot) continue
    const m = await metrics(`${coin}USDT`)
    if (m.length < 400) continue
    const qv = new Map(readJson(`./.research/binance-1d/${coin}.json`).map((r) => [Math.round(r[0] / DAY), r[6]]))
    data.push({ coin, spot, qv, m: new Map(m.map((r) => [r.day, r])) })
  }
  console.log(`  ${data.length} perpetuos con métricas: ${data.map((x) => x.coin).join(', ')}`)
  const first = Math.min(...data.flatMap((x) => [...x.m.keys()]))
  const last = Math.max(...data.flatMap((x) => [...x.m.keys()]))
  const FACTORS = {
    'OI en coins, cambio a 7 días': (x, d) => {
      const a = x.m.get(d)
      const b = x.m.get(d - 7)
      return a && b ? a.oiCoin / b.oiCoin - 1 : NaN
    },
    'OI en coins, cambio a 30 días': (x, d) => {
      const a = x.m.get(d)
      const b = x.m.get(d - 30)
      return a && b ? a.oiCoin / b.oiCoin - 1 : NaN
    },
    'OI en dólares / volumen de 30 días': (x, d) => {
      const a = x.m.get(d)
      if (!a) return NaN
      let q = 0
      let k = 0
      for (let i = d - 29; i <= d; i++) {
        const v = x.qv.get(i)
        if (v) {
          q += v
          k++
        }
      }
      return k >= 25 ? a.oiUsd / (q / k) : NaN
    },
    'largo/corto de cuentas globales': (x, d) => x.m.get(d)?.global ?? NaN,
    'takers, compra/venta': (x, d) => x.m.get(d)?.taker ?? NaN,
  }
  const t = (v) => mean(v) / (sd(v) / Math.sqrt(v.length))
  console.log(`     ${'factor'.padEnd(36)} ${'L − S / sem.'.padStart(11)} ${'t'.padStart(6)} ${'sem. +'.padStart(7)} ${'neto'.padStart(9)} ${'mitades'.padStart(17)}  semanas`)
  for (const [name, fn] of Object.entries(FACTORS)) {
    const weeks = []
    let prev = new Map()
    for (let d = Math.ceil(first / 7) * 7 + 30; d + 7 <= last; d += 7) {
      const rows = []
      for (const x of data) {
        const now = x.spot.get(d)
        const next = x.spot.get(d + 7)
        const v = fn(x, d)
        if (now && next && Number.isFinite(v)) rows.push({ coin: x.coin, v, r: next / now - 1 })
      }
      if (rows.length < 9) continue
      rows.sort((a, b) => b.v - a.v)
      const k = Math.floor(rows.length / 3)
      const w = new Map()
      rows.slice(0, k).forEach((u) => w.set(u.coin, 1 / k))
      rows.slice(rows.length - k).forEach((u) => w.set(u.coin, (w.get(u.coin) ?? 0) - 1 / k))
      let turnover = 0
      for (const key of new Set([...w.keys(), ...prev.keys()])) turnover += Math.abs((w.get(key) ?? 0) - (prev.get(key) ?? 0))
      prev = w
      const ls = mean(rows.slice(0, k).map((u) => u.r)) - mean(rows.slice(rows.length - k).map((u) => u.r))
      weeks.push({ ls, net: ls - turnover * 0.0005 })
    }
    if (weeks.length < 30) {
      console.log(`     ${name.padEnd(36)} (solo ${weeks.length} semanas)`)
      continue
    }
    const v = weeks.map((x) => x.ls)
    const half = Math.floor(v.length / 2)
    console.log(
      `     ${name.padEnd(36)} ${p(mean(v), 2).padStart(11)} ${f(t(v), 1).padStart(6)} ${(100 * v.filter((x) => x > 0).length / v.length).toFixed(0).padStart(6)}% ${p(mean(weeks.map((x) => x.net)), 2).padStart(9)} ${(p(mean(v.slice(0, half)), 2) + ' / ' + p(mean(v.slice(half)), 2)).padStart(17)}  ${v.length}`,
    )
  }

  // ── what the accounts' ratio is made of ─────────────────────────────────────
  // Written after the table above showed it as the one factor that stood out (t −3.9), so everything
  // here is a check on one result, not a search. A. Is it the coin or the moment? The ratio against
  // the coin's own previous 90 days (a coin that is always crowded is not crowded now). B. Is it the
  // past week's return? The factor inside each third of the past 7 days' return. C. Thirds, halves,
  // quintiles; one day late; each year. D. The top traders' own ratios, for the same weeks.
  const global = (x, d) => x.m.get(d)?.global ?? NaN
  const past7 = (x, d) => (x.spot.get(d) && x.spot.get(d - 7) ? x.spot.get(d) / x.spot.get(d - 7) - 1 : NaN)
  const demeaned = (len) => (x, d) => {
    const now = global(x, d)
    const hist = []
    for (let i = d - len; i < d; i++) {
      const v = x.m.get(i)?.global
      if (v > 0) hist.push(v)
    }
    return hist.length >= len * 0.8 && now > 0 ? now / mean(hist) - 1 : NaN
  }
  /** Weekly long-short of one factor; `tail` is each leg's share, `lag` days between the reading and the trade, `only` a filter. */
  const weekly = (fn, { tail = 1 / 3, lag = 0, only = null } = {}) => {
    const out = []
    for (let d = Math.ceil(first / 7) * 7 + 400; d + 7 + lag <= last; d += 7) {
      const rows = []
      for (const x of data) {
        const now = x.spot.get(d + lag)
        const next = x.spot.get(d + lag + 7)
        const v = fn(x, d)
        if (now && next && Number.isFinite(v)) rows.push({ coin: x.coin, v, r: next / now - 1, past: past7(x, d) })
      }
      const use = only ? only(rows) : rows
      if (use.length < 9) continue
      use.sort((a, b) => b.v - a.v)
      const k = Math.max(1, Math.floor(use.length * tail))
      out.push({ d, ls: mean(use.slice(0, k).map((u) => u.r)) - mean(use.slice(use.length - k).map((u) => u.r)) })
    }
    return out
  }
  const brief = (label, ws) => {
    const v = ws.map((w) => w.ls)
    if (v.length < 20) return console.log(`     ${label.padEnd(60)} (solo ${v.length} semanas)`)
    const half = Math.floor(v.length / 2)
    console.log(
      `     ${label.padEnd(60)} ${p(mean(v), 2).padStart(8)}  t ${f(t(v), 1).padStart(5)}  sem.+ ${(100 * v.filter((x) => x > 0).length / v.length).toFixed(0).padStart(3)} %  mitades ${p(mean(v.slice(0, half)), 2)} / ${p(mean(v.slice(half)), 2)}  (${v.length} sem.)`,
    )
  }
  console.log('\n  ── el factor de las cuentas globales, por dentro (desde 400 días de métricas, por comparabilidad) ──')
  brief('en bruto (como arriba)', weekly(global))
  brief('frente a la media de la propia moneda de los 90 días previos', weekly(demeaned(90)))
  brief('frente a la media de la propia moneda de los 365 días previos', weekly(demeaned(365)))
  console.log('     dentro de cada tercio de rentabilidad de la semana anterior (misma semana, mismas monedas):')
  for (const [name, pick] of [
    ['  la semana anterior cayó (tercio peor)', (rows) => [...rows].sort((a, b) => a.past - b.past).slice(0, Math.floor(rows.length / 3))],
    ['  la semana anterior, tercio medio', (rows) => [...rows].sort((a, b) => a.past - b.past).slice(Math.floor(rows.length / 3), rows.length - Math.floor(rows.length / 3))],
    ['  la semana anterior subió (tercio mejor)', (rows) => [...rows].sort((a, b) => a.past - b.past).slice(rows.length - Math.floor(rows.length / 3))],
  ]) {
    brief(name, weekly(global, { only: pick }))
  }
  {
    // Rank correlation between the ratio and the past week's return, per week.
    const cs = []
    for (let d = Math.ceil(first / 7) * 7 + 400; d + 7 <= last; d += 7) {
      const rows = data.map((x) => ({ a: global(x, d), b: past7(x, d) })).filter((r) => Number.isFinite(r.a) && Number.isFinite(r.b))
      if (rows.length < 9) continue
      const rank = (key) => {
        const order = [...rows].sort((u, v) => u[key] - v[key])
        return new Map(order.map((r, i) => [r, i]))
      }
      const ra = rank('a')
      const rb = rank('b')
      const xs = rows.map((r) => ra.get(r))
      const ys = rows.map((r) => rb.get(r))
      const mx = mean(xs)
      const my = mean(ys)
      cs.push(mean(xs.map((v, i) => (v - mx) * (ys[i] - my))) / (sd(xs) * sd(ys)))
    }
    console.log(`     correlación de rangos entre el ratio y la rentabilidad de la semana anterior, media semanal: ${f(mean(cs), 2)}`)
  }
  console.log('     tamaño de cada pata y retraso:')
  brief('  tercios, un día más tarde', weekly(global, { lag: 1 }))
  brief('  mitades', weekly(global, { tail: 0.5 }))
  brief('  quintiles', weekly(global, { tail: 0.2 }))
  {
    const ws = weekly(global)
    const byYear = {}
    ws.forEach((w) => (byYear[new Date(w.d * DAY).getUTCFullYear()] ??= []).push(w.ls))
    console.log('     por año (media semanal): ' + Object.entries(byYear).map(([y, v]) => `${y} ${p(mean(v), 2)} (${v.length})`).join('  '))
  }
  console.log('     los otros ratios, mismas semanas:')
  brief('  top traders, posiciones', weekly((x, d) => x.m.get(d)?.topPos ?? NaN))
  brief('  top traders, cuentas', weekly((x, d) => x.m.get(d)?.topAcc ?? NaN))
  brief('  cuentas globales, media de los 7 días', weekly((x, d) => mean([...Array(7).keys()].map((i) => x.m.get(d - i)?.global).filter((v) => v > 0))))
}
