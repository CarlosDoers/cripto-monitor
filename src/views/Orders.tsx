import { useMemo, useState } from 'react'
import { useOpenOrders, useOrderHistory } from '../lib/queries'
import { dateTime, num, price, qty, signedUsd } from '../lib/format'
import { Badge, Card, DeltaValue, EmptyState, ErrorNotice, SearchInput, TableSkeleton, TableWrap } from '../components/ui'
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
    <Badge variant={side === 'sell' ? 'sell' : 'buy'}>
      {side === 'sell' ? 'Venta ▼' : 'Compra ▲'}
    </Badge>
  )
}

function OrderRows({ orders, showPnl }: { orders: Order[]; showPnl?: boolean }) {
  return (
    <tbody>
      {orders.map((o) => {
        const filled = num(o.accFillSz)
        const size = num(o.sz)
        const pnl = num(o.pnl)
        const stateKey = o.state
        const isFilled = stateKey === 'filled'
        const isLive = stateKey === 'live' || stateKey === 'partially_filled'

        return (
          <tr key={o.ordId}>
            <td>
              <span className="ccy">{o.instId}</span>
            </td>
            <td>
              <Side side={o.side} />
            </td>
            <td>
              <span className="badge badge--neutral">{ORDER_TYPE[o.ordType] ?? o.ordType}</span>
            </td>
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
              <Badge variant={isLive ? 'live' : isFilled ? 'buy' : 'neutral'}>
                {ORDER_STATE[o.state] ?? o.state}
              </Badge>
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
  const [searchOpen, setSearchOpen] = useState('')
  const [searchHistory, setSearchHistory] = useState('')
  const [stateFilter, setStateFilter] = useState<'all' | 'filled' | 'canceled'>('all')

  const open = useOpenOrders()
  const history = useOrderHistory(instType)

  const openList = useMemo(() => {
    const list = open.data ?? []
    if (!searchOpen.trim()) return list
    const q = searchOpen.toLowerCase().trim()
    return list.filter((o) => o.instId.toLowerCase().includes(q))
  }, [open.data, searchOpen])

  const historyList = useMemo(() => {
    let list = history.data ?? []
    if (searchHistory.trim()) {
      const q = searchHistory.toLowerCase().trim()
      list = list.filter((o) => o.instId.toLowerCase().includes(q))
    }
    if (stateFilter === 'filled') list = list.filter((o) => o.state === 'filled')
    if (stateFilter === 'canceled') list = list.filter((o) => o.state.includes('cancel'))
    return list
  }, [history.data, searchHistory, stateFilter])

  return (
    <>
      <Card
        title="Órdenes Abiertas Pendientes"
        subtitle={open.isLoading ? undefined : `${openList.length} órdenes en el libro de órdenes`}
        flush
        dimmed={open.isFetching && !open.isLoading}
        action={
          (open.data?.length ?? 0) > 4 ? (
            <SearchInput
              value={searchOpen}
              onChange={setSearchOpen}
              placeholder="Buscar por símbolo..."
              className="table-search"
            />
          ) : undefined
        }
      >
        {open.error ? (
          <div style={{ padding: '0 18px 18px' }}>
            <ErrorNotice title="No se pudieron cargar las órdenes" message={open.error.message} />
          </div>
        ) : open.isLoading ? (
          <TableSkeleton rows={3} cols={6} />
        ) : openList.length === 0 ? (
          <EmptyState
            title={searchOpen ? 'Sin órdenes con ese criterio' : 'Sin órdenes abiertas'}
            hint="Todas tus órdenes límite están ejecutadas o canceladas."
          />
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Instrumento</th>
                  <th>Lado</th>
                  <th>Tipo</th>
                  <th className="num">Precio Límite</th>
                  <th className="num">Tamaño</th>
                  <th className="num">Ejecutado</th>
                  <th className="num">Precio Medio</th>
                  <th>Estado</th>
                  <th className="num">Creada</th>
                </tr>
              </thead>
              <OrderRows orders={openList} />
            </table>
          </TableWrap>
        )}
      </Card>

      <Card
        title="Historial de Órdenes"
        subtitle="Registro de los últimos 3 meses archivados por OKX"
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
        <div className="table-controls-bar">
          <SearchInput
            value={searchHistory}
            onChange={setSearchHistory}
            placeholder="Buscar por activo..."
            className="table-search"
          />
          <div className="seg-control">
            <button
              type="button"
              aria-pressed={stateFilter === 'all'}
              onClick={() => setStateFilter('all')}
            >
              Todas
            </button>
            <button
              type="button"
              aria-pressed={stateFilter === 'filled'}
              onClick={() => setStateFilter('filled')}
            >
              Ejecutadas
            </button>
            <button
              type="button"
              aria-pressed={stateFilter === 'canceled'}
              onClick={() => setStateFilter('canceled')}
            >
              Canceladas
            </button>
          </div>
        </div>

        {history.error ? (
          <div style={{ padding: '0 18px 18px' }}>
            <ErrorNotice title="No se pudo cargar el historial" message={history.error.message} />
          </div>
        ) : history.isLoading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : historyList.length === 0 ? (
          <EmptyState title={`Sin órdenes de ${instType.toLowerCase()} con los filtros actuales`} />
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Instrumento</th>
                  <th>Lado</th>
                  <th>Tipo</th>
                  <th className="num">Precio</th>
                  <th className="num">Tamaño</th>
                  <th className="num">Ejecutado</th>
                  <th className="num">Precio Medio</th>
                  <th className="num">PnL</th>
                  <th>Estado</th>
                  <th className="num">Creada</th>
                </tr>
              </thead>
              <OrderRows orders={historyList} showPnl />
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  )
}

