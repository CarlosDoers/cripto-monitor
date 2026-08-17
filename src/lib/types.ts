/**
 * Minimal shapes for the OKX v5 responses we consume. OKX returns every numeric
 * field as a string (and empty strings for "not applicable"), so these stay
 * strings and the parsing happens in `format.ts`.
 */

export interface OkxEnvelope<T> {
  code: string
  msg: string
  data: T[]
}

export interface BalanceDetail {
  ccy: string
  eq: string
  eqUsd: string
  cashBal: string
  availBal: string
  availEq: string
  frozenBal: string
  ordFrozen: string
  upl: string
  isoEq: string
  disEq: string
  accAvgPx?: string
  openAvgPx?: string
  spotUpl?: string
  spotUplRatio?: string
}

export interface AccountBalance {
  totalEq: string
  isoEq: string
  adjEq: string
  ordFroz: string
  imr: string
  mmr: string
  mgnRatio: string
  notionalUsd: string
  uTime: string
  details: BalanceDetail[]
}

export interface Position {
  instId: string
  instType: string
  posId: string
  posSide: string
  pos: string
  posCcy: string
  ccy: string
  avgPx: string
  markPx: string
  last: string
  lever: string
  liqPx: string
  margin: string
  mgnMode: string
  mgnRatio: string
  imr: string
  mmr: string
  upl: string
  uplRatio: string
  realizedPnl: string
  pnl: string
  fee: string
  fundingFee: string
  notionalUsd: string
  cTime: string
  uTime: string
}

/**
 * A closed derivatives position — OKX's own record of a completed trade, with
 * the realised PnL already net of fees and funding. This is the only place the
 * exchange reports per-trade profit: spot fills carry `fillPnl: 0`.
 */
export interface ClosedPosition {
  posId: string
  instId: string
  instType: string
  /** Close reason: 1 partial, 2 full, 3 liquidation, 4 partial liquidation, 5 ADL. */
  type: string
  direction: string
  lever: string
  mgnMode: string
  ccy: string
  openAvgPx: string
  closeAvgPx: string
  openMaxPos: string
  closeTotalPos: string
  /** Gross PnL, before costs. */
  pnl: string
  /** Net of fees and funding — the number that actually hit the balance. */
  realizedPnl: string
  pnlRatio: string
  fee: string
  fundingFee: string
  liqPenalty: string
  /** Opened at. */
  cTime: string
  /** Closed at. */
  uTime: string
}

export interface FundingBalance {
  ccy: string
  bal: string
  frozenBal: string
  availBal: string
}

export interface AssetValuation {
  totalBal: string
  ts: string
  details: {
    funding: string
    trading: string
    classic?: string
    earn: string
  }
}

export interface Ticker {
  instId: string
  instType: string
  last: string
  open24h: string
  high24h: string
  low24h: string
  vol24h: string
  volCcy24h: string
  /** Best bid/ask — the spread is the real cost of entering a trade. */
  bidPx: string
  askPx: string
  bidSz: string
  askSz: string
  ts: string
}

export interface Order {
  instId: string
  instType: string
  ordId: string
  clOrdId: string
  px: string
  sz: string
  ordType: string
  side: string
  posSide: string
  tdMode: string
  fillSz: string
  accFillSz: string
  avgPx: string
  state: string
  lever: string
  fee: string
  feeCcy: string
  pnl: string
  cTime: string
  uTime: string
}

export interface Fill {
  instId: string
  instType: string
  tradeId: string
  ordId: string
  fillPx: string
  fillSz: string
  side: string
  posSide: string
  execType: string
  fee: string
  feeCcy: string
  fillPnl: string
  ts: string
}

export interface AccountConfig {
  uid: string
  acctLv: string
  posMode: string
  level: string
  levelTmp: string
  greeksType: string
  autoLoan: string
}

export interface Bill {
  billId: string
  ccy: string
  instId: string
  instType: string
  type: string
  subType: string
  bal: string
  balChg: string
  sz: string
  px: string
  pnl: string
  fee: string
  ts: string
}

/** `[ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]` */
export type Candle = string[]

export interface OpenInterest {
  instId: string
  instType: string
  /** Contracts. */
  oi: string
  /** In the base currency. */
  oiCcy: string
  /** Already converted to USD by OKX. */
  oiUsd: string
  ts: string
}

export interface Instrument {
  instId: string
  instType: string
  /** Underlying, e.g. `ZEC-USD`. */
  uly: string
  baseCcy: string
  quoteCcy: string
  settleCcy: string
  ctVal: string
  ctValCcy: string
  state: string
  expTime: string
  /** Max leverage the contract allows. */
  lever: string
  /** Family, e.g. `BTC-USD_UM_XPERP`. */
  instFamily: string
}

/** A single position in the portfolio, merged from trading + funding accounts. */
export interface Holding {
  ccy: string
  /** Amount held in the trading account. */
  trading: number
  /** Amount held in the funding account. */
  funding: number
  total: number
  /** USD value, from OKX when available and price-derived otherwise. */
  usd: number
  /** Share of the total portfolio, 0–1. */
  weight: number
  /** Last price in USDT, when the pair exists. */
  price?: number
  /** 24h price change, 0–1 scale. */
  change24h?: number
  /** Unrealised PnL on the spot holding, when OKX reports it. */
  upl?: number
}

/**
 * The account's real fee tier. OKX reports these as negative strings — `-0.0005`
 * means 0.05 % is charged — because the same field carries a positive number for
 * accounts that earn a maker rebate.
 */
export interface TradeFee {
  instType: string
  /** Rate for orders that add liquidity (limit orders that rest). */
  maker: string
  /** Rate for orders that remove liquidity (market orders). */
  taker: string
  /** USDT-margined contracts use these instead when present. */
  makerU?: string
  takerU?: string
  level: string
}

/**
 * A stop-loss or take-profit order. These do NOT appear in `orders-pending`:
 * OKX keeps conditional orders in a separate book, which is why a position can
 * look unprotected in an app that only reads the regular one.
 */
export interface AlgoOrder {
  instId: string
  instType: string
  algoId: string
  ordType: string
  side: string
  posSide: string
  sz: string
  state: string
  /** Trigger price for the stop-loss leg, when set. */
  slTriggerPx: string
  slOrdPx: string
  /** Trigger price for the take-profit leg, when set. */
  tpTriggerPx: string
  tpOrdPx: string
  cTime: string
}

/** The periodic payment between longs and shorts on a perpetual. */
export interface FundingRate {
  instId: string
  /** Rate applied at `fundingTime`, as a ratio (0.0001 = 0.01 %). */
  fundingRate: string
  fundingTime: string
  /** OKX's estimate for the following period; often empty. */
  nextFundingRate: string
  nextFundingTime: string
}

/** A deposit into or withdrawal out of the account. */
export interface Transfer {
  ccy: string
  amt: string
  ts: string
  state: string
  chain?: string
  fee?: string
}
