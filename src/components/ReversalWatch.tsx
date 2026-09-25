import type { ReactNode } from 'react'
import { pct, plural, price } from '../lib/format'
import type { TrapWatch } from '../lib/indicators/reversalTrap'
import type { StrategySignal } from '../lib/indicators/types'
import { Badge, Card } from './ui'

/**
 * What the reversal is doing on the last closed candle, in one sentence and
 * one bar.
 *
 * The chart answers it too, but only to someone who already knows the rule:
 * that a signal needs a close *outside* a band followed by a close back *in*,
 * that ten bars outside stops counting, and that signals are spaced ten bars
 * apart. This card states the rule applied to now — "a close under 84 210
 * tomorrow fires a short" — which is the question a person opening the tab
 * actually has.
 *
 * The bar is laid out in percentages like `PositionRisk`, so it needs no
 * resize observer. Its two outer zones are where a signal is born, tinted with
 * the colour of the side it would fire.
 */
export function ReversalWatch({
  watch,
  active,
  trapWindow,
  lastClosed,
}: {
  watch: TrapWatch
  active: StrategySignal | null
  trapWindow: number
  lastClosed: number
}) {
  const { close, upper, basis, lower, zone, barsOutside, cooldown, armed, expired } = watch

  // Scale: the envelope plus room either side for the signal zones, stretched
  // if price has run further out than that.
  const width = upper - lower
  const lo = Math.min(lower - width * 0.35, close - width * 0.05)
  const hi = Math.max(upper + width * 0.35, close + width * 0.05)
  const at = (v: number) => ((v - lo) / (hi - lo)) * 100

  const side = zone === 'above' ? 'short' : 'long'
  const band = zone === 'above' ? upper : lower
  const activeHere = active && active.side === side

  let tone: 'neutral' | 'buy' | 'sell' | 'warn' = 'neutral'
  let state = 'Sin señal'
  let title: string
  let text: ReactNode

  if (active) {
    tone = active.side === 'long' ? 'buy' : 'sell'
    state = active.side === 'long' ? 'Long abierta' : 'Short abierta'
    title = `Hay una operación ${active.side} en curso`
    text = (
      <>
        Entró en <strong>{price(active.entry)}</strong> y busca la base, que hoy está en{' '}
        <strong>{price(basis)}</strong> ({pct(watch.toBasis)} desde aquí). El stop sigue en{' '}
        <strong>{price(active.stop)}</strong>. Su recorrido está en la tarjeta de arriba.
      </>
    )
  } else if (zone === 'inside') {
    title = 'Dentro de la envolvente: no hay nada que hacer'
    text = (
      <>
        Una señal <strong>long</strong> necesita que el precio cierre por debajo del suelo (
        <strong>{price(lower)}</strong>, {pct(watch.toLower)}) y después vuelva a cerrar dentro;
        una <strong>short</strong>, lo mismo por encima del techo (<strong>{price(upper)}</strong>,{' '}
        {pct(watch.toUpper)}).
        {cooldown > 0 &&
          ` Además acaba de haber una señal, y la siguiente no puede llegar hasta dentro de ${plural(cooldown, 'vela', 'velas')}.`}
      </>
    )
  } else if (expired) {
    tone = 'warn'
    state = 'Fuera demasiado tiempo'
    title = `Lleva ${plural(barsOutside, 'vela', 'velas')} ${zone === 'above' ? 'por encima del techo' : 'por debajo del suelo'}: ya no es una trampa`
    text = (
      <>
        El límite son {trapWindow}. Tanto tiempo fuera es una tendencia, no una ruptura falsa, así
        que aunque vuelva a cerrar dentro no saltará ninguna señal. Hay que esperar a que se cierre
        el episodio.
      </>
    )
  } else {
    tone = side === 'long' ? 'buy' : 'sell'
    state = armed ? `Vigilando ${side}` : 'En pausa'
    title =
      zone === 'above'
        ? `Fuera por arriba: posible señal short`
        : `Fuera por abajo: posible señal long`
    text = armed ? (
      <>
        Lleva {plural(barsOutside, 'vela', 'velas')}{' '}
        {zone === 'above' ? 'por encima del techo' : 'por debajo del suelo'}. Si la próxima vela
        cierra {zone === 'above' ? 'por debajo del techo' : 'por encima del suelo'} (hoy en{' '}
        <strong>{price(band)}</strong>; se mueve un poco con cada vela), salta una señal{' '}
        <strong>{side}</strong> con objetivo en la base (<strong>{price(basis)}</strong>).{' '}
        {trapWindow - barsOutside > 0
          ? `Puede seguir fuera hasta ${plural(trapWindow - barsOutside, 'vela más', 'velas más')} sin perder la opción; a partir de ahí deja de contar.`
          : 'Es la última oportunidad: si la próxima vela no cierra dentro, deja de contar.'}
      </>
    ) : (
      <>
        El precio está fuera, pero{' '}
        {activeHere
          ? `ya hay una ${side} abierta y no se abre otra del mismo lado.`
          : `acaba de haber una señal y la siguiente no puede llegar hasta dentro de ${plural(cooldown, 'vela', 'velas')}.`}
      </>
    )
  }

  const ticks = [
    // Outer labels face inwards, so they can never run off the edge of the card.
    { key: 'lower', value: lower, name: 'Suelo', align: 'start' },
    { key: 'basis', value: basis, name: 'Base · objetivo', align: 'center' },
    { key: 'upper', value: upper, name: 'Techo', align: 'end' },
  ]

  return (
    <Card title="Qué dice ahora" subtitle={`Con la última vela cerrada · ${new Date(lastClosed).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`}>
      <div className="watch">
        <div className="watch-head">
          <Badge variant={tone} pulse={tone !== 'neutral' && tone !== 'warn'}>
            {state}
          </Badge>
          <p className="watch-title">{title}</p>
        </div>
        <p className="watch-text">{text}</p>

        <div className="gauge" role="img" aria-label={`Precio ${price(close)} entre suelo ${price(lower)} y techo ${price(upper)}`}>
          {/* The label is clamped away from the edges so it cannot push the
              page sideways; the marker on the track stays exact. */}
          <div className="gauge-now-row">
            <div className="gauge-now" style={{ left: `${Math.min(90, Math.max(10, at(close)))}%` }}>
              <span className="gauge-now-value">{price(close)}</span>
              <span className="gauge-now-name">Precio</span>
            </div>
          </div>
          <div className="gauge-track">
            <span className="gauge-zone gauge-zone--long" style={{ left: 0, width: `${at(lower)}%` }} />
            <span
              className="gauge-zone gauge-zone--inside"
              style={{ left: `${at(lower)}%`, width: `${at(upper) - at(lower)}%` }}
            />
            <span className="gauge-zone gauge-zone--short" style={{ left: `${at(upper)}%`, right: 0 }} />
            {ticks.map((t) => (
              <span key={t.key} className={`gauge-tick gauge-tick--${t.key}`} style={{ left: `${at(t.value)}%` }} />
            ))}
            <span className="gauge-marker" style={{ left: `${at(close)}%` }} />
          </div>
          <div className="gauge-labels">
            {ticks.map((t) => (
              <span
                key={t.key}
                className={`gauge-label gauge-label--${t.align}`}
                style={{ left: `${at(t.value)}%` }}
              >
                <span className="gauge-label-value">{price(t.value)}</span>
                <span className="gauge-label-name">{t.name}</span>
              </span>
            ))}
          </div>
          <div className="gauge-zones">
            <span>▲ zona de señal long</span>
            <span>zona de señal short ▼</span>
          </div>
        </div>
      </div>
    </Card>
  )
}
