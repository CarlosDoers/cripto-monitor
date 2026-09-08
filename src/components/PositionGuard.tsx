import { useAlgoOrders, useFundingHistory, useFundingRate } from '../lib/queries'
import { guardsFor, isShort, stopOf, targetOf } from '../lib/guards'
import { num, price, share } from '../lib/format'
import type { Position } from '../lib/types'
import { Badge } from './ui'
import { IconAlert } from './icons'

/**
 * Whether a position has a protective order behind it, and what carrying it
 * costs.
 *
 * Both answers live outside `/account/positions`: a stop-loss is a conditional
 * order in a separate book, and funding is a public rate on the instrument. The
 * one distinction that matters when something moves against you overnight is
 * exactly the one that endpoint cannot make.
 */
export function ProtectionBadge({ position }: { position: Position }) {
  const { data, isLoading } = useAlgoOrders()
  if (isLoading) return <span className="sub">—</span>

  const guards = guardsFor(position, data ?? [])
  const stop = stopOf(guards)
  const target = targetOf(guards)

  if (!stop && !target) {
    return (
      <Badge variant="sell">
        <IconAlert /> Sin stop
      </Badge>
    )
  }

  return (
    <span className="guard-set">
      {stop ? (
        <span className="guard-line guard-line--stop">Stop {price(num(stop.slTriggerPx))}</span>
      ) : (
        <span className="guard-line guard-line--missing">Sin stop</span>
      )}
      {target && (
        <span className="guard-line guard-line--target">
          Objetivo {price(num(target.tpTriggerPx))}
        </span>
      )}
    </span>
  )
}

/** Settlements in a week: OKX settles every 8 hours. */
const PERIODS_PER_WEEK = 21

/**
 * Funding on a perpetual, as what it costs this position per day, against what
 * it has been costing.
 *
 * OKX quotes the rate per settlement period, normally every 8 hours — three a
 * day. The sign is relative to the long side: a positive rate means longs pay
 * shorts, so a short earns it.
 *
 * The current rate alone cannot tell a cheap position from one whose carry is
 * quietly tripling, and the difference decides whether a trade is still worth
 * holding. The week's realised average is the cheapest thing that can.
 */
export function FundingCost({ position }: { position: Position }) {
  const { data } = useFundingRate(position.instId)
  const history = useFundingHistory(position.instId, PERIODS_PER_WEEK)
  const rate = data?.[0]
  if (!rate) return <span className="sub">—</span>

  // Signed from the long side: a positive rate means longs pay shorts.
  const side = isShort(position) ? -1 : 1
  const perDayRate = num(rate.fundingRate) * side * 3
  const perDayUsd = num(position.notionalUsd) * perDayRate

  // `realizedRate` is what actually settled; `fundingRate` is the same figure on
  // this endpoint but only the first is guaranteed to be the applied one.
  const settled = (history.data ?? []).map((f) => num(f.realizedRate || f.fundingRate))
  const weekRate = settled.length
    ? (settled.reduce((sum, r) => sum + r, 0) / settled.length) * side * 3
    : null

  return (
    <span className={perDayUsd > 0 ? 'delta--down' : perDayUsd < 0 ? 'delta--up' : ''}>
      {share(Math.abs(perDayRate), 3)}
      <span className="sub">
        {' '}
        {perDayUsd > 0 ? 'pagas' : perDayUsd < 0 ? 'cobras' : ''} al día
      </span>
      {weekRate !== null && (
        <span className="sub"> · 7 d {share(Math.abs(weekRate), 3)}</span>
      )}
    </span>
  )
}
