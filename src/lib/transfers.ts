import { useMemo } from 'react'
import { num } from './format'
import { useSpotPrices } from './portfolio'
import { useDailyCandles, useTransfers } from './queries'
import type { Candle, FiatOrder, Ticker, Transfer } from './types'

/**
 * Every deposit and withdrawal, coins and bank transfers in one shape, each
 * valued on the day it happened.
 *
 * **The day matters more than it looks.** Valuing deposits at today's price
 * answers "what would those coins be worth now", which quietly books the price
 * rise of everything deposited as money put in rather than money made. On this
 * account that was 900 US$ of the contribution: 11,06 SOL arrived worth 891 US$
 * and are quoted at 1 118 today. The difference is a gain, and the only place
 * it belongs is the result.
 *
 * Checked against what the money actually bought: a 500 EUR deposit valued this
 * way came to 576,10 US$, and the USDC bought with it that day was 575,71.
 */

export type MovementStatus = 'done' | 'pending' | 'failed'

export interface Movement {
  id: string
  kind: 'in' | 'out'
  ccy: string
  amount: number
  ts: number
  /** Chain for coins, payment rail for bank transfers. */
  via: string
  status: MovementStatus
  /** In dollars, on the day it happened. Undefined when nothing prices it. */
  value: number | undefined
  /**
   * The same value in euros at that day's rate, so a euro deposit reads as the
   * euros that were sent. Converting `value` at today's rate instead would not.
   */
  valueEur: number | undefined
}

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'USD'])
const DAY_MS = 86_400_000
/** Euros per dollar, the pair `currency.ts` reads today's rate from. */
const EUR_PAIR = 'USDC-EUR'

/** How much a movement's state still leaves in doubt. Codes from the v5 docs. */
function coinStatus(kind: 'in' | 'out', state: string): MovementStatus {
  if (kind === 'in') return state === '1' || state === '2' ? 'done' : 'pending'
  if (state === '2') return 'done'
  return Number(state) < 0 ? 'failed' : 'pending'
}

function fiatStatus(state: string): MovementStatus {
  if (state === 'completed') return 'done'
  if (state === 'failed' || state === 'canceled') return 'failed'
  return 'pending'
}

const RAIL: Record<string, string> = {
  SEPA: 'SEPA',
  EA_OPENBANKING: 'Open Banking',
  TR_BANK_TRANSFER: 'Transferencia',
  PIX: 'PIX',
}

/**
 * The spot pair that prices a currency in dollars, and whether it has to be
 * inverted. Coins trade against a stable (`SOL-USDT`); fiat is the quote side
 * (`USDC-EUR`), so its dollar price is one over the pair's.
 */
export function pricingPair(
  ccy: string,
  tickers: Map<string, Ticker>,
): { instId: string; invert: boolean } | undefined {
  for (const stable of ['USDT', 'USDC']) {
    if (tickers.has(`${ccy}-${stable}`)) return { instId: `${ccy}-${stable}`, invert: false }
  }
  for (const stable of ['USDC', 'USDT']) {
    if (tickers.has(`${stable}-${ccy}`)) return { instId: `${stable}-${ccy}`, invert: true }
  }
  return undefined
}

/**
 * The candle's open or close, whichever is nearer in time. A daily close for a
 * deposit that landed at 09:00 carries fifteen hours of moves it never saw.
 */
function priceOnDay(candles: Candle[] | undefined, ts: number): number | undefined {
  const bar = candles?.find((c) => num(c[0]) <= ts && ts < num(c[0]) + DAY_MS)
  if (!bar) return undefined
  const px = ts - num(bar[0]) < DAY_MS / 2 ? num(bar[1]) : num(bar[4])
  return px > 0 ? px : undefined
}

function normalise(
  coins: Transfer[],
  fiat: FiatOrder[],
  kind: 'in' | 'out',
): Omit<Movement, 'value' | 'valueEur'>[] {
  return [
    ...coins.map((t, i) => ({
      id: `${kind}-coin-${t.ts}-${t.ccy}-${i}`,
      kind,
      ccy: t.ccy,
      amount: num(t.amt),
      ts: num(t.ts),
      via: t.chain || '—',
      status: coinStatus(kind, t.state),
    })),
    ...fiat.map((o) => ({
      id: `${kind}-fiat-${o.ordId}`,
      kind,
      ccy: o.ccy,
      amount: num(o.amt),
      ts: num(o.cTime),
      via: RAIL[o.paymentMethod] ?? o.paymentMethod ?? '—',
      status: fiatStatus(o.state),
    })),
  ]
}

export function useMovements() {
  const transfers = useTransfers()
  const tickers = useSpotPrices()

  const raw = useMemo(() => {
    const d = transfers.data
    if (!d) return []
    return [
      ...normalise(d.deposits, d.fiatDeposits, 'in'),
      ...normalise(d.withdrawals, d.fiatWithdrawals, 'out'),
    ].sort((a, b) => b.ts - a.ts)
  }, [transfers.data])

  // One date range per pricing pair, so a currency deposited ten times still
  // costs one request.
  const ranges = useMemo(() => {
    const byPair = new Map<string, { instId: string; from: number; to: number }>()
    for (const m of raw) {
      if (STABLES.has(m.ccy) || m.status === 'failed') continue
      const pair = pricingPair(m.ccy, tickers)
      if (!pair) continue
      const r = byPair.get(pair.instId)
      if (r) {
        r.from = Math.min(r.from, m.ts)
        r.to = Math.max(r.to, m.ts)
      } else byPair.set(pair.instId, { instId: pair.instId, from: m.ts, to: m.ts })
    }
    // The euro rate on every day money moved, for showing it in euros.
    const dated = raw.filter((m) => m.status !== 'failed')
    if (tickers.has(EUR_PAIR) && dated.length && !byPair.has(EUR_PAIR)) {
      const times = dated.map((m) => m.ts)
      byPair.set(EUR_PAIR, { instId: EUR_PAIR, from: Math.min(...times), to: Math.max(...times) })
    } else if (byPair.has(EUR_PAIR)) {
      const r = byPair.get(EUR_PAIR)!
      for (const m of dated) {
        r.from = Math.min(r.from, m.ts)
        r.to = Math.max(r.to, m.ts)
      }
    }
    return [...byPair.values()].sort((a, b) => a.instId.localeCompare(b.instId))
  }, [raw, tickers])

  const candles = useDailyCandles(ranges)

  const movements = useMemo<Movement[]>(() => {
    const now = Date.now()
    const onDay = (instId: string, ts: number) => {
      const px = priceOnDay(candles.data?.get(instId), ts)
      // Today's candle may not be in the history yet; the live price is the
      // same day's price.
      if (px === undefined && now - ts < DAY_MS) return num(tickers.get(instId)?.last) || undefined
      return px
    }
    const todayEur = num(tickers.get(EUR_PAIR)?.last) || undefined
    return raw.map((m) => {
      const eurRate = onDay(EUR_PAIR, m.ts) ?? todayEur
      const priced = (value: number | undefined) => ({
        ...m,
        value,
        valueEur: value === undefined || eurRate === undefined ? undefined : value * eurRate,
      })
      if (STABLES.has(m.ccy)) return priced(m.amount)
      const pair = pricingPair(m.ccy, tickers)
      const px = pair && onDay(pair.instId, m.ts)
      if (!pair || px === undefined) return priced(undefined)
      return priced(m.amount * (pair.invert ? 1 / px : px))
    })
  }, [raw, tickers, candles.data])

  const totals = useMemo(() => {
    let deposited = 0
    let withdrawn = 0
    let depositedEur = 0
    let withdrawnEur = 0
    let unpriced = 0
    let deposits = 0
    let withdrawals = 0
    for (const m of movements) {
      // A deposit counts once credited. A withdrawal counts unless it failed:
      // one still in flight has already left the balance.
      const counts = m.kind === 'in' ? m.status === 'done' : m.status !== 'failed'
      if (!counts) continue
      if (m.kind === 'in') deposits++
      else withdrawals++
      if (m.value === undefined) {
        unpriced++
        continue
      }
      if (m.kind === 'in') {
        deposited += m.value
        depositedEur += m.valueEur ?? 0
      } else {
        withdrawn += m.value
        withdrawnEur += m.valueEur ?? 0
      }
    }
    return { deposited, withdrawn, depositedEur, withdrawnEur, unpriced, deposits, withdrawals }
  }, [movements])

  return {
    movements,
    ...totals,
    incomplete: transfers.data?.incomplete ?? null,
    // Until the tickers arrive no pair can be chosen, so every coin would read
    // as unpriced for a moment instead of loading.
    isLoading: transfers.isLoading || tickers.size === 0 || (ranges.length > 0 && candles.isLoading),
    isFetching: transfers.isFetching,
    error: transfers.error ?? candles.error,
  }
}
