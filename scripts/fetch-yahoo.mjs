// Daily candles of what OKX's X-Perp board lists besides crypto — equities, ETFs, leveraged ETFs, gold,
// silver, WTI and Brent — plus the macro series a regime filter would read, from Yahoo's public chart
// endpoint, in the shape the strategies take ({ time, open, high, low, close, vol, confirmed }), in two
// folders from the same request:
//
//   ./.research/yahoo-1d-raw/<SYMBOL>.json   the prices as Yahoo prints them: adjusted for splits, NOT for
//                                            dividends. These are what a position is opened and stopped at,
//                                            and what `npm run novel` and the app's equities track measure.
//   ./.research/yahoo-1d/<SYMBOL>.json       rescaled to total return (open, high and low by adjclose/close).
//                                            Only the benchmark wants it: SPY held with its dividends.
//
//   node scripts/fetch-yahoo.mjs            fetch what is missing
//   REFRESH=1 node scripts/fetch-yahoo.mjs  fetch everything again
//   SYMBOLS=SPY,QQQ node scripts/fetch-yahoo.mjs   only these
//
// No key. Three details that matter:
//   · `range=max` returns MONTHLY bars whatever the interval says; explicit period1/period2 returns daily.
//   · The first research ran on the total-return series, and the coupons of the bond ETFs were most of what it
//     called an edge (+0.54 R long on bonds, currencies and commodities became +0.05 R on raw prices). A
//     perpetual pays no dividend, so a rule is measured on the raw series and only the benchmark on the other.
//   · Futures carry no dividends, so the continuous contracts (GC=F …) are the same in both — and carry their
//     roll gaps, which is why the research uses the physical ETFs for the commodities and keeps the futures
//     as a cross-check only.
//
// ./.research is gitignored and in .vercelignore.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const RAW_DIR = './.research/yahoo-1d-raw'
const ADJ_DIR = './.research/yahoo-1d'
mkdirSync(RAW_DIR, { recursive: true })
mkdirSync(ADJ_DIR, { recursive: true })

/** group → symbols. The group names are what `npm run novel` reports by. */
export const UNIVERSE = {
  // The commodities OKX lists as X-Perps (XAU, XAG, CL, BZ) through the funds that hold them: no roll gaps.
  commodityOkx: ['GLD', 'SLV', 'USO', 'BNO'],
  commodityOther: ['UNG', 'DBA', 'DBB', 'DBC', 'CPER', 'PPLT', 'PALL'],
  // Continuous futures of the same four, for a cross-check (unadjusted for rolls).
  futures: ['GC=F', 'SI=F', 'CL=F', 'BZ=F', 'HG=F', 'NG=F'],
  equityIndex: ['SPY', 'QQQ', 'IWM', 'MDY', 'EFA', 'EEM', 'EWJ', 'EWZ', 'EWY', 'FXI', 'VGK'],
  sectors: ['XLE', 'XLF', 'XLK', 'XLV', 'XLU', 'XLP', 'XLY', 'XLI', 'XLB'],
  bonds: ['TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'TIP', 'EMB'],
  fx: ['UUP', 'FXE', 'FXY', 'FXB', 'FXA', 'FXC'],
  reit: ['VNQ'],
  // Single stocks OKX lists as X-Perps (today's popular names: a survivor selection, kept apart for that reason).
  okxStocks: [
    'AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA', 'INTC', 'MU', 'MRVL', 'AMD', 'MSTR', 'COIN', 'HOOD',
    'QCOM', 'PLTR', 'ARM', 'DELL', 'AVGO', 'BE', 'OKTA', 'WDC', 'MRNA', 'KO', 'ORCL', 'COHR', 'TSM', 'GLW', 'AMAT',
    'CRDO', 'IONQ', 'ASTS', 'SMCI', 'ADBE', 'APP', 'NFLX', 'RKLB', 'NBIS', 'IREN', 'LITE', 'AAOI', 'CRWV', 'BMNR',
    'FLNC', 'USAR', 'SNDK', 'CRCL',
  ],
  // Leveraged and inverse ETFs, in bull / bear pairs where they exist (SOXL and SOXS are both X-Perps).
  leveraged: [
    'SOXL', 'SOXS', 'TQQQ', 'SQQQ', 'UPRO', 'SPXU', 'SPXL', 'SPXS', 'TNA', 'TZA', 'TECL', 'TECS', 'FAS', 'FAZ',
    'LABU', 'LABD', 'YINN', 'YANG', 'ERX', 'ERY', 'NUGT', 'DUST', 'UCO', 'SCO', 'BOIL', 'KOLD', 'KORU', 'EDC', 'EDZ',
    'TMF', 'TMV', 'UDOW', 'SDOW', 'URTY', 'SRTY', 'WEBL', 'WEBS', 'CURE', 'DPST', 'JNUG', 'JDST',
  ],
  macro: ['^GSPC', '^NDX', '^IXIC', '^VIX', 'DX-Y.NYB', '^TNX', '^TYX', '^IRX', 'KRW=X', 'EURUSD=X'],
}

const file = (dir, sym) => `${dir}/${sym.replace(/[^A-Za-z0-9.=-]/g, '_')}.json`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** One symbol's daily bars twice over: `raw` as printed, `adjusted` rescaled to total return. Null when Yahoo has nothing. */
export async function fetchSymbol(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=div%7Csplit`
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (r.status === 429) {
      await sleep(3000 * (attempt + 1))
      continue
    }
    const j = await r.json().catch(() => null)
    const res = j?.chart?.result?.[0]
    if (!res?.timestamp) return null
    const q = res.indicators.quote[0]
    const adj = res.indicators.adjclose?.[0]?.adjclose
    const raw = []
    const adjusted = []
    // One bar per date, the first: a stray duplicate (a partial session) would break every rolling window.
    const seen = new Set()
    for (let i = 0; i < res.timestamp.length; i++) {
      const [o, h, l, c] = [q.open[i], q.high[i], q.low[i], q.close[i]]
      if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0)) continue
      // The trading date at 00:00 UTC: Yahoo stamps each bar with the exchange's open.
      const time = Math.floor((res.timestamp[i] * 1000) / 86_400_000) * 86_400_000
      if (seen.has(time)) continue
      seen.add(time)
      const k = adj && Number.isFinite(adj[i]) && adj[i] > 0 ? adj[i] / c : 1
      const vol = q.volume?.[i] ?? 0
      raw.push({ time, open: o, high: h, low: l, close: c, vol, confirmed: true })
      adjusted.push({ time, open: o * k, high: h * k, low: l * k, close: c * k, vol, confirmed: true })
    }
    return { raw, adjusted }
  }
  return null
}

if (process.argv[1]?.endsWith('fetch-yahoo.mjs')) {
  const wanted = process.env.SYMBOLS?.split(',').filter(Boolean)
  const all = [...new Set(Object.values(UNIVERSE).flat())]
  const symbols = wanted ?? all
  let ok = 0
  const failed = []
  for (const sym of symbols) {
    // A symbol with only one of the two files (an older run wrote the adjusted series alone) is fetched again.
    if (!process.env.REFRESH && existsSync(file(RAW_DIR, sym)) && existsSync(file(ADJ_DIR, sym))) {
      ok++
      continue
    }
    const got = await fetchSymbol(sym)
    if (!got || got.raw.length < 100) {
      failed.push(sym)
      console.log(`  ✗ ${sym}`)
    } else {
      writeFileSync(file(RAW_DIR, sym), JSON.stringify(got.raw))
      writeFileSync(file(ADJ_DIR, sym), JSON.stringify(got.adjusted))
      ok++
      const rows = got.raw
      console.log(`  ✓ ${sym.padEnd(9)} ${String(rows.length).padStart(5)} barras  ${new Date(rows[0].time).toISOString().slice(0, 10)} → ${new Date(rows[rows.length - 1].time).toISOString().slice(0, 10)}`)
    }
    await sleep(350)
  }
  console.log(`\n${ok} de ${symbols.length} · sin datos: ${failed.join(', ') || 'ninguno'}`)
}
