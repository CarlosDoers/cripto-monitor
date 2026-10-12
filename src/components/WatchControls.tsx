import { WATCH_SIZES, type WatchScan } from '../lib/useWatchScan'
import { WATCH_BARS, type BarChoice, type WatchBar } from '../lib/watchBars'

/**
 * The controls of a "qué vigilar" card: which reading (the longer one on 4 h or
 * the short one on 1 h), how many contracts, which ones, and the button. A bar
 * the strategy is not offered on is shown disabled with the reason, like the
 * strategy view's timeframe buttons.
 */
export function WatchControls({
  scan,
  empty,
  bars,
}: {
  scan: WatchScan
  empty: boolean
  bars: Record<WatchBar, BarChoice>
}) {
  const { size, setSize, cryptoOnly, setCryptoOnly, bar, setBar, ids, run } = scan
  return (
    <div className="table-controls-bar ema-controls">
      <div className="seg-control" aria-label="Marco temporal">
        {WATCH_BARS.map((b) => (
          <button
            key={b.key}
            type="button"
            aria-pressed={bar === b.key}
            disabled={!bars[b.key].allowed}
            title={bars[b.key].title}
            onClick={() => setBar(b.key)}
          >
            {b.term} · {b.label}
          </button>
        ))}
      </div>
      <div className="seg-control" aria-label="Cuántos contratos">
        {WATCH_SIZES.map((n) => (
          <button key={n} type="button" aria-pressed={size === n} onClick={() => setSize(n)}>
            Top {n}
          </button>
        ))}
      </div>
      <div className="seg-control" aria-label="Qué contratos">
        <button type="button" aria-pressed={cryptoOnly} onClick={() => setCryptoOnly(true)}>
          Cripto
        </button>
        <button type="button" aria-pressed={!cryptoOnly} onClick={() => setCryptoOnly(false)}>
          Todo
        </button>
      </div>
      <button type="button" className="btn btn--primary" onClick={run} disabled={empty}>
        {ids ? 'Volver a escanear' : 'Qué vigilo'}
      </button>
    </div>
  )
}
