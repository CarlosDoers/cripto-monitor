---
name: propose-strategy
description: Turn a described trading strategy into a measured candidate for the Estrategias view. Use when the user describes a setup in words ("opening range breakout", "RSI2 pullback", a Pine script, a YouTube video's rules) and wants to know whether it makes money on this account's instruments. Writes a StrategyResult module and measures it with scripts/try-strategy.mjs; never registers anything that has not cleared the bar.
---

# Proposing a strategy

The user describes a setup. You turn it into a module that implements the
`StrategyResult` contract, measure it, and report what the data says.

**You are not here to find a winner.** You are here to find out whether this
particular idea works. Most do not — four have been deleted from this repo for
failing the bar, including one that won 67 % of its trades and made +0.01 R.
Reporting "this loses money" is a successful run of this skill.

## The one failure mode that matters

Trying variations until something passes is how you manufacture a false
positive. The harness checks both halves of the history, but if you try thirty
configurations and ship the one that clears both halves, you have overfitted to
both halves and the check has bought you nothing. 164 of 648 configurations
passed both epochs in the opening-range sweep — which is exactly the rate blind
chance produces.

So:

- **Measure the idea as described, first, and report that number.** That is the
  headline result, whatever it is.
- Unlimited iteration is allowed for *bugs* — it does not compile, the contract
  is wrong, the signals never fire because of an off-by-one.
- **At most three changes to the actual trading rules**, and every one of them
  gets reported with its result. If you changed the stop three times, say so.
- If it fails, say it fails. Do not go looking for the parameter set that
  rescues it.

## Steps

1. **Read the contract and one exemplar.** `src/lib/indicators/types.ts` for
   `StrategySignal` / `StrategyResult`, and `src/lib/indicators/openingRange.ts`
   as the closest thing to a template — it is the most recently measured one and
   shows the conventions in use.

2. **Restate the rules before writing code.** Entry trigger, stop, exit, and any
   filter, in one short list. Ask the user only if a rule is genuinely missing —
   an unstated exit is worth asking about, since for trend systems the exit *is*
   the strategy. Guess the rest and say what you guessed.

3. **Write the candidate** to `src/lib/indicators/<name>.ts`. Pure function over
   `Candle[]`, returning `summarise(signals, overlays, warmup, active)`. Build it
   on `src/lib/indicators/tradeKit.ts` (`walk` proposes entries one position at a
   time, `resolveTrade` runs each to its end): it already applies the resolution
   rules below, so a candidate cannot flatter itself in its own way.

4. **Measure it**: `npm run try -- src/lib/indicators/<name>.ts`

   **Count every measurement as a trial and pass the count.** The first run is
   `--trials 1`. Each rule change and each neighbourhood cell you measure is
   another variant, and the final verdict is the run with `--trials N` where N
   is everything you measured. The harness then asks the edge to beat what the
   best of N worthless variants reaches by luck (Deflated Sharpe Ratio), and
   the `aguanta` column says how many it could survive. Reporting the pass at
   `--trials 1` after trying eight things is the false positive this skill
   exists to prevent.

5. **If it passes, check the neighbourhood.** Vary one parameter at a time
   around the winning values and measure each. A flat neighbourhood — every
   nearby cell also positive — is what separates a real edge from a lucky
   parameter. If only the exact cell works and its neighbours are negative,
   **that is a failure**, and you report it as one.

6. **Run the review.** `npm run battery -- <module> <export> 4H|1D` — the best
   trades removed, each year, side and coin, BTC's regime, the fee doubled, a
   bootstrap by months, and the correlation with the Donchian and the EMA 200
   cross already shipped. Anything that clears `try` and correlates 0.6–0.9 with
   one of them is a weaker copy of the trend edge, not a new strategy (the
   squeeze, Ichimoku, EMA Wave and the EMA 9/50 all were). Then take it to a
   period nothing has seen: `BOARD_OLD=1 node scripts/fetch-board.mjs 4H|1D`
   fetches 2018–2021 for 14 coins, and a replication there at the same size is
   worth more than any number of neighbouring cells on the data that found it.
7. **Report.** Headline number, both halves, edge over the random control, the
   number of variants tried and whether it survives them, and what you assumed.
   Only then offer to register it.

## Writing the module: the traps this repo has already hit

- **Prices are in R.** `feeR` is `feeInR(entry, stop, feeRate)` with a 0.001
  round trip. `resultR` is gross; the harness subtracts `feeR` itself.
- **Resolve ties pessimistically.** If one candle touches both the stop and the
  target, assume the stop. Same if entry and stop land on the same candle. The
  ambiguity is real and flattering it is how a backtest lies.
- **Never read the current bar's future.** A filter averaged over a window must
  exclude the bar it is filtering. Compare against `close[i-1]` where the
  original rule does.
- **Two stop orders reached by one bar is a loss, not a skipped day.** For a
  breakout with the stop on the other side of the range, a bar that touches both
  levels is a certain −1 R whichever came first. Skipping those bars looks
  cautious and deletes exactly the losers: it turned NR7's true −0.07 R into
  +0.32 R. (The shipped opening range does it too, for 2.5 % of its opens.)
- **A limit order against the move is not credited its target on its fill bar.**
  Price had to come back to the level, so the bar's high may have come first. The
  kit's `limitFill` does this; without it the fair value gap read +0.14 R on
  2018–21 and measures +0.07 R.
- **`sma` keeps a running sum, so one NaN poisons it for good.** A series that
  starts with a warm-up gap needs zeros, not holes, or the strategy silently
  never fires — which reads exactly like an idea with no setups.
- **A filter must not look ahead of the entry.** "An EMA 200 cross within ±6 bars"
  includes crosses after the entry; trades that went on to cross are the winners.
  It made a +0.42 R result read +0.61 R.
- **`try`'s "ventaja sobre azar" is meaningless for a tight stop or a fixed
  target** (its control never awards a target: about −0.4 R by construction for
  NR7). Judge with the battery's controls, or build one with the same order
  geometry on random dates (`npm run ideas fvg` does).
- **Leave the last trade open when its window has not closed.** Marking a live
  trade as resolved at the end of the data turns an unknown into a result.
- **Only confirmed candles.** The harness passes them already; do not re-filter.
- **`erasableSyntaxOnly` is on.** No enums, no constructor parameter properties —
  the scripts run the TypeScript through Node's type stripping and both break it.
- If the strategy only makes sense on one timeframe, detect the bar spacing from
  the candle timestamps and return an empty result elsewhere, the way
  `analyseOpeningRange` does. Do not silently compute nonsense.

## Registering it, if it earns it

Only after `npm run try` prints `PASA`:

1. Add the entry to `STRATEGIES` in `src/lib/indicators/registry.ts`, copying
   the **measured** figures — `byTimeframe` per timeframe, `outOfSample` from the
   second half, `sampleSize` and `winRate` from the native timeframe. Set
   `nativeTimeframe` if it is not the daily. Never type a number you did not
   measure; the audit compares them and exits non-zero on drift.
2. `npm run audit` — must come back with no deviations. Its last table shows
   how many variants the new edge survives; say it next to how many you tried.
3. `npm run lookahead` — must report no signal that looks ahead or repaints,
   and none that differs between the browser's ~1 200 bars and the cache.
4. `npm run build` — the typecheck gate.
5. Drive the real app (`npm run dev`, then the Estrategias view) in both themes and
   at 390 px. Several bugs in this codebase were only ever visible on screen.
