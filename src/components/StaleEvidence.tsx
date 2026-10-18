import { evidenceAge, measuredThroughText } from '../lib/indicators/registry'
import { plural } from '../lib/format'
import { IconAlert } from './icons'

/**
 * The monthly refresh of the measured figures, as a notice and not a note in a file: the audit only sees what its cache
 * holds, so a strategy that is decaying shows up only when the cache is extended and the figures are measured again.
 * Silent until the data is more than five weeks old.
 */
export function StaleEvidence() {
  const { days, stale } = evidenceAge()
  if (!stale) return null
  return (
    <div className="notice notice--warning">
      <IconAlert />
      <div className="notice-body">
        <p className="notice-title">Las cifras medidas tienen {plural(days, 'día', 'días')}</p>
        <p className="notice-text">
          Salen de datos hasta el {measuredThroughText()}. Toca refrescarlas: <code>npm run candles</code>, <code>npm run audit</code> y volver
          a declarar lo que mida, suba o baje. Una estrategia que se deteriora solo se ve al medirla otra vez.
        </p>
      </div>
    </div>
  )
}
