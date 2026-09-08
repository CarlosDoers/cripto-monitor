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
- **Spot has no per-trade PnL.** `fillPnl` is `0` on every spot fill and `pnl` is `0` on spot orders. This is why the Rendimiento view covers derivatives only — a spot win rate would have to be invented from a cost-basis model over a truncated history. Do not add one without saying loudly that it is an estimate.
- **`/account/positions-history` is the only source of per-trade PnL.** `realizedPnl` is net of fees and funding; `pnl` is gross. Prefer `realizedPnl` — it is what hit the balance.
- **Pages cap at 100.** `useClosedPositions` paginates with `after=<oldest uTime>` up to 5 pages and reports `truncated`, so statistics never silently mean "the last 100 trades".
- **`posSide` only says `long`/`short` in hedge mode.** This account is one-way, so OKX reports `net` on every position and the direction lives in **the sign of `pos`**. Reading `posSide === 'short'` labelled a short as "Largo" *and* flipped the funding sign, so the app told the account it was paying funding on a short that was collecting it. Always go through `isShort()` in `src/lib/guards.ts`; never compare `posSide` directly.
- **`mgnRatio` is empty at the account level when all margin is isolated.** Parsing it through `num()` yields 0, which the Resumen then printed as a reassuring "100 %" next to a position sitting at 7.4× maintenance. Fall back to the worst open position's ratio and say which one it is.
- **It is not just `mgnRatio` — the whole account-level block goes empty.** With every position on isolated margin, `availEq`, `adjEq`, `imr` and `mmr` all come back as `""` on `/account/balance`, and `num()` turns each into a plausible-looking 0. Free margin therefore has to be summed out of `details[]` per currency, which is what `freeMargin` in `portfolio.ts` does. Anything read from the top level of that response needs the same check.
- **`posId` is not unique in `positions-history`.** One position closed in several parts produces several rows sharing it, so it cannot be a React key on its own — React silently drops the duplicates from the table. `Trade.id` is `${posId}-${uTime}`.

### Data layer

`src/lib/queries.ts` is one hook per endpoint over TanStack Query. Two cadences: `LIVE` (30 s) for balances, positions, prices; `SLOW` (5 min) for history. **Each tick is a serverless invocation** — raise these before adding polling. Intervals pause while the tab is backgrounded.

`useCandleArchive` is the third cadence: never. It pulls deep history from `history-candles` for the strategies that declare `archiveBars`, with a 6 h `staleTime` and no refetch, because old candles are immutable and the fresh tail already arrives via `useCandleHistory`. **OKX allows 20 requests per 2 seconds on that endpoint**, and 44 pages chained off each other's last timestamp both serialises them and trips it — the view came back `Too Many Requests` and rendered nothing. Candles sit on a fixed grid, so every page's cursor is arithmetic: they go out in parallel batches of 10, each batch padded to 1.1 s. Do not remove the padding.

Two hooks compose the raw queries into what views actually need:

- `src/lib/portfolio.ts` — merges the trading and funding wallets, prices everything in USD, and exposes `netWorth` (all wallets, from `asset-valuation`) alongside `totalUsd` (the priced holdings). Both Resumen and Cartera read `netWorth` so they can never disagree. It also derives `freeMargin` and `isolatedEq`, because the headline equity hides them: this account has read 7.998 US$ of net worth with **0,01 US$ actually free**, everything else locked in isolated margin and bot reservations. An account with no free margin cannot top up a position that turns, so the only choices left are close or be liquidated — the Salud de la Cuenta card says so when free margin drops under 1 % of equity.
- `src/lib/performance.ts` — every trading statistic, plus the period filter. `computePerformance()` is a pure function; test ideas belong there.
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

It prints two lists, and they are two different kinds of wrong. **DESVIACIONES** fails the run: a declared figure that does not match the data is a lie the UI tells next to real money. **EDGE FLOJO EN UNA MITAD** does not: it flags a timeframe that is positive overall but under `MIN_TRADABLE_R` on one half of the history, which is a judgement about what is worth offering rather than a factual error. Two things sit on that list today — `donchian/fast` on the daily (in −0.09 / out +0.17) and `donchian/accurate` on the daily (in +0.01 / out +0.48). Both were fine on the shallower data the old figures came from; deepening the cache is what exposed them.

`nativeTimeframe` on a profile says which timeframe `outOfSample`, `sampleSize` and `winRate` are measured on. It defaults to the daily, and only the opening range sets it — measuring a 15 m strategy on daily bars yields zero signals and would report a correct profile as broken.

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

**Nothing ships in `registry.ts` that loses money.** The Señales view offers three strategies and five presets, and every one of them is measured positive on the timeframe it is offered on. Four things were removed for failing that bar: `pullback` (+0.01 R), `reversal/original` (−0.15 R), `donchian/slow` (+0.87 in-sample, −0.14 out) and `donchian/momentum` (+0.74 in, +0.06 out). Explaining why a losing strategy loses is not worth the screen space — if one comes back, it must clear costs out of sample first.

The reversal's 4 h was offered at a declared +0.15 R and measures **+0.03 R** on the deeper cache, so it is now blocked. Nothing had to be edited to block it: the verdict is derived from the number, so correcting the number was the whole fix.

**Timeframe gating is derived, not listed.** `timeframeVerdict()` and `tradableTimeframes()` read `byTimeframe`, so the set of selectable timeframes updates automatically when a profile is re-measured and can never contradict it. Below `MIN_TRADABLE_R` (0.1) the button is disabled rather than hidden, so the reason stays visible. Switching strategy or preset snaps the timeframe to the best tradable one. `TIMEFRAMES` in `signals.ts` used to carry a hand-written `verdict` per timeframe; it was dead and it was wrong, and a list that is free to contradict the measurement is exactly what this design exists to avoid.

**`appliesTo()` is a different question from `timeframeVerdict()`.** Blocked means the measured edge does not clear costs; not applicable means the strategy cannot be computed there at all. The opening range is built from 30-minute ranges, so on 1 h and above it is the second. Telling the user "the commission eats it" about a timeframe where nothing was ever measured is a lie, so the button tooltip, the backtest list and the explanatory paragraph all branch on it.

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
- **The measured frontier**, on the only genuinely long history (daily BTC/ETH/SOL, 4 years, 571 configurations that stayed positive in both epochs): 50–55 % hit rate buys +0.31 R; 60–65 % buys +0.117 R; 70–75 % buys +0.081 R. There is no corner with "70 % and +0.25 R". Hit rate is bought at market price and gets expensive above 60 %.
- **Beware the history the cache actually holds.** This used to say 15 m covered ~15 days and 1 H ~60 days, and that was a property of the fetcher, not of OKX — `/market/candles` caps at ~1440 bars. On `history-candles` the cache now holds ~164 000 bars of 15 m per major instrument, back to 2022. The dated X-PERP contracts still have only months, aggregates over "10 instruments × 4 timeframes" are still far less independent than the n suggests, and ETH/SOL still appear twice (spot and perp).
- **The pullback (Connors RSI2) hits 62–68 % and still makes nothing.** Measured expectancy is +0.01 R on the daily over n=176, and 25 combinations of stop, exit and target were swept without one reaching profitability. It was shipped first with a warning, then deleted: a strategy that wins two thirds of the time and loses money is exactly the trap this project keeps re-discovering, and leaving it selectable meant the app still offered it.
- An RSI gate and a minimum reward-to-risk filter both *hurt*. A trend filter is structurally incompatible: the signal fires far from the moving average by construction, so "only trade with the trend" leaves almost no signals.

#### The opening range, and why a 24/7 market has an opening

This is the one intraday strategy that clears costs, and the reasoning is not the same as for the others. `npm run orb` re-derives all of it.

- **Crypto borrows Wall Street's open.** At 09:30 in New York, BTC's 15 m volume runs at **1.48× the daily average** and the first half hour's range is 0.42 % against 0.25 % at UTC midnight. Sweeping all 24 hours of the New York clock, 09:30 is the **only clearly positive hour**: 08:30 measures −0.03 R and 10:30 −0.04 R. London's open is worse than useless — **0 of 216 configurations positive** — and UTC midnight, the hour the daily candle uses, has *below-average* volume.
- **The anchor must follow daylight saving.** New York opens at 13:30 UTC in summer and 14:30 in winter. A fixed UTC anchor sends half the year to the wrong hour and smears the effect away.
- **A wide stop is what makes 15 m survivable.** Cost in R is `feeRate / (stop distance / price)`. An ATR stop on 15 m sits ~0.25 % away, so a 0.1 % round trip costs 0.4 R. The opening range's stop is the *whole range*, ~0.55 % at the bell, which halves it. Measured +0.18 R at 0.1 %, +0.08 R at 0.2 %, dead at 0.3 %. **Every entry is a taker stop order**, so slippage is the risk that matters, not the signal.
- **It beats its own geometry.** Random entries with the same stop distance, same window and same days measure −0.135 R, so the signal is worth **+0.29 R** over the shape of the trade. This is the control that killed five other candidate families.
- **It does not need a trend.** Measured by Kaufman efficiency at entry: +0.119 R ranging, +0.317 R mixed, +0.460 R trending (n=13, noise). It prefers a trend and never needs one, which is why its `regime` is `any` — a value that means "measured across regimes", not "unknown".
- **Both sides pay.** Longs +0.21 R, shorts +0.10 R, a 50/50 split. Without that, the whole thing would just be beta on a market that went up.
- **The concentration to watch is 2026.** Positive every year (2022 +0.10, 2023 +0.10, 2024 +0.05, 2025 +0.08) but 2026 measures +0.56 and carries over half the total profit from 16 % of the trades. Excluding it, expectancy is ~+0.08 R — below `MIN_TRADABLE_R`.
- **164 of 648 swept configurations passed both epochs, which is exactly the 25 % chance rate.** The count proves nothing. What does is the structure: NY 161/216 positive against London 0/216. Chance does not sort itself by anchor.
- The volume filter is the paper's "stocks in play" screen with no stocks to screen. It lifts +0.14 R to +0.18 R and cuts two days in three, which is why both are offered as presets rather than one being obviously right.

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

Two things that only show up at that width: a `.card-head` with an action control squeezes its title into a one-word-per-line column unless it stacks, and a flex `<td>` will not shrink below its content, so an unbreakable instrument id like `ZEC-USD_UM_XPERP-310530` overflows the card until it gets `min-width: 0` plus `overflow-wrap`.

A horizontally scrolling strip needs the selected item scrolled into view. Two strategy tabs just fit at 390 px; the third pushed the active tab off-screen, so the user saw two unselected tabs and no indication of which strategy was running. `Signals.tsx` puts a ref on the selected tab and calls `scrollIntoView({ block: 'nearest', inline: 'nearest' })` — `block: 'nearest'` matters, or selecting a tab yanks the page vertically.

Chrome's window will not go below ~500 px on macOS, so `resize_page` cannot reach phone widths — use device emulation (`390x844x2,mobile,touch`) or the media query never fires.

## Conventions

### Display currency

The account settles in **USDC**, so every figure the API returns is in dollars. OKX's own app converts for display, so a euro-configured OKX will not match until the app is switched too — `src/lib/currency.ts` holds that choice and the rate, read from OKX's own `USDC-EUR` ticker rather than hardcoded.

`usd()` converts on the way out, so switching currency changes every figure at once. The catch: the formatters read a module store, not props, so **nothing re-renders on their own** — `Views` in `App.tsx` subscribes via `useCurrency()` to re-render the tree. Remove that call and only the sidebar updates.

**The calendar keys each trade on the day it was OPENED**, which is what OKX's analytics page does: a trade opened on the 13th and closed on the 14th is booked on the 13th. Verified against real screenshots — the 30-day aggregates then match OKX exactly (total, hit rate, position count and risk/reward all line up). Individual days can still differ when OKX splits a partial close across sessions.

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

### Charts

`src/styles/tokens.css` holds a **categorical palette validated for colour-vision deficiency in both themes**. Do not change the `--series-*` hexes or their order without re-validating: the slot order is the safety mechanism, not decoration.

- **Colour follows the entity, never its rank.** `src/lib/colors.ts` assigns a stable hue per currency and persists it. Only the top 7 get a hue; everything else is grey, matching the "Otros" segment — so the chart and the tables always agree.
- Statistics under `MIN_SAMPLE` (5) trades render faded and hide their win rate. Two trades at 100 % is noise and the UI must not invite reading it as signal.
- **Ticks can overlap; labels cannot.** `PositionRisk` places every marker by `left: %`, which is fine for the ticks and broke for the labels: on a position that has barely moved, entry and break-even land a few percent apart and their two prices printed interleaved into one unreadable string. Labels are now dropped when they would collide, in priority order — liquidation and mark price win because they are what the position is read against, entry and break-even yield. Any absolutely-positioned label track needs the same treatment.
- **A `<span>` used as a bar must be given `display: block`.** An inline box ignores `width` and `height` outright, so the bar silently never draws while the DOM and the computed style both look correct — `getComputedStyle().width` happily reports `100%`. This has now bitten `.rail-fill`, `.rail-track`, `.avg-track` and `.avg-bar`. To sweep for it: find elements with an inline `width` style whose computed `display` is `inline`.
- **An overlay with holes must break its path, not bridge it.** `linePath` in `PriceChart.tsx` keyed its `M` off `i === 0`, so any overlay whose first visible bar was `NaN` produced a path starting with `L` — invalid SVG the browser rejects outright, silently, with the console as the only clue. It also joined straight across gaps, drawing a level that was never there. Both were latent until the opening range, whose overlays exist only inside each day's window. The band underneath is a `<path>` of closed subpaths for the same reason; it was a single `<polygon>`, which spanned the holes.
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
