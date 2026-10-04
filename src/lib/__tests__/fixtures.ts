import type { AlgoOrder, ClosedPosition, DcaBot, DcaPosition, Position, Ticker } from '../types'

/** Only the fields a test cares about; the rest default to OKX's "not applicable". */
export const position = (p: Partial<Position>): Position =>
  ({ instId: 'ZEC-USD_UM_XPERP-310530', instType: 'FUTURES', posId: '1', posSide: 'net', pos: '10', ...p }) as Position

export const algo = (a: Partial<AlgoOrder>): AlgoOrder =>
  ({
    instId: 'ZEC-USD_UM_XPERP-310530',
    instType: 'FUTURES',
    algoId: 'a1',
    ordType: 'conditional',
    side: 'sell',
    posSide: 'net',
    sz: '',
    state: 'live',
    slTriggerPx: '',
    slOrdPx: '',
    tpTriggerPx: '',
    tpOrdPx: '',
    cTime: '0',
    ...a,
  }) as AlgoOrder

export const ticker = (instId: string, last: number, open24h = last): Ticker =>
  ({ instId, last: String(last), open24h: String(open24h) }) as Ticker

const DAY = 86_400_000

export const closed = (c: Partial<ClosedPosition> & { closedDaysAgo?: number }): ClosedPosition => {
  const closedAt = Date.now() - (c.closedDaysAgo ?? 1) * DAY
  return {
    posId: '1',
    instId: 'ZEC-USD_UM_XPERP-310530',
    instType: 'FUTURES',
    direction: 'long',
    lever: '5',
    openAvgPx: '100',
    closeAvgPx: '110',
    closeTotalPos: '1',
    realizedPnl: '0',
    pnl: '0',
    pnlRatio: '0',
    fee: '0',
    fundingFee: '0',
    type: '2',
    cTime: String(closedAt - DAY),
    uTime: String(closedAt),
    ...c,
  } as ClosedPosition
}

export const dcaBot = (b: Partial<DcaBot>): DcaBot =>
  ({ algoId: 'b1', algoOrdType: 'contract_dca', instId: 'ETH-USDT-SWAP', maxSafetyOrds: '9', ...b }) as DcaBot

export const dcaPosition = (p: Partial<DcaPosition>): DcaPosition =>
  ({ algoId: 'b1', instId: 'ETH-USDT-SWAP', avgPx: '2000', liqPx: '1720', fillSafetyOrds: '0', ...p }) as DcaPosition
