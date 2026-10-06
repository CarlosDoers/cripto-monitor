// What a search for new alert strategies found, in one place (2026-10-06).
//
//   npm run ideas              every section whose data is on disk
//   npm run ideas reversal     the reversal outside BTC, ETH and SOL, and before 2022
//   npm run ideas trend        the Donchian with an EMA trend filter, both periods — and
//                              exits non-zero if the figures the registry preset and the Screener's
//                              help quote (DONCHIAN_TREND_EVIDENCE) drift from what it measures
//   npm run ideas fvg          the fair value gap against a control with random dates
//   npm run ideas orb          the opening range on altcoins, and the double-touch rule
//   npm run ideas listing      do newly listed coins underperform BTC
//
// The families that simply lose (squeeze, NR7, Turtle Soup, climax, RSI
// divergence, UT Bot, Nadaraya-Watson, candles, alt/BTC ratio, volatility
// breakout, hour window, Ichimoku) are measured with `npm run try` — the commands
// are in CLAUDE.md; they need no script of their own.
//
// Data (all gitignored, all public OKX candles, no key):
//   node scripts/fetch-board.mjs 4H | 1D            the 30 coins since 2022
//   BOARD_OLD=1 node scripts/fetch-board.mjs 4H|1D  14 coins, 2018-2021 — a period nothing was tuned on
//   BOARD_COINS=XRP,DOGE,ADA,LINK,AVAX,LTC,DOT,BCH,NEAR,UNI node scripts/fetch-board.mjs 15m   (~4 min a coin)
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { STRATEGIES } from '../src/lib/indicators/registry.ts'
import { analyseDonchian, DONCHIAN_SETTINGS, DONCHIAN_TREND_EVIDENCE } from '../src/lib/indicators/donchianBreakout.ts'
import { analyseOpeningRange, OPENING_RANGE_SETTINGS } from '../src/lib/indicators/openingRange.ts'
import {
  analyseFvg,
  analyseFvgDepth25,
  analyseFvgDepth75,
  analyseFvgGap025,
  analyseFvgGap100,
  analyseFvgTarget15,
  analyseFvgTarget3,
  analyseFvgTradeThrough,
  analyseFvgTrend50,
  analyseFvgTrend100,
  analyseFvgTrend200,
  analyseFvgWindow10,
  analyseFvgWindow40,
  FVG_SETTINGS,
} from '../src/lib/indicators/fvg.ts'
import { resolveTrade } from '../src/lib/indicators/tradeKit.ts'
import { atr } from '../src/lib/indicators/ta.ts'
import { feeInR } from '../src/lib/indicators/types.ts'
import { deflate } from '../src/lib/indicators/deflated.ts'

const section = process.argv[2] ?? 'all'
const want = (name) => section === 'all' || section === name

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const sd = (xs) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const f = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '  — ')
/** 95 % interval of the mean resampling MONTHS: coins in one month move together, so trades are not independent. */
function monthCI(trades, runs = 4000) {
  const byMonth = {}
  for (const t of trades) (byMonth[new Date(t.t).toISOString().slice(0, 7)] ??= []).push(t.r)
  const groups = Object.values(byMonth)
  let seed = 11
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const out = []
  for (let b = 0; b < runs; b++) {
    const pick = []
    for (let i = 0; i < groups.length; i++) pick.push(...groups[Math.floor(rnd() * groups.length)])
    out.push(mean(pick))
  }
  out.sort((a, b) => a - b)
  return [out[Math.floor(runs * 0.025)], out[Math.floor(runs * 0.975)]]
}
const ci = (trades) => {
  const [lo, hi] = monthCI(trades)
  return `[${f(lo)}, ${f(hi)}]`
}
const pct = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)} %` : '  — ')

function load(dir, min = 250) {
  if (!existsSync(dir)) return null
  return readdirSync(dir)
    .filter((x) => x.endsWith('.json') && !x.startsWith('_'))
    .map((x) => [x.replace('.json', ''), JSON.parse(readFileSync(`${dir}/${x}`, 'utf8'))])
    .filter(([, c]) => c.length >= min)
}
const missing = (what, hint) => console.log(`  (falta ${what}: ${hint})`)

/** Net R of the closed trades of `fn` on one series, each tagged with the half it opened in. */
const closed = (fn, cs) => {
  const half = Math.floor(cs.length / 2)
  return fn(cs).signals
    .filter((s) => s.outcome !== 'open' && Number.isFinite(s.resultR))
    .map((s) => ({ r: s.resultR - s.feeR, gross: s.resultR, fee: s.feeR, side: s.side, first: s.index < half, t: s.time, closedIndex: s.closedIndex, index: s.index }))
}

// ── 1. the reversal outside the three coins it was tuned on ──────────────────
if (want('reversal')) {
  console.log('\n=== REVERSIÓN DIARIA (la de «Oportunidades ahora»), fuera de BTC, ETH y SOL ===')
  const reversal = (cs) => STRATEGIES.find((s) => s.key === 'reversal').run(cs, 'tuned')
  const sets = [
    ['2022-26 · diario de OKX (cierre 16:00 UTC, el de la app)', './.candles-board-1D', 'node scripts/fetch-board.mjs 1D'],
    ['2022-26 · diario a las 00:00 UTC', './.candles-screener', 'npm run screener'],
    ['2018-21 · diario de OKX', './.candles-board-1Dold', 'BOARD_OLD=1 node scripts/fetch-board.mjs 1D'],
  ]
  for (const [label, dir, hint] of sets) {
    const coins = load(dir)
    if (!coins) {
      missing(dir, hint)
      continue
    }
    const majors = []
    const others = []
    for (const [coin, cs] of coins) (['BTC', 'ETH', 'SOL'].includes(coin) ? majors : others).push(...closed(reversal, cs))
    const all = [...majors, ...others]
    const mean_ = (ts) => mean(ts.map((t) => t.r))
    console.log(`  ${label}`)
    console.log(`     BTC+ETH+SOL  n=${String(majors.length).padStart(3)}  ${f(mean_(majors))} R ${ci(majors)}    el resto (${coins.length - 3} monedas)  n=${others.length}  ${f(mean_(others))} R ${ci(others)}    todas  n=${all.length}  ${f(mean_(all))} R`)
  }
  console.log('  (intervalos al 95 % remuestreando meses.) Producción dice +0,43 R sobre BTC, ETH y SOL (n=141): reproduce con el diario')
  console.log('  de OKX; en el resto no hay ventaja demostrada, y antes de 2022 BTC, ETH y SOL pierden de forma significativa.')
}

// ── 2. the Donchian with a trend filter ──────────────────────────────────────
if (want('trend')) {
  console.log('\n=== DONCHIAN 4 h CON FILTRO DE TENDENCIA (largos sobre la EMA, cortos bajo ella) ===')
  const variants = [
    ['sin filtro', (c) => analyseDonchian(c)],
    ['EMA 100', (c) => analyseDonchian(c, { ...DONCHIAN_SETTINGS, trendLen: 100 })],
    ['EMA 150', (c) => analyseDonchian(c, { ...DONCHIAN_SETTINGS, trendLen: 150 })],
    ['EMA 200', (c) => analyseDonchian(c, { ...DONCHIAN_SETTINGS, trendLen: 200 })],
    ['EMA 300', (c) => analyseDonchian(c, { ...DONCHIAN_SETTINGS, trendLen: 300 })],
  ]
  /** What this run measured for the preset (EMA 200) and for the same breakouts unfiltered, per period. */
  const measured = {}
  for (const [period, label, dir, hint] of [
    ['board', '2022-26 · 30 monedas', './.candles-board-4H', 'node scripts/fetch-board.mjs 4H'],
    ['old', '2018-21 · 14 monedas', './.candles-board-4Hold', 'BOARD_OLD=1 node scripts/fetch-board.mjs 4H'],
    // 1 h is big (41 000 candles a coin): only the unfiltered breakout and the preset.
    ['hourly', '2022-26 · 30 monedas · 1 h', './.candles-board-1H', 'node scripts/fetch-board.mjs 1H'],
  ]) {
    const coins = load(dir, 800)
    if (!coins) {
      missing(dir, hint)
      continue
    }
    console.log(`  ${label}`)
    for (const [name, fn] of variants.filter(([n]) => period !== 'hourly' || n === 'sin filtro' || n === 'EMA 200')) {
      const T = coins.flatMap(([, cs]) => closed(fn, cs))
      const side = (s) => T.filter((t) => t.side === s).map((t) => t.r)
      const halves = [mean(T.filter((t) => t.first).map((t) => t.r)), mean(T.filter((t) => !t.first).map((t) => t.r))]
      console.log(
        `     ${name.padEnd(10)} n=${String(T.length).padStart(5)}  ${f(mean(T.map((t) => t.r)))} R   mitades ${f(halves[0])} / ${f(halves[1])}   largos ${f(mean(side('long')))} (${side('long').length})  cortos ${f(mean(side('short')))} (${side('short').length})`,
      )
      measured[period] ??= {}
      if (name === 'sin filtro') measured[period].plain = mean(T.map((t) => t.r))
      if (name === 'EMA 200') {
        const best = [...T.map((t) => t.r)].sort((a, b) => b - a)
        Object.assign(measured[period], {
          n: T.length,
          net: mean(T.map((t) => t.r)),
          halves,
          longs: mean(side('long')),
          shorts: mean(side('short')),
          withoutBest10: mean(best.slice(10)),
          doubleFee: mean(T.map((t) => t.gross - 2 * t.fee)),
        })
      }
    }
  }
  console.log('  El filtro sube la esperanza por operación pero quita operaciones y se parece más a la EMA 200:')
  console.log('  el Sharpe mensual de «todas las señales» no mejora (`npm run battery`). Sirve para priorizar.')

  // The figures the preset's note and the Screener's help quote must still be what the data says.
  const drift = []
  const near = (what, got, quoted, tol) => {
    if (!(Math.abs(got - quoted) <= tol)) drift.push(`${what}: medido ${f(got, 3)} vs citado ${f(quoted, 3)}`)
  }
  const E = DONCHIAN_TREND_EVIDENCE
  for (const [period, quoted] of [['board', E.board], ['old', E.old], ['hourly', E.hourly]]) {
    const m = measured[period]
    if (!m) continue
    if (Math.abs(m.n - quoted.n) > Math.max(10, quoted.n * 0.03)) drift.push(`${period} · n: medido ${m.n} vs citado ${quoted.n}`)
    near(`${period} · neto`, m.net, quoted.net, 0.03)
    near(`${period} · sin filtro`, m.plain, quoted.plain, 0.03)
    if (period === 'hourly') {
      near('1 h · 1ª mitad', m.halves[0], quoted.halves[0], 0.03)
      near('1 h · 2ª mitad', m.halves[1], quoted.halves[1], 0.03)
      near('1 h · con el doble de comisión', m.doubleFee, quoted.doubleFee, 0.03)
    }
    if (period === 'board') {
      near('board · 1ª mitad', m.halves[0], quoted.halves[0], 0.03)
      near('board · 2ª mitad', m.halves[1], quoted.halves[1], 0.03)
      near('board · largos', m.longs, quoted.longs, 0.03)
      near('board · cortos', m.shorts, quoted.shorts, 0.03)
      near('board · sin las 10 mejores', m.withoutBest10, quoted.withoutBest10, 0.03)
    }
  }
  if (Object.keys(measured).length) {
    console.log(`\n  Cifras que cita la interfaz (DONCHIAN_TREND_EVIDENCE): ${drift.length ? 'DESVIADAS' : 'coinciden con lo medido'}`)
    for (const d of drift) console.log(`    ⚠ ${d}`)
    if (drift.length) process.exitCode = 1
  }
}

// ── 3. the fair value gap, and whether the gap itself matters ────────────────
if (want('fvg')) {
  console.log('\n=== FAIR VALUE GAP (diario) ===')
  const variants = [
    ['titular', analyseFvg],
    ['entrada 25 %', analyseFvgDepth25],
    ['entrada 75 %', analyseFvgDepth75],
    ['hueco ≥0,25 ATR', analyseFvgGap025],
    ['hueco ≥1 ATR', analyseFvgGap100],
    ['objetivo 1,5 R', analyseFvgTarget15],
    ['objetivo 3 R', analyseFvgTarget3],
    ['orden 10 barras', analyseFvgWindow10],
    ['orden 40 barras', analyseFvgWindow40],
    ['exige cruzar 0,2 %', analyseFvgTradeThrough],
    ['con tendencia EMA 50', analyseFvgTrend50],
    ['con tendencia EMA 100', analyseFvgTrend100],
    ['con tendencia EMA 200', analyseFvgTrend200],
  ]
  for (const [label, dir, hint] of [
    ['2022-26 · 30 monedas, diario de OKX', './.candles-board-1D', 'node scripts/fetch-board.mjs 1D'],
    ['2018-21 · 14 monedas', './.candles-board-1Dold', 'BOARD_OLD=1 node scripts/fetch-board.mjs 1D'],
  ]) {
    const coins = load(dir)
    if (!coins) {
      missing(dir, hint)
      continue
    }
    console.log(`  ${label}`)
    for (const [name, fn] of variants) {
      const T = coins.flatMap(([, cs]) => closed(fn, cs))
      console.log(`     ${name.padEnd(19)} n=${String(T.length).padStart(4)}  ${f(mean(T.map((t) => t.r)), 3)} R   mitades ${f(mean(T.filter((t) => t.first).map((t) => t.r)))} / ${f(mean(T.filter((t) => !t.first).map((t) => t.r)))}`)
    }

    // The control: the same limit orders, with the distances of the real gaps, on random dates and sides.
    const unitOf = (cs) => atr(cs.map((c) => c.high), cs.map((c) => c.low), cs.map((c) => c.close), 14)
    const pool = []
    for (const [, cs] of coins) {
      const u = unitOf(cs)
      for (let i = 20; i < cs.length; i++) {
        if (!(u[i - 1] > 0)) continue
        const a = cs[i - 2]
        const m = cs[i - 1]
        const b = cs[i]
        const up = b.low - a.high
        const down = a.low - b.high
        if (up >= FVG_SETTINGS.minGapAtr * u[i - 1] && m.close > m.open) {
          const e = b.low - FVG_SETTINGS.entryDepth * up
          pool.push({ E: (b.close - e) / u[i - 1], G: (e - a.high) / u[i - 1], S: (e - a.low) / u[i - 1] })
        } else if (down >= FVG_SETTINGS.minGapAtr * u[i - 1] && m.close < m.open) {
          const e = b.high + FVG_SETTINGS.entryDepth * down
          pool.push({ E: (e - b.close) / u[i - 1], G: (a.low - e) / u[i - 1], S: (a.high - e) / u[i - 1] })
        }
      }
    }
    const bars = coins.reduce((a, [, cs]) => a + cs.length, 0)
    const p = pool.length / bars
    const control = (seed0) => {
      let st = seed0 * 7919
      const rnd = () => (st = (st * 1103515245 + 12345) % 2147483648) / 2147483648
      const rs = []
      for (const [, cs] of coins) {
        const u = unitOf(cs)
        let pending = null
        let i = 20
        while (i < cs.length) {
          const b = cs[i]
          if (pending) {
            const long = pending.side === 1
            if (long ? b.low <= pending.entry : b.high >= pending.entry) {
              const sig = resolveTrade(cs, { index: i, side: long ? 'long' : 'short', entry: pending.entry, stop: pending.stop, target: pending.target, maxBars: FVG_SETTINGS.maxBars, intrabar: true, limitFill: true }, { feeRate: FVG_SETTINGS.feeRate })
              pending = null
              if (sig.outcome === 'open') break
              if (Number.isFinite(sig.resultR)) rs.push(sig.resultR - sig.feeR)
              i = (sig.closedIndex ?? i) + 1
              continue
            } else if (i > pending.expires || (long ? b.close < pending.edge : b.close > pending.edge)) pending = null
          }
          if (u[i - 1] > 0 && rnd() < p) {
            const g = pool[Math.floor(rnd() * pool.length)]
            const side = rnd() < 0.5 ? 1 : -1
            const entry = b.close - side * g.E * u[i - 1]
            const stop = entry - side * g.S * u[i - 1]
            const risk = Math.abs(entry - stop)
            if (risk > 0 && feeInR(entry, stop, FVG_SETTINGS.feeRate) <= 1)
              pending = { side, entry, stop, target: entry + side * FVG_SETTINGS.targetR * risk, edge: entry - side * g.G * u[i - 1], expires: i + FVG_SETTINGS.fillWindow }
          }
          i++
        }
      }
      return mean(rs)
    }
    const real = mean(coins.flatMap(([, cs]) => closed(analyseFvg, cs).map((t) => t.r)))
    const nets = Array.from({ length: 30 }, (_, k) => control(k + 1))
    console.log(`     control al azar (30 semillas, mismas órdenes y distancias): ${f(mean(nets), 3)} ± ${sd(nets).toFixed(3)} → el hueco aporta ${f(real - mean(nets), 3)} R (${((real - mean(nets)) / sd(nets)).toFixed(1)} σ)`)
  }
  console.log('  Vecindario positivo y control superado en los dos periodos, pero ~+0,1 R: bajo el listón de 0,1 R, con')
  console.log('  intervalo mensual que incluye el cero (`npm run battery -- fvg analyseFvg 1D`). No se registra.')
}

// ── 4. the opening range outside BTC, ETH and SOL ────────────────────────────
if (want('orb')) {
  console.log('\n=== RANGO DE APERTURA (15 m) FUERA DE BTC, ETH Y SOL, Y REGLA DE LOS DOBLES TOQUES ===')
  const doubleTouch = (cs) => analyseOpeningRange(cs, { ...OPENING_RANGE_SETTINGS, doubleTouchLoss: true })
  const shipped = (cs) => analyseOpeningRange(cs)
  const report = (label, entries) => {
    if (!entries.length) return
    for (const [name, fn] of [['producción', shipped], ['dobles toques = pérdida', doubleTouch]]) {
      const per = entries.map(([coin, path]) => [coin, closed(fn, JSON.parse(readFileSync(path, 'utf8')))])
      const all = per.flatMap(([, t]) => t)
      const R = all.map((t) => t.r)
      const yr = {}
      for (const t of all) (yr[new Date(t.t).getUTCFullYear()] ??= []).push(t.r)
      console.log(`  ${label} · ${name}: n=${R.length}  ${f(mean(R), 3)} R  mitades ${f(mean(all.filter((t) => t.first).map((t) => t.r)))} / ${f(mean(all.filter((t) => !t.first).map((t) => t.r)))}  PSR ${(deflate(R, 1).psr * 100).toFixed(0)} %`)
      console.log(`       ${per.map(([c, t]) => `${c} ${f(mean(t.map((x) => x.r)))}`).join(' · ')}`)
      console.log(`       por año: ${Object.entries(yr).sort().map(([y, v]) => `${y} ${f(mean(v))}`).join(' · ')}`)
    }
  }
  const majors = ['BTC', 'ETH', 'SOL'].map((s) => [s, `./.candles/${s}_USDT__15m.json`]).filter(([, p]) => existsSync(p))
  if (majors.length) report('BTC/ETH/SOL spot', majors)
  else missing('./.candles', 'npm run candles')
  const dir = './.candles-board-15m'
  const alts = existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith('.json')).map((x) => [x.replace('.json', ''), `${dir}/${x}`]) : []
  if (alts.length) report(`${alts.length} altcoins`, alts)
  else missing(dir, 'BOARD_COINS=XRP,DOGE,ADA,LINK,AVAX,LTC,DOT,BCH,NEAR,UNI node scripts/fetch-board.mjs 15m')
}

// ── 5. the new-listing effect ────────────────────────────────────────────────
if (want('listing')) {
  console.log('\n=== MONEDAS RECIÉN LISTADAS FRENTE A BTC (spot de OKX, diario) ===')
  const coins = load('./.candles-board-1D', 1)
  if (!coins) missing('./.candles-board-1D', 'node scripts/fetch-board.mjs 1D')
  else {
    const all = Object.fromEntries(coins)
    const btc = all.BTC
    const btcAt = (t) => {
      let lo = 0
      let hi = btc.length - 1
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1
        if (btc[m].time <= t) lo = m
        else hi = m - 1
      }
      return btc[lo].close
    }
    const fresh = coins.filter(([s, c]) => s !== 'BTC' && c[0].time > Date.parse('2022-03-01'))
    console.log(`  listadas dentro de la ventana: ${fresh.length} (${fresh.map(([s]) => s).join(', ')})`)
    for (const [from, to] of [[1, 30], [7, 60], [7, 90], [30, 90], [30, 180]]) {
      const rel = []
      for (const [, c] of fresh) {
        if (c.length <= to) continue
        rel.push(c[to].close / c[from].close - btcAt(c[to].time) / btcAt(c[from].time))
      }
      console.log(`  día ${String(from).padStart(2)} → ${String(to).padStart(3)}: n=${rel.length}  media frente a BTC ${pct(mean(rel))}  mediana ${pct(med(rel))}  peor que BTC ${rel.filter((x) => x < 0).length}/${rel.length}`)
    }
    console.log('  La mediana pierde frente a BTC pero la media no: unas pocas multiplican por varios. No es un corto operable.')
  }
}
