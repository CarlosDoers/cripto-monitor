import type { BookCost } from './depthCost'
import { ratio, share } from './format'
import { analyseDonchian, DONCHIAN_TREND_SETTINGS, type LateBucket } from './indicators/donchianBreakout'
import { atr, ema, highest } from './indicators/ta'
import type { Candle } from './indicators/types'
import type { TradBoardRow, TradKind } from './ledgerModel'
import type { Instrument } from './types'
import { US_CLOSE_MS } from './yahoo'

/**
 * The daily trend rule on what OKX lists besides crypto: equities, ETFs and four
 * commodities. The perpetuals are months old, so the rule reads the history of
 * what they track (Yahoo, `yahoo.ts`) and says where each contract stands against it,
 * for the Screener's card and the tracking ledger's alerts.
 *
 * It is the Canal 20 + EMA 200 preset itself — the one the crypto cards run, the
 * one `npm run novel trend` measured — on daily bars and **long only**: the
 * shorts measured −0.27 R on the index ETFs, and a random short loses almost as much. What the
 * measurement says, and does not, is in `TRAD_TREND_EVIDENCE` and in each kind's
 * note below, because the evidence is not the same for every contract:
 *
 *  - index ETFs (SPY, QQQ, EWY, EWZ…): measured, on 20 index and sector ETFs.
 *  - commodities (gold, silver, WTI, Brent): four series do not carry a trend
 *    follower's tail; the rule is the ETFs'.
 *  - stocks: today's popular names are a survivor selection — their own number
 *    (+1.4 R) is not evidence, and the same-side random control is why.
 *  - leveraged ETFs: measured and without an edge. Shown, never followed or announced.
 *
 * The first version of this research used dividend-adjusted prices and reported
 * +0.61 R on 41 ETFs; the coupons of the bond ETFs were most of it. On the raw
 * prices a perpetual trades at, the same rule is what the numbers below say.
 */

export type { TradKind }

export interface TradSymbol {
  /** What OKX calls it in the contract id: `AAPL` in `AAPL-USD_UM_XPERP-310613`. */
  okx: string
  /** The symbol on Yahoo of what the contract tracks. */
  yahoo: string
  kind: TradKind
  /** For the ones whose ticker says nothing: "Oro", "Brent". */
  name?: string
}

const sym = (okx: string, kind: TradKind, yahoo = okx, name?: string): TradSymbol => ({ okx, yahoo, kind, name })

/**
 * Each OKX contract and the symbol that follows it. Checked against the live
 * board by `npm run novel map`: a ticker can mean another thing, so a pair is
 * accepted only when the contract's daily returns move with the symbol's (≥ 0.8
 * over 40 days) or, for a contract too new for that, when they print the same
 * price. 71 of the 80 contracts listed on 2026-10-16 pass; the nine that do not
 * are foreign or private names Yahoo does not have (Samsung, SK hynix's Korean
 * line, SoftBank, Xiaomi, Zhipu, MiniMax, CXMT, Unitree). US100 is left out
 * because QQQ is the same index and would alert twice.
 */
export const TRAD_UNIVERSE: TradSymbol[] = [
  sym('SPY', 'index', 'SPY', 'S&P 500'),
  sym('QQQ', 'index', 'QQQ', 'Nasdaq 100'),
  sym('EWY', 'index', 'EWY', 'Corea del Sur'),
  sym('EWZ', 'index', 'EWZ', 'Brasil'),
  sym('DRAM', 'index', 'DRAM', 'Memoria'),
  sym('XAU', 'commodity', 'GLD', 'oro'),
  sym('XAG', 'commodity', 'SLV', 'plata'),
  sym('CL', 'commodity', 'USO', 'petróleo WTI'),
  sym('BZ', 'commodity', 'BNO', 'petróleo Brent'),
  sym('SOXL', 'leveraged'),
  sym('SOXS', 'leveraged'),
  sym('TQQQ', 'leveraged'),
  sym('KORU', 'leveraged'),
  sym('MUU', 'leveraged'),
  sym('SNXX', 'leveraged'),
  sym('SKDD', 'leveraged'),
  ...[
    'AAOI', 'AAPL', 'ADBE', 'AMAT', 'AMD', 'AMZN', 'APP', 'ARM', 'ASTS', 'AVGO', 'AXTI', 'BE', 'BMNR', 'BSP', 'CBRS',
    'COHR', 'COIN', 'CRCL', 'CRDO', 'CRWV', 'DELL', 'FLNC', 'GLW', 'GOOGL', 'HOOD', 'INTC', 'IONQ', 'IREN', 'KO', 'LITE',
    'META', 'MRNA', 'MRVL', 'MSFT', 'MSTR', 'MU', 'NBIS', 'NFLX', 'NVDA', 'OKTA', 'ORCL', 'PENG', 'PLTR', 'PURR', 'QCOM',
    'RKLB', 'SKHY', 'SMCI', 'SNDK', 'SPCX', 'TSLA', 'TSM', 'USAR', 'WDC',
  ].map((t) => sym(t, 'stock')),
]

/** The ledger's key for the track, in the registry's `strategy/preset@bar` shape. */
export const TRAD_TRACK_KEY = 'trad/trend@1D'
export const isTradTrack = (track: string | undefined) => typeof track === 'string' && track.startsWith('trad/')

/**
 * Everything the card and the notification quote, measured on RAW prices, long
 * only, by `npm run novel trad-evidence` (which exits non-zero when one drifts).
 * Net R per trade after a 0.1 % round trip, daily bars, 1993–2026.
 */
export const TRAD_TREND_EVIDENCE = {
  /** The reference: 20 index and sector ETFs. `random` is a random LONG with the same stop and holding time. */
  index: {
    n: 1169,
    net: 0.45,
    /** Standard deviation of one trade's net R: the noise a mean of n of them carries. */
    sd: 2.95,
    halves: [0.49, 0.41] as [number, number],
    random: 0.17,
    withoutBest10: 0.29,
    interval: [0.21, 0.77] as [number, number],
    /** 2022–2026 alone: no better than a random long, and negative without its ten best. */
    recent: { net: 0.2, random: 0.05, withoutBest10: -0.22 },
  },
  /**
   * The four of those twenty ETFs that OKX lists — SPY, QQQ, EWY and EWZ — pooled: the part of the evidence a person can
   * actually trade. `npm run novel trend-okx` prints the whole review. SPY and QQQ are one market counted twice, EWY and
   * EWZ are negative without their ten best trades, and since 2022 there are 49 trades with halves of −0.50 and +1.80.
   */
  okxIndex: {
    n: 234,
    net: 0.76,
    random: 0.29,
    halves: [0.75, 0.77] as [number, number],
    withoutBest10: 0.23,
    interval: [0.37, 1.28] as [number, number],
    ewyEwzWithoutBest10: -0.35,
    recent: { n: 49, net: 0.67, random: 0.18, withoutBest10: -0.8 },
  },
  /**
   * Entering late on the daily, longs, the 20 index and sector ETFs since 1993 (`npm run late trad`): unlike crypto it holds
   * up to two weeks with intervals clear of zero — and an ETF's long also earns the drift, which a random long does too.
   */
  late: {
    sample: '20 ETF de índices y sectores, diario, desde 1993, solo longs',
    buckets: [
      { from: 1, to: 1, n: 1160, net: 0.43, halves: [0.52, 0.34], withoutBest10: 0.26, riskPct: 0.032, interval: [0.17, 0.7] },
      { from: 2, to: 3, n: 1129, net: 0.44, halves: [0.57, 0.31], withoutBest10: 0.24, riskPct: 0.032, interval: [0.13, 0.82] },
      { from: 4, to: 7, n: 1043, net: 0.44, halves: [0.56, 0.33], withoutBest10: 0.21, riskPct: 0.036, interval: [0.18, 0.8] },
      { from: 8, to: 15, n: 903, net: 0.32, halves: [0.44, 0.2], withoutBest10: 0.13, riskPct: 0.043, interval: [0.04, 0.65] },
      { from: 16, to: 30, n: 772, net: 0.19, halves: [0.22, 0.15], withoutBest10: 0.05, riskPct: 0.054, interval: [-0.03, 0.38] },
    ] as LateBucket[],
  },
  /** Both sides on the same ETFs: the shorts are why the ledger follows longs only. */
  indexBothSides: 0.11,
  indexShorts: -0.27,
  leveraged: { n: 1086, net: 0.1, withoutBest10: -0.14 },
  commodity: { n: 191, net: 0.61, withoutBest10: -0.32 },
  stocks: { n: 1843, net: 1.41, random: 0.25 },
  /**
   * The long book as an account (0.25 % of capital per R, marked every close, every market day of 2008–2026) against SPY held
   * with its dividends. SPY's series used to inherit the days the book had a position open, and so left out the crashes it
   * sat out of; it is now the whole calendar.
   */
  portfolio: {
    cagr: 0.036,
    sharpe: 0.32,
    maxDd: -0.295,
    spyCagr: 0.113,
    spySharpe: 0.64,
    spyMaxDd: -0.523,
    corrSpy: 0.59,
    exposure: 1.0,
    sharpeSince2022: 0.12,
    spySharpeSince2022: 0.75,
  },
}

/** What a kind's evidence amounts to, in the order the card sorts and labels them. */
export const TRAD_KIND: Record<TradKind, { label: string; evidence: 'medida' | 'escasa' | 'ninguna' | 'negativa' }> = {
  index: { label: 'ETF de índice', evidence: 'medida' },
  commodity: { label: 'Materia prima', evidence: 'escasa' },
  stock: { label: 'Acción', evidence: 'ninguna' },
  leveraged: { label: 'ETF apalancado', evidence: 'negativa' },
}

/** Whether the ledger follows a kind (and may announce it): the measured-and-failed one is only shown. */
export const tradFollowed = (kind: TradKind) => kind !== 'leveraged'

/** The kinds a notification goes out for unless `WATCH_TRAD_KINDS` says otherwise. */
export const TRAD_ALERT_KINDS: TradKind[] = ['index', 'commodity', 'stock']

/**
 * Whether OKX's book can take a position of the size a trade here is. The research charged fees (0.1 % a round trip) and not
 * the spread, and OKX's equity and ETF perpetuals are thin: on 2026-10-16 the median of the 79 moved 55 k$ a day behind a 24 bp
 * spread, SPY 158 k$ and QQQ 421 k$, EWY 32 k$, EWZ next to nothing, while gold, silver and oil moved millions at 1 bp. So the
 * card says which contracts are thin, and an alert carries what entering would cost — and is not sent when that is too much.
 */
export const TRAD_LIQUIDITY = {
  /** The size the cost is quoted for: a trade of this account at 0.25–1 % risk behind a stop of about 2 %. */
  refUsd: 5_000,
  /** The card calls a contract thin under this 24 h volume (a position of `refUsd` would be 5 % of the day) or over this spread. */
  minVolumeUsd: 100_000,
  maxSpreadBp: 25,
  /** No alert when entering and leaving `refUsd` at market costs more than this many R in spread, on top of the fees. */
  maxCostR: 0.15,
}

/** Why the card calls a contract thin, from its ticker: nothing when it is not. An empty book has no spread to read. */
export function thinReasons(volumeUsd: number, spreadBp: number): string[] {
  const out: string[] = []
  if (!Number.isFinite(spreadBp)) out.push('sin libro')
  else if (spreadBp > TRAD_LIQUIDITY.maxSpreadBp) out.push('horquilla ancha')
  if (!(volumeUsd >= TRAD_LIQUIDITY.minVolumeUsd)) out.push('poco volumen')
  return out
}

export interface LiquidityVerdict {
  /** The alert is not sent: a position of `refUsd` cannot go in and out at a sane price. */
  block: boolean
  /** The line the message carries. */
  line: string
  /** Entering and leaving at market in R of the trade's own stop, spread only; null when the book cannot say. */
  costR: number | null
}

/**
 * What the book says about entering a long and leaving it, as a line for the alert and a verdict on sending it. `cost` is
 * the walk of the book for `refUsd` (`bookCost`), `riskFraction` the distance from entry to stop as a share of the entry.
 * `maxCostR` of 0 switches the gate off: the line still goes out.
 */
export function liquidityVerdict(cost: BookCost | null, riskFraction: number, maxCostR = TRAD_LIQUIDITY.maxCostR): LiquidityVerdict {
  const size = new Intl.NumberFormat('es-ES').format(TRAD_LIQUIDITY.refUsd)
  const gate = maxCostR > 0
  if (!cost) return { block: gate, line: '   ⚠ liquidez: el libro de OKX no tiene ahora compra y venta', costR: null }
  if (cost.buyBp === null || cost.sellBp === null) {
    return { block: gate, line: `   ⚠ liquidez: el libro de OKX no admite ${size} $ a mercado en los 50 niveles que mira la app`, costR: null }
  }
  const roundTripBp = cost.buyBp + cost.sellBp
  const costR = riskFraction > 0 ? roundTripBp / 10_000 / riskFraction : null
  const pb = (x: number) => `${ratio(x, 1)} pb (${share(x / 10_000, 2)})`
  const line =
    `   liquidez ahora: entrar con ${size} $ cuesta ~${pb(cost.buyBp)} sobre el precio medio y salir ~${pb(cost.sellBp)}` +
    (costR !== null ? `: unos ${ratio(costR)} R de horquilla en la ida y vuelta, sin contar comisiones` : '') +
    `. Horquilla ${ratio(cost.spreadBp, 1)} pb`
  return { block: gate && costR !== null && costR > maxCostR, line, costR }
}

const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2).replace('.', ',')}`

/** One sentence on what is known about a kind, for the card, the tooltip and the notification. */
export function tradKindNote(kind: TradKind): string {
  const e = TRAD_TREND_EVIDENCE
  switch (kind) {
    case 'index':
      return `Medido en ${new Intl.NumberFormat('es-ES').format(e.index.n)} operaciones de 20 ETF de índices y sectores: ${signed(e.index.net)} R por operación en largos, frente a ${signed(e.index.random)} R de una entrada larga al azar; OKX lista cuatro de ellos (SPY, QQQ, EWY, EWZ) y en esos ${signed(e.okxIndex.net)} R en ${e.okxIndex.n} operaciones, frente a ${signed(e.okxIndex.random)} R al azar. SPY y QQQ son un mismo mercado, y en 2022–2026 son solo ${e.okxIndex.recent.n} operaciones.`
    case 'commodity':
      return `Cuatro series (oro, plata y los dos petróleos) no bastan para medirlo: ${signed(e.commodity.net)} R en largos, pero ${signed(e.commodity.withoutBest10)} R sin sus diez mejores operaciones. La regla es la de los ETF de índices.`
    case 'stock':
      return `Sin evidencia propia: las acciones que lista OKX son las de hoy, una selección de supervivientes (${signed(e.stocks.net)} R en largos, de los que una entrada larga al azar ya da ${signed(e.stocks.random)}). La regla es la de los ETF de índices.`
    case 'leveraged':
      return `Medido y sin ventaja: ${signed(e.leveraged.net)} R en ETF apalancados, ${signed(e.leveraged.withoutBest10)} R sin sus diez mejores operaciones. Se muestra, no se sigue ni se avisa.`
  }
}

/** The table's entry for an OKX ticker (`XAU`, `AAPL`), to put a name to it. */
export const tradSymbolByOkx = (okx: string): TradSymbol | undefined => TRAD_UNIVERSE.find((s) => s.okx === okx)

/** "XAU (oro)" for the ones whose ticker says nothing, the ticker alone for the rest. */
export const tradDisplay = (s: Pick<TradSymbol, 'okx' | 'name' | 'kind'>) =>
  s.name && s.kind !== 'index' ? `${s.okx} (${s.name})` : s.okx

// ── the live universe ────────────────────────────────────────────────────────

export interface TradContract {
  sym: TradSymbol
  /** The OKX contract, e.g. `AAPL-USD_UM_XPERP-310613`. */
  instId: string
}

/**
 * The symbols of the table whose perpetual is live on OKX right now. A contract
 * that is not listed (or was delisted) is not scanned: the point is what the
 * account can trade.
 */
export function liveTradContracts(instruments: Pick<Instrument, 'instId' | 'state' | 'instCategory'>[]): TradContract[] {
  const live = new Map<string, string>()
  for (const i of instruments) {
    if (!i.instId.includes('_UM_XPERP') || i.state !== 'live') continue
    if (i.instCategory !== '3' && i.instCategory !== '4') continue
    live.set(i.instId.split('-')[0], i.instId)
  }
  return TRAD_UNIVERSE.filter((s) => live.has(s.okx)).map((s) => ({ sym: s, instId: live.get(s.okx)! }))
}

// ── where a contract stands today ────────────────────────────────────────────

export type TradStatus = 'nueva' | 'cerca' | 'tendencia' | 'fuera' | 'corto'

const NEAR_ATR = 0.5
/** A position opened on this many closed bars ago or fewer is "nueva": the measured entry is still close. */
const FRESH = 1

/** Row of the board the job stores and the card reads. Plain numbers, so it survives JSON. */
export type TradWatch = TradBoardRow

/**
 * Where the underlying stands against the rule at its last close. Long only: a
 * short the rule would hold is "fuera", because nothing follows it. `closedAt`
 * is the close time of the newest bar (its date plus `US_CLOSE_MS`).
 */
export function watchTradTrend(candles: Candle[], s: TradSymbol, instId: string): TradWatch {
  const result = analyseDonchian(candles, DONCHIAN_TREND_SETTINGS)
  const last = candles.length - 1
  const base = { yahoo: s.yahoo, okx: s.okx, instId, name: s.name, kind: s.kind, bars: candles.length }
  if (candles.length <= result.warmup) {
    return { ...base, status: 'corto', asOf: last >= 0 ? candles[last].time + US_CLOSE_MS : 0, price: last >= 0 ? candles[last].close : NaN, need: result.warmup }
  }
  const close = candles.map((c) => c.close)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const line = ema(close, DONCHIAN_TREND_SETTINGS.trendLen)[last]
  const unit = atr(high, low, close, DONCHIAN_TREND_SETTINGS.atrLen)[last]
  const top = highest(high, DONCHIAN_TREND_SETTINGS.channelLen)[last]
  const price = close[last]
  const above = price > line
  const open = result.active
  const long = open?.side === 'long' ? open : null
  const age = long ? last - long.index : 0

  let status: TradStatus
  if (long && age <= FRESH) status = 'nueva'
  else if (long) status = 'tendencia'
  else if (above && (top - price) / unit <= NEAR_ATR) status = 'cerca'
  else status = 'fuera'

  return {
    ...base,
    status,
    asOf: candles[last].time + US_CLOSE_MS,
    price,
    ema: line,
    above,
    // A long that is already open has no edge left to break; otherwise the 20-bar high is the next trigger.
    level: long ? undefined : top,
    distance: long ? undefined : price / top - 1,
    distanceAtr: long ? undefined : Math.abs(top - price) / unit,
    entry: long?.entry,
    entryAt: long ? candles[long.index].time + US_CLOSE_MS : undefined,
    age: long ? age : undefined,
    stop: long ? (long.stopNow ?? long.stop) : undefined,
    // A short the rule would hold is only noted: nothing follows the short side.
    shortOpen: open?.side === 'short' ? true : undefined,
  }
}

const RANK: Record<TradStatus, number> = { nueva: 0, cerca: 1, tendencia: 2, fuera: 3, corto: 4 }
const KIND_RANK: Record<TradKind, number> = { index: 0, commodity: 1, stock: 2, leveraged: 3 }

/** Most urgent first; within a status the better-evidenced kind, then the nearest trigger. */
export function compareTradWatch(a: TradWatch, b: TradWatch): number {
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status]
  if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] - KIND_RANK[b.kind]
  if (a.status === 'tendencia' || a.status === 'nueva') return (a.age ?? 0) - (b.age ?? 0)
  return (a.distanceAtr ?? Infinity) - (b.distanceAtr ?? Infinity)
}
