---
name: propose-strategy
description: Turn a described trading strategy into a measured candidate for the Señales view. Use when the user describes a setup in words ("opening range breakout", "RSI2 pullback", a Pine script, a YouTube video's rules) and wants to know whether it makes money on this account's instruments. Writes a StrategyResult module and measures it with scripts/try-strategy.mjs; never registers anything that has not cleared the bar.
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
   `Candle[]`, returning `summarise(signals, overlays, warmup, active)`.

4. **Measure it**: `npm run try -- src/lib/indicators/<name>.ts`

5. **If it passes, check the neighbourhood.** Vary one parameter at a time
   around the winning values and measure each. A flat neighbourhood — every
   nearby cell also positive — is what separates a real edge from a lucky
   parameter. If only the exact cell works and its neighbours are negative,
   **that is a failure**, and you report it as one.

6. **Report.** Headline number, both halves, edge over the random control, and
   what you assumed. Only then offer to register it.

## Writing the module: the traps this repo has already hit

- **Prices are in R.** `feeR` is `feeInR(entry, stop, feeRate)` with a 0.001
  round trip. `resultR` is gross; the harness subtracts `feeR` itself.
- **Resolve ties pessimistically.** If one candle touches both the stop and the
  target, assume the stop. Same if entry and stop land on the same candle. The
  ambiguity is real and flattering it is how a backtest lies.
- **Never read the current bar's future.** A filter averaged over a window must
  exclude the bar it is filtering. Compare against `close[i-1]` where the
  original rule does.
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
2. `npm run audit` — must come back with no deviations.
3. `npm run build` — the typecheck gate.
4. Drive the real app (`npm run dev`, then the Señales view) in both themes and
   at 390 px. Several bugs in this codebase were only ever visible on screen.
