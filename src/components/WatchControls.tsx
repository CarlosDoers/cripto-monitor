import { WATCH_SIZES, type WatchScan } from '../lib/useWatchScan'

/** The controls of a "qué vigilar" card: how many contracts, which ones, and the button. */
export function WatchControls({ scan, empty }: { scan: WatchScan; empty: boolean }) {
  const { size, setSize, cryptoOnly, setCryptoOnly, ids, run } = scan
  return (
    <div className="table-controls-bar ema-controls">
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
