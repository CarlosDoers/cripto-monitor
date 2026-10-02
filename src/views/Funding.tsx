import { BASE_FUNDING_APR, CARRY_EVIDENCE, CARRY_RULE, useCarry, type CarryStatus } from '../lib/carry'
import { DUST } from '../components/HoldingsTable'
import { pct, plural, qty, ratio, share, usd, usdCompact } from '../lib/format'
import { HELP } from '../lib/glossary'
import {
  Badge,
  Card,
  DeltaValue,
  EmptyState,
  ErrorNotice,
  Help,
  Stat,
  TableSkeleton,
  TableWrap,
} from '../components/ui'

const STATUS: Record<CarryStatus, { label: string; variant: 'buy' | 'live' | 'warn' | 'neutral'; title: string }> = {
  cubrir: {
    label: 'Cubrir',
    variant: 'buy',
    title: 'La última semana pagó más del 10 % anual y no tienes el corto: la regla dice montarlo.',
  },
  cobrando: {
    label: 'Cobrando',
    variant: 'live',
    title: 'Ya tienes el corto y la financiación sigue pagando: mantener.',
  },
  salir: {
    label: 'Deshacer',
    variant: 'warn',
    title: 'Tienes el corto pero la última semana ya no pagó: la regla dice cerrarlo.',
  },
  esperar: {
    label: 'Esperar',
    variant: 'neutral',
    title: 'La última semana pagó menos del 10 % anual: no compensa montarlo.',
  },
  pequena: {
    label: 'Muy poco',
    variant: 'neutral',
    title: 'Lo que tienes no llega a un contrato: no se puede cubrir.',
  },
}

const apr = (x: number | undefined) =>
  x === undefined || !Number.isFinite(x) ? <span className="muted">—</span> : <DeltaValue value={x}>{pct(x, 1)}</DeltaValue>

const days = (d: number | undefined) =>
  d === undefined || !Number.isFinite(d) ? '—' : plural(Math.max(1, Math.ceil(d)), 'día', 'días')

/**
 * Funding carry, made usable: which of the coins held could be hedged for an
 * income right now, which contracts pay enough to be worth buying the spot for,
 * and the measurement behind the rule. See `src/lib/carry.ts`.
 */
export function Funding() {
  const c = useCarry()
  // Dust out, as on the Resumen: a coin worth cents "to hedge" for 0,50 US$ a
  // year is noise in a table meant to show what is worth doing. A hedge that
  // already exists always stays in, whatever its size.
  const holdings = c.holdings.filter((h) => h.weight >= DUST || h.hedged > 0)
  const dust = c.holdings.length - holdings.length
  const toHedge = holdings.filter((h) => h.status === 'cubrir')
  const collecting = holdings.filter((h) => h.status === 'cobrando' || h.status === 'cubrir')
  const income = collecting.reduce((s, h) => s + h.incomeUsd, 0)
  const ev = CARRY_EVIDENCE

  if (c.error) {
    return <ErrorNotice title="No se pudo cargar la financiación" message={c.error.message} />
  }

  return (
    <>
      <div className="kpi-row">
        <Stat
          label="Para cubrir ahora"
          hero
          loading={c.isLoading}
          value={String(toHedge.length)}
          help={HELP.carry}
          foot={<span>de {plural(holdings.length, 'moneda tuya', 'monedas tuyas')} con X-Perp y peso en la cartera</span>}
        />
        <Stat
          label="Cobro estimado al año"
          loading={c.isLoading || c.trailsPending > 0}
          value={income > 0 ? usd(income) : '—'}
          help={HELP.fundingTrailing}
          foot={<span>cubriendo lo que la regla marca, al ritmo de la última semana</span>}
        />
        <Stat
          label="Pagan más del 10 %"
          loading={c.isLoading}
          value={String(c.board.paying)}
          help={HELP.fundingNow}
          foot={
            <span>
              de {c.board.liquid} líquidos al tipo de ahora · {c.board.aboveBase} claramente por encima de la base del{' '}
              {share(BASE_FUNDING_APR, 1)}
            </span>
          }
        />
        <Stat
          label="Medido desde 2022"
          value={`${pct(ev.ownApr, 1)} anual`}
          foot={<span>con la regla, cubriendo lo que ya tienes · {ev.coins} monedas</span>}
        />
      </div>

      <Card
        title="Tus monedas"
        subtitle={`Las que tienes en spot y tienen X-Perp: cubrirlas con un corto cobra la financiación sin apostar por el precio${
          dust > 0 ? ` · ${plural(dust, 'saldo', 'saldos')} bajo el 0,5 % de la cartera fuera` : ''
        }`}
        flush
        dimmed={c.isFetching && !c.isLoading}
      >
        {c.isLoading ? (
          <TableSkeleton rows={4} cols={8} />
        ) : holdings.length === 0 ? (
          <EmptyState
            title="Ninguna moneda tuya tiene X-Perp"
            hint="El carry necesita la moneda en spot y su perpetuo. Mira abajo los contratos que pagan bien si compraras el spot."
          />
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Moneda</th>
                  <th className="num">Tienes</th>
                  <th className="num">
                    Últimos 7 días
                    <Help label="Últimos 7 días">{HELP.fundingTrailing}</Help>
                  </th>
                  <th className="num">
                    Ahora
                    <Help label="Ahora">{HELP.fundingNow}</Help>
                  </th>
                  <th className="num">
                    Para cubrir
                    <Help label="Para cubrir">{HELP.carryContracts}</Help>
                  </th>
                  <th className="num">Cobro al año</th>
                  <th className="num">
                    Recuperas comisiones
                    <Help label="Recuperas comisiones">{HELP.carryBreakEven}</Help>
                  </th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const s = h.status ? STATUS[h.status] : undefined
                  return (
                    <tr key={h.instId}>
                      <td>
                        <span>
                          <span className="ccy">{h.ccy}</span> <span className="sub">{h.instId}</span>
                        </span>
                      </td>
                      <td className="num">
                        <span>
                          {qty(h.held)} <span className="sub">{usd(h.heldUsd)}</span>
                        </span>
                      </td>
                      <td className="num">{apr(h.trailing)}</td>
                      <td className="num">{apr(h.nowApr)}</td>
                      <td className="num">
                        <span>
                          {h.contracts > 0 ? `${qty(h.contracts)} contr.` : '—'}
                          {h.hedged > 0 && <span className="sub"> · {qty(h.hedged)} ya en corto</span>}
                        </span>
                      </td>
                      <td className="num">
                        {h.incomeUsd > 0 ? (
                          // Only what the rule says to collect is an income; the
                          // rest is what that week would have paid, shown muted.
                          <span className={h.status === 'cubrir' || h.status === 'cobrando' ? undefined : 'muted'}>
                            {usd(h.incomeUsd)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num">{h.status === 'pequena' ? '—' : days(h.breakEvenDays)}</td>
                      <td>
                        {s ? (
                          <span title={s.title}>
                            <Badge variant={s.variant}>{s.label}</Badge>
                          </span>
                        ) : (
                          <span className="muted">cargando…</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card
        title="Si compraras el spot"
        subtitle={`Contratos líquidos cuya última semana pagó más del ${share(CARRY_RULE.enter, 0)} anual, entre los 15 que más pagan ahora. Comprar el spot en tu cuenta cuesta ${share(c.costs.spotMaker, 2)} por lado con orden límite`}
        flush
        dimmed={c.isFetching && !c.isLoading}
      >
        {c.isLoading || (c.trailsPending > 0 && c.opportunities.length === 0) ? (
          <TableSkeleton rows={5} cols={6} />
        ) : c.opportunities.length === 0 ? (
          <EmptyState
            title="Ningún contrato líquido paga ahora lo suficiente"
            hint={`La regla pide más de un ${share(CARRY_RULE.enter, 0)} anual en la última semana. Con la financiación baja, el carry no compensa sus comisiones.`}
          />
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Contrato</th>
                  <th className="num">
                    Últimos 7 días
                    <Help label="Últimos 7 días">{HELP.fundingTrailing}</Help>
                  </th>
                  <th className="num">
                    Ahora
                    <Help label="Ahora">{HELP.fundingNow}</Help>
                  </th>
                  <th>Par spot</th>
                  <th className="num">
                    Recuperas comisiones
                    <Help label="Recuperas comisiones">{HELP.carryBreakEven}</Help>
                  </th>
                  <th className="num">Volumen 24 h</th>
                </tr>
              </thead>
              <tbody>
                {c.opportunities.map((o) => (
                  <tr key={o.instId}>
                    <td>
                      <span>
                        <span className="ccy">{o.ccy}</span> <span className="sub">{o.instId}</span>
                      </span>
                    </td>
                    <td className="num">{apr(o.trailing)}</td>
                    <td className="num">{apr(o.nowApr)}</td>
                    <td>{o.spotPair ?? <span className="muted">sin spot en tu cuenta</span>}</td>
                    <td className="num">{days(o.breakEvenDays)}</td>
                    <td className="num">{usdCompact(o.volumeUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="La regla, y lo que se midió">
        <div className="prose">
          <p>
            <strong>La regla:</strong> cubrir una moneda cuando la financiación de su X-Perp pagó más de un{' '}
            {share(CARRY_RULE.enter, 0)} anual en los últimos {CARRY_RULE.days} días, y deshacerlo cuando
            deje de pagar. Cubrir es abrir un corto del mismo tamaño que lo que tienes: el precio se compensa y
            cobras la financiación cada 8 horas.
          </p>
          <p>
            Ese {share(CARRY_RULE.enter, 0)} está justo por debajo del tipo por defecto de OKX, un{' '}
            {share(BASE_FUNDING_APR, 2)} anual (0,01 % cada 8 horas), que es lo que paga casi cualquier perpetuo
            cuando cotiza pegado al spot. Así que la regla, en la práctica, es: cubrir mientras la financiación
            esté en su nivel normal o por encima, y salir cuando se gire. Se midió también con umbrales del 5, 20
            y 30 % y los cuatro aguantaron las dos mitades del histórico.
          </p>
          <p>
            <strong>Lo medido:</strong> sobre {ev.coins} perpetuos desde 2022, la regla dio un{' '}
            {pct(ev.ownApr, 1)} anual cubriendo monedas que ya se tienen ({pct(ev.halves[0], 1)} en la primera
            mitad del histórico, {pct(ev.halves[1], 1)} en la segunda) y un {pct(ev.spotLimitApr, 1)} comprando
            el spot con orden límite a las comisiones de tu cuenta. En los X-Perp, los tres meses que guarda
            OKX dieron {pct(ev.xperpOwnApr, 1)} y {pct(ev.xperpSpotLimitApr, 1)}. Y se mueve aparte de las
            estrategias: su correlación mensual es {ratio(ev.correlation.reversal)} con la
            Reversión, {ratio(ev.correlation.donchian)} con la Ruptura y{' '}
            {ratio(ev.correlation.opening)} con la Apertura.
          </p>
          <p>
            <strong>Lo que no funcionó:</strong> ir contra la financiación extrema. Ponerse corto cuando está en
            su décimo más alto perdió un {pct(ev.contrarianShortWeekly, 1)} por semana, porque cuando hay muchos
            largos el precio suele seguir subiendo. Tampoco una cartera larga en la financiación baja y corta en
            la alta: un año gana, otro pierde lo mismo.
          </p>
          <p>
            <strong>Los riesgos, que no son pocos:</strong>
          </p>
          <ul>
            <li>
              <strong>El corto necesita margen.</strong> Si el precio se dispara, la moneda gana lo que el corto
              pierde, pero están en carteras distintas y el corto puede liquidarse. Con poco apalancamiento (1–2×)
              y vigilando el margen.
            </li>
            <li>
              <strong>La financiación se gira.</strong> En los X-Perp, BTC pagó un {pct(ev.xperpBtcApr, 1)}{' '}
              anual estos tres meses aplicando la regla. Por eso se deshace cuando deja de pagar, y aun así la
              última semana puede ser peor que la anterior.
            </li>
            <li>
              <strong>El spot es caro en tu cuenta.</strong> La columna de días para recuperar comisiones lo dice
              contrato a contrato; si la financiación cae antes, el carry pierde.
            </li>
            <li>
              <strong>Los X-Perp no siguen a Binance día a día</strong> (correlación{' '}
              {ratio(ev.xperpBinanceCorrelation)}): el histórico largo dice cuánto suele
              pagar el carry, y los datos en vivo de esta página dicen cuándo.
            </li>
          </ul>
          <p className="muted">
            Es la regla aplicada a tus datos de hoy, no un consejo: la app no opera, y el tamaño y el margen los
            decides tú.
          </p>
        </div>
      </Card>
    </>
  )
}
