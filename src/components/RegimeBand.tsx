import { regimeReading } from '../lib/entryContext'
import { pct, plural, ratio } from '../lib/format'
import { useBtcRegime } from '../lib/useBtcRegime'
import { Badge, Help } from './ui'

const signedR = (x: number) => `${x >= 0 ? '+' : '−'}${ratio(Math.abs(x))}`

/**
 * One line under the account's own figures: which side of its 4 h EMA 200 BTC is on, since when, and what the longs of the
 * shipped trend strategy measured on each side. Context, not a signal — it is the split the signal tags use, shown once for
 * the whole market. Amber on the side that measured worse, never green or red. Nothing is drawn until the EMA has settled.
 */
export function RegimeBand() {
  const now = Date.now()
  const r = regimeReading(useBtcRegime(), now)
  if (!r) return null
  const since =
    r.days === null
      ? `desde hace más de ${plural(r.atLeastDays, 'día', 'días')}`
      : r.days === 0
        ? 'desde hoy'
        : `desde hace ${plural(r.days, 'día', 'días')}`
  return (
    <div className="notice regime-band">
      <div className="notice-body">
        <p className="notice-title">
          Régimen de BTC{' '}
          <Help label="Régimen de BTC">
            <p>
              Si BTC cierra por encima o por debajo de su media exponencial de 200 velas de 4 horas. No es una señal: es la
              división de las entradas de la Ruptura + EMA 200 que más separó en el histórico. Los largos con BTC por encima
              midieron {signedR(r.longsAbove)} R por operación y con BTC por debajo {signedR(r.longsBelow)} R ({r.sample}).
            </p>
            <p>
              Los cortos no se separaron por régimen, así que esto solo dice cuánta confianza dar a los largos del día. Se
              encontró mirando los controles, y comparte familia con las demás estrategias de tendencia: por eso se muestra
              y no se opera.
            </p>
          </Help>
        </p>
        <p className="notice-text">
          <Badge variant={r.above ? 'neutral' : 'warn'}>{r.above ? 'Por encima de su EMA 200' : 'Por debajo de su EMA 200'}</Badge>{' '}
          ({pct(r.distance, 1)} de la media) {since}. Los largos de la tendencia midieron {signedR(r.above ? r.longsAbove : r.longsBelow)} R con BTC{' '}
          {r.above ? 'por encima' : 'por debajo'}, frente a {signedR(r.above ? r.longsBelow : r.longsAbove)} R en el otro lado. Contexto, no
          una señal.
        </p>
      </div>
    </div>
  )
}
