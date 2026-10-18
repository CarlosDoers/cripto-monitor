import { useMemo, useState } from 'react'
import { plural, share } from '../lib/format'
import type { Trade } from '../lib/performance'
import { useCandleBoard } from '../lib/queries'
import { toCandles } from '../lib/signals'
import { alignWithRule, type Stance } from '../lib/mySignals'
import { MIN_SAMPLE } from '../lib/performance'
import { Card, Help } from './ui'
import { DivergingBars, type DivergingRow } from './PerfCharts'

/** Contracts compared at most: each costs five paced requests of 4 h candles. */
const MAX_CONTRACTS = 12

const LABEL: Record<Stance, string> = {
  with: 'La regla tenía posición en tu mismo sentido',
  against: 'La regla tenía posición en sentido contrario',
  none: 'La regla no tenía posición',
}

/**
 * Where the trades of the period stood against the lead trend rule (Ruptura + EMA 200 en 4 h) run on the same contract: with
 * it, against it or with nothing open. On demand — it reads about five pages of candles per contract — and descriptive: the
 * rule is not the account's strategy and most of its trades are shorter than a 4 h trend, so most are not expected to match.
 */
export function SignalAlignment({ trades, dimmed }: { trades: Trade[]; dimmed?: boolean }) {
  const [ids, setIds] = useState<string[] | null>(null)
  const board = useCandleBoard(ids ?? [], '4H', 5)

  const contracts = useMemo(() => {
    const count = new Map<string, number>()
    for (const t of trades) count.set(t.instId, (count.get(t.instId) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  }, [trades])
  const chosen = contracts.slice(0, MAX_CONTRACTS)

  const loaded = ids ? board.loaded : 0
  const done = ids !== null && loaded >= ids.length
  const alignment = useMemo(() => {
    if (!done) return null
    const candles = Object.fromEntries(Object.entries(board.byInst).map(([id, rows]) => [id, toCandles(rows)]))
    return alignWithRule(trades, candles)
  }, [done, board.byInst, trades])

  const rows = (a: NonNullable<typeof alignment>): DivergingRow[] =>
    (['with', 'against', 'none'] as Stance[])
      .filter((s) => a.groups[s].trades > 0)
      .map((s) => {
        const g = a.groups[s]
        return {
          key: s,
          label: LABEL[s],
          value: g.pnl,
          meta: g.reliable ? `${plural(g.trades, 'op', 'ops')} · ${share(g.winRate, 0)}` : `${plural(g.trades, 'op', 'ops')} · muestra corta`,
          thin: g.trades < MIN_SAMPLE,
        }
      })

  return (
    <Card
      title="Tus operaciones frente a la regla de tendencia"
      subtitle="Si la Ruptura + EMA 200 de 4 h tenía una posición abierta en el contrato cuando abriste · bajo demanda"
      action={
        <Help label="Frente a la regla">
          <p>
            Para cada operación del periodo, la app corre la regla de la Ruptura + EMA 200 en 4 h sobre el mismo contrato y mira si,
            en el momento en que abriste, tenía una posición abierta en tu mismo sentido, en el contrario o ninguna.
          </p>
          <p>
            No es tu estrategia ni un reproche: la mayoría de tus operaciones duran menos que una tendencia de 4 h y no se espera
            que coincidan. Sirve para ver cuántas ibas a favor de la regla, cuántas en contra, y si el resultado de unas y otras
            difiere. Con pocas operaciones en un grupo, la diferencia es casualidad: los grupos de menos de cinco se muestran
            atenuados. Mira como mucho {MAX_CONTRACTS} contratos (los que más operaste) y lee unas cinco páginas de velas por
            cada uno.
          </p>
        </Help>
      }
      dimmed={dimmed}
    >
      <div className="habits">
        {!ids && (
          <>
            <p className="habit-line">
              {chosen.length === 0
                ? 'No hay operaciones en el periodo.'
                : `Compara tus ${plural(trades.length, 'operación', 'operaciones')} con la regla en ${plural(chosen.length, 'contrato', 'contratos')} (los que más operaste). Lee unas ${chosen.length * 5} páginas de velas, con calma, y no se repite durante diez minutos.`}
            </p>
            <div className="table-controls-bar">
              <button type="button" className="btn btn--primary" disabled={chosen.length === 0} onClick={() => setIds(chosen)}>
                Comparar con la regla
              </button>
            </div>
          </>
        )}
        {ids && !alignment && <p className="habit-line">Leyendo velas: {loaded} de {ids.length} contratos…</p>}
        {alignment && (
          <>
            {alignment.placed === 0 ? (
              <p className="habit-line">
                Ninguna de las operaciones se pudo colocar: faltan velas de 4 h de su contrato anteriores a la operación (la regla necesita
                unas 620 para asentar su EMA 200).
              </p>
            ) : (
              <>
                <DivergingBars rows={rows(alignment)} />
                <p className="habit-line">
                  Se colocaron {plural(alignment.placed, 'operación', 'operaciones')} en {plural(alignment.contracts, 'contrato', 'contratos')}
                  {alignment.unplaced > 0 ? `; ${plural(alignment.unplaced, 'queda fuera', 'quedan fuera')} por falta de velas o por ser anteriores a que la regla pudiera señalar` : ''}.{' '}
                  {alignment.groups.with.trades + alignment.groups.against.trades === 0
                    ? 'En ninguna la regla tenía una posición abierta.'
                    : `En ${alignment.groups.with.trades} ibas con su posición y en ${alignment.groups.against.trades} contra ella.`}
                </p>
              </>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
