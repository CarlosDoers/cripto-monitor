import { useMemo, useState } from 'react'
import { useBills, useFills, useInstruments } from '../lib/queries'
import { useMovements, type MovementStatus } from '../lib/transfers'
import type { Fill, Instrument } from '../lib/types'
import { colorOf } from '../lib/colors'
import { usePortfolio } from '../lib/portfolio'
import { usePerformance } from '../lib/performance'
import {
  dateTime,
  num,
  plural,
  price,
  qty,
  share,
  shownAmount,
  signedUsd,
  signedUsdOrEur,
  usd,
  usdOrEur,
} from '../lib/format'
import { convert } from '../lib/currency'
import {
  Badge,
  Card,
  DeltaValue,
  EmptyState,
  ErrorNotice,
  SearchInput,
  Stat,
  TableSkeleton,
  TableWrap,
} from '../components/ui'
import { HELP } from '../lib/glossary'

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

/**
 * A fill's notional in dollars.
 *
 * On spot and margin `fillSz` is in coins, so price × size is the notional. On
 * perpetuals and futures it is in *contracts*, and each contract is `ctVal` of
 * the underlying — 0.01 ZEC on ZEC-USD_UM_XPERP. Price × size without it printed
 * a 5 748 US$ fill as 574 846 US$, and a hundred of them summed to 13.9 M against
 * 168 k real. Inverse contracts are already denominated in dollars, so there the
 * notional is just contracts × ctVal.
 *
 * Undefined while the contract size is unknown: a dash is honest, a figure off
 * by two orders of magnitude is not.
 */
function notionalOf(fill: Fill, inst: Instrument | undefined): number | undefined {
  const px = num(fill.fillPx)
  const sz = num(fill.fillSz)
  if (fill.instType === 'SPOT' || fill.instType === 'MARGIN') return px * sz
  const ctVal = num(inst?.ctVal)
  if (!(ctVal > 0)) return undefined
  return inst!.ctType === 'inverse' ? sz * ctVal : px * sz * ctVal
}

function Fills({ instType }: { instType: string }) {
  const { data, isLoading, isFetching, error } = useFills(instType)
  const instruments = useInstruments(instType)
  const contracts = useMemo(
    () => new Map((instruments.data ?? []).map((i) => [i.instId, i])),
    [instruments.data],
  )
  const derivative = instType === 'SWAP' || instType === 'FUTURES'
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
                  <td className="num">
                    {qty(fillSz)}
                    {derivative && <span className="sub"> contr.</span>}
                  </td>
                  <td className="num">
                    {(() => {
                      const notional = notionalOf(f, contracts.get(f.instId))
                      return notional !== undefined ? usd(notional) : '—'
                    })()}
                  </td>
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

const STATUS: Record<MovementStatus, string> = {
  done: 'Completado',
  pending: 'En curso',
  failed: 'Fallido',
}

/**
 * Money in and out of the account.
 *
 * Without this the portfolio total answers the wrong question: a balance that
 * grew because of a deposit reads exactly like one that grew from trading, and
 * nothing else in the app separates them.
 *
 * The value column is the table twin of the figures above it: summing the
 * completed rows gives the Depósitos stat, so a total can always be traced back
 * to the movements it came from.
 */
function Transfers() {
  const { movements, incomplete, isLoading, isFetching, error } = useMovements()

  if (error) {
    return <ErrorNotice title="No se pudieron cargar los movimientos externos" message={error.message} />
  }
  if (isLoading) return <TableSkeleton rows={5} cols={6} />
  if (movements.length === 0) {
    return (
      <EmptyState
        title="Sin depósitos ni retiradas"
        hint={
          incomplete
            ? `No se pudo leer todo el historial (${incomplete}).`
            : 'Todo el saldo de la cuenta procede de lo que has operado en ella.'
        }
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
            <th className="num">Valor al llegar</th>
            <th>Vía</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => {
            const failed = m.status === 'failed'
            return (
              <tr key={m.id}>
                <td className="sub">{dateTime(m.ts)}</td>
                <td>
                  <Badge variant={failed ? 'neutral' : m.kind === 'in' ? 'buy' : 'sell'}>
                    {m.kind === 'in' ? 'Depósito' : 'Retirada'}
                  </Badge>
                </td>
                <td className="num">
                  <span className={failed ? 'muted' : m.kind === 'in' ? 'delta--up' : 'delta--down'}>
                    {m.kind === 'in' ? '+' : '−'}
                    {qty(m.amount)} <span className="ccy">{m.ccy}</span>
                  </span>
                </td>
                <td className="num">
                  {m.value === undefined || m.valueEur === undefined || failed
                    ? '—'
                    : usdOrEur(m.value, m.valueEur)}
                </td>
                <td className="sub">{m.via}</td>
                <td className="sub">{STATUS[m.status]}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableWrap>
  )
}

/**
 * Where the balance came from.
 *
 * A balance that grew from a deposit reads exactly like one that grew from
 * trading, and nothing else in the app can tell them apart: `positions-history`
 * only knows about trades, and `asset-valuation` only knows the total. Putting
 * the two side by side is the whole point of this view.
 *
 * Deposits are valued on the day they arrived (see `transfers.ts`), which is
 * what makes **Resultado total** mean something: net worth minus what was put
 * in is everything the account has made since — trading, bots, and the price
 * of the coins it holds. Generado operando is only the first of those, which is
 * why the two are shown apart and never added.
 */
function Provenance() {
  const flows = useMovements()
  const perf = usePerformance('all')
  const portfolio = usePortfolio()

  const net = flows.deposited - flows.withdrawn
  const netEur = flows.depositedEur - flows.withdrawnEur
  // Net worth is a balance, so today's rate is the right one for it; what was
  // put in keeps the rate of the day it arrived. In euros the result therefore
  // includes what the dollar did in between, which is what a euro holder made.
  const result = portfolio.netWorth - net
  const resultEur = convert(portfolio.netWorth) - netEur
  const loading = flows.isLoading || perf.isLoading || portfolio.isLoading
  const partial = flows.unpriced > 0 || flows.incomplete !== null

  // Nothing to separate when no money has moved in or out.
  if (!loading && !flows.error && flows.deposits + flows.withdrawals === 0) return null

  return (
    <div className="kpi-row">
      <Stat
        label="Depósitos"
        help={HELP.deposits}
        hero
        loading={loading}
        value={usdOrEur(flows.deposited, flows.depositedEur)}
        badge={partial ? <Badge variant="neutral">parcial</Badge> : undefined}
        foot={
          <span title={flows.incomplete ?? undefined}>
            {plural(flows.deposits, 'movimiento', 'movimientos')} ·{' '}
            {flows.unpriced > 0
              ? `${flows.unpriced} sin precio`
              : flows.incomplete
                ? 'historial incompleto'
                : 'valor al llegar'}
          </span>
        }
      />
      <Stat
        label="Retiradas"
        loading={loading}
        value={usdOrEur(flows.withdrawn, flows.withdrawnEur)}
        foot={<span>{plural(flows.withdrawals, 'movimiento', 'movimientos')}</span>}
      />
      <Stat
        label="Aportación Neta"
        help={HELP.netContribution}
        loading={loading}
        value={<DeltaValue value={shownAmount(net, netEur)}>{signedUsdOrEur(net, netEur)}</DeltaValue>}
        foot={
          <span>
            {portfolio.netWorth > 0
              ? `${share(Math.abs(shownAmount(net, netEur)) / convert(portfolio.netWorth), 1)} del patrimonio actual`
              : 'dinero que metiste tú'}
          </span>
        }
      />
      <Stat
        label="Resultado Total"
        help={HELP.totalResult}
        loading={loading}
        value={
          <DeltaValue value={shownAmount(result, resultEur)}>{signedUsdOrEur(result, resultEur)}</DeltaValue>
        }
        foot={<span>patrimonio menos lo aportado</span>}
      />
      <Stat
        label="Generado Operando"
        help={HELP.tradingResult}
        loading={loading}
        value={<DeltaValue value={perf.netPnl}>{signedUsd(perf.netPnl)}</DeltaValue>}
        foot={<span>{perf.count} posiciones cerradas · neto de costes</span>}
      />
      <Stat
        label="Costes de Operar"
        help={HELP.totalCosts}
        loading={loading}
        value={<DeltaValue value={perf.totalCosts}>{signedUsd(perf.totalCosts)}</DeltaValue>}
        foot={<span>comisiones y financiación</span>}
      />
    </div>
  )
}

/**
 * These lists are one page of 100, not the three months OKX keeps. On futures
 * that is a few days of this account's activity, so a subtitle promising the
 * whole window described a table missing most of it.
 */
const PAGE = 100

export function History() {
  const [instType, setInstType] = useState<string>('SPOT')
  // Same query keys as the tables below, so these read the cache, not the API.
  const fills = useFills(instType)
  const bills = useBills()

  return (
    <>
      <Provenance />

      <Card
        title="Ejecuciones y Fills"
        subtitle={
          (fills.data?.length ?? 0) >= PAGE
            ? `Las ${PAGE} más recientes · OKX conserva 3 meses`
            : 'Operaciones completadas en los últimos 3 meses'
        }
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

      <Card
        title="Movimientos de la Cuenta"
        subtitle={`Transferencias, comisiones, tasas de funding e intereses${
          (bills.data?.length ?? 0) >= PAGE ? ` · los ${PAGE} más recientes` : ''
        }`}
        flush
      >
        <Movements />
      </Card>
    </>
  )
}

