import { duration, ratio, signedUsd } from './format'
import { MIN_SAMPLE, type Trade } from './performance'

/**
 * What the account's own closed trades say about HOW it trades, apart from what it trades: how long losers are held against
 * winners, what happens right after a loss, after two, and at each leverage. Descriptive and nothing more — one account, a
 * few dozen trades — so every group carries its size and anything under `MIN_SAMPLE` is said to be short, not read.
 */

/** A trade opened within this long of closing a loss is "right after". */
export const QUICK_MS = 60 * 60_000
/** Leverage buckets, by the leverage the position was opened at. */
export const LEVERAGE_BUCKETS = [
  { key: 'low', label: 'Hasta 3×', max: 3 },
  { key: 'mid', label: 'De 3× a 10×', max: 10 },
  { key: 'high', label: 'Más de 10×', max: Infinity },
] as const

export interface HabitGroup {
  trades: number
  wins: number
  losses: number
  /** Breakeven trades are left out of the denominator, as everywhere else. */
  winRate: number
  pnl: number
  avgPnl: number
  /** The middle trade: a few huge ones move the mean and leave this where it was. */
  medianPnl: number
  /** The mean once the single worst trade is left out; equal to `avgPnl` with fewer than two trades. */
  avgWithoutWorst: number
  reliable: boolean
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}

export function groupOf(trades: Trade[]): HabitGroup {
  const wins = trades.filter((t) => t.pnl > 0).length
  const losses = trades.filter((t) => t.pnl < 0).length
  const pnl = trades.reduce((s, t) => s + t.pnl, 0)
  const worst = trades.length ? Math.min(...trades.map((t) => t.pnl)) : 0
  return {
    trades: trades.length,
    wins,
    losses,
    winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    pnl,
    avgPnl: trades.length ? pnl / trades.length : 0,
    medianPnl: trades.length ? median(trades.map((t) => t.pnl)) : 0,
    avgWithoutWorst: trades.length > 1 ? (pnl - worst) / (trades.length - 1) : trades.length ? pnl : 0,
    reliable: trades.length >= MIN_SAMPLE,
  }
}

export interface Habits {
  /** Median time a winner and a loser were held. Null without open times. */
  holding: { winners: number; losers: number; nWinners: number; nLosers: number; ratio: number } | null
  /** Trades opened within `QUICK_MS` of closing a loss, against the rest. */
  quickAfterLoss: { quick: HabitGroup; rest: HabitGroup } | null
  /** Trades opened when the last two closed trades were both losses, against the rest. */
  afterTwoLosses: { after: HabitGroup; rest: HabitGroup } | null
  byLeverage: { key: string; label: string; group: HabitGroup }[]
}

/**
 * Habits from the trades given (already filtered to a period). "Right after" looks at the trade that CLOSED most recently
 * before this one opened, on any instrument: a loss on one coin followed by a trade on another is the same decision.
 */
export function analyseHabits(trades: Trade[]): Habits {
  const timed = trades.filter((t) => t.openedAt > 0 && t.closedAt > 0)
  const byClose = [...timed].sort((a, b) => a.closedAt - b.closedAt)

  const winners = timed.filter((t) => t.pnl > 0 && t.duration !== undefined).map((t) => t.duration!)
  const losers = timed.filter((t) => t.pnl < 0 && t.duration !== undefined).map((t) => t.duration!)
  const holding =
    winners.length && losers.length
      ? { winners: median(winners), losers: median(losers), nWinners: winners.length, nLosers: losers.length, ratio: median(losers) / median(winners) }
      : null

  const quick: Trade[] = []
  const afterTwo: Trade[] = []
  const quickRest: Trade[] = []
  const twoRest: Trade[] = []
  for (const t of timed) {
    // The two trades that closed last before this one opened.
    const before = byClose.filter((x) => x.id !== t.id && x.closedAt <= t.openedAt)
    const last = before.at(-1)
    const prev = before.at(-2)
    const isQuick = last !== undefined && last.pnl < 0 && t.openedAt - last.closedAt <= QUICK_MS
    ;(isQuick ? quick : quickRest).push(t)
    const isTwo = last !== undefined && prev !== undefined && last.pnl < 0 && prev.pnl < 0
    ;(isTwo ? afterTwo : twoRest).push(t)
  }

  return {
    holding,
    quickAfterLoss: timed.length ? { quick: groupOf(quick), rest: groupOf(quickRest) } : null,
    afterTwoLosses: timed.length ? { after: groupOf(afterTwo), rest: groupOf(twoRest) } : null,
    byLeverage: LEVERAGE_BUCKETS.map((b, i) => {
      const min = i === 0 ? 0 : LEVERAGE_BUCKETS[i - 1].max
      return { key: b.key, label: b.label, group: groupOf(trades.filter((t) => t.lever > min && t.lever <= b.max)) }
    }).filter((b) => b.group.trades > 0),
  }
}

const avg = (g: HabitGroup) => signedUsd(g.avgPnl)
/** The group's mean with what the mean hides: the middle trade and the mean without the worst one. */
const avgDetail = (g: HabitGroup) => `${avg(g)} por operación (mediana ${signedUsd(g.medianPnl)}, sin la peor ${signedUsd(g.avgWithoutWorst)})`

/**
 * The reading of each habit, in a sentence that says what the numbers are and when they are too few to say anything. Plain
 * Spanish first; nothing here tells the person what to do.
 */
export function habitLines(h: Habits): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = []
  if (h.holding) {
    const { winners, losers, nWinners, nLosers, ratio: r } = h.holding
    const short = Math.min(nWinners, nLosers) < MIN_SAMPLE
    const detail = `mediana de ${duration(losers)} en las perdedoras (${nLosers}) frente a ${duration(winners)} en las ganadoras (${nWinners})`
    out.push({
      key: 'holding',
      text: short
        ? `Tiempo en la posición: ${detail}. Muestra corta: no se lee.`
        : r >= 1.25
          ? `Mantienes las perdedoras ${ratio(r, 1)} veces más que las ganadoras: ${detail}. Es el patrón de aguantar lo que pierde y recoger pronto lo que gana.`
          : r <= 0.8
            ? `Cortas las perdedoras antes que las ganadoras: ${detail}.`
            : `Mantienes ganadoras y perdedoras un tiempo parecido: ${detail}.`,
    })
  }
  if (h.quickAfterLoss) {
    const { quick, rest } = h.quickAfterLoss
    out.push({
      key: 'quick',
      text:
        quick.trades === 0
          ? 'Nunca abriste una operación en la hora siguiente a cerrar una pérdida.'
          : quick.reliable
            ? `Tras una pérdida abriste otra en menos de una hora ${quick.trades} veces: resultado medio ${avgDetail(quick)} frente a ${avgDetail(rest)} en las otras ${rest.trades}.`
            : `Tras una pérdida abriste otra en menos de una hora solo ${quick.trades} ${quick.trades === 1 ? 'vez' : 'veces'}: muestra corta, no se lee.`,
    })
  }
  if (h.afterTwoLosses) {
    const { after, rest } = h.afterTwoLosses
    out.push({
      key: 'two',
      text:
        after.trades === 0
          ? 'Nunca abriste una operación justo después de dos pérdidas seguidas.'
          : after.reliable
            ? `Tras dos pérdidas seguidas abriste ${after.trades} operaciones: resultado medio ${avgDetail(after)} frente a ${avgDetail(rest)} en las otras ${rest.trades}.`
            : `Tras dos pérdidas seguidas abriste solo ${after.trades} ${after.trades === 1 ? 'operación' : 'operaciones'}: muestra corta, no se lee.`,
    })
  }
  return out
}
