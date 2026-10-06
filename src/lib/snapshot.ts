import { accountAlerts, type AccountAlert } from './alerts'
import { feeShareOfGrid, fuelUsed, gridLiquidationRoom, gridPlace, liquidationRoom, rangePosition } from './bots'
import { instTypeOf } from './instruments'
import { BASE_FUNDING_APR, CARRY_EVIDENCE, CARRY_RULE, carryStatus, trailingApr } from './carry'
import { emaTouchSummary } from './emaTouch'
import { activeCurrency, convert } from './currency'
import { compareWatch, watchEmaCross, type EmaWatch } from './emaWatch'
import { duration, num, pct, plural, price, qty, ratio, share, signedUsd, usd } from './format'
import { guardsFor, isShort, liquidationDistance, PARTIAL_STOP, positionSize, stopCoverage, stopOf, targetOf } from './guards'
import { MIN_TRADABLE_R, profileOf, STRATEGIES, tradableTimeframes } from './indicators/registry'
import { scanReversal } from './opportunities'
import { computePerformance, MIN_SAMPLE, type Performance } from './performance'
import { buildPortfolio, type PortfolioCore } from './portfolioCore'
import { toCandles } from './signals'
import type {
  AccountBalance,
  AlgoOrder,
  AssetValuation,
  Candle,
  ClosedPosition,
  DcaBot,
  DcaPosition,
  FundingBalance,
  FundingBoardRow,
  FundingRate,
  GridBot,
  Instrument,
  Position,
  Ticker,
} from './types'

/**
 * The account and the market as text, for Claude.
 *
 * Two consumers, one pipeline: the "Copiar para Claude" button runs it in the
 * browser through the read-only proxy, and the claude.ai connector (`api/mcp.ts`)
 * runs it on the server through the same signed, allowlisted call. Every figure
 * comes from the functions the app's own views use — `buildPortfolio`,
 * `accountAlerts`, `computePerformance`, the registered strategies — so Claude
 * reads exactly what the screen shows, never a number the model worked out.
 *
 * What is deliberately *not* here: anything a strategy has not measured. The
 * text tells Claude so in its header, because a model asked "what should I
 * buy" will otherwise answer.
 */

/** `okx()` in the browser; a signed allowlisted fetch on the server. */
export type Get = <T>(path: string, params?: Record<string, string | number | undefined>) => Promise<T[]>

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** Ten requests per 1.1 s — the pace the app keeps on OKX's candle endpoints. */
async function paced<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += 10) {
    const started = Date.now()
    out.push(...(await Promise.all(items.slice(i, i + 10).map(run))))
    const rest = 1100 - (Date.now() - started)
    if (i + 10 < items.length && rest > 0) await sleep(rest)
  }
  return out
}

/**
 * Retries OKX's rate limit. A snapshot fires a dozen requests at once while the
 * app is polling the same endpoints, and the connector's tools run in parallel
 * when Claude calls several; `/asset/asset-valuation` allows one request per
 * second, and the first copy from the browser came back "Too Many Requests".
 * Both the browser's `okx()` and the server's `okxData()` carry the HTTP status
 * on the error. Jittered, so callers that collided do not collide again.
 */
export function patient(get: Get): Get {
  return async <T,>(path: string, params?: Record<string, string | number | undefined>) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await get<T>(path, params)
      } catch (err) {
        if ((err as { status?: number })?.status !== 429 || attempt >= 3) throw err
        await sleep(1100 * (attempt + 1) + Math.random() * 400)
      }
    }
  }
}

// ── account ───────────────────────────────────────────────────────────────────

export interface RawAccount {
  balance: AccountBalance[]
  funding: FundingBalance[]
  valuation: AssetValuation[]
  tickers: Ticker[]
  positions: Position[]
  algos: AlgoOrder[]
  closed: ClosedPosition[]
  truncated: boolean
  dcaBots: DcaBot[]
  dcaPositions: Record<string, DcaPosition>
  gridBots: GridBot[]
  /** Funding history of each short X-Perp held against a coin, for the carry exit. */
  hedgeFunding: Record<string, FundingRate[]>
  /** Live price of each bot's instrument: bot positions carry no mark. */
  marks: Record<string, number>
}

/** Same paging as `useClosedPositions`: five pages of 100, flagged if cut. */
export async function collectClosed(get: Get): Promise<{ closed: ClosedPosition[]; truncated: boolean }> {
  const closed: ClosedPosition[] = []
  let after: string | undefined
  for (let page = 0; page < 5; page++) {
    const batch = await get<ClosedPosition>('/api/v5/account/positions-history', { limit: 100, after })
    closed.push(...batch)
    if (batch.length < 100) return { closed, truncated: false }
    after = batch.reduce((o, r) => (Number(r.uTime) < Number(o) ? r.uTime : o), batch[0].uTime)
  }
  return { closed, truncated: true }
}

export async function collectAccount(get: Get): Promise<RawAccount> {
  const [balance, funding, valuation, tickers, positions, conditional, oco, contractDca, spotDca, grid, contractGrid] =
    await Promise.all([
      get<AccountBalance>('/api/v5/account/balance'),
      get<FundingBalance>('/api/v5/asset/balances'),
      get<AssetValuation>('/api/v5/asset/asset-valuation', { ccy: 'USD' }),
      get<Ticker>('/api/v5/market/tickers', { instType: 'SPOT' }),
      get<Position>('/api/v5/account/positions'),
      get<AlgoOrder>('/api/v5/trade/orders-algo-pending', { ordType: 'conditional', limit: 100 }),
      get<AlgoOrder>('/api/v5/trade/orders-algo-pending', { ordType: 'oco', limit: 100 }),
      get<DcaBot>('/api/v5/tradingBot/dca/ongoing-list', { algoOrdType: 'contract_dca' }),
      get<DcaBot>('/api/v5/tradingBot/dca/ongoing-list', { algoOrdType: 'spot_dca' }),
      get<GridBot>('/api/v5/tradingBot/grid/orders-algo-pending', { algoOrdType: 'grid' }),
      get<GridBot>('/api/v5/tradingBot/grid/orders-algo-pending', { algoOrdType: 'contract_grid' }),
    ])

  const { closed, truncated } = await collectClosed(get)

  const dcaBots = [...contractDca, ...spotDca]
  const details = await Promise.all(
    dcaBots.map((b) =>
      get<DcaPosition>('/api/v5/tradingBot/dca/position-details', { algoId: b.algoId, algoOrdType: b.algoOrdType }),
    ),
  )
  const dcaPositions = Object.fromEntries(details.flat().filter((p) => p?.algoId).map((p) => [p.algoId, p]))

  // Live prices for every bot's instrument: neither the DCA details nor the
  // grid list carries a mark, and both liquidation distances are read from it.
  const allBots = [...dcaBots, ...grid, ...contractGrid]
  const botTypes = [...new Set(allBots.map((b) => instTypeOf(b.instId)))]
  const botIds = new Set(allBots.map((b) => b.instId))
  const marks: Record<string, number> = {}
  for (const list of await Promise.all(botTypes.map((instType) => get<Ticker>('/api/v5/market/tickers', { instType })))) {
    for (const t of list) if (botIds.has(t.instId)) marks[t.instId] = num(t.last)
  }

  const portfolio = buildPortfolio({ balance, funding, tickers, valuation })
  const held = new Set(portfolio.holdings.filter((h) => h.total > 0).map((h) => h.ccy))
  const hedges = positions.filter(
    (p) => p.instId.includes('_UM_XPERP') && num(p.pos) < 0 && held.has(p.instId.split('-')[0]),
  )
  const hedgeFunding = Object.fromEntries(
    await Promise.all(
      hedges.map(async (p) => [
        p.instId,
        await get<FundingRate>('/api/v5/public/funding-rate-history', { instId: p.instId, limit: 50 }),
      ]),
    ),
  )

  return {
    balance,
    funding,
    valuation,
    tickers,
    positions,
    algos: [...conditional, ...oco],
    closed,
    truncated,
    dcaBots,
    dcaPositions,
    gridBots: [...grid, ...contractGrid],
    hedgeFunding,
    marks,
  }
}

export interface AccountSnapshot {
  at: number
  portfolio: PortfolioCore
  alerts: AccountAlert[]
  marginRatio: number
  positions: Position[]
  algos: AlgoOrder[]
  month: Performance
  /** Every closed position fetched, for other periods than the month. */
  closed: ClosedPosition[]
  truncated: boolean
  dcaBots: DcaBot[]
  dcaPositions: Record<string, DcaPosition>
  gridBots: GridBot[]
  marks: Record<string, number>
}

export function buildAccount(raw: RawAccount, now = Date.now()): AccountSnapshot {
  const portfolio = buildPortfolio(raw)
  const carryExits = Object.entries(raw.hedgeFunding)
    .map(([instId, rows]) => ({ instId, apr: trailingApr(rows, now) }))
    .filter((x) => x.apr !== undefined && x.apr <= CARRY_RULE.exit)
  const a = accountAlerts({
    account: raw.balance[0],
    positions: raw.positions,
    algos: raw.algos,
    dcaBots: raw.dcaBots,
    dcaPositions: raw.dcaPositions,
    netWorth: portfolio.netWorth,
    freeMargin: portfolio.freeMargin,
    carryExits,
    marks: raw.marks,
    gridBots: raw.gridBots,
  })
  return {
    at: now,
    portfolio,
    alerts: a.alerts,
    marginRatio: a.marginRatio,
    positions: raw.positions,
    algos: raw.algos,
    month: computePerformance(raw.closed, 30),
    closed: raw.closed,
    truncated: raw.truncated,
    dcaBots: raw.dcaBots,
    dcaPositions: raw.dcaPositions,
    gridBots: raw.gridBots,
    marks: raw.marks,
  }
}

// ── markdown ──────────────────────────────────────────────────────────────────

// With its zone: in the browser it is the user's, on Vercel it is UTC, and a
// bare "14:05" read by Claude would be ambiguous between the two.
// (`dateStyle` cannot be combined with `timeZoneName`, hence the fields.)
const when = (ms: number) =>
  new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(ms))

const table = (head: string[], rows: string[][]) =>
  rows.length
    ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
    : '_(ninguno)_'

export function renderSummary(s: AccountSnapshot): string {
  const p = s.portfolio
  const unrealised = s.positions.reduce((sum, x) => sum + num(x.upl), 0)
  return [
    '## Cuenta',
    `- Patrimonio total: ${usd(p.netWorth)} (cuenta de trading ${usd(p.tradingEq)})`,
    `- Margen libre: ${usd(p.freeMargin)} · en margen aislado: ${usd(p.isolatedEq)}`,
    `- Ratio de margen: ${s.marginRatio > 0 ? share(s.marginRatio, 0) : 'sin posiciones con margen'}`,
    `- Ganancia abierta: ${signedUsd(unrealised)} en ${plural(s.positions.length, 'posición', 'posiciones')}`,
    `- Cerrado en 30 días: ${signedUsd(s.month.netPnl)} en ${plural(s.month.count, 'operación', 'operaciones')} · hoy ${signedUsd(s.month.todayPnl)}`,
    '',
    '### Requiere atención',
    s.alerts.length ? s.alerts.map((a) => `- ${a.text}`).join('\n') : '- Nada: ningún aviso activo.',
  ].join('\n')
}

export function renderPositions(s: AccountSnapshot): string {
  const rows = s.positions.map((x) => {
    const g = guardsFor(x, s.algos)
    const stop = stopOf(g)
    const target = targetOf(g)
    const size = positionSize(x)
    const dist = liquidationDistance(x)
    return [
      x.instId,
      `${isShort(x) ? 'Corto' : 'Largo'} ${ratio(num(x.lever), 0)}×`,
      `${usd(num(x.notionalUsd))} (${qty(size.amount)} ${size.unit})`,
      price(num(x.avgPx)),
      price(num(x.markPx)),
      `${num(x.liqPx) > 0 ? price(num(x.liqPx)) : '—'}${dist !== null ? ` (a ${share(dist, 0)})` : ''}`,
      stop
        ? `${price(num(stop.slTriggerPx))}${stopCoverage(x, g) < PARTIAL_STOP ? ` (cubre solo el ${share(stopCoverage(x, g), 0)})` : ''}`
        : 'SIN STOP',
      target ? price(num(target.tpTriggerPx)) : '—',
      `${signedUsd(num(x.upl))} (${pct(num(x.uplRatio), 1)})`,
      signedUsd(num(x.fundingFee)),
      when(Number(x.cTime)),
    ]
  })
  return [
    '## Posiciones abiertas',
    table(
      ['Contrato', 'Lado', 'Tamaño (nocional)', 'Entrada', 'Marca', 'Liquidación', 'Stop', 'Objetivo', 'Ganancia abierta', 'Financiación', 'Abierta'],
      rows,
    ),
  ].join('\n')
}

/** `period` completes "Rendimiento …": "de los últimos 30 días", "de todo el historial". */
export function renderPerformance(p: Performance, period: string, truncated: boolean): string {
  // The same rule as Rendimiento: under MIN_SAMPLE trades the win rate is noise.
  const groups = (gs: Performance['byInstrument'], label = (k: string) => k) =>
    gs
      .slice(0, 8)
      .map((g) => `${label(g.key)} ${signedUsd(g.pnl)} (${plural(g.trades, 'op', 'ops')}, ${g.trades >= MIN_SAMPLE ? share(g.winRate, 0) : 'muestra corta'})`)
      .join(' · ')
  const side = (k: string) => (k === 'short' ? 'Cortos' : 'Largos')
  const recent = [...p.trades].sort((a, b) => b.closedAt - a.closedAt).slice(0, 15)
  return [
    `## Rendimiento ${period}${truncated ? ' (historial recortado a las 500 últimas)' : ''}`,
    `- Resultado neto: ${signedUsd(p.netPnl)} en ${p.count} operaciones (bruto ${signedUsd(p.grossPnl)}, costes ${signedUsd(p.totalCosts)})`,
    `- Acierto: ${p.count ? share(p.winRate, 1) : '—'} (${p.wins} ganadas, ${p.losses} perdidas) · factor de beneficio ${Number.isFinite(p.profitFactor) ? ratio(p.profitFactor) : '∞'}`,
    `- Ganancia media ${signedUsd(p.avgWin)} · pérdida media ${signedUsd(-p.avgLoss)} · riesgo/recompensa 1:${ratio(p.riskReward)} · esperanza ${signedUsd(p.expectancy)} por operación`,
    `- Mejor ${p.best ? `${p.best.symbol} ${signedUsd(p.best.pnl)}` : '—'} · peor ${p.worst ? `${p.worst.symbol} ${signedUsd(p.worst.pnl)}` : '—'} · duración media ${p.avgDuration ? duration(p.avgDuration) : '—'}`,
    `- Rachas: actual ${p.currentStreak}, mejor ${p.longestWinStreak} ganadoras seguidas, peor ${Math.abs(p.longestLossStreak)} perdedoras seguidas · liquidaciones ${p.liquidations}`,
    `- Por activo: ${groups(p.byInstrument) || '—'}`,
    `- Por lado: ${groups(p.byDirection, side) || '—'}`,
    '',
    '### Últimas operaciones cerradas',
    table(
      ['Cierre', 'Activo', 'Lado', 'Apal.', 'Entrada', 'Salida', 'Resultado neto', 'Duración'],
      recent.map((t) => [
        when(t.closedAt),
        t.symbol,
        t.direction === 'short' ? 'Corto' : 'Largo',
        `${t.lever}×`,
        price(t.openPx),
        price(t.closePx),
        signedUsd(t.pnl),
        t.duration ? duration(t.duration) : '—',
      ]),
    ),
  ].join('\n')
}

export function renderBots(s: AccountSnapshot): string {
  const dca = s.dcaBots.map((b) => {
    const pos = s.dcaPositions[b.algoId]
    const mark = s.marks[b.instId]
    const room = liquidationRoom(pos, mark)
    return [
      b.instId,
      b.direction,
      usd(num(b.investmentAmt)),
      pos ? price(num(pos.avgPx)) : '—',
      pos && num(pos.liqPx) > 0
        ? `${price(num(pos.liqPx))}${room !== null ? ` (a ${share(room, 0)} ${mark ? 'del precio' : 'de la media'})` : ''}`
        : '—',
      `${num(pos?.fillSafetyOrds)}/${b.maxSafetyOrds} (${share(fuelUsed(b, pos), 0)})`,
      signedUsd(num(b.totalPnl)),
    ]
  })
  // The same reading as the Bots view: where price is in the range, the
  // liquidation from the live price, and what the fees took of the grid's profit.
  const grid = s.gridBots.map((g) => {
    const mark = s.marks[g.instId]
    const at = mark ? rangePosition(num(g.minPx), num(g.maxPx), mark) : null
    const place = mark ? gridPlace(g, mark) : null
    const room = gridLiquidationRoom(g, mark)
    const feeShare = feeShareOfGrid(g)
    return [
      g.instId,
      `${g.direction === 'short' ? 'Corto' : g.direction === 'long' ? 'Largo' : 'Neutral'}${num(g.lever) > 0 ? ` ${g.lever}×` : ''}`,
      usd(num(g.investment)),
      `${price(num(g.minPx))}–${price(num(g.maxPx))} (${g.gridNum} niveles)`,
      mark
        ? `${price(mark)} · ${place === 'dentro' ? `dentro, al ${share(at ?? 0, 0)}` : `fuera, por ${place === 'encima' ? 'arriba' : 'abajo'}`}`
        : '—',
      num(g.liqPx) > 0 ? `${price(num(g.liqPx))}${room !== null ? ` (a ${share(room, 0)} del precio)` : ''}` : '—',
      `${signedUsd(num(g.gridProfit))} en ${g.arbitrageNum} arbitrajes`,
      signedUsd(num(g.floatProfit)),
      `${usd(Math.abs(num(g.fee)))}${feeShare !== null ? ` (${share(feeShare, 0)} de la rejilla)` : ''}`,
      num(g.slTriggerPx) > 0 ? price(num(g.slTriggerPx)) : 'SIN STOP',
      signedUsd(num(g.totalPnl)),
    ]
  })
  return [
    '## Bots en marcha',
    s.dcaBots.length || s.gridBots.length ? '' : '_(ninguno)_',
    s.dcaBots.length ? table(['DCA', 'Dirección', 'Invertido', 'Precio medio', 'Liquidación', 'Órdenes de seguridad usadas', 'PnL'], dca) : '',
    s.gridBots.length
      ? [
          table(['Rejilla', 'Dirección', 'Invertido', 'Rango', 'Precio ahora', 'Liquidación', 'Ganado por la rejilla', 'Flotante', 'Comisiones pagadas', 'Stop', 'Resultado'], grid),
          '_Resultado = ganado por la rejilla + flotante, ya neto de las comisiones pagadas (no restarlas otra vez). Pararlo cuesta además cerrar su posición a mercado._',
        ].join('\n\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function renderHoldings(s: AccountSnapshot): string {
  const main = s.portfolio.holdings.filter((h) => h.weight >= 0.005)
  const dust = s.portfolio.holdings.length - main.length
  return [
    '## Cartera (saldos)',
    table(
      ['Moneda', 'Cantidad', 'Valor', 'Peso', '24 h'],
      main.map((h) => [h.ccy, qty(h.total), usd(h.usd), share(h.weight), h.change24h !== undefined ? pct(h.change24h) : '—']),
    ),
    dust > 0 ? `\n_${plural(dust, 'saldo', 'saldos')} por debajo del 0,5 % de la cartera no se listan._` : '',
  ].join('\n')
}

/**
 * What has been measured, for Claude to reason from — and what has not. Built
 * from the registry and the evidence objects, never typed here, so it changes
 * when a strategy is re-measured.
 */
export function renderMethod(): string {
  const strategies = STRATEGIES.map((st) => {
    const preset = st.presets[0]
    const profile = profileOf(st, preset.key)
    const tfs = tradableTimeframes(profile)
    const native = profile.nativeTimeframe ?? '1D'
    return `- **${st.label}** (${st.tagline}): ${tfs.length ? `operable en ${tfs.join(', ')}` : 'ninguna temporalidad operable'}, ${signedR(profile.byTimeframe[native] ?? 0)} R por operación en ${native}, mitad del histórico fuera de muestra ${signedR(profile.outOfSample)} R, acierto ${share(profile.winRate, 0)}, confianza ${profile.confidence === 'weak' ? 'débil' : 'razonable'}. ${preset.note}`
  })
  const touch = emaTouchSummary()
  return [
    '## Cómo leer esto (reglas de la app)',
    '- Todas las cifras salen de la app, que las calcula con los datos de OKX. No las recalcules ni las redondees de otra forma.',
    `- Solo hay ${STRATEGIES.length} estrategias que la app ofrece, cada una medida con años de datos, costes incluidos, en las dos mitades del histórico (umbral +${ratio(MIN_TRADABLE_R)} R). **No propongas señales, niveles ni entradas que no salgan de ellas**: la app ha medido decenas de ideas que parecían buenas (soportes y resistencias, rebotes en EMAs, cruces de MACD, ir contra la financiación extrema) y ninguna ganaba dinero.`,
    '- R es lo que se arriesga en una operación (de la entrada al stop). Acertar mucho no es ganar: manda la esperanza en R.',
    ...strategies,
    `- **Financiación (carry):** tener la moneda y un corto igual en su perpetuo, entrando cuando los últimos 7 días pagaron más del ${share(CARRY_RULE.enter, 0)} anual y saliendo cuando dejan de pagar: ${pct(CARRY_EVIDENCE.ownApr, 1)} anual medido desde 2022. El tipo por defecto de OKX es ${share(BASE_FUNDING_APR, 2)} anual.`,
    `- **Toques a la EMA ${touch.length} diaria:** contexto, no señal (${touch.text}).`,
  ].join('\n')
}

const signedR = (x: number) => `${x >= 0 ? '+' : '−'}${ratio(Math.abs(x))}`

/**
 * `usd()` follows the app's currency switch, so a snapshot copied in euro mode
 * carries euro amounts — while `price()` never converts, and contract prices
 * stay in dollars. The header has to say which is which.
 */
function currencyNote(): string {
  return activeCurrency() === 'EUR'
    ? `_Datos de solo lectura. Importes en euros al cambio USDC-EUR de OKX (1 US$ = ${price(convert(1))} €); los precios de los contratos, en dólares._`
    : '_Datos de solo lectura. Importes y precios en dólares (la cuenta liquida en USDC)._'
}

export function renderAccount(s: AccountSnapshot): string {
  return [
    `# Mi cuenta de OKX — ${when(s.at)}`,
    currencyNote(),
    renderSummary(s),
    renderPositions(s),
    renderBots(s),
    renderPerformance(s.month, 'de los últimos 30 días', s.truncated),
    renderHoldings(s),
    renderMethod(),
  ].join('\n\n')
}

// ── market: live signals of the measured strategies ───────────────────────────

export interface RawMarket {
  instruments: Instrument[]
  tickers: Ticker[]
}

export async function collectMarket(get: Get): Promise<RawMarket> {
  const [instruments, tickers] = await Promise.all([
    get<Instrument>('/api/v5/public/instruments', { instType: 'FUTURES' }),
    get<Ticker>('/api/v5/market/tickers', { instType: 'FUTURES' }),
  ])
  return { instruments, tickers }
}

/** The liquid crypto X-Perps, most traded first — the universe every scan uses. */
export function liquidCrypto(m: RawMarket, top: number) {
  const tick = new Map(m.tickers.map((t) => [t.instId, t]))
  return m.instruments
    .filter((i) => i.instId.includes('_UM_XPERP') && i.state === 'live' && (i.instCategory ?? '1') === '1')
    .map((i) => {
      const t = tick.get(i.instId)
      return { instId: i.instId, symbol: i.instId.split('-')[0], last: num(t?.last), volumeUsd: num(t?.volCcy24h) * num(t?.last) }
    })
    .filter((x) => x.volumeUsd >= 1_000_000)
    .sort((a, b) => b.volumeUsd - a.volumeUsd)
    .slice(0, top)
}

export async function signalsText(get: Get, market: RawMarket, opts: { reversal: number; ema: number }) {
  const reversalSet = liquidCrypto(market, opts.reversal)
  const emaSet = liquidCrypto(market, opts.ema)

  const daily = await paced(reversalSet, (x) => get<Candle>('/api/v5/market/candles', { instId: x.instId, bar: '1D', limit: 300 }))
  const live = reversalSet
    .map((x, i) => ({ x, scan: scanReversal(toCandles(daily[i]), x.last) }))
    .filter((r) => r.scan?.kind === 'signal')
  const watching = reversalSet
    .map((x, i) => ({ x, scan: i < daily.length ? scanReversal(toCandles(daily[i]), x.last) : null }))
    .filter((r) => r.scan?.kind === 'watch')

  const fourHour = await paced(emaSet, async (x) => {
    const all: Candle[] = []
    let after: string | undefined
    for (let page = 0; page < 5; page++) {
      const batch = await get<Candle>('/api/v5/market/candles', { instId: x.instId, bar: '4H', limit: 300, after })
      if (!batch.length) break
      all.push(...batch)
      after = batch[batch.length - 1][0]
      if (batch.length < 300) break
    }
    return all.sort((a, b) => Number(a[0]) - Number(b[0]))
  })
  const ema: EmaWatch[] = emaSet.map((x, i) => watchEmaCross(fourHour[i], x.last, x.instId, x.symbol)).sort(compareWatch)

  const rev = live.map(({ x, scan }) => {
    const o = scan!.kind === 'signal' ? scan!.opportunity : null
    return o
      ? [x.symbol, o.side === 'long' ? 'Largo' : 'Corto', `1:${ratio(o.remaining)}`, price(o.entry), price(o.price), price(o.stop), price(o.target), `hace ${o.age} días`]
      : []
  })
  const watchStatus: Record<EmaWatch['status'], string> = {
    nueva: 'SEÑAL NUEVA',
    cruzando: 'cruzando ahora',
    cerca: 'cerca de cruzar',
    tendencia: 'en tendencia',
    fuera: 'sin posición',
    corto: 'historial corto',
  }
  return [
    `# Señales en vivo — ${when(Date.now())}`,
    `## Reversión diaria (${reversalSet.length} X-Perp de cripto más negociados)`,
    'Una señal sigue siendo válida hasta 7 días si el precio no ha tocado stop ni objetivo (medido).',
    table(['Activo', 'Lado', 'Recompensa/riesgo que queda', 'Entrada', 'Precio ahora', 'Stop', 'Objetivo', 'Señal'], rev),
    watching.length ? `A vigilar (fuera de su banda; si la próxima vela diaria cierra dentro, salta la señal): ${watching.map((w) => w.x.symbol).join(', ')}` : '',
    '',
    `## EMA 200 en 4 h (${emaSet.length} más negociados)`,
    'Solo la "señal nueva" es la entrada medida; entrar en una tendencia ya empezada no está medido.',
    table(
      ['Activo', 'Estado', 'Lado', 'Desde', 'Precio', 'EMA 200', 'Distancia', 'Stop'],
      ema.map((w) => [
        w.symbol,
        watchStatus[w.status],
        w.side === 'long' ? 'Largo' : w.side === 'short' ? 'Corto' : '—',
        w.side ? (w.age * 4 < 48 ? `${w.age * 4} h` : `${Math.round(w.age / 6)} días`) : '—',
        price(w.price),
        Number.isFinite(w.ema) ? price(w.ema) : '—',
        Number.isFinite(w.distance) ? `${pct(w.distance)} (${ratio(w.distanceAtr, 1)} ATR)` : '—',
        w.stop !== undefined ? price(w.stop) : '—',
      ]),
    ),
  ]
    .filter((x) => x !== '')
    .join('\n\n')
}

// ── funding carry ─────────────────────────────────────────────────────────────

export async function fundingText(get: Get, account: AccountSnapshot, market: RawMarket): Promise<string> {
  // The board is the most rate-limited call the app makes; without it there is
  // no live rate, but the rule reads the last week, which comes from elsewhere.
  // So a refusal costs one column, as in Financiación, not the whole text.
  let board: FundingBoardRow[] = []
  let boardMissing = false
  try {
    board = await get<FundingBoardRow>('/api/v5/public/funding-rate', { instId: 'ANY' })
  } catch {
    boardMissing = true
  }
  const rateById = new Map(board.map((r) => [r.instId, r]))
  const vol = new Map(liquidCrypto(market, 400).map((x) => [x.instId, x.volumeUsd]))
  // One X-Perp per coin, the most traded, from the catalogue.
  const byCoin = new Map<string, { instId: string; rate?: FundingBoardRow }>()
  for (const i of market.instruments) {
    if (!i.instId.includes('_UM_XPERP') || i.state !== 'live' || (i.instCategory ?? '1') !== '1') continue
    const coin = i.instId.split('-')[0]
    const prev = byCoin.get(coin)
    if (!prev || (vol.get(i.instId) ?? 0) > (vol.get(prev.instId) ?? 0)) byCoin.set(coin, { instId: i.instId, rate: rateById.get(i.instId) })
  }
  const inst = new Map(market.instruments.map((i) => [i.instId, i]))
  const shorts = new Map(account.positions.filter((p) => num(p.pos) < 0).map((p) => [p.instId, -num(p.pos)]))
  const holdings = account.portfolio.holdings.filter((h) => h.weight >= 0.005 && byCoin.has(h.ccy))
  const histories = await paced(holdings, (h) =>
    get<FundingRate>('/api/v5/public/funding-rate-history', { instId: byCoin.get(h.ccy)!.instId, limit: 50 }),
  )
  const now = Date.now()
  const nowApr = (r: FundingBoardRow) => {
    const gap = num(r.nextFundingTime) - num(r.fundingTime)
    return num(r.fundingRate) * (gap > 0 ? 86_400_000 / gap : 3) * 365
  }
  const nowText = (r: FundingBoardRow | undefined) => (r ? pct(nowApr(r), 1) : '—')
  const rows = holdings.map((h, i) => {
    const r = byCoin.get(h.ccy)!
    const apr = trailingApr(histories[i], now)
    const ctVal = num(inst.get(r.instId)?.ctVal)
    const hedged = shorts.get(r.instId) ?? 0
    return [
      h.ccy,
      usd(h.usd),
      apr !== undefined ? pct(apr, 1) : '—',
      nowText(r.rate),
      ctVal > 0 ? `${qty(Math.floor(h.total / ctVal))} contratos` : '—',
      hedged ? `${qty(hedged)} en corto` : 'no',
      carryStatus(apr, hedged > 0) ?? '—',
    ]
  })
  const liquidNow = [...byCoin.values()].filter((r) => vol.has(r.instId) && r.rate)
  const paying = liquidNow.filter((r) => nowApr(r.rate!) > CARRY_RULE.enter).length
  return [
    `# Financiación (carry) — ${when(now)}`,
    `Regla medida: cubrir con un corto cuando los últimos 7 días pagaron más del ${share(CARRY_RULE.enter, 0)} anual; deshacer cuando dejan de pagar. Medido: ${pct(CARRY_EVIDENCE.ownApr, 1)} anual desde 2022 cubriendo monedas que ya se tienen (${pct(CARRY_EVIDENCE.spotLimitApr, 1)} comprando el spot). Riesgos: el corto necesita margen y puede liquidarse; la financiación se gira; el spot en esta cuenta cuesta 0,20–0,35 % por lado.`,
    table(['Moneda', 'Valor', 'Últimos 7 días (anual)', 'Ahora (anual)', 'Para cubrir', 'Ya cubierta', 'Regla'], rows),
    boardMissing
      ? 'OKX no dejó leer ahora la financiación de todo el mercado (límite de peticiones): falta la columna «Ahora», pero la regla usa la última semana, que sí está.'
      : `En el tablero: ${paying} de ${liquidNow.length} X-Perp líquidos pagan ahora más del ${share(CARRY_RULE.enter, 0)} anual (el tipo por defecto es ${share(BASE_FUNDING_APR, 2)}).`,
  ].join('\n\n')
}

// ── the whole text, as the copy button produces it ────────────────────────────

/**
 * The account is the point of the copy; signals and funding are extras. An
 * extra that fails (a rate limit, a contract that errors) becomes one line
 * saying so, rather than taking the account down with it.
 */
export async function fullSnapshot(okx: Get, opts: { signals: boolean; funding: boolean }): Promise<string> {
  const get = patient(okx)
  const wantsMarket = opts.signals || opts.funding
  const [raw, market] = await Promise.all([
    collectAccount(get),
    wantsMarket ? collectMarket(get).catch(() => null) : Promise.resolve(null),
  ])
  const account = buildAccount(raw)
  const parts = [renderAccount(account)]
  const extra = async (label: string, run: () => Promise<string>) => {
    try {
      parts.push(market ? await run() : `_${label}: no se pudo leer el mercado de OKX ahora._`)
    } catch (err) {
      parts.push(`_${label}: no se pudo leer de OKX (${err instanceof Error ? err.message : String(err)})._`)
    }
  }
  if (opts.signals) await extra('Señales en vivo', () => signalsText(get, market!, { reversal: 40, ema: 10 }))
  if (opts.funding) await extra('Financiación', () => fundingText(get, account, market!))
  return parts.join('\n\n---\n\n')
}
