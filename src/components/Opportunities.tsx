import { EVIDENCE, useOpportunities, type Opportunity, type Watch } from '../lib/opportunities'
import { plural, price, ratio, share } from '../lib/format'
import { routeHref } from '../lib/router'
import { HELP } from '../lib/glossary'
import { useState } from 'react'
import { Badge, Card, Help, Skeleton } from './ui'
import { NARROW, useMediaQuery } from '../lib/useMediaQuery'

const signedRatio = (x: number) => `${x >= 0 ? '+' : '−'}${ratio(Math.abs(x))}`

const ago = (days: number) =>
  days === 0 ? 'en la última vela' : days === 1 ? 'hace 1 día' : `hace ${days} días`

/**
 * Stop on the left, target on the right, whatever the side: left is where it
 * goes wrong, right is where it pays. The entry and today's price sit between,
 * placed by percentage like `PositionRisk`, so how much of the way is already
 * travelled reads at a glance.
 */
function Track({ o }: { o: Opportunity }) {
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - o.stop) / (o.target - o.stop)) * 100))}%`
  return (
    <div className="opp-track" aria-hidden="true">
      <span className="opp-track-line" />
      <span className="opp-mark opp-mark--entry" style={{ left: at(o.entry) }} title="Entrada" />
      <span className="opp-mark opp-mark--price" style={{ left: at(o.price) }} title="Precio ahora" />
    </div>
  )
}

/**
 * One live signal. On a phone it starts folded to its headline — coin, side
 * and the reward-to-risk left — because three full tiles stacked took most of
 * a screen before the open positions; a tap opens the rest.
 */
function Tile({ o, rank, foldable }: { o: Opportunity; rank: number; foldable: boolean }) {
  const long = o.side === 'long'
  const [open, setOpen] = useState(false)
  const head = (
    <>
      <span className="opp-rank">{rank}</span>
      <span className="opp-symbol">{o.symbol}</span>
      <Badge variant={long ? 'buy' : 'sell'}>{long ? 'Largo' : 'Corto'}</Badge>
      {o.held && <Badge variant="neutral">ya abierta</Badge>}
    </>
  )
  if (foldable && !open) {
    return (
      <article className="opp opp--folded">
        <button type="button" className="opp-fold" aria-expanded={false} onClick={() => setOpen(true)}>
          <span className="opp-head">{head}</span>
          <span className="opp-fold-ratio">1:{ratio(o.remaining)}</span>
          <span className="opp-fold-chevron" aria-hidden="true">›</span>
        </button>
      </article>
    )
  }
  return (
    <article className="opp">
      {foldable ? (
        <button type="button" className="opp-fold" aria-expanded onClick={() => setOpen(false)}>
          <span className="opp-head">{head}</span>
          <span className="opp-fold-chevron is-open" aria-hidden="true">›</span>
        </button>
      ) : (
        <header className="opp-head">{head}</header>
      )}

      <div className="opp-figure">
        <span className="opp-ratio">1:{ratio(o.remaining)}</span>
        <span className="opp-caption">recompensa por riesgo que queda</span>
      </div>

      <Track o={o} />
      <div className="opp-ends">
        <span>
          Stop <strong>{price(o.stop)}</strong> <span className="delta--down">−{share(o.toStop, 1)}</span>
        </span>
        <span>
          Objetivo <strong>{price(o.target)}</strong> <span className="delta--up">+{share(o.toTarget, 1)}</span>
        </span>
      </div>

      <p className="opp-meta">
        <span className="opp-key opp-key--entry" aria-hidden="true" /> entrada {price(o.entry)}, {ago(o.age)} · al
        entrar era 1:{ratio(o.entryRatio)}
        <br />
        <span className="opp-key opp-key--price" aria-hidden="true" /> ahora {price(o.price)}
      </p>
      <a className="card-link" href={routeHref('estrategias', { inst: o.instId })}>
        Ver en Estrategias →
      </a>
    </article>
  )
}

/** What may fire next: contracts outside their band, where a close back in is a signal. */
function WatchTile({ watching, span }: { watching: Watch[]; span: number }) {
  return (
    <article className="opp opp--watch" style={{ gridColumn: `span ${span}` }}>
      <header className="opp-head">
        <span className="metric-label">A vigilar</span>
      </header>
      <p className="opp-meta">
        {plural(watching.length, 'contrato cerró', 'contratos cerraron')} fuera de su banda. Si la próxima vela
        diaria cierra de vuelta dentro, salta la señal, y entonces aparecerán arriba.
      </p>
      <ul className="opp-watch">
        {watching.slice(0, 8).map((x) => (
          <li key={x.instId}>
            <a className="card-link" href={routeHref('estrategias', { inst: x.instId })}>
              {x.symbol}
            </a>
            <Badge variant={x.side === 'long' ? 'buy' : 'sell'}>{x.side === 'long' ? 'Largo' : 'Corto'}</Badge>
          </li>
        ))}
      </ul>
    </article>
  )
}

/**
 * The Resumen's call to action: where the strongest measured strategy has a
 * live signal right now, best room first. See `opportunities.ts` for why the
 * order is what it is and which numbers back it.
 */
export function Opportunities() {
  const o = useOpportunities()
  const narrow = useMediaQuery(NARROW)
  const scanning = o.scanned < o.total

  return (
    <Card
      title="Oportunidades ahora"
      subtitle={
        o.isLoading
          ? 'Revisando los X-Perp de cripto más líquidos…'
          : `Señales vivas de la Reversión diaria · ${o.scanned} de ${o.total} X-Perp de cripto con más de 1 M$ al día${scanning ? ' (revisando)' : ''}`
      }
      action={<Help label="Cómo se eligen">{HELP.opportunities}</Help>}
      className="opps-card"
    >
      {o.isLoading ? (
        <Skeleton height={190} />
      ) : o.top.length === 0 ? (
        <p className="opp-empty">
          Ninguna señal viva de la Reversión en los {o.scanned} contratos revisados
          {o.maxAge ? ` (se cuentan las de los últimos ${o.maxAge} días que no han tocado stop ni objetivo)` : ''}.
          Es lo normal: la Reversión dispara pocas veces, y es mejor no operar que forzar una señal.
        </p>
      ) : (
        <div className="opps">
          {o.top.map((x, i) => (
            <Tile key={x.instId} o={x} rank={i + 1} foldable={narrow} />
          ))}
          {/* Fewer than three live: the rest of the row goes to what may fire
              next, rather than to empty space. */}
          {o.top.length < 3 && o.watching.length > 0 && (
            <WatchTile watching={o.watching} span={3 - o.top.length} />
          )}
        </div>
      )}

      {!o.isLoading && (o.others.length > 0 || (o.watching.length > 0 && (o.top.length === 0 || o.top.length === 3))) && (
        <ul className="opp-more">
          {o.others.length > 0 && (
            <li>
              <span className="metric-label">También vivas</span>{' '}
              {o.others.map((x, i) => (
                <span key={x.instId}>
                  {i > 0 && ', '}
                  <a className="card-link" href={routeHref('estrategias', { inst: x.instId })}>
                    {x.symbol}
                  </a>{' '}
                  <span className="sub">
                    ({x.side === 'long' ? 'largo' : 'corto'}, 1:{ratio(x.remaining)})
                  </span>
                </span>
              ))}
            </li>
          )}
          {o.watching.length > 0 && (o.top.length === 0 || o.top.length === 3) && (
            <li>
              <span className="metric-label">A vigilar</span>{' '}
              {o.watching.slice(0, 6).map((x, i) => (
                <span key={x.instId}>
                  {i > 0 && ', '}
                  <a className="card-link" href={routeHref('estrategias', { inst: x.instId })}>
                    {x.symbol}
                  </a>{' '}
                  <span className="sub">({x.side === 'long' ? 'largo' : 'corto'})</span>
                </span>
              ))}
              <span className="sub">
                {' '}
                · {plural(o.watching.length, 'contrato fuera de su banda', 'contratos fuera de su banda')}: si la
                próxima vela diaria cierra dentro, salta la señal
              </span>
            </li>
          )}
        </ul>
      )}

      <p className="opp-note">
        Medida en BTC, ETH y SOL: {signedRatio(EVIDENCE.expectancy)} R por señal, y entrar hasta {EVIDENCE.maxAge}{' '}
        días tarde sigue dando al menos {signedRatio(EVIDENCE.lateFloor)} R mientras el precio no toque stop ni
        objetivo. En otras monedas es la misma regla, no la misma
        evidencia. Es la regla aplicada hoy, no un consejo: el tamaño de la posición lo decides tú.
      </p>
    </Card>
  )
}
