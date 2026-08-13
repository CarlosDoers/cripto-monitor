import { usePortfolio } from '../lib/portfolio'
import { useValuation } from '../lib/queries'
import { num, usd, usdCompact } from '../lib/format'
import { AllocationBar } from '../components/AllocationBar'
import { HoldingsTable } from '../components/HoldingsTable'
import { Card, Delta, ErrorNotice, Skeleton, Stat, TableSkeleton } from '../components/ui'

export function Portfolio() {
  const portfolio = usePortfolio()
  const valuation = useValuation()

  const details = valuation.data?.[0]?.details
  const dimmed = portfolio.isFetching && !portfolio.isLoading

  if (portfolio.error) {
    return <ErrorNotice title="No se pudo cargar la cartera" message={portfolio.error.message} />
  }

  return (
    <>
      <div className="kpi-row">
        <Stat
          label="Patrimonio Total"
          hero
          glow
          loading={portfolio.isLoading}
          value={usdCompact(portfolio.netWorth)}
          foot={
            portfolio.change24h !== undefined ? (
              <>
                <Delta ratio={portfolio.change24h} pill />
                <span>24 h ponderado</span>
              </>
            ) : undefined
          }
        />
        <Stat
          label="Cuenta de Trading"
          loading={valuation.isLoading}
          value={usdCompact(num(details?.trading))}
          foot={<span>Para derivados y margen</span>}
        />
        <Stat
          label="Cuenta de Fondos"
          loading={valuation.isLoading}
          value={usdCompact(num(details?.funding))}
          foot={<span>Depósitos y spot holding</span>}
        />
        <Stat
          label="Cuenta Earn (Ahorros)"
          loading={valuation.isLoading}
          value={usdCompact(num(details?.earn))}
          foot={<span>Rendimientos pasivos</span>}
        />
      </div>

      <Card title="Distribución de la Cartera" subtitle="Ponderación por valor de mercado en USD" dimmed={dimmed}>
        {portfolio.isLoading ? <Skeleton height={32} /> : <AllocationBar holdings={portfolio.holdings} />}
      </Card>

      <Card
        title="Inventario de Activos y Criptomonedas"
        subtitle={
          portfolio.isLoading
            ? undefined
            : `${portfolio.holdings.length} activos detectados · ${usd(portfolio.totalUsd)} total valorado`
        }
        flush
        dimmed={dimmed}
      >
        {portfolio.isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : (
          <HoldingsTable holdings={portfolio.holdings} showSparkline showSearch />
        )}
      </Card>
    </>
  )
}

