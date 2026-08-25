import { num, price, share } from '../lib/format'
import { isShort } from '../lib/guards'
import type { Position } from '../lib/types'

/**
 * Where the price stands between the entry and the liquidation.
 *
 * The table already prints those numbers, but three prices in three columns do
 * not answer the question they exist for: how much of the road to liquidation
 * has already been travelled. A short loses to the right and a long to the
 * left, so the axis is drawn in the direction the position loses — the marker
 * always moves rightwards as things get worse.
 *
 * Laid out in percentages rather than measured pixels, so it needs no resize
 * observer and cannot stretch its strokes along one axis.
 */
export function PositionRisk({ position }: { position: Position }) {
  const entry = num(position.avgPx)
  const mark = num(position.markPx)
  const liq = num(position.liqPx)
  const breakEven = num(position.bePx)

  // Isolated spot-like rows and positions OKX cannot price have no liquidation.
  if (!(entry > 0 && mark > 0 && liq > 0)) return null

  const short = isShort(position)
  // Distance travelled against the position, over the whole road to liquidation.
  const road = Math.abs(liq - entry)
  const travelled = road > 0 ? Math.abs(mark - entry) / road : 0
  const past = mark !== entry && (short ? mark > entry : mark < entry)
  const progress = Math.min(1, Math.max(0, past ? travelled : 0))

  // The axis runs entry → liquidation with a margin at both ends, so the
  // markers never sit on the very edge.
  const PAD = 0.12
  const at = (value: number) => {
    const raw = road > 0 ? (short ? value - entry : entry - value) / road : 0
    return (PAD + Math.min(1.06, Math.max(-0.1, raw)) * (1 - 2 * PAD)) * 100
  }

  const marks = [
    { key: 'entry', at: at(entry), label: 'Entrada', value: price(entry), tone: 'mid' },
    ...(breakEven > 0 && Math.abs(breakEven - entry) / entry > 0.0005
      ? [{ key: 'be', at: at(breakEven), label: 'Equilibrio', value: price(breakEven), tone: 'mid' }]
      : []),
    { key: 'mark', at: at(mark), label: 'Marca', value: price(mark), tone: 'now' },
    { key: 'liq', at: at(liq), label: 'Liquidación', value: price(liq), tone: 'bad' },
  ]

  return (
    <div className="risk-scale">
      <div className="risk-scale-head">
        <span className="metric-label">Camino hasta la liquidación</span>
        <span className={`risk-scale-pct ${progress >= 0.5 ? 'delta--down' : ''}`}>
          {share(progress, 0)} recorrido
        </span>
      </div>

      <div className="risk-scale-track">
        <span className="risk-scale-lost" style={{ left: `${at(entry)}%`, width: `${Math.max(0, at(mark) - at(entry))}%` }} />
        <span className="risk-scale-left" style={{ left: `${at(mark)}%`, width: `${Math.max(0, at(liq) - at(mark))}%` }} />
        {marks.map((m) => (
          <span key={m.key} className={`risk-scale-tick risk-scale-tick--${m.tone}`} style={{ left: `${m.at}%` }} />
        ))}
      </div>

      <div className="risk-scale-labels">
        {marks.map((m) => (
          <span key={m.key} className={`risk-scale-label risk-scale-label--${m.tone}`} style={{ left: `${m.at}%` }}>
            <span className="risk-scale-value">{m.value}</span>
            <span className="risk-scale-name">{m.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
