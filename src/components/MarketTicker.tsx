import { useTickers } from '../lib/queries'
import { num, pct, price } from '../lib/format'
import { Delta } from './ui'

const WATCHLIST = [
  'BTC-USDT',
  'ETH-USDT',
  'SOL-USDT',
  'XRP-USDT',
  'DOGE-USDT',
  'BNB-USDT',
  'OKB-USDT',
  'AVAX-USDT',
]

export function MarketTicker() {
  const { data, isLoading } = useTickers('SPOT')

  if (isLoading || !data || data.length === 0) {
    return (
      <div className="ticker-bar">
        <div className="ticker-item skeleton" style={{ width: 140, height: 20 }} />
        <div className="ticker-item skeleton" style={{ width: 140, height: 20 }} />
        <div className="ticker-item skeleton" style={{ width: 140, height: 20 }} />
      </div>
    )
  }

  const tickerMap = new Map(data.map((t) => [t.instId, t]))
  const items = WATCHLIST.map((id) => tickerMap.get(id)).filter(
    (t): t is NonNullable<typeof t> => Boolean(t),
  )

  if (items.length === 0) return null

  return (
    <div className="ticker-bar" role="region" aria-label="Cotizaciones en vivo">
      <div className="ticker-track">
        {items.map((t) => {
          const last = num(t.last)
          const open = num(t.open24h)
          const change = open > 0 ? (last - open) / open : 0
          const symbol = t.instId.replace('-USDT', '')

          return (
            <div key={t.instId} className="ticker-item">
              <span className="ticker-symbol">{symbol}</span>
              <span className="ticker-price">{price(last)}</span>
              <Delta ratio={change} pill>
                {pct(change)}
              </Delta>
            </div>
          )
        })}
      </div>
    </div>
  )
}
