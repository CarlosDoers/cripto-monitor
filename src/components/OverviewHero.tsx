import { HELP } from '../lib/glossary'
import { share, shownAmount, signedUsd, signedUsdOrEur, usd, usdCompact, usdOrEur } from '../lib/format'
import type { Trade } from '../lib/performance'
import { useFlash } from '../lib/useFlash'
import { NARROW, useMediaQuery } from '../lib/useMediaQuery'
import { PnlCurve } from './PnlCurve'
import { SplitBar } from './MiniCharts'
import { Badge, DeltaValue, Help, Skeleton } from './ui'

/**
 * The Resumen's lead: what the account is worth, how much of that it made,
 * and the closed result over its whole life.
 *
 * Every figure here is the real one. The curve is the cumulative closed
 * result, not the net worth — OKX keeps no history of the net worth, and a
 * curve drawn behind that number would be read as one. It sits beside it with
 * its own label instead.
 */
export function OverviewHero({
  loading,
  netWorth,
  composition,
  contributed,
  contributedEur,
  result,
  resultEur,
  partial,
  noFlows,
  curve,
  trades,
  curveLoading,
}: {
  loading: boolean
  netWorth: number
  composition: { trading: number; funding: number; earn: number }
  contributed: number
  contributedEur: number
  result: number
  resultEur: number
  partial: boolean
  noFlows: boolean
  curve: { t: number; value: number }[]
  trades: Trade[]
  curveLoading: boolean
}) {
  const flash = useFlash(loading ? undefined : netWorth)
  // Shorter on a phone, where the Resumen already runs to three screens.
  const curveHeight = useMediaQuery(NARROW) ? 110 : 140
  const closed = curve.at(-1)?.value ?? 0
  const since = trades[0]
    ? new Date(trades[0].closedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
    : null
  const gained = result >= 0

  return (
    <section className="hero" aria-label="Patrimonio y resultado">
      <div className="hero-main">
        <p className="hero-label">
          Patrimonio total
          <Help label="Patrimonio total">{HELP.netWorth}</Help>
          <span className="hero-live" aria-hidden="true" />
        </p>
        {loading ? (
          <Skeleton height={48} width="70%" />
        ) : (
          <p key={flash.key} className={`hero-value${flash.dir ? ` is-flash-${flash.dir}` : ''}`}>
            {usd(netWorth)}
          </p>
        )}
        <p className="hero-sub">
          Trading {usdCompact(composition.trading)} · Fondos {usdCompact(composition.funding)}
          {composition.earn > 0 ? ` · Earn ${usdCompact(composition.earn)}` : ''}
        </p>

        {!noFlows && !loading && (
          <div className="hero-split">
            <SplitBar
              label={
                gained
                  ? `Del patrimonio, ${usd(contributed)} aportado y ${usd(result)} ganado`
                  : `De lo aportado, ${usd(netWorth)} queda y ${usd(-result)} perdido`
              }
              parts={
                gained
                  ? [
                      { key: 'Aportado', value: contributed, tone: 'base' },
                      { key: 'Ganado', value: result, tone: 'up' },
                    ]
                  : [
                      { key: 'Queda', value: netWorth, tone: 'base' },
                      { key: 'Perdido', value: -result, tone: 'down' },
                    ]
              }
            />
            <p className="hero-split-legend">
              <span>
                <span className="split-key is-base" aria-hidden="true" />
                {gained ? 'Aportado' : 'Queda'}{' '}
                <strong>{gained ? usdOrEur(contributed, contributedEur) : usd(netWorth)}</strong>
              </span>
              <span>
                <span className={`split-key ${gained ? 'is-up' : 'is-down'}`} aria-hidden="true" />
                {gained ? 'Ganado' : 'Perdido'}{' '}
                <strong>
                  <DeltaValue value={shownAmount(result, resultEur)}>{signedUsdOrEur(result, resultEur)}</DeltaValue>
                </strong>
                {gained && netWorth > 0 && <span className="sub"> · {share(result / netWorth, 0)} del patrimonio</span>}
                <Help label="Resultado total">{HELP.totalResult}</Help>
              </span>
              {partial && <Badge variant="warn">parcial</Badge>}
            </p>
          </div>
        )}
      </div>

      <div className="hero-curve">
        <p className="hero-label">
          Resultado cerrado{since ? ` desde el ${since}` : ''}
          <Help label="Resultado cerrado">{HELP.tradingResult}</Help>
          {!curveLoading && curve.length > 0 && (
            <span className={`hero-curve-total ${closed >= 0 ? 'delta--up' : 'delta--down'}`}>
              {signedUsd(closed)}
            </span>
          )}
        </p>
        {curveLoading ? (
          <Skeleton height={curveHeight} />
        ) : (
          <PnlCurve points={curve} trades={trades} height={curveHeight} />
        )}
      </div>
    </section>
  )
}
