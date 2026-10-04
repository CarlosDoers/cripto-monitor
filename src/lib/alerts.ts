import { fuelUsed, liquidationRoom, NEARLY_DRY } from './bots'
import { num, pct, plural, share, usd } from './format'
import { guardsFor, hasStop, PARTIAL_STOP, stopCoverage } from './guards'
import type { AccountBalance, AlgoOrder, DcaBot, DcaPosition, Position } from './types'

/**
 * The Resumen's "Requiere atención", as a pure function: the same rules for the
 * app, the "Copiar para Claude" snapshot and the claude.ai connector, so none
 * of them can call an account healthy that another flags.
 *
 * Each rule is the one of the view it comes from — `hasStop` from Posiciones,
 * `NEARLY_DRY` and `fuelUsed` from Bots, the carry exit from Financiación.
 */

/**
 * OKX reports the margin ratio as a multiple of maintenance; under ~150 % the
 * account is close to liquidation, and 3× is the point to start watching.
 */
export const MARGIN_WARN = 3

export interface AccountAlert {
  key: string
  text: string
  href: string
  link: string
}

export interface AlertInput {
  account: AccountBalance | undefined
  positions: Position[]
  /** Undefined while the stops are loading: no stop rule is claimed until they are. */
  algos: AlgoOrder[] | undefined
  dcaBots: DcaBot[]
  dcaPositions: Record<string, DcaPosition> | undefined
  netWorth: number
  freeMargin: number
  /** Hedges whose funding stopped paying (see `useCarryExits`). */
  carryExits: { instId: string; apr: number | undefined }[]
  /** Live price of each bot's instrument, by instId, when loaded. */
  marks?: Record<string, number>
}

export function accountAlerts(input: AlertInput) {
  const { account, positions, algos, dcaBots, dcaPositions, netWorth, freeMargin, carryExits, marks } = input

  // With isolated margin OKX leaves the account ratio empty, and read as-is it
  // printed "100 %" beside a position at 8× maintenance. The honest figure is
  // then the worst open position's.
  const accountRatio = num(account?.mgnRatio)
  const positionRatios = positions.map((p) => num(p.mgnRatio)).filter((r) => r > 0)
  const marginRatio =
    accountRatio > 0 ? accountRatio : positionRatios.length ? Math.min(...positionRatios) : 0
  const atRisk = positions.length > 0 && marginRatio > 0 && marginRatio < MARGIN_WARN
  // Under 1 % of equity free: an isolated position that turns cannot be topped
  // up, so the only options left are close or be liquidated.
  const locked = netWorth > 0 && freeMargin / netWorth < 0.01

  const unprotected = algos ? positions.filter((p) => !hasStop(guardsFor(p, algos))) : []
  const partial = algos
    ? positions
        .map((p) => ({ p, covered: stopCoverage(p, guardsFor(p, algos)) }))
        .filter((x) => x.covered > 0 && x.covered < PARTIAL_STOP)
    : []
  const botRisk = dcaBots
    .map((bot) => {
      const position = dcaPositions?.[bot.algoId]
      const mark = marks?.[bot.instId]
      return {
        bot,
        position,
        used: fuelUsed(bot, position),
        room: liquidationRoom(position, mark),
        /** Whether `room` is measured from the live price or only from the average. */
        roomFromMark: Boolean(mark && mark > 0),
      }
    })
    .sort((a, b) => b.used - a.used)
  const dryBots = botRisk.filter((r) => r.used >= NEARLY_DRY)

  const alerts: AccountAlert[] = [
    ...(atRisk
      ? [{ key: 'margin', href: '#/encurso', link: 'Ver en curso', text: `Margen ajustado (${share(marginRatio, 0)}): se acerca al nivel de liquidación.` }]
      : []),
    ...(unprotected.length
      ? [{ key: 'stop', href: '#/encurso', link: 'Ver en curso', text: `${plural(unprotected.length, 'posición sin stop', 'posiciones sin stop')} (${unprotected.map((p) => p.instId).join(', ')}): su pérdida solo tiene como límite la liquidación.` }]
      : []),
    ...partial.map((x) => ({
      key: `partial-${x.p.instId}`,
      href: '#/encurso',
      link: 'Ver en curso',
      text: `El stop de ${x.p.instId} cubre solo el ${share(x.covered, 0)} de la posición: el resto no tiene más límite que la liquidación.`,
    })),
    ...dryBots.map((r) => ({
      key: `bot-${r.bot.algoId}`,
      href: '#/encurso',
      link: 'Ver en curso',
      text: `${r.bot.instId} ha gastado ${num(r.position?.fillSafetyOrds)} de ${r.bot.maxSafetyOrds} órdenes de seguridad${r.room !== null ? ` y la liquidación está a un ${share(r.room, 0)} del ${r.roomFromMark ? 'precio actual' : 'precio medio'}` : ''}: si el precio sigue en contra ya no le queda con qué promediar.`,
    })),
    ...carryExits.map((x) => ({
      key: `carry-${x.instId}`,
      href: '#/financiacion',
      link: 'Ver financiación',
      text: `La cobertura en ${x.instId} ya no cobra: la financiación de la última semana va al ${pct(x.apr ?? 0, 1)} anual, y la regla dice deshacerla.`,
    })),
    ...(locked && positions.length > 0
      ? [{ key: 'free', href: '#/encurso', link: 'Ver en curso', text: `Margen libre ${usd(freeMargin)}: no queda con qué reforzar una posición que se tuerza.` }]
      : []),
  ]

  return {
    alerts,
    /** The alarms proper: margin, no stop, a dry bot. */
    alarm: atRisk || unprotected.length > 0 || partial.length > 0 || dryBots.length > 0,
    marginRatio,
    accountRatio,
    positionRatios,
    atRisk,
    locked,
    unprotected,
    partial,
    botRisk,
    tightest: botRisk[0],
  }
}
