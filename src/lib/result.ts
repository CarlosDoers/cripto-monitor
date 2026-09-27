import { useMovements } from './transfers'
import { usePortfolio } from './portfolio'
import { convert } from './currency'

/**
 * What the account has made since the first deposit: net worth minus what was
 * put in. The answer to "¿cómo voy?", and the reason it has one home — the
 * Resumen leads with it and the Historial breaks it down, and two copies of
 * the arithmetic would drift.
 *
 * Deposits are valued on the day they arrived (see `transfers.ts`); net worth
 * is a balance, so today's rate applies to it. In euros the result therefore
 * includes what the dollar did in between, which is what a euro holder made.
 */
export function useAccountResult() {
  const flows = useMovements()
  const portfolio = usePortfolio()

  const net = flows.deposited - flows.withdrawn
  const netEur = flows.depositedEur - flows.withdrawnEur

  return {
    flows,
    net,
    netEur,
    result: portfolio.netWorth - net,
    resultEur: convert(portfolio.netWorth) - netEur,
    netWorth: portfolio.netWorth,
    /** Some deposit could not be priced, or a history endpoint failed. */
    // Not while loading: until the day candles arrive every deposit is
    // unpriced, and the badge flashed on every page load.
    partial: !flows.isLoading && (flows.unpriced > 0 || flows.incomplete !== null),
    /** No money has ever moved in or out: there is nothing to measure against. */
    noFlows: !flows.isLoading && !flows.error && flows.deposits + flows.withdrawals === 0,
    isLoading: flows.isLoading || portfolio.isLoading,
  }
}
