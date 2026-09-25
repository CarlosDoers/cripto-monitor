# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read-only dashboard for an OKX trading account. Vite + React 19 + TypeScript, deployed on Vercel with a serverless function that signs the API requests. The UI is in Spanish (es-ES).

## Commands

```bash
npm run dev              # Vite dev server; also runs the api/ function (see below)
npm run build            # tsc -b && vite build — the typecheck gate
npm run lint             # oxlint
npm run candles          # populate ./.candles (needs npm run dev up)
npm run audit            # every strategy vs. the profile it claims — exits non-zero on drift
npm run orb              # the evidence behind the opening range, which the audit does not check
npm run trendlines       # diagonal support/resistance vs. a random parallel line
npm run ma               # EMA 50/200 as support/resistance vs. a randomly shifted copy
npm run try -- <módulo>  # measure a candidate strategy that is not registered yet
./scripts/push-env.sh    # push .env.local vars to the linked Vercel project
vercel --prod            # deploy (manual; a git push does NOT deploy)
```

The three script commands carry `--experimental-strip-types`. `scripts/_hook.mjs`
resolves the extensionless imports so the scripts run the app's own TypeScript,
but Node needs the flag to execute `.ts` at all before 23.6 — running them as a
bare `node --import ...` fails with `ERR_UNKNOWN_FILE_EXTENSION`. This is what
`erasableSyntaxOnly` in tsconfig is for, so never add an enum or a constructor
parameter property to anything a script imports.

There is no test suite. `npm run build` is the only automated check — always run it before calling work done.

Verification is done by driving the real app: `npm run dev`, then check the views against live data in both themes and at mobile width. Several bugs in this codebase were only visible on screen (bars that never rendered, colours that changed between views, numbers that ignored the hero font size).

To browse locally without the password gate: `APP_ACCESS_TOKEN="" npm run dev`.

## Architecture

### The credential boundary

The OKX secret must never reach the browser. Everything hinges on this:

```
browser ──▶ /api/okx?path=/api/v5/…  ──▶  api/_okx.ts  ──▶  OKX
            (no credentials)              (signs here)
```

- `api/_okx.ts` holds the HMAC signing, the endpoint allowlist and the optional access-token gate. Files under `api/` prefixed with `_` are not deployed as functions, so it stays a shared module.
- `api/okx.ts` is the Vercel function — a Web-standard `export default { fetch(request) }` handler.
- **Never use a `VITE_` prefix for anything secret**: Vite inlines those into the client bundle.
- `vite.config.ts` mounts the same handler in the dev server via `ssrLoadModule`, so `npm run dev` behaves like production without the Vercel CLI. Dev-only plugin.

**The allowlist is a security control, not a convenience.** Only GET, only read endpoints. A deployment URL is public, so even a leaked one cannot place an order or withdraw — regardless of what the API key was granted. To use a new OKX endpoint, add it to `ALLOWED_PATHS` and give it a hook in `src/lib/queries.ts`.

### Endpoints that answer a question nothing else can

Three of them exist because the obvious endpoint is silent on the thing that matters:

- **`/account/trade-fee`** — the account's real maker/taker rates. Every expectancy figure in Señales is quoted net of an assumed 0.1 % round trip, so this is what decides whether those figures apply at all. Measured on this account: taker 0.05 % a side (0.1 % round trip, exactly the assumption) and maker 0.02 % (0.04 % round trip). OKX signs these from the account's point of view — **negative means charged**, positive is a rebate — so the cost is `-rate`.
- **`/trade/orders-algo-pending`** — stop-loss and take-profit. These are **not** in `orders-pending`; OKX keeps conditional orders in a separate book, and `ordType` is required on the request, so `conditional` and `oco` both have to be fetched or a protected position still looks bare. This is the only way the app can tell "position with a stop" from "position with nothing behind it".
- **`/asset/deposit-history`, `/asset/withdrawal-history`** — a balance that grew from a deposit reads exactly like one that grew from trading. Nothing else separates them.
- **`/fiat/deposit-order-history`, `/fiat/withdrawal-order-history`** — and the two above only cover *coins sent on a chain*. Euros that arrive by SEPA or Open Banking are in neither, so the Historial showed an Aportación Neta of 5 704 US$ on an account that had put in **11 687 US$**: 6 000 EUR of bank deposits were invisible. `useTransfers` fetches all four; the fiat pair may fail (an entity without euro rails) without taking the coin history down, but the failure is reported in `incomplete` and the stat gets a `parcial` badge, because a missing half of a sum looks like a smaller number, not like a gap. Fiat `state` is a word (`completed`, `failed`) where the coin endpoints use codes, and failed attempts are listed — two failed 500 EUR orders sit in this account's history and must not count.

  **Deposits are valued on the day they arrived**, from `1Dutc` candles on `history-candles` (`useDailyCandles`, one request per currency, same pacing as the archive). They used to be priced at today's spot, which booked the rise of every coin deposited as money put in rather than money made — 900 US$ of it here, 11,06 SOL worth 891 US$ on arrival and 1 118 today. The day's open or close is used, whichever is nearer the arrival time; checked against what the money bought, a 500 EUR deposit values at 576,10 US$ and the USDC bought with it that day was 575,71. Each movement also keeps its euro value at that day's `USDC-EUR` rate, and `usdOrEur()` prints it in euro mode — through `usd()` a 500 EUR deposit read "505,63 €" because the dollar had moved since. With contributions fixed, *Resultado total* (net worth minus what was put in) is the figure the view exists for; *Generado operando* is only the closed derivatives inside it, so the two are never added.

- **`/tradingBot/dca/ongoing-list`** — the bots OKX's UI calls *DCA de futuros*. This one is worth spelling out because it is not discoverable: it is **absent from the published v5 docs**, it does not follow the naming of any other bot family (`ongoing-list` / `history-list` / `position-details`, not `orders-algo-pending`), and its `algoOrdType` values are `contract_dca` and `spot_dca` — neither of which any grid endpoint accepts. The paths came from reading OKX's own `okx/agent-trade-kit` repository. Hours were spent guessing paths before that; go there first next time a bot family is missing.

  The money is visible without it, which is what makes the gap easy to miss: bot capital shows up in `/account/balance` as frozen USDC that is not isolated margin, and their positions do **not** appear in `/account/positions` at all. So an account can hold four figures inside bots while the app shows one position and a healthy balance.

- **`/tradingBot/dca/position-details`** — average price, take-profit, liquidation price, and `fillSafetyOrds`. That last one is the only real health metric a martingale has: a bot at 8 of 9 safety orders has nothing left to average with, so the next move against it goes straight to liquidation. PnL alone will not tell you that, which is why the Bots view leads with it.

- **`/trade/fills-history`** — the fee *tier* gives a maker and a taker rate, but what decides whether a backtest applies is the **mix**. Each fill carries `execType` (`M`/`T`), so `feeMix()` in `src/lib/fees.ts` measures it: this account came out at 52 % maker and an effective 0.033 % a side (0.066 % round trip), against the 0.1 % the sweeps assume. The weighting deliberately avoids the contract multiplier — a fill's notional is `fee / rate`, not `size × price`, so the figure is exact without any per-instrument `ctVal`.

- **`/market/index-tickers`** — the spot index a contract is priced against, and the reason the Mercados board can show a premium at all: `quoteCcy=USD` returns **1 047 indices in one response**, so the basis for all 171 live X-PERP contracts costs a single request instead of 171. The index id is the contract id with `_UM_XPERP-<n>` stripped (`ETH-USD_UM_XPERP-310404` → `ETH-USD`), verified against every shape on the board.

- **`/market/books`** — depth, and *only* depth. The ticker already carries the best bid and ask, so the spread never needs this endpoint; what it adds is what sits behind the top of book. A two-basis-point spread with nothing behind it is exactly the trap `ExitDepth` catches, because the mark price and the unrealised PnL both quietly assume the whole position can be closed there. One request per instrument, so it is only ever called for something the account holds.

- **`/public/economic-calendar`** — usable, but not for what you would expect. With no cursor it serves the last few weeks; with `before` it jumps to events **months out** (2026-12 at the earliest when probed in 2026-09). The near future — the part a "what's coming this week" card needs — is not reachable at all. So the card looks backwards, which is also where `actual` lives: a release far from forecast is a candidate explanation for a move that already happened. Six weeks is nowhere near enough history to measure whether any of it moves a price, so the card says in as many words that it is context and not signal.

**`/public/funding-rate-history`** answers what the carry has been costing, which the current rate cannot. A rate of 0.01 % is cheap if it has been flat and a warning if it has tripled in three days, and that difference decides whether a position is still worth holding. `FundingCost` shows the live daily figure next to the week's realised average; both are signed from the position's side, so a short reads "cobras" against its own seven-day mean.

`useFundingRate()` is gated on the instrument being a perp: asking about a spot pair is an error, not an empty result. The rate is per settlement period (8 h, so ×3 for a daily cost) and signed from the long side — a short earns what a long pays.

### OKX quirks that shape the code

- **Regional entities.** A key only exists on the entity where the account lives. `API key doesn't exist` (`50119`) means the wrong domain, not a typo — `regionHint()` in `api/_okx.ts` says so in the error. Configured via `OKX_BASE_URL`.
- **Every numeric field is a string**, and `""` means "not applicable". Always parse through `num()` from `src/lib/format.ts`.
- **A 200 response can be a business error** (`code !== "0"`). The proxy converts those to HTTP errors so the UI never renders an empty table as success.
- **Spot has no per-trade PnL.** `fillPnl` is `0` on every spot fill and `pnl` is `0` on spot orders — verified across all 183 fills on this account, not assumed. Nor does the balance help: `accAvgPx`, `spotUpl` and `spotUplRatio` exist on `BalanceDetail` and come back **empty**, because the coins sit in the funding wallet where OKX prices nothing.

  So `src/lib/spot.ts` reconstructs it by FIFO, and **what it refuses to count is the point**. A sell whose coins arrived by deposit or airdrop has no purchase price anywhere in the API — they were bought outside OKX. Pricing them at zero invents a profit; pricing them at market invents a wash. Those proceeds go to `uncoveredProceeds` and never enter the PnL.

  The split on this account is why the UI is built the way it is: **537 US$ priced against 5 894 US$ not**, a coverage of 52 %. A lone "+537 US$ en spot" would have read as the whole story while describing half of it, so `uncoveredUsd` and `coverage` sit in the KPI strip beside the figure rather than in a footnote, and a `parcial` badge appears below 90 % coverage. Ten of the account's thirteen coins (DOS, KAITO, MON, NES, NIGHT, RE, SEI, SENT, SLX, ZAMA) appear in no trade at all.

  Two distinctions the table has to keep: *no valorable* (sold, but the cost is unknowable) is not *sin cerrar* (bought and still held, so there is no result yet); and a EUR-quoted pair must never go through `usd()`, which converts and relabels — it printed "21,88 US$ EUR" until it was caught on screen.
- **`/account/positions-history` is the only source of per-trade PnL.** `realizedPnl` is net of fees and funding; `pnl` is gross. Prefer `realizedPnl` — it is what hit the balance.
- **Pages cap at 100.** `useClosedPositions` paginates with `after=<oldest uTime>` up to 5 pages and reports `truncated`, so statistics never silently mean "the last 100 trades".
- **`posSide` only says `long`/`short` in hedge mode.** This account is one-way, so OKX reports `net` on every position and the direction lives in **the sign of `pos`**. Reading `posSide === 'short'` labelled a short as "Largo" *and* flipped the funding sign, so the app told the account it was paying funding on a short that was collecting it. Always go through `isShort()` in `src/lib/guards.ts`; never compare `posSide` directly.
- **`mgnRatio` is empty at the account level when all margin is isolated.** Parsing it through `num()` yields 0, which the Resumen then printed as a reassuring "100 %" next to a position sitting at 7.4× maintenance. Fall back to the worst open position's ratio and say which one it is.
- **It is not just `mgnRatio` — the whole account-level block goes empty.** With every position on isolated margin, `availEq`, `adjEq`, `imr` and `mmr` all come back as `""` on `/account/balance`, and `num()` turns each into a plausible-looking 0. Free margin therefore has to be summed out of `details[]` per currency, which is what `freeMargin` in `portfolio.ts` does. Anything read from the top level of that response needs the same check.
- **Order sizes are not always in the same unit.** A spot market buy placed by amount carries `tgtCcy: "quote_ccy"`, so `sz` is the quote currency spent while `accFillSz` is the base received: Órdenes printed "500 · 575,7" for 500 EUR buying 575,7 USDC, an order apparently overfilled by 15 %. `tgtCcy` is empty on limit orders. Derivative sizes are contracts, and a fill's notional is `fillSz × ctVal × fillPx` (inverse: `fillSz × ctVal`) — the Historial's *Volumen total* multiplied price by contracts and read ~100× too high on ZEC X-PERP. Every size column now names its unit.
- **Single-page lists say so.** `useFills`, `useBills` and `useOrderHistory` fetch one page of 100; on futures that is days of this account, not the three months OKX keeps. Their subtitles used to promise the whole window and now switch to "las 100 más recientes" when the page is full. Paginate before computing anything over them.
- **`posId` is not unique in `positions-history`.** One position closed in several parts produces several rows sharing it, so it cannot be a React key on its own — React silently drops the duplicates from the table. `Trade.id` is `${posId}-${uTime}`.

### Data layer

`src/lib/queries.ts` is one hook per endpoint over TanStack Query. Two cadences: `LIVE` (30 s) for balances, positions, prices; `SLOW` (5 min) for history. **Each tick is a serverless invocation** — raise these before adding polling. Intervals pause while the tab is backgrounded.

`useCandleArchive` is the third cadence: never. It pulls deep history from `history-candles` for the strategies that declare `archiveBars`, with a 6 h `staleTime` and no refetch, because old candles are immutable and the fresh tail already arrives via `useCandleHistory`. **OKX allows 20 requests per 2 seconds on that endpoint**, and 44 pages chained off each other's last timestamp both serialises them and trips it — the view came back `Too Many Requests` and rendered nothing. Candles sit on a fixed grid, so every page's cursor is arithmetic: they go out in parallel batches of 10, each batch padded to 1.1 s. Do not remove the padding.

Two hooks compose the raw queries into what views actually need:

- `src/lib/portfolio.ts` — merges the trading and funding wallets, prices everything in USD, and exposes `netWorth` (all wallets, from `asset-valuation`) alongside `totalUsd` (the priced holdings). Both Resumen and Cartera read `netWorth` so they can never disagree. It also derives `freeMargin` and `isolatedEq`, because the headline equity hides them: this account has read 7.998 US$ of net worth with **0,01 US$ actually free**, everything else locked in isolated margin and bot reservations. An account with no free margin cannot top up a position that turns, so the only choices left are close or be liquidated — the Salud de la Cuenta card says so when free margin drops under 1 % of equity.

  **En Bots** sits in the KPI strip, in the slot that used to hold *Costes (30d)* — the user's call, because the bots are what they want to see on opening the app, and costs are still one tab away in Rendimiento as "Costes totales". Two things about it are worth keeping. Semantically, bot capital is a *slice* of the patrimonio and never an addition: measured on this account, the bots' committed capital plus their PnL came to 1 175,55 US$ while `frozenBal − isoEq` came to 1 175,47 — the same money, eight cents apart, already inside `totalEq` and inside the `asset-valuation` figure the hero stat prints. Adding it to net worth would count it twice, which is why its foot says "ya dentro del patrimonio". Physically, the strip is `repeat(auto-fit, minmax(178px, 1fr))` and holds exactly **six** at 1440 px: a seventh stat drops onto a second row on its own, which is what the "measure the hero figure before enlarging it" note is really about. So a new figure up there replaces one, it never joins — and the same number is not also repeated in Salud de la Cuenta, where two copies on one screen only invite adding them together.
  **The Resumen carries every warning the app raises, not just its own.** It is the view that gets opened, and a warning that only lives on another tab is a warning nobody reads. Before this, a position with no stop was flagged only in Posiciones and a bot running out of safety orders only in Bots, while the Resumen said "Saludable" — measured the day it changed, the ETH bot sat at **7 of 9** safety orders with liquidation 14 % below its average price, and its green +75 US$ was the most reassuring number on the screen. So a single *Requiere atención* notice gathers margin risk, positions without a stop, nearly-dry bots and exhausted free margin, each linking to the view that owns it, and the Salud badge reads *Revisar* whenever any of them is live. Each uses the exact rule of its home view — `hasStop()` from `guards.ts`, `NEARLY_DRY` and `fuelUsed()` from `src/lib/bots.ts` — so the two can never disagree about what counts. That module exists for that reason: the threshold used to be a `0.75` literal inside `Bots.tsx`.

  **The 24 h figure is the spot holdings' price move, and says so.** It sat as a bare "+1,05 %" badge on *Patrimonio Total*, where it read as the net worth's own change. It is `change24h` from `portfolio.ts`: each coin's ticker move weighted by its size, stablecoins at zero — so it knows nothing of the derivatives, which are the account's real risk, nor of what closed today. The day it was caught it was SOL's +4 % on a quarter of the portfolio, beside −111 US$ of open futures PnL it left out. It now lives in *Activos Principales*' subtitle, next to the Var. 24 h column it summarises, in dollars and percent. There is no endpoint that gives the account's real 24 h change; do not put a number on the hero stat that pretends to be one.

  **The Salud badge reads *Revisar* on any entry of the notice**, not only the alarms — with free margin exhausted it used to say *Saludable* right under "Requiere atención". The positions card sorts by notional (its subtitle says "las 6 mayores de N" when it cuts), shows **notional in dollars with the contract count as its unit**, the distance to liquidation next to the price, and the same `ProtectionBadge` as Posiciones, so a position the notice calls unprotected is marked in its own row. `liquidationDistance()`, `LIQ_DANGER`/`LIQ_WATCH` and `positionSize()` live in `guards.ts` so both views colour and size a position identically; `pos` is signed on a one-way account, and Posiciones printed it raw.

  Three smaller rules from the same pass. **Dust stays out of Distribución and Activos Principales** below 0,5 % of the portfolio, relative like `locked`, and the subtitle states how many balances and how many dollars were left out — five of eight rows used to be coins worth one to four dollars printing "0,0 %". Cartera still lists everything. **Contract prices go through `price()`, never `usd()`**: `usd()` converts to euros and rounds to two decimals, so the Resumen's entry price disagreed with Posiciones' in euro mode. **"Esperanza por operación"** is now in both views: Rendimiento's headline replaced a bare "Operaciones: 75" that repeated the line above it.
- `src/lib/performance.ts` — every trading statistic, plus the period filter. Rendimiento follows three rules from its review: **every grouped breakdown fades and hides its win rate under `MIN_SAMPLE`** (`DivergingRow.thin`) — "Cortos · 4 ops · 100 %" printed at full strength beside 71 longs; **per-trade costs are signed**, like the Detalle total, because funding a short collects can outweigh its fee and `Math.abs` turned that income into a cost; and the trade size carries `sizeUnit` (contracts, or coins on margin). The calendar ignores the period filter and says so in its subtitle. Amounts in a spot pair's own quote currency go through `quoteAmount()`: fiat gets two decimals ("21,885 EUR" read like twenty-one thousand), and money without a known cost is not coloured red — it is not a loss. `computePerformance()` is a pure function; test ideas belong there.
- `src/lib/signals.ts` — candles plus the indicator, for the Señales view.

### Indicators

`src/lib/indicators/` ports TradingView indicators to TypeScript.

**Every number in a `backtest` profile must be measured, never written by hand.** The UI presents them as fact next to real money. An audit caught three invented profiles at once, including one claiming +0.58 R for a setup that actually measures +0.01 R.

```bash
npm run candles   # populate ./.candles (needs npm run dev up)
npm run audit
```

`scripts/fetch-candles.mjs` pages `/market/history-candles`, not
`/market/candles`. The latter serves only the last ~1440 bars whatever you ask
it, which on 15 m is a fortnight — the reason this file used to say intraday
history was too short to test anything. The former reaches 2021, so 15 m is now
~164 000 bars per instrument and an intraday strategy is measurable. It also
stores `vol`, which the opening range needs for its volume filter.

The audit reads the declared figures **from `registry.ts` itself** rather than from a copy, so it cannot go stale, and it exits non-zero on any drift. It also fails when a timeframe is selectable but measures below `MIN_TRADABLE_R` — that check is the guard rail, not a formality. Run it after touching any strategy parameter.

It prints two lists. **DESVIACIONES** fails the run: a declared figure that does not match the data is a lie the UI tells next to real money — and that includes the declared `halves`, because the gate reads them. **EDGE FLOJO EN UNA MITAD** should now always be empty: since the 2026-09 review a timeframe with a half under `MIN_TRADABLE_R` is *blocked*, not merely flagged. It used to be a warning, which meant the shipped strategies were held to a lower bar than `try` holds a candidate to, and two daily presets sat on that list for weeks while the UI offered them.

`nativeTimeframe` on a profile says which timeframe `outOfSample`, `sampleSize` and `winRate` are measured on. It defaults to the daily; the Donchian sets `4H` (the only timeframe it clears) and the opening range `15m`. **`exclusive` is a separate flag** meaning the strategy cannot be computed anywhere else — only the opening range has it. They used to be one field, which was fine until a strategy's headline timeframe stopped being the only one it runs on.

### Adding a strategy

`npm run try -- src/lib/indicators/myIdea.ts` measures a candidate that is not
in `registry.ts` yet and says whether it clears the bar: n ≥ 30, at or above
`MIN_TRADABLE_R` net **in the aggregate and in both halves**, and at least
0.05 R above a random entry with the same geometry. It writes nothing — a
candidate that passes still gets registered by hand with the figures it printed,
and then `npm run audit` checks that what was typed matches what was measured.
The two scripts answer different questions: `try` asks whether an idea is worth
shipping, `audit` asks whether the UI tells the truth about what shipped.

It refuses to guess when the shape is wrong. A module that returns raw indicator
output rather than a `StrategyResult` — `analyseTraps` does, and is adapted in
`registry.ts` — produces zero resolved signals, which reads exactly like an idea
that never fires. The harness says which of the two it is instead of printing a
row of dashes.

The `propose-strategy` skill in `.claude/skills/` drives that loop from a
description in plain language. Its important half is not the code generation but
the discipline written into it: **measure the idea as described and report that
number**, cap changes to the trading rules at three and report every one, and
treat a passing cell whose neighbours are all negative as a failure. Iterating
until something passes manufactures a false positive — 164 of 648 configurations
cleared both epochs in the opening-range sweep, which is exactly the rate chance
produces. If that loop is ever wanted unattended (CI, a batch of ideas), the
Claude API would only be driving `npm run try`; the harness stays the judge.

**Nothing ships in `registry.ts` that loses money, or that makes it on one half of the history.** The Señales view offers three strategies with one preset each, every one measured positive on both halves of the timeframe it is offered on. Four things were removed for losing: `pullback` (+0.01 R), `reversal/original` (−0.15 R), `donchian/slow` (+0.87 in-sample, −0.14 out) and `donchian/momentum` (+0.74 in, +0.06 out). Explaining why a losing strategy loses is not worth the screen space — if one comes back, it must clear costs out of sample first.

**The 2026-09 review** looked past the aggregate — distribution, best trades removed, per instrument and year, bootstrap interval, random control, cost sensitivity — and removed three more:

- **`donchian/fast` on the daily** is blocked (`unstable`). Its +0.67 R is one SOL trade of +68 R in 2023: without it +0.17, without the best five −0.08, 95 % interval [−0.17, +1.90], first half −0.09. Its 4 h stays: +0.33 R, halves +0.43 / +0.25, interval [+0.13, +0.50], positive on BTC, ETH and SOL spot alike. It is still a trend follower — without its ten best trades out of 899 it measures +0.07 — and the preset note says so.
- **`donchian/accurate`** is gone: +0.21 R with an interval reaching below zero, a first half of +0.01, and negative in 2022 and 2023.
- **`opening/selectiva`** is gone, and `opening/todas` became `opening/laborables` — see the opening range section. The weekend trades were the problem, and the volume filter had only been hiding them.

The reversal passed every check: interval [+0.25, +0.97], positive on each of BTC, ETH and SOL, every year, both sides, +0.26 R without its ten best trades, and indifferent to cost (+0.59 R at double the commission). It is the strongest thing in the app.

The reversal's 4 h was offered at a declared +0.15 R and measures **+0.03 R** on the deeper cache, so it is now blocked. Nothing had to be edited to block it: the verdict is derived from the number, so correcting the number was the whole fix.

**Timeframe gating is derived, not listed.** `timeframeVerdict()` and `tradableTimeframes()` read `byTimeframe` and `halves` through `blockReason()`, so the set of selectable timeframes updates automatically when a profile is re-measured and can never contradict it. Below `MIN_TRADABLE_R` (0.1) the button is disabled rather than hidden, so the reason stays visible. Switching strategy or preset snaps the timeframe to the best tradable one. `TIMEFRAMES` in `signals.ts` used to carry a hand-written `verdict` per timeframe; it was dead and it was wrong, and a list that is free to contradict the measurement is exactly what this design exists to avoid.

**A timeframe is blocked for one of three reasons, and `blockReason()` says which.** `cost`: the measured edge does not clear `MIN_TRADABLE_R`. `unstable`: the average does, but one half of the history does not — the list reads *inestable* and the paragraph prints both halves. `not-applicable`: the strategy cannot be computed there at all (`appliesTo()`, from `exclusive`) — the opening range is built from 30-minute ranges. Telling the user "the commission eats it" about the second or third is a lie, so the button tooltip, the backtest list and the explanatory paragraphs all branch on it.

Strategies are registered in `registry.ts` and the Señales view is driven entirely off that list — adding one means adding an entry there, not touching the view. Each implements the `StrategyResult` contract in `types.ts`, which prices everything in **R** so a fixed-target setup and a trailing one stay comparable.

- `ta.ts` — EMA, RMA, ATR, RSI, highest/lowest, **matching Pine Script exactly**. The seeding rule is the part that is easy to get wrong: both `ta.ema` and `ta.rma` warm up with an SMA of the first `length` values and are `na` before that, and `ta.rma` uses `alpha = 1/length` (not `2/(length+1)`). Getting this wrong shifts every signal to a different candle. Verified against TradingView's documented pseudocode — do not "simplify" the seeding.
- `reversalTrap.ts` — the Reversal Trap Probability Bands port. Two subtleties keep it bar-for-bar faithful: the outside-the-band counter is read *before* it is updated (Pine's `[1]`), and `close[1]` is compared against the *current* bar's band.

Both are pure functions over an array of candles, so they can be exercised from a script without a browser.

Only confirmed candles are analysed. A signal computed on the still-forming candle can vanish when it closes, which would be worse than showing nothing.

**Win rate alone does not say whether a setup is profitable.** These signals run at ~30–50 % accuracy with a 2.5–3× reward-to-risk, so the expectancy in R is the figure that decides it. Always show both.

#### What a sweep over 10 instruments × 4 timeframes found

Kept here because re-deriving it costs an hour and the conclusions shape the UI:

- **Trading costs decide the timeframe, not the signal quality.** The cost in R is `feeRate / (stop distance / price)`. On 15 m the stop sits ~0.25 % away, so a 0.1 % round trip is **0.4 R per signal** and turns a positive gross edge sharply negative. On the daily the stop is ~4 % away and the same cost is 0.02 R. Reversal net expectancy: 15 m −0.33 R, 1 h +0.07 R, 4 h +0.15 R, **1 D +0.54 R**. Any new indicator must be scored net of costs or the answer will be wrong. This is why the view blocks short timeframes outright.
- **The published parameters are not the good ones.** `multiplier: 4` scored −0.03 R and was profitable on only 4 of 10 instruments; measured again later it came out at −0.15 R on the daily, so it is no longer offered. `multiplier: 2.5, stopMult: 0.25` scored +0.54 R and *improved* out-of-sample (+0.57 R on the untouched half). `ORIGINAL_SETTINGS` stays in `reversalTrap.ts` because `TUNED_SETTINGS` spreads it, not because it is selectable.
- **Per-instrument results scatter wildly** (−0.41 R to +0.25 R on the same config). Never tune or judge on one instrument; always aggregate.
- The same-bar target-and-stop ambiguity that flatters the backtest turned out to be **1 occurrence in 1 198** — measured, not assumed.
- **For trend systems the exit IS the strategy.** Donchian 20 scores −0.19 R with a 3.5 ATR trail and **+0.91 R** with an 8 ATR trail. The win rate barely moves; the whole difference is how far winners are allowed to run. Never tighten a trail without re-running the sweep.
- **The stop is the other half of it, and tighter won a re-sweep.** Donchian 20 at 2 ATR beats 3 ATR on every axis: +0.75 R against +0.50 R aggregate, better on each of BTC (0.24 vs 0.13), ETH (0.31 vs 0.16) and SOL (1.80 vs 1.25), and better out of sample (0.34 vs 0.19). Tightening the *initial* stop cuts losers without touching how far winners run — the opposite of tightening the trail.
- **In-sample peaks are traps; check both epochs.** The 55-bar channel scored **+1.43 R** in-sample, the best number the sweep has ever produced, and **−0.02 R** out of sample. Anything that only looks good on one half gets deleted.
- **The trend and reversal systems only clear costs on the daily** — the opening range is the exception and has its own section below. Reversal +0.61 R (n=141, out-of-sample +0.40), Donchian +0.67 R (n=134, out-of-sample +0.17); everything shorter is flat or negative except the Donchian on 4 h, which measures +0.33 R once there are four years of 4 h bars instead of a few months, and holds both halves (+0.43 / +0.25). The Donchian daily result is the weaker of the two despite the bigger headline: it is negative on the first half of the history.
- **A flat neighbourhood is the real robustness test.** The reversal was re-swept over 108 nearby configurations: every one that produced enough signals scored +0.45 to +0.59 R on the daily. The edge does not depend on having landed on exact parameters, which is what distinguishes it from a curve fit.
- Kaufman's efficiency ratio (`registry.ts`) reads the current regime. It has sat at 0.08–0.13 across all timeframes — firmly ranging, which is why mean reversion works and trend following struggles. The view surfaces it so the two tabs can be read as complements.
- **Do not automate the regime switch.** Routing signals to the breakout above an efficiency ratio of 0.25–0.35 and to the reversal below scored +0.55 R against +0.54 R for the reversal alone. Because the ratio almost never clears the threshold, the trend branch barely fires and the "combination" is just the reversal with extra machinery. Measured, not assumed — the note is on `efficiencyRatio()`.
- **A high hit rate is geometry, not signal.** With RANDOM entries and a wide stop against a near target (6 ATR stop, 0.4 R target), the hit rate is **73 %** with an expectancy of −0.006 R. Any candidate claiming 78–88 % must be checked against a random-entry control with the *same* stop/target geometry before it means anything. Five separate strategy families were explored (Bollinger+RSI, VWAP bands, deep pullback, multi-timeframe, target sweep); every "80 %+ hit rate" they produced fell inside the random band. None survived.
- **Support and resistance did not survive the same control.** Three techniques were measured walk-forward against a random line placed at the same distance and side — pivot clustering (`src/lib/indicators/levels.ts`), round numbers, and the previous day's high/low — over a grid of 3 rejection thresholds × 3 horizons × 4 timeframes. `npm run levels` runs the single case, `npm run levels:sweep` the grid. **No technique beat the random line consistently.** Pivot levels managed +0.5 to +1.1 pp only at a loose 0.5–1 ATR threshold on 15 m and 1 h, went negative at 2 ATR, and were negative on 4 h and the daily throughout. The prior-day extremes measured as bad as −3.7 pp. Round numbers scattered around zero, with their best cells (+4.1 pp on the daily) sitting on n=163 and surrounded by negative neighbours — a good cell among bad ones, which this file already calls noise.

  The number that explains all of it: **any horizontal line gets "rejected" about 74 % of the time**, which is the same geometry that makes random entries hit 73 %. A 1 ATR bounce inside a 40-bar horizon measures intraday noise, not the level. So levels may be drawn as *description* — where price has turned before — but nothing in the app may present them as predicting a reaction, and no strategy may use them as a signal without clearing this control first.

  **Traded, both ways, they lose.** `src/lib/indicators/levelTrade.ts` turns the levels into the two setups anyone would try — *rebote* (buy the touch of support, stop just beyond) and *ruptura* (buy the close that clears it, stop back inside) — so `npm run try -- src/lib/indicators/levelTrade.ts --export analyseLevelBounce` can settle it. Neither clears the bar. Rebote: −0.54 R on 15 m, −0.15 R on 1 h, −0.00 R on 4 h, and +0.10 R on the daily that fails the both-halves check (in +0.07). Ruptura is negative on every timeframe and **below its random control everywhere** (−0.20 to −0.35 R of edge), which is the cleanest possible statement that breaking a level predicts nothing. Consistent with the sweep: if price neither respects nor breaks these lines more than it does a random one, no entry built on them can be positive after costs.

  Two things that pass came out of getting there, and both are traps worth naming. **Resolve the entry bar.** Managing an open position only from the *next* bar excuses exactly the candles that dip to a level and then collapse through it, and it turned rebote from negative into a false **+0.35 R on the daily, passing on three timeframes with stable halves**. The opening range already checks its entry candle for this reason; any new strategy must too, stop before target. **And do not read `try`'s "ventaja sobre azar" as edge on a tight stop.** Its control resolves only by stop or by mark-to-close and never awards a target, so with a 0.5 ATR stop it scores about −1 R by construction; the +0.9 "advantage" the flawed rebote showed was the control failing, not the strategy working. The column is meaningful when the candidate's risk is a few ATR wide, as the Donchian's and the opening range's are.

  They ship on that footing. `findLevels()` runs on **the candles the chart shows** — `chartStart()` in `src/lib/chartWindow.ts` is the chart's own window, shared with the view. It used to run on the whole series, which on the opening range includes the deep archive: the detector found its levels months from price and the chart filtered every one out as off-scale. The merge tolerance is in ATRs, so the timeframe is respected without a per-timeframe table. Levels outside the visible price range are **filtered, not folded into the scale** — a level far from price would stretch the axis and flatten every candle on screen.

  **Trendlines — the diagonal version — measure the same.** `src/lib/indicators/trendlines.ts` is the hand-drawn procedure made mechanical: join two swing lows (support) or highs (resistance) at least 8 bars apart, keep the line only while no candle has *closed* through it, rank by touches then recency, one per side (with two, the runner-up was the same line fanned out from a neighbouring anchor). `npm run trendlines` tests them walk-forward against a **parallel line at a random distance on the same side**: +0.3 pp on 15 m, +0.5 on 1 h, −1.3 on 4 h, −3.3 on the daily, and lines with three or more touches are no better. Any line, diagonal or flat, gets "rejected" ~70 % of the time.

  Both are drawn as solid thin lines in ink, never in a strategy colour, with separate toggles (*Horizontales*, *Tendencias*) and a legend that says *contexto, no señal*. The line under the chart names the nearest support and resistance with their distance, and closes with "no dónde va a girar". Their prices go in the **axis gutter as tags**, TradingView-style, and any tick label a tag lands on is hidden. The gutter is the one place a label cannot sit on a candle; the old left-edge labels collided with the price action and had to be dropped below 520 px, where the gutter tags still fit. Tags still collide with each other, so trendlines claim a slot first and then levels by strength.

  **The *Análisis* tab is where they live, and it opens every timeframe.** It is the first tab in Señales and the default: the chart with levels and trendlines, no strategy run (`useSignals` takes a null key and skips both the strategy and the archive), and `LevelsTable` below it as a price ladder — resistances, the current price, supports, with distance, touches and last touch. The strategy tabs still block 15 m to 4 h, and that is right: they are blocked because a *trade* there pays more in commission than the signal earns, which says nothing against *looking* at a 15 m chart. Do not unblock a strategy timeframe to get the lines onto it; that is what this tab is for. Its opening on a recently listed X-Perp also matters — the strategies need 100 daily bars of warm-up and ZEC has 121, so a strategy tab showed an empty chart where Análisis draws lines on every timeframe.

  **Moving averages sit in the same tab, off by default.** A *Medias* toggle draws the EMA 50 and EMA 200 (`src/lib/indicators/movingAverages.ts`) in `--series-1`/`--series-2`, so they cannot be mistaken for the ink trendlines or for PnL colours. `npm run ma` tests each as dynamic support against a copy of itself shifted by a random amount on the same side: on 15 m both come out +0.3 to +1.4 pp ahead in all four seeds tried, which is consistent but no larger than what pivot levels managed there; on 1 h, 4 h and the daily the sign flips with the seed (the 200 on the daily swings from +2.5 to +9.7 pp on n=75 — noise). So they are context too. Three rules came with them:

  - **They are left out of the price scale** (`Overlay.context`) and clipped to the plot, for the same reason as the levels: a 200 far from price would flatten every candle. The line under the chart states the distance instead — side of the 200, its slope (flat below 0.5 ATR over 10 bars, so "flat" means the same on every timeframe), and the date of the last 50/200 cross.
  - **Each EMA needs three times its length in bars** (`SEED_FACTOR`) or it is not drawn. `ta.ema` seeds with an SMA, and two lengths past the seed it still carries e^-4 of the seed's error; below that it would disagree with TradingView by a visible margin. ZEC's 121 daily bars get neither average, and the text says how many each needs.
  - **They are computed over every fetched candle, not the chart window**, because an EMA needs its history to settle; the chart only reads the tail.

- **The measured frontier**, on the only genuinely long history (daily BTC/ETH/SOL, 4 years, 571 configurations that stayed positive in both epochs): 50–55 % hit rate buys +0.31 R; 60–65 % buys +0.117 R; 70–75 % buys +0.081 R. There is no corner with "70 % and +0.25 R". Hit rate is bought at market price and gets expensive above 60 %.
- **Beware the history the cache actually holds.** This used to say 15 m covered ~15 days and 1 H ~60 days, and that was a property of the fetcher, not of OKX — `/market/candles` caps at ~1440 bars. On `history-candles` the cache now holds ~164 000 bars of 15 m per major instrument, back to 2022. The dated X-PERP contracts still have only months, aggregates over "10 instruments × 4 timeframes" are still far less independent than the n suggests, and ETH/SOL still appear twice (spot and perp).
- **The pullback (Connors RSI2) hits 62–68 % and still makes nothing.** Measured expectancy is +0.01 R on the daily over n=176, and 25 combinations of stop, exit and target were swept without one reaching profitability. It was shipped first with a warning, then deleted: a strategy that wins two thirds of the time and loses money is exactly the trap this project keeps re-discovering, and leaving it selectable meant the app still offered it.
- An RSI gate and a minimum reward-to-risk filter both *hurt*. A trend filter is structurally incompatible: the signal fires far from the moving average by construction, so "only trade with the trend" leaves almost no signals.

#### The opening range, and why a 24/7 market has an opening

This is the one intraday strategy that clears costs, and the reasoning is not the same as for the others. `npm run orb` re-derives all of it.

- **Crypto borrows Wall Street's open.** At 09:30 in New York, BTC's 15 m volume runs at **1.48× the daily average** and the first half hour's range is 0.42 % against 0.25 % at UTC midnight. Sweeping all 24 hours of the New York clock, 09:30 is the **only clearly positive hour**: 08:30 measures −0.03 R and 10:30 −0.04 R. London's open is worse than useless — **0 of 216 configurations positive** — and UTC midnight, the hour the daily candle uses, has *below-average* volume.
- **The anchor must follow daylight saving.** New York opens at 13:30 UTC in summer and 14:30 in winter. A fixed UTC anchor sends half the year to the wrong hour and smears the effect away.
- **Weekdays only — the thesis says so, and it was not enforced.** New York does not open on Saturday or Sunday, yet the strategy traded every day. The 1 640 weekend trades measured **−0.17 R**. Dropping them (`weekdaysOnly`) took every open from +0.14 to **+0.25 R**, BTC from −0.01 to +0.18, the result without the ten best trades from +0.07 to +0.19, and survival at a 0.2 % round trip from −0.03 to +0.14. This was found by looking at the results, which is the trap `propose-strategy` warns about, so it went through the whole battery before shipping — flat neighbourhood, every year, both halves (+0.38 / +0.13), 9 of 10 instruments, +0.31 R over random. It is also one change, not a search: the rule the strategy already claimed to follow.
- **The volume filter was a weekend filter in disguise.** It was the paper's "stocks in play" screen and seemed to work (+0.18 R against +0.14 without it), but it was discarding 92 % of weekends, which trade thin. With weekends gone it *lowers* the result at every threshold from 1.0× to 2.0×, so `minRelVolume` is 0 and the Selectiva preset is gone. The setting stays so `npm run orb` can keep testing it.
- **A wide stop is what makes 15 m survivable.** Cost in R is `feeRate / (stop distance / price)`. An ATR stop on 15 m sits ~0.25 % away, so a 0.1 % round trip costs 0.4 R. The opening range's stop is the *whole range*, ~0.55 % at the bell, which halves it. Measured +0.25 R at 0.1 %, +0.14 R at 0.2 %, +0.02 R at 0.3 %. **Every entry is a taker stop order**, so slippage is the risk that matters, not the signal.
- **It beats its own geometry.** Random entries with the same stop distance, same window and same days measure −0.06 R, so the signal is worth **+0.31 R** over the shape of the trade. This is the control that killed five other candidate families.
- **It does not need a trend.** Measured by Kaufman efficiency at entry: +0.255 R ranging, +0.197 R mixed, +0.007 R trending (n=20, noise). Which is why its `regime` is `any` — a value that means "measured across regimes", not "unknown".
- **Both sides pay.** Longs +0.26 R, shorts +0.24 R. Without that, the whole thing would just be beta on a market that went up.
- **The 2026 concentration went with the weekends.** With the volume filter, 2026 carried over half the profit from 16 % of the trades and the rest of the history measured +0.08 R. Weekdays only, 2026 is 14 % of the profit from 14 % of the trades and the rest measures +0.25 R. **What to watch now is decay:** by year 2022 +0.42, 2023 +0.30, 2024 +0.20, 2025 +0.08, 2026 +0.23 — the edge has narrowed, which is why its confidence is `weak` despite the tightest interval in the app ([+0.19, +0.28]).
- **164 of 648 swept configurations passed both epochs, which is exactly the 25 % chance rate.** The count proves nothing. What does is the structure: NY 161/216 positive against London 0/216. Chance does not sort itself by anchor. (That sweep predates the weekday rule.)
- **Its overlay stops where the next range starts forming.** A 24 h window ends exactly at the next day's range, so drawn to its end the two days joined into one path with a vertical step of thousands of dollars between them. The trade still runs to the end of its window; only the drawing stops.

### Trading bots

The Bots view reads two families. Grid bots need `algoOrdType` (`grid` or
`contract_grid`, nothing else — `moon_grid`, `spot` and `contract` all error),
and DCA bots need `contract_dca` or `spot_dca`, one family per request. Asking
for one silently omits the others, so both are fetched and merged — the same
trap as `ordType` on `/trade/orders-algo-pending`.

The list is on `LIVE` and `position-details` on `SLOW`, deliberately: the list is
one request for every bot and carries the live PnL, while the details cost one
invocation *per bot* and add only numbers that change when a safety order fills.

A subaccount named in the account (`/users/subaccount/list`) is not where the
bots are unless it holds money — this account has one with 0.0007 USD in it,
which sent the first investigation down a blind alley. Check `totalEq` before
concluding anything from a subaccount's existence.

Routing is hash-based in `src/lib/router.ts` (`useSyncExternalStore`, no router dependency). Adding a view means touching `ROUTES`, the `NAV` map in `Layout.tsx`, and the switch in `App.tsx` — and nothing else, because every navigation surface derives from those three.

That last part had to be fixed to be true. The phone's overflow menu used to be a hand-written `MOBILE_MORE` list, and Bots shipped **completely unreachable on mobile**: `NAV` is a `Record<Route, …>` so TypeScript demanded an entry for the new route, but a `Route[]` demands nothing, so the list simply went stale in silence while the desktop sidebar showed the view fine. `MOBILE_MORE` is now `ROUTES.filter(r => !MOBILE_PRIMARY.includes(r))`. `MOBILE_PRIMARY` stays hand-written on purpose — which four routes deserve a one-tap slot is an editorial call — but it can only ever *promote* a route, never hide one.

### Mobile

**Every data table must be wrapped in `TableWrap`, never a bare `div.table-wrap`.** Below 720 px the CSS redraws each row as a card: the first cell becomes the card title and every other cell is labelled by its column. Those labels come from a `useEffect` in `TableWrap` that copies the `<thead>` text onto each `<td>` as `data-label` after every render — derived rather than hand-written, so a label cannot disagree with its column when one is inserted. A bare `div` gets the card layout with no labels at all.

This exists because horizontal scroll inside a card is where mobile data goes to die: at 390 px the tables were hiding 220–650 px of themselves, and the hidden part is always the right-hand columns — PnL, weight, result.

**A cell with more than one piece must wrap them in one element.** In the card layout a `<td>` is a flex row that spreads its children to opposite edges, so "13.468 US$" and "· 1467 contratos", or a price and its distance badge, ended up at the two ends of the card. One `<span>` around them fixes it; this has bitten `LevelsTable`, Resumen and Posiciones.

Two things that only show up at that width: a `.card-head` with an action control squeezes its title into a one-word-per-line column unless it stacks, and a flex `<td>` will not shrink below its content, so an unbreakable instrument id like `ZEC-USD_UM_XPERP-310530` overflows the card until it gets `min-width: 0` plus `overflow-wrap`.

A horizontally scrolling strip needs the selected item scrolled into view. Two strategy tabs just fit at 390 px; the third pushed the active tab off-screen, so the user saw two unselected tabs and no indication of which strategy was running. `Signals.tsx` puts a ref on the selected tab and calls `scrollIntoView({ block: 'nearest', inline: 'nearest' })` — `block: 'nearest'` matters, or selecting a tab yanks the page vertically.

Chrome's window will not go below ~500 px on macOS, so `resize_page` cannot reach phone widths — use device emulation (`390x844x2,mobile,touch`) or the media query never fires.

## Conventions

### Display currency

The account settles in **USDC**, so every figure the API returns is in dollars. OKX's own app converts for display, so a euro-configured OKX will not match until the app is switched too — `src/lib/currency.ts` holds that choice and the rate, read from OKX's own `USDC-EUR` ticker rather than hardcoded.

`usd()` converts on the way out, so switching currency changes every figure at once. The catch: the formatters read a module store, not props, so **nothing re-renders on their own** — `Views` in `App.tsx` subscribes via `useCurrency()` to re-render the tree. Remove that call and only the sidebar updates.

**The rate is loaded at the root, by `useEurRate()` in `Views`.** It used to be a side effect inside `usePortfolio()`, so only the views that price the portfolio ever set it. Opened straight on Rendimiento with euros selected, the rate stayed unknown, `activeCurrency()` fell back to dollars as designed, and every figure printed "US$" under a switch that read "€". The ticker strip fetches the same `tickers/SPOT` query on every screen, so loading the rate there costs no extra request. Anything a formatter depends on must be mounted independently of the route.

**The calendar keys each trade on the day it CLOSED** — changed deliberately in `c6834be`; this note said "opened" for two weeks after that and was wrong. Closing day is when the result hit the balance, and it matches the 7/30/90-day filters in `computePerformance()`, which also cut on `uTime`, so the calendar's total for a month always equals that period's headline. The cost is that individual days can differ from OKX's own analytics page, which books a trade on the day it was opened.

### Visual direction — "terminal denso"

Flat surfaces, one-pixel rules, monospaced figures. `src/styles/tokens.css` sets `--radius-*` to `0` and every `--shadow-*` except `--shadow-pop` to `none`; `--card-gradient` and `--accent-gradient` survive as tokens but hold flat colours. **Do not reintroduce gradients, glass or card shadows** — hierarchy comes from type weight and space, and a rule between two blocks weighs less than a border around each.

- `.content` has no padding and no gap: every block reaches both edges and separates from the next with `border-bottom`. A new top-level block therefore needs its own bottom rule, and a two-column row needs `border-right` on its children (see `.grid-2` / `.overview-grid`).
- Type is **IBM Plex Sans** with **JetBrains Mono** for every figure. The mono is not decoration: `font-variant-numeric: tabular-nums` is what lets a column of numbers be compared down the page. Plus Jakarta Sans was dropped because its geometry fought the density.
- Labels are 9.5 px uppercase with `0.1em` tracking and `white-space: nowrap`. They share a flex row with a badge, so without the nowrap "PATRIMONIO TOTAL" wraps and knocks that stat out of line with its neighbours.
- The accent appears in exactly three places — the active nav item, the selected control and links — and never fills a large surface. Green and red stay reserved for PnL polarity.
- Only status dots keep a radius (`50%`). A pill-shaped chip reads as decoration here; a bordered rectangle reads as a tag.
- Measure the hero figure before enlarging it: thirteen monospaced characters at 26 px do not fit a six-column KPI strip at 1440 px, which is why `.stat-value--hero` is 22 px.

### Formatting

Everything user-facing goes through `src/lib/format.ts` — `usd`, `qty`, `price`, `pct`, `share`, `ratio`, `duration`, `plural`, `axisTick`. **Never `toFixed()` in a component**: it emits a `.` decimal separator, which is wrong in es-ES. `qty()` and `price()` scale precision to magnitude, because BTC needs 8 decimals and SHIB does not.

### Explanations ("?")

Every figure whose name is jargon carries a `Help` from `src/components/ui.tsx`: `Stat` takes a `help` prop, and anywhere else — a table header, a health-list row — renders `<Help label="…">`. **The texts live only in `src/lib/glossary.tsx`** (`HELP`), because the same term sits on several views and three hand-written explanations of the hit rate become three different explanations. Say what the number is, then what to do with it; where a definition alone would not land, compute the part that does — `riskRewardHelp()` prints the hit rate at which the account's own ratio breaks even ("1:2,18 → basta acertar más del 31 %").

Three details the component depends on. The tip is **portalled to `<body>` with fixed positioning**, because headers and KPI strips sit inside cards and scroll containers that clip anything absolute. The "?" glyph is **CSS content, not text**, so a `<th>` holding one still hands `TableWrap` a clean `data-label`. And a phone has no hover, so a tap pins it open; scrolling closes it rather than leaving it stranded. Below 720 px the `<thead>` is hidden by the card layout, so column help is desktop-only — anything a phone user must be able to look up belongs on a `Stat`, not only on a column.

### Charts

`src/styles/tokens.css` holds a **categorical palette validated for colour-vision deficiency in both themes**. Do not change the `--series-*` hexes or their order without re-validating: the slot order is the safety mechanism, not decoration.

- **Colour follows the entity, never its rank.** `src/lib/colors.ts` assigns a stable hue per currency and persists it. Only the top 7 get a hue; everything else is grey, matching the "Otros" segment — so the chart and the tables always agree.
- Statistics under `MIN_SAMPLE` (5) trades render faded and hide their win rate. Two trades at 100 % is noise and the UI must not invite reading it as signal.
- **Ticks can overlap; labels cannot.** `PositionRisk` places every marker by `left: %`, which is fine for the ticks and broke for the labels: on a position that has barely moved, entry and break-even land a few percent apart and their two prices printed interleaved into one unreadable string. Labels are now dropped when they would collide, in priority order — liquidation and mark price win because they are what the position is read against, entry and break-even yield. Any absolutely-positioned label track needs the same treatment.
- **A `<span>` used as a bar must be given `display: block`.** An inline box ignores `width` and `height` outright, so the bar silently never draws while the DOM and the computed style both look correct — `getComputedStyle().width` happily reports `100%`. This has now bitten `.rail-fill`, `.rail-track`, `.avg-track` and `.avg-bar`. To sweep for it: find elements with an inline `width` style whose computed `display` is `inline`.
- **An overlay with holes must break its path, not bridge it.** `linePath` in `PriceChart.tsx` keyed its `M` off `i === 0`, so any overlay whose first visible bar was `NaN` produced a path starting with `L` — invalid SVG the browser rejects outright, silently, with the console as the only clue. It also joined straight across gaps, drawing a level that was never there. Both were latent until the opening range, whose overlays exist only inside each day's window. The band underneath is a `<path>` of closed subpaths for the same reason; it was a single `<polygon>`, which spanned the holes.
- **A trade is drawn as two boxes, not as rails.** `PriceChart` used to draw a dashed line to the target, a dotted one to the stop and a diagonal arrow, which carried every price and had to be decoded. Each signal is now TradingView's position tool: green from entry to target (or to the exit, coloured by result, for trailing strategies), red from entry to stop, spanning the bars it was open, drawn *under* the candles and clipped to the plot because a stop can sit off the scale. The realised R is printed at the end of the box with a surface-coloured halo so it stays legible over candles.
- **The strategy's own lines claim axis tags first**, bordered in their colour — for the reversal that is techo, base and suelo, and the base is the target of every trade. Trendlines and levels take what is left.
- **On a strategy tab the context lines start off.** Six levels and two trendlines over the reversal's bands and boxes left neither readable. `Signals.tsx` keeps a separate on/off per mode: on in Análisis, off on a strategy, each remembered while the view is open.
- **`ReversalWatch` states the rule applied to the last candle.** Reading the reversal off the chart required knowing that a signal needs a close outside a band and then a close back in, that more than `trapWindow` (10) bars outside stops counting, and that signals are `signalGap` (10) bars apart. `trapWatch()` in `reversalTrap.ts` re-derives those same counters, plus "no second trade on a side already open", so a sentence like "si la próxima vela cierra por debajo del techo, salta una short" is what the next bar will actually do. Its bar lays the price between suelo, base and techo with the two signal zones tinted by side, in percentages like `PositionRisk`, and below 720 px its labels become a row.
- Charts draw at measured pixel size (`useSize`) rather than a scaled viewBox, which would stretch strokes along one axis.
- Green/red is reserved for PnL polarity and always ships with a sign, an arrow, or a printed value — never colour alone.
- Bar segments are separated by a 2px surface gap, never a border.
- On refetch, hold the previous render dimmed (`is-refetching`); never flash a skeleton over data that is already on screen.
- Every chart has a table twin or a legend carrying the same values.

### TypeScript

`erasableSyntaxOnly` is on: **no constructor parameter properties** (`constructor(private x: string)`), no enums. Declare fields explicitly.

`api/` is typechecked by `tsconfig.node.json` (Node types, `nodenext`), `src/` by `tsconfig.app.json` (DOM types, bundler). A new top-level directory needs adding to one of them or it is silently unchecked.

### Shell scripts

`vercel` reads stdin. Inside a `while read` loop, redirect the loop's input to a separate descriptor (`done 3< file`) and give each command `</dev/null` — otherwise the command eats the rest of the file and the loop exits after one iteration. This already caused a bug in `scripts/push-env.sh`.

## Deployment

Manual by choice: `git push` publishes code, `vercel --prod` deploys. They are independent. Auto-deploy would need the repo connected in Vercel's *Settings → Git*, which requires installing the Vercel GitHub app on the account that owns the repo.

Environment variables live only in Vercel and `.env.local` (gitignored):

| Variable | Notes |
| --- | --- |
| `OKX_API_KEY` / `OKX_API_SECRET` / `OKX_API_PASSPHRASE` | Read-only OKX key |
| `APP_ACCESS_TOKEN` | Password gate. Without it the public URL exposes the portfolio |
| `OKX_BASE_URL` | Regional entity — required when the account is not on the global domain |
| `OKX_SIMULATED` | `1` for the demo account |

`scripts/push-env.sh` publishes them to Production and Preview, marks the four credentials as sensitive, and skips `VERCEL_*` (the platform injects those itself).
