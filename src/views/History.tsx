import { useMemo, useState } from 'react'
import { useBills, useFills, useTransfers } from '../lib/queries'
import { colorOf } from '../lib/colors'
import { dateTime, num, price, qty, signedUsd, usd } from '../lib/format'
import { Badge, Card, DeltaValue, EmptyState, ErrorNotice, SearchInput, TableSkeleton, TableWrap } from '../components/ui'

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
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const fills = data ?? []
    if (!search.trim()) return fills
    const q = search.toLowerCase().trim()
    return fills.filter((f) => f.instId.toLowerCase().includes(q))
  }, [data, search])

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
    <>
      <div className="table-controls-bar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por activo (ej. BTC-USDT)..."
          className="table-search"
        />
      </div>

      <TableWrap className={isFetching ? 'is-refetching' : ''}>
        <table className="data">
          <thead>
            <tr>
              <th>Fecha y Hora</th>
              <th>Instrumento</th>
              <th>Lado</th>
              <th className="num">Precio Ejecución</th>
              <th className="num">Cantidad</th>
              <th className="num">Volumen Total</th>
              <th className="num">Comisión</th>
              <th className="num">PnL Realizado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => {
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
                      {f.side === 'sell' ? 'Venta ▼' : 'Compra ▲'}
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

        {filtered.length === 0 && (
          <EmptyState title="Sin ejecuciones con ese criterio de búsqueda" />
        )}
      </TableWrap>
    </>
  )
}

function Movements() {
  const { data, isLoading, isFetching, error } = useBills()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const bills = data ?? []
    if (!search.trim()) return bills
    const q = search.toLowerCase().trim()
    return bills.filter((b) => b.ccy.toLowerCase().includes(q) || b.instId?.toLowerCase().includes(q))
  }, [data, search])

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
    <>
      <div className="table-controls-bar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por moneda o activo (ej. USDT, BTC)..."
          className="table-search"
        />
      </div>

      <TableWrap className={isFetching ? 'is-refetching' : ''}>
        <table className="data">
          <thead>
            <tr>
              <th>Fecha y Hora</th>
              <th>Tipo Movimiento</th>
              <th>Activo</th>
              <th>Instrumento</th>
              <th className="num">Variación</th>
              <th className="num">Saldo Resultante</th>
              <th className="num">PnL</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((b) => {
              const change = num(b.balChg)
              const pnl = num(b.pnl)
              return (
                <tr key={b.billId}>
                  <td className="sub">{dateTime(b.ts)}</td>
                  <td>
                    <Badge variant="neutral">{BILL_TYPE[b.type] ?? `Tipo ${b.type}`}</Badge>
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

        {filtered.length === 0 && (
          <EmptyState title="Sin movimientos con ese criterio" />
        )}
      </TableWrap>
    </>
  )
}

/**
 * Money in and out of the account.
 *
 * Without this the portfolio total answers the wrong question: a balance that
 * grew because of a deposit reads exactly like one that grew from trading, and
 * nothing else in the app separates them.
 */
function Transfers() {
  const { data, isLoading, isFetching, error } = useTransfers()

  const rows = useMemo(() => {
    const deposits = (data?.deposits ?? []).map((t) => ({ ...t, kind: 'in' as const }))
    const withdrawals = (data?.withdrawals ?? []).map((t) => ({ ...t, kind: 'out' as const }))
    return [...deposits, ...withdrawals].sort((a, b) => Number(b.ts) - Number(a.ts))
  }, [data])

  if (error) {
    return <ErrorNotice title="No se pudieron cargar los movimientos externos" message={error.message} />
  }
  if (isLoading) return <TableSkeleton rows={5} cols={4} />
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Sin depósitos ni retiradas"
        hint="Todo el saldo de la cuenta procede de lo que has operado en ella."
      />
    )
  }

  return (
    <TableWrap className={isFetching ? 'is-refetching' : ''}>
      <table className="data">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Movimiento</th>
            <th className="num">Cantidad</th>
            <th>Red</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={`${t.ts}-${t.ccy}-${i}`}>
              <td className="sub">{dateTime(t.ts)}</td>
              <td>
                <Badge variant={t.kind === 'in' ? 'buy' : 'sell'}>
                  {t.kind === 'in' ? 'Depósito' : 'Retirada'}
                </Badge>
              </td>
              <td className="num">
                <span className={t.kind === 'in' ? 'delta--up' : 'delta--down'}>
                  {t.kind === 'in' ? '+' : '−'}
                  {qty(num(t.amt))} <span className="ccy">{t.ccy}</span>
                </span>
              </td>
              <td className="sub">{t.chain || '—'}</td>
              <td className="sub">{t.state === '2' || t.state === '3' ? 'Completado' : 'En curso'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  )
}

export function History() {
  const [instType, setInstType] = useState<string>('SPOT')

  return (
    <>
      <Card
        title="Ejecuciones y Fills"
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

      <Card
        title="Depósitos y Retiradas"
        subtitle="Dinero que entra y sale de OKX — no es rendimiento, aunque mueva el patrimonio"
        flush
      >
        <Transfers />
      </Card>

      <Card title="Movimientos de la Cuenta" subtitle="Transferencias, comisiones, tasas de funding e intereses" flush>
        <Movements />
      </Card>
    </>
  )
}

