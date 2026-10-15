import { WATCH_SIZES, type WatchScan } from '../lib/useWatchScan'
import { WATCH_BARS, type BarChoice, type WatchBar } from '../lib/watchBars'

/**
 * The controls of a "qué vigilar" card: which reading (the longer one on 4 h,
 * the short one on 1 h, or both side by side), how many contracts, which ones,
 * and the button. A bar the strategy is not offered on is shown disabled with
 * the reason, like the strategy view's timeframe buttons — and so is "both",
 * which needs the two.
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
  const { size, setSize, cryptoOnly, setCryptoOnly, view, setView, ids, run } = scan
  const both = bars['4H'].allowed && bars['1H'].allowed
  return (
    <div className="table-controls-bar ema-controls">
      <div className="seg-control" aria-label="Marco temporal">
        {WATCH_BARS.map((b) => (
          <button
            key={b.key}
            type="button"
            aria-pressed={view === b.key}
            disabled={!bars[b.key].allowed}
            title={bars[b.key].title}
            onClick={() => setView(b.key)}
          >
            {b.term} · {b.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={view === 'both'}
          disabled={!both}
          title={
            both
              ? 'Las dos lecturas, una fila cada una: cuesta cuatro peticiones más por contrato.'
              : 'Hace falta que la estrategia se ofrezca en las dos: ' + (!bars['1H'].allowed ? bars['1H'].title : bars['4H'].title)
          }
          onClick={() => setView('both')}
        >
          Ambos
        </button>
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
