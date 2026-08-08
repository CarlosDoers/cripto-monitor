import { useState } from 'react'
import { useOpenOrders, useOrderHistory } from '../lib/queries'
import { dateTime, num, price, qty, signedUsd } from '../lib/format'
import { Badge, Card, DeltaValue, EmptyState, ErrorNotice, TableSkeleton } from '../components/ui'
import type { Order } from '../lib/types'

const INST_TYPES = [
  { key: 'SPOT', label: 'Spot' },
  { key: 'SWAP', label: 'Perpetuos' },
  { key: 'FUTURES', label: 'Futuros' },
  { key: 'MARGIN', label: 'Margen' },
] as const

const ORDER_STATE: Record<string, string> = {
  live: 'Activa',
  partially_filled: 'Parcial',
  filled: 'Ejecutada',
  canceled: 'Cancelada',
  mmp_canceled: 'Cancelada',
}

const ORDER_TYPE: Record<string, string> = {
  market: 'Mercado',
  limit: 'Límite',
  post_only: 'Post only',
  fok: 'FOK',
  ioc: 'IOC',
  optimal_limit_ioc: 'IOC óptima',
}

function Side({ side }: { side: string }) {
  return (
    <Badge variant={side === 'sell' ? 'sell' : 'buy'}>{side === 'sell' ? 'Venta' : 'Compra'}</Badge>
  )
}

function OrderRows({ orders, showPnl }: { orders: Order[]; showPnl?: boolean }) {
  return (
    <tbody>
      {orders.map((o) => {
        const filled = num(o.accFillSz)
        const size = num(o.sz)
        const pnl = num(o.pnl)
        return (
          <tr key={o.ordId}>
            <td>
              <span className="ccy">{o.instId}</span>
            </td>
            <td>
              <Side side={o.side} />
            </td>
            <td>{ORDER_TYPE[o.ordType] ?? o.ordType}</td>
            <td className="num">{num(o.px) > 0 ? price(num(o.px)) : 'Mercado'}</td>
            <td className="num">{qty(size)}</td>
            <td className="num">
              {qty(filled)}
              {size > 0 && filled > 0 && filled < size && (
                <span className="sub"> ({Math.round((filled / size) * 100)} %)</span>
              )}
            </td>
            <td className="num">{num(o.avgPx) > 0 ? price(num(o.avgPx)) : '—'}</td>
            {showPnl && (
              <td className="num">
                {pnl !== 0 ? (
                  <DeltaValue value={pnl}>{signedUsd(pnl)}</DeltaValue>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            )}
            <td>
              <Badge>{ORDER_STATE[o.state] ?? o.state}</Badge>
            </td>
            <td className="num sub">{dateTime(o.cTime)}</td>
          </tr>
        )
      })}
    </tbody>
  )
}

export function Orders() {
  const [instType, setInstType] = useState<string>('SPOT')
  const open = useOpenOrders()
  const history = useOrderHistory(instType)

  return (
    <>
      <Card
        title="Órdenes abiertas"
        subtitle={open.isLoading ? undefined : `${open.data?.length ?? 0} pendientes`}
        flush
        dimmed={open.isFetching && !open.isLoading}
      >
        {open.error ? (
          <div style={{ padding: '0 18px 18px' }}>
            <ErrorNotice title="No se pudieron cargar las órdenes" message={open.error.message} />
          </div>
        ) : open.isLoading ? (
          <TableSkeleton rows={3} cols={6} />
        ) : (open.data?.length ?? 0) === 0 ? (
          <EmptyState title="Sin órdenes abiertas" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Instrumento</th>
                  <th>Lado</th>
                  <th>Tipo</th>
                  <th className="num">Precio</th>
                  <th className="num">Tamaño</th>
                  <th className="num">Ejecutado</th>
                  <th className="num">Precio medio</th>
                  <th>Estado</th>
                  <th className="num">Creada</th>
                </tr>
              </thead>
              <OrderRows orders={open.data ?? []} />
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Historial de órdenes"
        subtitle="Últimos 3 meses"
        flush
        dimmed={history.isFetching && !history.isLoading}
        action={
          <div className="seg-control">
            {INST_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={instType === t.key}
                onClick={() => setInstType(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      >
        {history.error ? (
          <div style={{ padding: '0 18px 18px' }}>
            <ErrorNotice title="No se pudo cargar el historial" message={history.error.message} />
          </div>
        ) : history.isLoading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : (history.data?.length ?? 0) === 0 ? (
          <EmptyState title={`Sin órdenes de ${instType.toLowerCase()}`} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Instrumento</th>
                  <th>Lado</th>
                  <th>Tipo</th>
                  <th className="num">Precio</th>
                  <th className="num">Tamaño</th>
                  <th className="num">Ejecutado</th>
                  <th className="num">Precio medio</th>
                  <th className="num">PnL</th>
                  <th>Estado</th>
                  <th className="num">Creada</th>
                </tr>
              </thead>
              <OrderRows orders={history.data ?? []} showPnl />
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
