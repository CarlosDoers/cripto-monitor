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
          label="Patrimonio total"
          hero
          loading={portfolio.isLoading}
          value={usdCompact(portfolio.netWorth)}
          foot={
            portfolio.change24h !== undefined ? (
              <>
                <Delta ratio={portfolio.change24h} />
                <span>24 h ponderado</span>
              </>
            ) : undefined
          }
        />
        <Stat
          label="Cuenta de trading"
          loading={valuation.isLoading}
          value={usdCompact(num(details?.trading))}
        />
        <Stat
          label="Cuenta de fondos"
          loading={valuation.isLoading}
          value={usdCompact(num(details?.funding))}
        />
        <Stat
          label="Earn"
          loading={valuation.isLoading}
          value={usdCompact(num(details?.earn))}
        />
      </div>

      <Card title="Distribución" subtitle="Por valor en USD" dimmed={dimmed}>
        {portfolio.isLoading ? <Skeleton height={28} /> : <AllocationBar holdings={portfolio.holdings} />}
      </Card>

      <Card
        title="Todos los activos"
        subtitle={
          portfolio.isLoading
            ? undefined
            : `${portfolio.holdings.length} activos · ${usd(portfolio.totalUsd)} en trading y fondos`
        }
        flush
        dimmed={dimmed}
      >
        {portfolio.isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : (
          <HoldingsTable holdings={portfolio.holdings} showSparkline />
        )}
      </Card>
    </>
  )
}
