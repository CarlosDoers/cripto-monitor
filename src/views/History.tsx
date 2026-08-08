import { useState } from 'react'
import { useBills, useFills } from '../lib/queries'
import { colorOf } from '../lib/colors'
import { dateTime, num, price, qty, signedUsd, usd } from '../lib/format'
import { Badge, Card, DeltaValue, EmptyState, ErrorNotice, TableSkeleton } from '../components/ui'

const INST_TYPES = [
  { key: 'SPOT', label: 'Spot' },
  { key: 'SWAP', label: 'Perpetuos' },
  { key: 'FUTURES', label: 'Futuros' },
  { key: 'MARGIN', label: 'Margen' },
] as const

/** OKX bill type codes, as documented for /api/v5/account/bills. */
const BILL_TYPE: Record<string, string> = {
  '1': 'Transferencia',
  '2': 'Operación',
  '3': 'Entrega',
  '4': 'Reembolso forzoso',
  '5': 'Liquidación',
  '6': 'Transferencia de margen',
  '7': 'Intereses',
  '8': 'Financiación',
  '9': 'ADL',
  '10': 'Clawback',
  '11': 'Conversión de sistema',
  '12': 'Transferencia de estrategia',
  '13': 'DDH',
  '14': 'Block trade',
  '22': 'Devolución de préstamo',
}

function Fills({ instType }: { instType: string }) {
  const { data, isLoading, isFetching, error } = useFills(instType)
  const fills = data ?? []

  if (error) {
    return (
      <div style={{ padding: '0 18px 18px' }}>
        <ErrorNotice title="No se pudieron cargar las ejecuciones" message={error.message} />
      </div>
    )
  }
  if (isLoading) return <TableSkeleton rows={6} cols={6} />
  if (fills.length === 0) {
    return <EmptyState title={`Sin ejecuciones de ${instType.toLowerCase()}`} hint="Últimos 3 meses." />
  }

  return (
    <div className={`table-wrap${isFetching ? ' is-refetching' : ''}`}>
      <table className="data">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Instrumento</th>
            <th>Lado</th>
            <th className="num">Precio</th>
            <th className="num">Cantidad</th>
            <th className="num">Total</th>
            <th className="num">Comisión</th>
            <th className="num">PnL</th>
          </tr>
        </thead>
        <tbody>
          {fills.map((f) => {
            const fillPx = num(f.fillPx)
            const fillSz = num(f.fillSz)
            const fee = num(f.fee)
            const pnl = num(f.fillPnl)
            return (
              <tr key={`${f.tradeId}-${f.ordId}`}>
                <td className="sub">{dateTime(f.ts)}</td>
                <td>
                  <span className="ccy">{f.instId}</span>
                </td>
                <td>
                  <Badge variant={f.side === 'sell' ? 'sell' : 'buy'}>
                    {f.side === 'sell' ? 'Venta' : 'Compra'}
                  </Badge>
                </td>
                <td className="num">{price(fillPx)}</td>
                <td className="num">{qty(fillSz)}</td>
                <td className="num">{usd(fillPx * fillSz)}</td>
                <td className="num">
                  {fee !== 0 ? (
                    <>
                      {qty(Math.abs(fee))} <span className="sub">{f.feeCcy}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="num">
                  {pnl !== 0 ? (
                    <DeltaValue value={pnl}>{signedUsd(pnl)}</DeltaValue>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Movements() {
  const { data, isLoading, isFetching, error } = useBills()
  const bills = data ?? []

  if (error) {
    return (
      <div style={{ padding: '0 18px 18px' }}>
        <ErrorNotice title="No se pudieron cargar los movimientos" message={error.message} />
      </div>
    )
  }
  if (isLoading) return <TableSkeleton rows={6} cols={5} />
  if (bills.length === 0) return <EmptyState title="Sin movimientos recientes" />

  return (
    <div className={`table-wrap${isFetching ? ' is-refetching' : ''}`}>
      <table className="data">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Activo</th>
            <th>Instrumento</th>
            <th className="num">Variación</th>
            <th className="num">Saldo</th>
            <th className="num">PnL</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => {
            const change = num(b.balChg)
            const pnl = num(b.pnl)
            return (
              <tr key={b.billId}>
                <td className="sub">{dateTime(b.ts)}</td>
                <td>
                  <Badge>{BILL_TYPE[b.type] ?? `Tipo ${b.type}`}</Badge>
                </td>
                <td>
                  <span className="ccy">
                    <span className="ccy-dot" style={{ background: colorOf(b.ccy) }} />
                    {b.ccy}
                  </span>
                </td>
                <td className="sub">{b.instId || '—'}</td>
                <td className="num">
                  <DeltaValue value={change}>
                    {change > 0 ? '+' : change < 0 ? '−' : ''}
                    {qty(Math.abs(change))}
                  </DeltaValue>
                </td>
                <td className="num">{qty(num(b.bal))}</td>
                <td className="num">
                  {pnl !== 0 ? (
                    <DeltaValue value={pnl}>{signedUsd(pnl)}</DeltaValue>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function History() {
  const [instType, setInstType] = useState<string>('SPOT')

  return (
    <>
      <Card
        title="Ejecuciones"
        subtitle="Operaciones completadas en los últimos 3 meses"
        flush
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
        <Fills instType={instType} />
      </Card>

      <Card title="Movimientos de la cuenta" subtitle="Transferencias, comisiones e intereses" flush>
        <Movements />
      </Card>
    </>
  )
}
