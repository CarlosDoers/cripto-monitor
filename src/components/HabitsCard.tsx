import { useMemo } from 'react'
import { analyseHabits, habitLines, type HabitGroup } from '../lib/habits'
import { plural, share } from '../lib/format'
import { Card, Help } from './ui'
import { DivergingBars, type DivergingRow } from './PerfCharts'

const row = (key: string, label: string, g: HabitGroup): DivergingRow => ({
  key,
  label,
  value: g.pnl,
  meta: g.reliable ? `${plural(g.trades, 'op', 'ops')} · ${share(g.winRate, 0)}` : `${plural(g.trades, 'op', 'ops')} · muestra corta`,
  thin: !g.reliable,
})

/**
 * How the account trades, from its own closed trades: how long losers are held against winners, what follows a loss, what
 * follows two, and the result at each leverage. Descriptive, from the period chosen above and with no extra request: one
 * account and a few dozen trades say little, so every group shows its size and the short ones are faded and not read.
 */
export function HabitsCard({ trades, dimmed }: { trades: Parameters<typeof analyseHabits>[0]; dimmed?: boolean }) {
  const habits = useMemo(() => analyseHabits(trades), [trades])
  const lines = habitLines(habits)
  if (!habits.quickAfterLoss && habits.byLeverage.length === 0) return null
  const text = (key: string) => lines.find((l) => l.key === key)?.text

  return (
    <Card
      title="Cómo operas"
      subtitle="Tus hábitos según tus operaciones cerradas del periodo · descriptivo: con pocas operaciones no se lee"
      action={
        <Help label="Cómo operas">
          <p>
            Cuatro lecturas de tus propias operaciones cerradas: cuánto mantienes las perdedoras frente a las ganadoras, qué pasa en
            la hora siguiente a una pérdida, qué pasa tras dos pérdidas seguidas y qué resultado das con cada apalancamiento.
          </p>
          <p>
            No dice qué hacer. Es una sola cuenta y, con unas decenas de operaciones, una diferencia puede ser casualidad: por eso
            cada grupo enseña cuántas operaciones tiene y los de menos de cinco se muestran atenuados y sin porcentaje. Sirve para
            que una sospecha («abro demasiado rápido tras perder») se pueda mirar con números.
          </p>
        </Help>
      }
      dimmed={dimmed}
    >
      <div className="habits">
        {text('holding') && <p className="habit-line">{text('holding')}</p>}

        {habits.quickAfterLoss && (
          <div className="habit-block">
            <p className="metric-label">Tras una pérdida (menos de una hora después)</p>
            <DivergingBars
              rows={[
                row('quick', 'Abierta enseguida tras perder', habits.quickAfterLoss.quick),
                row('rest', 'El resto de operaciones', habits.quickAfterLoss.rest),
              ].filter((r) => (r.key === 'rest' ? true : habits.quickAfterLoss!.quick.trades > 0))}
            />
            {text('quick') && <p className="habit-line">{text('quick')}</p>}
          </div>
        )}

        {habits.afterTwoLosses && (
          <div className="habit-block">
            <p className="metric-label">Tras dos pérdidas seguidas</p>
            <DivergingBars
              rows={[
                row('after', 'Abierta tras dos pérdidas', habits.afterTwoLosses.after),
                row('rest', 'El resto de operaciones', habits.afterTwoLosses.rest),
              ].filter((r) => (r.key === 'rest' ? true : habits.afterTwoLosses!.after.trades > 0))}
            />
            {text('two') && <p className="habit-line">{text('two')}</p>}
          </div>
        )}

        {habits.byLeverage.length > 0 && (
          <div className="habit-block">
            <p className="metric-label">Según el apalancamiento con que abriste</p>
            <DivergingBars rows={habits.byLeverage.map((b) => row(b.key, b.label, b.group))} />
          </div>
        )}
      </div>
    </Card>
  )
}
