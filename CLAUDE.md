# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read-only dashboard for an OKX trading account. Vite + React 19 + TypeScript, deployed on Vercel with a serverless function that signs the API requests. The UI is in Spanish (es-ES).

## Commands

```bash
npm run dev              # Vite dev server; also runs the api/ function (see below)
npm run build            # tsc -b && vite build — the typecheck gate
npm run lint             # oxlint
./scripts/push-env.sh    # push .env.local vars to the linked Vercel project
vercel --prod            # deploy (manual; a git push does NOT deploy)
```

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

- **`/trade/fills-history`** — the fee *tier* gives a maker and a taker rate, but what decides whether a backtest applies is the **mix**. Each fill carries `execType` (`M`/`T`), so `feeMix()` in `src/lib/fees.ts` measures it: this account came out at 52 % maker and an effective 0.033 % a side (0.066 % round trip), against the 0.1 % the sweeps assume. The weighting deliberately avoids the contract multiplier — a fill's notional is `fee / rate`, not `size × price`, so the figure is exact without any per-instrument `ctVal`.

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
- **`posId` is not unique in `positions-history`.** One position closed in several parts produces several rows sharing it, so it cannot be a React key on its own — React silently drops the duplicates from the table. `Trade.id` is `${posId}-${uTime}`.

### Data layer

`src/lib/queries.ts` is one hook per endpoint over TanStack Query. Two cadences: `LIVE` (30 s) for balances, positions, prices; `SLOW` (5 min) for history. **Each tick is a serverless invocation** — raise these before adding polling. Intervals pause while the tab is backgrounded.

Two hooks compose the raw queries into what views actually need:

- `src/lib/portfolio.ts` — merges the trading and funding wallets, prices everything in USD, and exposes `netWorth` (all wallets, from `asset-valuation`) alongside `totalUsd` (the priced holdings). Both Resumen and Cartera read `netWorth` so they can never disagree.
- `src/lib/performance.ts` — every trading statistic, plus the period filter. `computePerformance()` is a pure function; test ideas belong there.
- `src/lib/signals.ts` — candles plus the indicator, for the Señales view.

### Indicators

`src/lib/indicators/` ports TradingView indicators to TypeScript.

**Every number in a `backtest` profile must be measured, never written by hand.** The UI presents them as fact next to real money. An audit caught three invented profiles at once, including one claiming +0.58 R for a setup that actually measures +0.01 R.

```bash
node scripts/fetch-candles.mjs                              # populate ./.candles (needs npm run dev up)
node --import ./scripts/_hook.mjs scripts/audit-strategies.mjs
```

The audit reads the declared figures **from `registry.ts` itself** rather than from a copy, so it cannot go stale, and it exits non-zero on any drift. It also fails when a timeframe is selectable but measures below `MIN_TRADABLE_R` — that check is the guard rail, not a formality. Run it after touching any strategy parameter.

**Nothing ships in `registry.ts` that loses money.** The Señales view offers two strategies and three presets, and every one of them is measured positive on the timeframe it is offered on. Four things were removed for failing that bar: `pullback` (+0.01 R), `reversal/original` (−0.15 R), `donchian/slow` (+0.87 in-sample, −0.14 out) and `donchian/momentum` (+0.74 in, +0.06 out). Explaining why a losing strategy loses is not worth the screen space — if one comes back, it must clear costs out of sample first.

**Timeframe gating is derived, not listed.** `timeframeVerdict()` and `tradableTimeframes()` read `byTimeframe`, so the set of selectable timeframes updates automatically when a profile is re-measured and can never contradict it. Below `MIN_TRADABLE_R` (0.1) the button is disabled rather than hidden, so the reason stays visible. Switching strategy or preset snaps the timeframe to the best tradable one, because the breakout is daily-only while the reversal also allows 4 h.

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
- **Both strategies only clear costs on the daily.** Reversal +0.54 R (n=115, out-of-sample +0.57), Donchian +0.75 R (n=111, out-of-sample +0.34); everything shorter is flat or negative. The Donchian result is the weaker of the two despite the bigger headline, because it is concentrated in SOL's run — the UI says so in the preset note.
- **A flat neighbourhood is the real robustness test.** The reversal was re-swept over 108 nearby configurations: every one that produced enough signals scored +0.45 to +0.59 R on the daily. The edge does not depend on having landed on exact parameters, which is what distinguishes it from a curve fit.
- Kaufman's efficiency ratio (`registry.ts`) reads the current regime. It has sat at 0.08–0.13 across all timeframes — firmly ranging, which is why mean reversion works and trend following struggles. The view surfaces it so the two tabs can be read as complements.
- **Do not automate the regime switch.** Routing signals to the breakout above an efficiency ratio of 0.25–0.35 and to the reversal below scored +0.55 R against +0.54 R for the reversal alone. Because the ratio almost never clears the threshold, the trend branch barely fires and the "combination" is just the reversal with extra machinery. Measured, not assumed — the note is on `efficiencyRatio()`.
- **A high hit rate is geometry, not signal.** With RANDOM entries and a wide stop against a near target (6 ATR stop, 0.4 R target), the hit rate is **73 %** with an expectancy of −0.006 R. Any candidate claiming 78–88 % must be checked against a random-entry control with the *same* stop/target geometry before it means anything. Five separate strategy families were explored (Bollinger+RSI, VWAP bands, deep pullback, multi-timeframe, target sweep); every "80 %+ hit rate" they produced fell inside the random band. None survived.
- **The measured frontier**, on the only genuinely long history (daily BTC/ETH/SOL, 4 years, 571 configurations that stayed positive in both epochs): 50–55 % hit rate buys +0.31 R; 60–65 % buys +0.117 R; 70–75 % buys +0.081 R. There is no corner with "70 % and +0.25 R". Hit rate is bought at market price and gets expensive above 60 %.
- **Beware the history the cache actually holds.** 15 m covers ~15 days and 1 H ~60 days; only daily BTC/ETH/SOL reaches four years. Aggregates over "10 instruments × 4 timeframes" are far less independent than the n suggests, and ETH/SOL appear twice (spot and perp). Weight daily results accordingly.
- **The pullback (Connors RSI2) hits 62–68 % and still makes nothing.** Measured expectancy is +0.01 R on the daily over n=176, and 25 combinations of stop, exit and target were swept without one reaching profitability. It was shipped first with a warning, then deleted: a strategy that wins two thirds of the time and loses money is exactly the trap this project keeps re-discovering, and leaving it selectable meant the app still offered it.
- An RSI gate and a minimum reward-to-risk filter both *hurt*. A trend filter is structurally incompatible: the signal fires far from the moving average by construction, so "only trade with the trend" leaves almost no signals.

Routing is hash-based in `src/lib/router.ts` (`useSyncExternalStore`, no router dependency). Adding a view means touching `ROUTES`, the `NAV` map in `Layout.tsx`, and the switch in `App.tsx`.

### Mobile

**Every data table must be wrapped in `TableWrap`, never a bare `div.table-wrap`.** Below 720 px the CSS redraws each row as a card: the first cell becomes the card title and every other cell is labelled by its column. Those labels come from a `useEffect` in `TableWrap` that copies the `<thead>` text onto each `<td>` as `data-label` after every render — derived rather than hand-written, so a label cannot disagree with its column when one is inserted. A bare `div` gets the card layout with no labels at all.

This exists because horizontal scroll inside a card is where mobile data goes to die: at 390 px the tables were hiding 220–650 px of themselves, and the hidden part is always the right-hand columns — PnL, weight, result.

Two things that only show up at that width: a `.card-head` with an action control squeezes its title into a one-word-per-line column unless it stacks, and a flex `<td>` will not shrink below its content, so an unbreakable instrument id like `ZEC-USD_UM_XPERP-310530` overflows the card until it gets `min-width: 0` plus `overflow-wrap`.

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
- **A `<span>` used as a bar must be given `display: block`.** An inline box ignores `width` and `height` outright, so the bar silently never draws while the DOM and the computed style both look correct — `getComputedStyle().width` happily reports `100%`. This has now bitten `.rail-fill`, `.rail-track`, `.avg-track` and `.avg-bar`. To sweep for it: find elements with an inline `width` style whose computed `display` is `inline`.
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
