import { useMemo } from 'react'
import { useEconomicCalendar } from '../lib/queries'
import { num } from '../lib/format'
import { Badge, Card, EmptyState, TableSkeleton, TableWrap } from '../components/ui'
import type { CalendarEvent } from '../lib/types'

/** Releases from these regions are the ones that move a dollar-quoted book. */
const MAJOR = new Set(['United States', 'Euro Area', 'China', 'Germany', 'United Kingdom', 'Japan'])

const when = (ms: number) =>
  new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms))

/**
 * Macro releases that have already landed, with what was expected next to what
 * came out.
 *
 * This card looks backwards on purpose, and not for lack of trying. OKX's
 * calendar serves the last few weeks with no cursor, and `before` jumps
 * straight to events months out — the near future, the part a "what's coming
 * this week" card would need, is simply not reachable. Rather than ship an
 * empty table, the card shows what the endpoint does deliver, which carries
 * `actual` and is therefore the more informative half anyway: a number that
 * came out far from forecast is a candidate explanation for a move that already
 * happened.
 *
 * Context, and only that. Six weeks of history is nowhere near enough to
 * measure whether any of it moves a price, so nothing here may be phrased as
 * signal — see the note under the table.
 */
export function EconomicCalendar() {
  const { data, isLoading, isFetching } = useEconomicCalendar('3')

  const released = useMemo(
    () =>
      (data ?? [])
        .filter((e) => MAJOR.has(e.region) && e.actual)
        .sort((a, b) => num(b.date) - num(a.date))
        .slice(0, 8),
    [data],
  )

  return (
    <Card
      title="Datos Macro Recientes"
      subtitle="Publicaciones de alta importancia ya conocidas"
      flush
      dimmed={isFetching && !isLoading}
      action={<Badge variant="neutral">contexto, no señal</Badge>}
    >
      {isLoading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : released.length === 0 ? (
        <EmptyState
          title="Sin publicaciones recientes de alta importancia"
          hint="Solo se listan las de importancia 3 en las regiones que mueven un libro cotizado en dólares."
        />
      ) : (
        <>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Región</th>
                  <th className="num">Real</th>
                  <th className="num">Previsto</th>
                  <th className="num">Anterior</th>
                  <th className="num">Cuándo</th>
                </tr>
              </thead>
              <tbody>
                {released.map((e: CalendarEvent) => (
                  <tr key={e.calendarId}>
                    <td>
                      <strong>{e.event}</strong>
                    </td>
                    <td className="sub">{e.region}</td>
                    <td className="num">
                      <strong>{e.actual}</strong>
                    </td>
                    <td className="num">{e.forecast || '—'}</td>
                    <td className="num sub">{e.previous || '—'}</td>
                    <td className="num sub">{when(num(e.date))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="sub" style={{ padding: '10px 16px 14px' }}>
            Real frente a previsto sin restar: las unidades vienen como texto («€21.3B», «28.2 %»)
            y compararlas a ojo es más fiable que inventar un parseo. Mira hacia atrás porque la
            fuente no sirve el futuro cercano — sin cursor da las últimas semanas y con cursor salta
            a meses vista. Está aquí para que puedas explicarte un movimiento, no porque se haya
            medido que estas publicaciones muevan nada: seis semanas de histórico no dan para
            comprobarlo.
          </p>
        </>
      )}
    </Card>
  )
}
