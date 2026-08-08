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
