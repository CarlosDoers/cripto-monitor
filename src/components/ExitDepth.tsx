import { useOrderBook } from '../lib/queries'
import { num, qty, ratio, share } from '../lib/format'
import { isShort } from '../lib/guards'
import type { BookLevel, Position } from '../lib/types'

/** How far from the mid still counts as "not moving the market". */
const NEAR_BPS = 10
/** Below this share of the position, getting out is not a given. */
const THIN = 0.5

/**
 * Whether this position can actually be closed at the price on screen.
 *
 * The table prints a mark price and an unrealised PnL, and both quietly assume
 * the whole position can be sold there. On a thin book that is fiction: the
 * spread can be two basis points with almost nothing behind it, and a size that
 * walks six levels down realises a very different number.
 *
 * So this measures the side the position would actually hit — closing a short
 * buys and eats the asks, closing a long sells into the bids — and asks how much
 * of it fits within ten basis points of the mid.
 */
export function ExitDepth({ position }: { position: Position }) {
  const { data, isLoading } = useOrderBook(position.instId, 100)
  const book = data?.[0]
  const size = Math.abs(num(position.pos))

  if (isLoading) return null
  if (!book?.bids?.length || !book?.asks?.length || size <= 0) return null

  const bid = num(book.bids[0][0])
  const ask = num(book.asks[0][0])
  const mid = (bid + ask) / 2
  if (!(mid > 0)) return null

  const side: BookLevel[] = isShort(position) ? book.asks : book.bids
  const nearMid = side
    .filter(([px]) => Math.abs(num(px) - mid) / mid <= NEAR_BPS / 10_000)
    .reduce((sum, [, sz]) => sum + num(sz), 0)

  const covered = Math.min(1, nearMid / size)
  const thin = covered < THIN

  return (
    <div className="risk-scale">
      <div className="risk-scale-head">
        <span className="metric-label">Salida sin mover el mercado</span>
        <span className={`risk-scale-pct ${thin ? 'delta--down' : ''}`}>
          {share(covered, 0)} de la posición
        </span>
      </div>
      <p className="sub">
        Dentro de {NEAR_BPS} pb del medio hay {qty(nearMid)} contratos en{' '}
        {isShort(position) ? 'la venta' : 'la compra'}, y la posición son {qty(size)}.{' '}
        {thin ? (
          <>
            Cerrarla entera hoy movería el precio: el PnL de arriba se calcula a precio de marca y
            asume una salida que este libro no sostiene.
          </>
        ) : (
          <>La horquilla es de {ratio(((ask - bid) / mid) * 10_000, 1)} pb y aguanta el tamaño.</>
        )}
      </p>
    </div>
  )
}
