import { useCandles } from '../lib/queries'
import { num, pct, price } from '../lib/format'
import type { Market } from '../lib/markets'
import { Sparkline } from './Sparkline'
import { useSize } from '../lib/useSize'

/**
 * One contract the account trades, as a tile: price, 24 h move, the shape of
 * the day and where price sits inside its 24 h range.
 *
 * The range bar answers the question the percentage cannot: +3 % that closed
 * at the high of the day and +3 % that gave half of it back read the same as a
 * number and very differently as a position on the bar.
 */
export function MarketCard({ market }: { market: Market }) {
  const { data } = useCandles(market.instId, '1H', 24)
  // Drawn at the card's real width: a fixed-size SVG stretched by CSS keeps
  // its points where they were and leaves the line short of the edge.
  const [ref, width] = useSize<HTMLDivElement>()
  // OKX returns newest first.
  const closes = (data ?? []).map((c) => num(c[4])).reverse()
  const up = market.change24h >= 0
  const span = market.high24h - market.low24h
  const inRange = span > 0 ? Math.min(1, Math.max(0, (market.last - market.low24h) / span)) : 0.5

  return (
    <article className="market-card">
      <header className="market-card-head">
        <span className="market-card-symbol">{market.symbol}</span>
        <span className={`market-card-change ${up ? 'delta--up' : 'delta--down'}`}>
          {up ? '↑' : '↓'} {pct(market.change24h)}
        </span>
      </header>
      <span className="market-card-price">{price(market.last)}</span>
      <div ref={ref}>
        <Sparkline
          values={closes}
          color={up ? 'var(--good)' : 'var(--critical)'}
          width={Math.max(width, 80)}
          height={36}
        />
      </div>
      <div className="market-card-range" title="Dónde está el precio dentro del rango de las últimas 24 h">
        <span className="market-card-range-track">
          <span className="market-card-range-dot" style={{ left: `${inRange * 100}%` }} />
        </span>
        <span className="market-card-range-labels">
          <span>{price(market.low24h)}</span>
          <span>mín · máx 24 h</span>
          <span>{price(market.high24h)}</span>
        </span>
      </div>
    </article>
  )
}
