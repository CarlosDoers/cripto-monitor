import { useMemo } from 'react'
import { useInstruments, useOpenInterest, useTickers } from './queries'
import { num } from './format'

/**
 * The X-Perp universe, ranked by how tradable each contract is right now.
 *
 * "Tradable" is not "will go up". It is a measure of market *conditions*: can
 * you get in and out without the spread eating the trade, is there enough
 * volume behind the book, and is the thing moving enough to be worth the risk.
 * Nothing here predicts direction.
 */

export interface Market {
  instId: string
  symbol: string
  last: number
  change24h: number
  /** 24h traded value in USD. */
  volumeUsd: number
  /** Open interest in USD, as OKX reports it. */
  openInterestUsd: number
  /** Bid-ask spread in basis points. NaN when the book is empty. */
  spreadBps: number
  /** 24h high-low range as a share of price. */
  rangePct: number
  maxLeverage: number
  /** 0–100 composite of liquidity, cost and movement. */
  score: number
  grade: 'excelente' | 'bueno' | 'aceptable' | 'evitar'
  /** Why it scored what it scored, for the tooltip. */
  reasons: string[]
  /** The account has traded this contract. */
  traded: boolean
}

/**
 * Cost matters more than anything else here, and this project has measured why:
 * a strategy's edge is spent on the spread long before it is spent on being
 * wrong. So spread carries as much weight as raw volume.
 */
const WEIGHTS = { liquidity: 0.35, cost: 0.35, movement: 0.3 }

/** Rank within a sorted list, 0–1. Robust to the wild outliers in crypto volume. */
function percentile(sorted: number[], value: number): number {
  if (sorted.length < 2) return 0.5
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo / (sorted.length - 1)
}

/**
 * Movement is not "more is better": a contract that moved 60 % in a day is a
 * liquidation risk, not an opportunity. The sweet spot sits around a 3–8 % daily
 * range, and the score falls away on both sides.
 */
function movementScore(rangePct: number): number {
  if (!Number.isFinite(rangePct) || rangePct <= 0) return 0
  if (rangePct < 1) return rangePct / 1 * 0.4
  if (rangePct <= 3) return 0.4 + ((rangePct - 1) / 2) * 0.5
  if (rangePct <= 8) return 0.9 + ((rangePct - 3) / 5) * 0.1
  if (rangePct <= 15) return 1 - ((rangePct - 8) / 7) * 0.45
  return Math.max(0.1, 0.55 - (rangePct - 15) / 40)
}

export function useMarkets(tradedInstIds: string[] = []) {
  const instruments = useInstruments('FUTURES')
  const tickers = useTickers('FUTURES')
  const openInterest = useOpenInterest('FUTURES')

  const traded = useMemo(() => new Set(tradedInstIds), [tradedInstIds])

  const markets = useMemo<Market[]>(() => {
    const byTicker = new Map((tickers.data ?? []).map((t) => [t.instId, t]))
    const byOi = new Map((openInterest.data ?? []).map((o) => [o.instId, o]))

    const base = (instruments.data ?? [])
      .filter((i) => i.instId.includes('XPERP') && i.state === 'live')
      .map((i) => {
        const t = byTicker.get(i.instId)
        const last = num(t?.last)
        const bid = num(t?.bidPx)
        const ask = num(t?.askPx)
        const open = num(t?.open24h)
        const mid = (bid + ask) / 2

        return {
          instId: i.instId,
          symbol: i.instId.split('-')[0],
          last,
          change24h: open > 0 ? (last - open) / open : 0,
          // volCcy24h is in the base currency for linear contracts.
          volumeUsd: num(t?.volCcy24h) * last,
          openInterestUsd: num(byOi.get(i.instId)?.oiUsd),
          spreadBps: bid > 0 && ask > 0 && mid > 0 ? ((ask - bid) / mid) * 10_000 : NaN,
          rangePct: last > 0 ? ((num(t?.high24h) - num(t?.low24h)) / last) * 100 : 0,
          maxLeverage: num(i.lever),
          traded: traded.has(i.instId),
        }
      })
      .filter((m) => m.volumeUsd > 0 && m.last > 0)

    if (base.length === 0) return []

    // Percentile ranks make the score robust: crypto volume spans four orders of
    // magnitude, so a linear scale would compress everything below the leader.
    const volumes = base.map((m) => m.volumeUsd).sort((a, b) => a - b)
    const ois = base.map((m) => m.openInterestUsd).sort((a, b) => a - b)
    const spreads = base.map((m) => m.spreadBps).filter(Number.isFinite).sort((a, b) => a - b)

    return base
      .map((m) => {
        const liquidity = 0.6 * percentile(volumes, m.volumeUsd) + 0.4 * percentile(ois, m.openInterestUsd)
        // Low spread is good, so the percentile is inverted.
        const cost = Number.isFinite(m.spreadBps) ? 1 - percentile(spreads, m.spreadBps) : 0
        const movement = movementScore(m.rangePct)

        const score = Math.round(
          100 * (WEIGHTS.liquidity * liquidity + WEIGHTS.cost * cost + WEIGHTS.movement * movement),
        )

        const reasons: string[] = []
        if (liquidity > 0.8) reasons.push('mucha liquidez')
        else if (liquidity < 0.35) reasons.push('poca liquidez')
        if (Number.isFinite(m.spreadBps)) {
          if (m.spreadBps <= 2) reasons.push('horquilla muy estrecha')
          else if (m.spreadBps > 20) reasons.push('horquilla ancha: entrar y salir cuesta')
        }
        if (m.rangePct > 15) reasons.push('movimiento extremo: riesgo alto')
        else if (m.rangePct < 1) reasons.push('apenas se mueve')

        const grade: Market['grade'] =
          score >= 70 ? 'excelente' : score >= 55 ? 'bueno' : score >= 38 ? 'aceptable' : 'evitar'

        return { ...m, score, grade, reasons }
      })
      .sort((a, b) => b.score - a.score)
  }, [instruments.data, tickers.data, openInterest.data, traded])

  return {
    markets,
    isLoading: instruments.isLoading || tickers.isLoading,
    isFetching: instruments.isFetching || tickers.isFetching || openInterest.isFetching,
    error: instruments.error ?? tickers.error ?? openInterest.error,
    /** Open interest is a separate call; say so when it is missing. */
    hasOpenInterest: (openInterest.data?.length ?? 0) > 0,
  }
}
