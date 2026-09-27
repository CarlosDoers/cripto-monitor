import { usePortfolio } from '../lib/portfolio'
import { useValuation } from '../lib/queries'
import { num, pct, plural, signedUsd, usd } from '../lib/format'
import { AllocationBar } from '../components/AllocationBar'
import { DUST, HoldingsTable } from '../components/HoldingsTable'
import { Card, ErrorNotice, Skeleton, Stat, TableSkeleton } from '../components/ui'
import { HELP } from '../lib/glossary'

export function Portfolio() {
  const portfolio = usePortfolio()
  const valuation = useValuation()

  const details = valuation.data?.[0]?.details
  const dimmed = portfolio.isFetching && !portfolio.isLoading

  if (portfolio.error) {
    return <ErrorNotice title="No se pudo cargar la cartera" message={portfolio.error.message} />
  }

  const trading = num(details?.trading)
  const funding = num(details?.funding)
  const earn = num(details?.earn)
  // What the trading account holds that is not free: isolated margin behind
  // positions and the bots' reservations. The funding wallet is not in it —
  // coins there are not committed, they just cannot serve as margin.
  const committed = Math.max(0, trading - portfolio.freeMargin)
  const main = portfolio.holdings.filter((h) => h.weight >= DUST)
  const dust = portfolio.holdings.filter((h) => h.weight < DUST && h.usd > 0)
  const spotMove = portfolio.holdings.reduce(
    (sum, h) => (h.change24h ? sum + (h.usd * h.change24h) / (1 + h.change24h) : sum),
    0,
  )

  return (
    <>
      {/* The "24 h ponderado" badge that sat under the net worth is gone: it was
          the spot coins' price move alone, and read as the account's change.
          It lives in the inventory subtitle now, named for what it is. */}
      <div className="kpi-row">
        <Stat
          label="Patrimonio total"
          help={HELP.netWorth}
          hero
          loading={portfolio.isLoading}
          value={usd(portfolio.netWorth)}
          foot={<span>todas las cuentas de OKX</span>}
        />
        <Stat
          label="Disponible para operar"
          help={HELP.freeMargin}
          loading={portfolio.isLoading}
          value={usd(portfolio.freeMargin)}
          foot={<span>libre en la cuenta de trading</span>}
        />
        <Stat
          label="Comprometido"
          help={HELP.committed}
          loading={portfolio.isLoading || valuation.isLoading}
          value={usd(committed)}
          foot={<span>margen de posiciones y capital de bots</span>}
        />
        <Stat
          label="En la cuenta de fondos"
          loading={valuation.isLoading}
          value={usd(funding)}
          foot={<span>monedas guardadas; para usarlas como margen hay que transferirlas</span>}
        />
        {earn > 0 && (
          <Stat
            label="En Earn"
            loading={valuation.isLoading}
            value={usd(earn)}
            foot={<span>ahorros con rendimiento</span>}
          />
        )}
      </div>

      <Card
        title="¿En qué está tu dinero?"
        subtitle={
          dust.length > 0
            ? `Por valor de mercado · ${plural(dust.length, 'saldo residual', 'saldos residuales')} (${usd(
                dust.reduce((s, h) => s + h.usd, 0),
              )}) fuera del gráfico`
            : 'Por valor de mercado'
        }
        dimmed={dimmed}
      >
        {portfolio.isLoading ? <Skeleton height={32} /> : <AllocationBar holdings={main} />}
      </Card>

      <Card
        title="Todas tus monedas"
        subtitle={
          portfolio.isLoading
            ? undefined
            : [
                `${plural(portfolio.holdings.length, 'activo', 'activos')} · ${usd(portfolio.totalUsd)}`,
                portfolio.change24h !== undefined && Math.abs(spotMove) >= 0.01
                  ? `en 24 h sus precios mueven ${signedUsd(spotMove)} (${pct(portfolio.change24h)}), sin contar derivados`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
        }
        flush
        dimmed={dimmed}
      >
        {portfolio.isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : (
          <HoldingsTable holdings={portfolio.holdings} showSparkline showSearch foldDust />
        )}
      </Card>
    </>
  )
}
