import { ratio } from './format'
import { blockReason, MIN_TRADABLE_R, timeframeVerdict, type StrategyBacktest } from './indicators/registry'

/**
 * The two readings the Screener's "qué vigilar" cards can give: the longer one
 * (4 h, where both trend strategies were found and measured) and a shorter one
 * on 1 h candles. The same strategy code runs on either; what changes is how
 * much evidence stands behind it, and the app already derives that per
 * timeframe (`timeframeVerdict`), so the card asks the registry instead of
 * keeping its own list.
 */
export type WatchBar = '4H' | '1H'

export const WATCH_BARS = [
  { key: '4H', hours: 4, label: '4 h', term: 'Largo plazo' },
  { key: '1H', hours: 1, label: '1 h', term: 'Corto plazo' },
] as const

export const barOf = (key: WatchBar) => WATCH_BARS.find((b) => b.key === key)!

/** What a card shows: one reading, or the two side by side, a row each. */
export type WatchView = WatchBar | 'both'

/** The bars a view reads, longer first. */
export const barsOf = (view: WatchView): WatchBar[] => (view === 'both' ? ['4H', '1H'] : [view])

/** A candle's length in ms, for the functions that turn a candle's open time into its close. */
export const barMsOf = (key: WatchBar) => barOf(key).hours * 3_600_000

/** An age in candles of `bar`, as the cards say it: "hace 12 h", then days. */
export function spanText(candles: number, bar: WatchBar): string {
  const hours = candles * barOf(bar).hours
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} días`
}

export interface BarChoice {
  allowed: boolean
  /** Why it is not offered, or what it measures, for the button's tooltip. */
  title: string
}

/**
 * Whether the strategy is offered on this bar — the rule Estrategias applies to
 * its timeframe buttons, so a card can never offer a reading the strategy view
 * blocks. A blocked bar is shown disabled with the reason, not hidden.
 */
export function barChoice(profile: StrategyBacktest, bar: WatchBar): BarChoice {
  const r = profile.byTimeframe[bar] ?? 0
  const reason = blockReason(profile, bar)
  if (reason === 'cost') {
    return {
      allowed: false,
      title: `No se ofrece en ${barOf(bar).label}: mide ${ratio(r)} R por señal, por debajo de ${ratio(MIN_TRADABLE_R, 1)} R. Las comisiones se comen la ventaja.`,
    }
  }
  if (reason === 'unstable') {
    const worst = Math.min(...(profile.halves[bar] ?? [0]))
    return {
      allowed: false,
      title: `No se ofrece en ${barOf(bar).label}: ${ratio(r)} R de media, pero ${ratio(worst)} R en una de las dos mitades del histórico.`,
    }
  }
  if (reason === 'not-applicable') {
    return { allowed: false, title: `No aplica en ${barOf(bar).label}: la estrategia no se calcula en este marco.` }
  }
  const marginal = timeframeVerdict(profile, bar) === 'marginal'
  return {
    allowed: true,
    title: `Esperanza medida: ${ratio(r)} R por señal${marginal ? ' (marco justo: cerca del listón)' : ''}`,
  }
}
