import { dateTime, pct, plural, price } from '../lib/format'
import type { Candle } from '../lib/indicators/types'
import type { Level } from '../lib/indicators/levels'
import { lineAt, type Trendline } from '../lib/indicators/trendlines'
import { Badge, Card, EmptyState, TableSkeleton, TableWrap } from './ui'

interface Row {
  key: string
  kind: Level['kind']
  shape: 'horizontal' | 'up' | 'down'
  /** Where the line sits on the last candle — a trendline moves every bar. */
  now: number
  /** Price change per bar, as a fraction of price. Zero for horizontals. */
  slopePct: number
  touches: number
  lastTime: number
}

/**
 * Every line on the Análisis chart as a price ladder: resistances above the
 * current price, supports below, and a row for the price itself between them.
 *
 * The chart's axis tags only carry the price. What the ladder adds is what an
 * analysis actually needs next — how far away each line is, how many times
 * price has turned there and when it last did — and it is the table twin every
 * chart in this app is meant to have.
 *
 * Neutral badges on purpose: green and red are reserved for PnL polarity, and
 * "soporte" is not a promise of a gain.
 */
export function LevelsTable({
  levels,
  trendlines,
  candles,
  lastPrice,
  loading,
  dimmed,
}: {
  levels: Level[]
  /** Indices into `candles`, like the ones `PriceChart` takes. */
  trendlines: Trendline[]
  candles: Candle[]
  lastPrice: number
  loading: boolean
  dimmed: boolean
}) {
  const lastBar = candles.length - 1
  const timeAt = (i: number) => candles[Math.min(Math.max(i, 0), lastBar)]?.time ?? 0

  const rows: Row[] = [
    ...levels.map((l) => ({
      key: `l-${l.price}`,
      kind: l.kind,
      shape: 'horizontal' as const,
      now: l.price,
      slopePct: 0,
      touches: l.touches,
      lastTime: timeAt(l.lastIndex),
    })),
    ...trendlines.map((t) => {
      const now = lineAt(t, lastBar)
      return {
        key: `t-${t.i1}-${t.i2}`,
        kind: t.kind,
        shape: t.slope >= 0 ? ('up' as const) : ('down' as const),
        now,
        slopePct: now > 0 ? t.slope / now : 0,
        touches: t.touches,
        lastTime: timeAt(t.lastIndex),
      }
    }),
  ].sort((a, b) => b.now - a.now)

  const above = rows.filter((r) => r.now >= lastPrice)
  const below = rows.filter((r) => r.now < lastPrice)

  const line = (r: Row) => (
    <tr key={r.key}>
      <td>
        <Badge variant="neutral">{r.kind === 'soporte' ? 'Soporte' : 'Resistencia'}</Badge>
      </td>
      <td>
        {/* One child: below 720 px the cell is a flex row that spreads its
            children apart, which split the slope from its own label. */}
        <span>
          {r.shape === 'horizontal'
            ? 'Horizontal'
            : r.shape === 'up'
              ? 'Tendencia ↗ ascendente'
              : 'Tendencia ↘ descendente'}
          {r.shape !== 'horizontal' && <span className="sub"> · {pct(r.slopePct, 3)} por vela</span>}
        </span>
      </td>
      <td className="num">{price(r.now)}</td>
      <td className="num">{lastPrice > 0 ? pct(r.now / lastPrice - 1) : '—'}</td>
      <td className="num">{r.touches}</td>
      <td className="sub">{dateTime(r.lastTime)}</td>
    </tr>
  )

  return (
    <Card
      title="Niveles en pantalla"
      subtitle={
        rows.length
          ? `${plural(rows.length, 'línea', 'líneas')}: ${above.length} por encima del precio y ${below.length} por debajo`
          : undefined
      }
      flush
      dimmed={dimmed}
    >
      {loading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Sin niveles con los filtros actuales"
          hint="Activa Horizontales o Tendencias, o prueba otra temporalidad."
        />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Forma</th>
                <th className="num">Precio ahora</th>
                <th className="num">Distancia</th>
                <th className="num">Toques</th>
                <th>Último toque</th>
              </tr>
            </thead>
            <tbody>
              {above.map(line)}
              <tr className="levels-price-row">
                <td>
                  <Badge variant="accent">Precio actual</Badge>
                </td>
                <td className="sub">Última vela cerrada</td>
                <td className="num">
                  <strong>{price(lastPrice)}</strong>
                </td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td className="sub">{dateTime(timeAt(lastBar))}</td>
              </tr>
              {below.map(line)}
            </tbody>
          </table>
        </TableWrap>
      )}
      <div className="prose levels-note">
        <p className="sub">
          <strong>Cómo se trazan.</strong> Un nivel horizontal agrupa giros del precio que cayeron a
          menos de 0,75 ATR unos de otros; cuantos más, más fuerte. Una línea de tendencia une dos
          mínimos (soporte) o dos máximos (resistencia) y sigue en pie mientras ninguna vela haya
          cerrado al otro lado. Todo se calcula sobre las velas visibles, así que cada temporalidad
          tiene sus propias líneas.
        </p>
        <p className="sub">
          <strong>Qué no son.</strong> Medido sobre años de datos, el precio &quot;respeta&quot; una
          línea puesta al azar a la misma distancia tantas veces como estas, en torno al 70 %. Sirven
          para leer la estructura del mercado —dónde giró, si hace mínimos crecientes o máximos
          decrecientes—, no para anticipar un rebote.
        </p>
      </div>
    </Card>
  )
}
