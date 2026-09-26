import { num } from './format'
import type { Market } from './markets'
import type { Candle as Row } from './types'
import type { Candle } from './indicators/types'
import { atr, rsi, sma } from './indicators/ta'
import { analyseSmc } from './indicators/smc'
import { analyseTraps, trapWatch, TUNED_SETTINGS } from './indicators/reversalTrap'

/**
 * The per-contract figures the Screener filters on — Finviz's technical block,
 * rebuilt from one request of daily UTC candles per contract, plus the two
 * readings Finviz cannot give: where this app's own indicators stand.
 *
 * Every figure is *description*. The strategies' measurements already showed
 * that conditioning on RSI hurt the reversal and that no level technique beats
 * a random line; whether any screen predicts anything is measured separately
 * (`npm run screener`), and the view says so.
 *
 * History is short: the X-Perp board was listed on 2026-03-30, so a contract
 * has at most ~180 daily bars. That rules out a 200-day average and a 52-week
 * high, which Finviz leads with. Rather than print them from too little data,
 * the screen uses the 20- and 50-day ones and "since listing".
 */

export interface Technicals {
  bars: number
  perf7: number
  perf30: number
  perf90: number
  /** Since the first daily bar on record, i.e. since listing on the X-Perp board. */
  perfListed: number
  rsi14: number
  /** Price against its 20 and 50-day simple averages, as a fraction. */
  vsSma20: number
  vsSma50: number
  /** Price over the highest high / lowest low of the previous 20 and 50 days. */
  vsHigh20: number
  vsLow20: number
  vsHigh50: number
  vsLow50: number
  /** Mean daily high-low range as a share of the close — Finviz's volatility. */
  volatilityWeek: number
  volatilityMonth: number
  atrPct: number
  /** Last 24 h of volume against the mean of the previous 20 full days. */
  relVolume: number
  /** Move since today's UTC open. */
  fromOpen: number
  trend: 'alcista' | 'bajista' | 'mixta'
  smc: {
    swing: 1 | -1 | 0
    internal: 1 | -1 | 0
    /** The most recent break on either scale, and how many daily bars ago. */
    last?: { kind: 'BOS' | 'CHoCH'; bias: 1 | -1; scale: 'swing' | 'internal'; barsAgo: number }
  }
  reversal: 'long-activa' | 'short-activa' | 'vigila-long' | 'vigila-short' | null
  /** The last 91 closes — 90 days of change, the same span as `perf90`. */
  closes: number[]
}

export interface ScreenRow extends Market {
  tech: Technicals | null
}

const MIN_BARS = 30

const back = (closes: number[], n: number) => {
  const i = closes.length - 1 - n
  return i >= 0 ? closes[closes.length - 1] / closes[i] - 1 : NaN
}

export function technicals(rows: Row[], market: Market): Technicals | null {
  const all: Candle[] = rows.map((r) => ({
    time: Number(r[0]),
    open: num(r[1]),
    high: num(r[2]),
    low: num(r[3]),
    close: num(r[4]),
    vol: num(r[6]),
    confirmed: r[8] === '1',
  }))
  const done = all.filter((c) => c.confirmed)
  if (done.length < MIN_BARS) return null

  // Price figures use the live price as today's close; everything that needs a
  // finished day (volume, volatility, indicators) uses confirmed bars only.
  const today = all.at(-1)!.confirmed ? null : all.at(-1)!
  const live = market.last > 0 ? market.last : done.at(-1)!.close
  const closes = [...done.map((c) => c.close), live]
  const last = closes.length - 1

  const highs = done.map((c) => c.high)
  const lows = done.map((c) => c.low)
  const maxOf = (a: number[], n: number) => Math.max(...a.slice(-n))
  const minOf = (a: number[], n: number) => Math.min(...a.slice(-n))
  const s20 = sma(closes, 20)[last]
  const s50 = sma(closes, 50)[last]
  const range = (n: number) => {
    const d = done.slice(-n)
    return d.reduce((s, c) => s + (c.high - c.low) / c.close, 0) / d.length
  }
  const a14 = atr(highs, lows, done.map((c) => c.close), 14).at(-1) ?? NaN
  const dayVolumes = done.slice(-20).map((c) => (c.vol ?? 0) * c.close)
  const meanVolume = dayVolumes.reduce((s, v) => s + v, 0) / dayVolumes.length

  const trend =
    live > s20 && s20 > s50 ? 'alcista' : live < s20 && s20 < s50 ? 'bajista' : 'mixta'

  // Structure and the reversal run on finished days only, like every analysis
  // in the app: a signal on a forming candle can vanish when it closes.
  const smc = analyseSmc(done)
  const lastBreak = smc.structures.at(-1)
  const traps = analyseTraps(done, TUNED_SETTINGS)
  const watch = trapWatch(
    done,
    traps.upper,
    traps.basis,
    traps.lower,
    traps.signals.at(-1)?.index ?? null,
    traps.active?.side ?? null,
    TUNED_SETTINGS,
  )
  const reversal = traps.active
    ? traps.active.side === 'long'
      ? 'long-activa'
      : 'short-activa'
    : watch?.armed
      ? watch.zone === 'below'
        ? 'vigila-long'
        : 'vigila-short'
      : null

  return {
    bars: done.length,
    perf7: back(closes, 7),
    perf30: back(closes, 30),
    perf90: back(closes, 90),
    perfListed: live / done[0].open - 1,
    rsi14: rsi(closes, 14)[last],
    vsSma20: Number.isFinite(s20) ? live / s20 - 1 : NaN,
    vsSma50: Number.isFinite(s50) ? live / s50 - 1 : NaN,
    vsHigh20: live / maxOf(highs, 20) - 1,
    vsLow20: live / minOf(lows, 20) - 1,
    vsHigh50: done.length >= 50 ? live / maxOf(highs, 50) - 1 : NaN,
    vsLow50: done.length >= 50 ? live / minOf(lows, 50) - 1 : NaN,
    volatilityWeek: range(7),
    volatilityMonth: range(30),
    atrPct: a14 / live,
    relVolume: meanVolume > 0 ? market.volumeUsd / meanVolume : NaN,
    fromOpen: today && today.open > 0 ? live / today.open - 1 : NaN,
    trend,
    smc: {
      swing: smc.swingTrend,
      internal: smc.internalTrend,
      last: lastBreak
        ? {
            kind: lastBreak.kind,
            bias: lastBreak.bias,
            scale: lastBreak.scale,
            barsAgo: done.length - 1 - lastBreak.index,
          }
        : undefined,
    },
    reversal,
    closes: closes.slice(-91),
  }
}

// ── Filters ──────────────────────────────────────────────────────────────────

export interface ScreenFilters {
  category: 'todas' | 'cripto' | 'accion' | 'materia'
  minVolume: number
  perf7: '' | 'up' | 'down' | 'up5' | 'up10' | 'down5' | 'down10'
  perf30: '' | 'up' | 'down' | 'up10' | 'up20' | 'down10' | 'down20'
  rsi: '' | 'oversold' | 'low' | 'high' | 'overbought'
  sma20: '' | 'above' | 'below'
  sma50: '' | 'above' | 'below'
  extremes: '' | 'high20' | 'low20' | 'high50' | 'low50' | 'near20'
  volatility: '' | 'low' | 'mid' | 'high'
  relVolume: 0 | 1.5 | 2 | 3
  trend: '' | 'alcista' | 'bajista'
  structure: '' | 'swing-up' | 'swing-down' | 'choch5' | 'bos5'
  reversal: '' | 'any' | 'activa' | 'vigila'
  onlyTraded: boolean
}

export const NO_FILTERS: ScreenFilters = {
  category: 'todas',
  minVolume: 0,
  perf7: '',
  perf30: '',
  rsi: '',
  sma20: '',
  sma50: '',
  extremes: '',
  volatility: '',
  relVolume: 0,
  trend: '',
  structure: '',
  reversal: '',
  onlyTraded: false,
}

/** Technical filters need candles; a row without them fails any technical test. */
export function passes(row: ScreenRow, f: ScreenFilters): boolean {
  if (f.category !== 'todas' && row.category !== f.category) return false
  if (row.volumeUsd < f.minVolume) return false
  if (f.onlyTraded && !row.traded) return false

  const technical =
    f.perf7 || f.perf30 || f.rsi || f.sma20 || f.sma50 || f.extremes || f.volatility || f.relVolume ||
    f.trend || f.structure || f.reversal
  if (!technical) return true
  const t = row.tech
  if (!t) return false

  const p7 = t.perf7
  if (f.perf7 === 'up' && !(p7 > 0)) return false
  if (f.perf7 === 'down' && !(p7 < 0)) return false
  if (f.perf7 === 'up5' && !(p7 > 0.05)) return false
  if (f.perf7 === 'up10' && !(p7 > 0.1)) return false
  if (f.perf7 === 'down5' && !(p7 < -0.05)) return false
  if (f.perf7 === 'down10' && !(p7 < -0.1)) return false

  const p30 = t.perf30
  if (f.perf30 === 'up' && !(p30 > 0)) return false
  if (f.perf30 === 'down' && !(p30 < 0)) return false
  if (f.perf30 === 'up10' && !(p30 > 0.1)) return false
  if (f.perf30 === 'up20' && !(p30 > 0.2)) return false
  if (f.perf30 === 'down10' && !(p30 < -0.1)) return false
  if (f.perf30 === 'down20' && !(p30 < -0.2)) return false

  const r = t.rsi14
  if (f.rsi === 'oversold' && !(r < 30)) return false
  if (f.rsi === 'low' && !(r >= 30 && r < 50)) return false
  if (f.rsi === 'high' && !(r >= 50 && r <= 70)) return false
  if (f.rsi === 'overbought' && !(r > 70)) return false

  if (f.sma20 === 'above' && !(t.vsSma20 > 0)) return false
  if (f.sma20 === 'below' && !(t.vsSma20 < 0)) return false
  if (f.sma50 === 'above' && !(t.vsSma50 > 0)) return false
  if (f.sma50 === 'below' && !(t.vsSma50 < 0)) return false

  if (f.extremes === 'high20' && !(t.vsHigh20 >= 0)) return false
  if (f.extremes === 'low20' && !(t.vsLow20 <= 0)) return false
  if (f.extremes === 'high50' && !(t.vsHigh50 >= 0)) return false
  if (f.extremes === 'low50' && !(t.vsLow50 <= 0)) return false
  if (f.extremes === 'near20' && !(t.vsHigh20 >= -0.05)) return false

  const v = t.volatilityMonth
  if (f.volatility === 'low' && !(v < 0.03)) return false
  if (f.volatility === 'mid' && !(v >= 0.03 && v <= 0.06)) return false
  if (f.volatility === 'high' && !(v > 0.06)) return false

  if (f.relVolume && !(t.relVolume >= f.relVolume)) return false
  if (f.trend && t.trend !== f.trend) return false

  const b = t.smc.last
  if (f.structure === 'swing-up' && t.smc.swing !== 1) return false
  if (f.structure === 'swing-down' && t.smc.swing !== -1) return false
  if (f.structure === 'choch5' && !(b && b.kind === 'CHoCH' && b.barsAgo <= 5)) return false
  if (f.structure === 'bos5' && !(b && b.kind === 'BOS' && b.barsAgo <= 5)) return false

  if (f.reversal === 'any' && !t.reversal) return false
  if (f.reversal === 'activa' && !(t.reversal === 'long-activa' || t.reversal === 'short-activa')) return false
  if (f.reversal === 'vigila' && !(t.reversal === 'vigila-long' || t.reversal === 'vigila-short')) return false

  return true
}

// ── Presets: Finviz's "Signal" menu ──────────────────────────────────────────

export type SortKey =
  | 'volume'
  | 'change'
  | 'perf7'
  | 'perf30'
  | 'perf90'
  | 'perfListed'
  | 'rsi'
  | 'vsSma20'
  | 'vsSma50'
  | 'vsHigh20'
  | 'volatility'
  | 'atr'
  | 'relVolume'
  | 'fromOpen'
  | 'symbol'

export interface Preset {
  key: string
  label: string
  /** One line: what it selects, in the terms of the filters. */
  note: string
  filters: Partial<ScreenFilters>
  sort: SortKey
  desc: boolean
}

/** Liquid enough that a percentage means something: the Mercados movers rule. */
const LIQUID = 1_000_000

export const PRESETS: Preset[] = [
  { key: 'todos', label: 'Todos', note: 'Todo el tablero X-Perp, por volumen.', filters: {}, sort: 'volume', desc: true },
  { key: 'suben', label: 'Mayores subidas', note: 'Más de 1 M$ de volumen, ordenados por su variación en 24 h.', filters: { minVolume: LIQUID }, sort: 'change', desc: true },
  { key: 'bajan', label: 'Mayores caídas', note: 'Más de 1 M$ de volumen, de la peor variación en 24 h a la mejor.', filters: { minVolume: LIQUID }, sort: 'change', desc: false },
  { key: 'max20', label: 'Nuevo máximo 20 d', note: 'Por encima del máximo de las 20 sesiones anteriores.', filters: { extremes: 'high20' }, sort: 'perf7', desc: true },
  { key: 'min20', label: 'Nuevo mínimo 20 d', note: 'Por debajo del mínimo de las 20 sesiones anteriores.', filters: { extremes: 'low20' }, sort: 'perf7', desc: false },
  { key: 'volumen', label: 'Volumen inusual', note: 'Al menos el doble de su volumen diario medio de 20 días.', filters: { relVolume: 2 }, sort: 'relVolume', desc: true },
  { key: 'sobrecompra', label: 'Sobrecompra', note: 'RSI(14) diario por encima de 70.', filters: { rsi: 'overbought' }, sort: 'rsi', desc: true },
  { key: 'sobreventa', label: 'Sobreventa', note: 'RSI(14) diario por debajo de 30.', filters: { rsi: 'oversold' }, sort: 'rsi', desc: false },
  { key: 'volatiles', label: 'Más volátiles', note: 'Más de 1 M$ de volumen, por su rango diario medio de 30 días.', filters: { minVolume: LIQUID }, sort: 'volatility', desc: true },
  { key: 'tendencia', label: 'Tendencia alcista', note: 'Precio por encima de su media de 20 días, y esta por encima de la de 50.', filters: { trend: 'alcista' }, sort: 'perf30', desc: true },
  { key: 'choch', label: 'CHoCH reciente', note: 'Un cambio de carácter (SMC) en las últimas 5 sesiones.', filters: { structure: 'choch5' }, sort: 'volume', desc: true },
  { key: 'reversion', label: 'Reversión', note: 'La estrategia Reversión tiene una señal abierta o está vigilando una en diario.', filters: { reversal: 'any' }, sort: 'volume', desc: true },
]

export function sortValue(row: ScreenRow, key: SortKey): number | string {
  const t = row.tech
  switch (key) {
    case 'volume':
      return row.volumeUsd
    case 'change':
      return row.change24h
    case 'symbol':
      return row.symbol
    case 'perf7':
      return t?.perf7 ?? NaN
    case 'perf30':
      return t?.perf30 ?? NaN
    case 'perf90':
      return t?.perf90 ?? NaN
    case 'perfListed':
      return t?.perfListed ?? NaN
    case 'rsi':
      return t?.rsi14 ?? NaN
    case 'vsSma20':
      return t?.vsSma20 ?? NaN
    case 'vsSma50':
      return t?.vsSma50 ?? NaN
    case 'vsHigh20':
      return t?.vsHigh20 ?? NaN
    case 'volatility':
      return t?.volatilityMonth ?? NaN
    case 'atr':
      return t?.atrPct ?? NaN
    case 'relVolume':
      return t?.relVolume ?? NaN
    case 'fromOpen':
      return t?.fromOpen ?? NaN
  }
}

/** Rows without a value sort last in either direction. */
export function compareRows(a: ScreenRow, b: ScreenRow, key: SortKey, desc: boolean): number {
  const x = sortValue(a, key)
  const y = sortValue(b, key)
  if (typeof x === 'string' || typeof y === 'string') {
    return (desc ? -1 : 1) * String(x).localeCompare(String(y))
  }
  const fx = Number.isFinite(x)
  const fy = Number.isFinite(y)
  if (!fx || !fy) return fx === fy ? 0 : fx ? -1 : 1
  return desc ? y - x : x - y
}
