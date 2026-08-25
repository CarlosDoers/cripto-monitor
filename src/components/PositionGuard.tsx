import { useAlgoOrders, useFundingRate } from '../lib/queries'
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

/**
 * Funding on a perpetual, as what it costs this position per day.
 *
 * OKX quotes the rate per settlement period, normally every 8 hours — three a
 * day. The sign is relative to the long side: a positive rate means longs pay
 * shorts, so a short earns it.
 */
export function FundingCost({ position }: { position: Position }) {
  const { data } = useFundingRate(position.instId)
  const rate = data?.[0]
  if (!rate) return <span className="sub">—</span>

  const perPeriod = num(rate.fundingRate)
  // Signed from the long side: a positive rate means longs pay shorts.
  const costRate = isShort(position) ? -perPeriod : perPeriod
  const perDayRate = costRate * 3
  const perDayUsd = num(position.notionalUsd) * perDayRate

  return (
    <span className={perDayUsd > 0 ? 'delta--down' : perDayUsd < 0 ? 'delta--up' : ''}>
      {share(Math.abs(perDayRate), 3)}
      <span className="sub">
        {' '}
        {perDayUsd > 0 ? 'pagas' : perDayUsd < 0 ? 'cobras' : ''} al día
      </span>
    </span>
  )
}
