// Patient trend-rider for the 24h cbBTC/USDC race (agent-fun/bars-replay/v1).
//
// Idea: on 1-minute bars the market is mostly noise (1m return std ~8 bps) while a
// full round trip costs ~26-40 bps, so fast signals bleed out. This bot therefore
// trades rarely and only with the multi-hour trend:
//
//   * ENTRY: once 30 closes are known, buy 100% of cash the first time the
//     trailing 30-bar return turns positive. (On the dev window that fired at
//     bar 37 and rode the day's big move; buy-and-hold made +$32.17 there and
//     this entry made +$35.89 in local backtests.)
//   * FALLBACK: if no entry signal has fired by tradable batch 720 (halfway),
//     buy anyway, so the entry always makes at least one trade.
//   * EXIT: trailing stop — sell everything if the close falls 2.5% below the
//     highest close since the position filled. A 2.5% stop sits just outside the
//     dev window's own 1.98% peak-to-trough chop, so it only fires on a real
//     reversal; in a downtrend stress test (dev window reversed) it capped the
//     loss at about -$18 instead of buy-and-hold's -$38.
//   * RE-ENTRY (at most once): after a stop-out, buy again only if the
//     trailing 240-bar return exceeds +1.0% — a genuine trend reversal, not noise.
//
// Everything is deterministic: every decision comes from the bars the harness
// sends, never from the wall clock, the environment, or randomness.

import { runBars } from "./vendor/makefun-bars.ts";
import type { BarsState, Batch, OrderInput } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";

// Trailing lookbacks, in bars (1 bar = 1 minute).
const ENTRY_LOOKBACK = 30;
const REENTRY_LOOKBACK = 240;
const FALLBACK_BATCH = 720;

// Trailing stop: sell when the close drops this far below the highest close
// seen since the position filled.
const TRAIL_STOP = 0.025;

// Re-entry needs a real reversal: trailing 240-bar return above this.
const REENTRY_RETURN = 0.01;

// Generous slippage cap: fills land at the next bar's open; 1m moves are
// ~8 bps std, impact at full size ~15 bps, so 200 bps leaves ample room
// while still guarding against a wild gap.
const MAX_SLIPPAGE_BPS = 200;

const closes: number[] = [];
let tradableBatches = 0;
let wantLong = false;
let enteredOnce = false;
let reEntries = 0;
let peak: number | null = null;

function closeOf(state: BarsState): number | null {
  const c = state.close(SYMBOL);
  return c === null ? null : Number(c);
}

function trailingReturn(lookback: number): number | null {
  if (closes.length <= lookback) return null;
  const now = closes[closes.length - 1];
  const then = closes[closes.length - 1 - lookback];
  if (then <= 0) return null;
  return now / then - 1;
}

function buyAll(state: BarsState): OrderInput[] {
  if (state.cash <= 0n) return [];
  return [
    {
      side: "buy",
      symbol: SYMBOL,
      notional_quote_units: state.cash,
      max_slippage_bps: MAX_SLIPPAGE_BPS,
    },
  ];
}

function sellAll(state: BarsState): OrderInput[] {
  const pos = state.positions.get(SYMBOL);
  if (!pos || pos.qty <= 0n) return [];
  return [
    {
      side: "sell",
      symbol: SYMBOL,
      qty: pos.qty,
      max_slippage_bps: MAX_SLIPPAGE_BPS,
    },
  ];
}

function logTrade(kind: string, state: BarsState, close: number | null): void {
  // Diagnostics go to stderr only; stdout carries replies alone, so this
  // cannot change the action log.
  console.error(
    `[bot] ${kind} seq=${state.seq} close=${close === null ? "?" : close.toFixed(2)} cash=${state.cash} equity=${state.equity}`,
  );
}

await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    // Record the new close first; warm-up bars count as history but never trade.
    const close = closeOf(state);
    if (close !== null) closes.push(close);
    if (state.warmingUp) return [];
    tradableBatches += 1;

    const holding = (state.positions.get(SYMBOL)?.qty ?? 0n) > 0n;

    // We want to be long but hold nothing (order not yet filled, or rejected):
    // (re)send the buy.
    if (wantLong && !holding) return buyAll(state);

    // We want to be flat but still hold something (sell rejected): retry the sell.
    if (!wantLong && holding) return sellAll(state);

    if (wantLong && holding) {
      // Track the highest close since the position filled.
      if (peak === null) peak = close;
      if (close !== null) peak = Math.max(peak, close);
      if (close !== null && peak !== null && close < peak * (1 - TRAIL_STOP)) {
        wantLong = false;
        peak = null;
        logTrade("exit-trailing-stop", state, close);
        return sellAll(state);
      }
      return [];
    }

    // Flat and holding nothing: look for an entry.
    if (!enteredOnce) {
      const ret30 = trailingReturn(ENTRY_LOOKBACK);
      if (ret30 !== null && ret30 > 0) {
        wantLong = true;
        enteredOnce = true;
        peak = null;
        logTrade("enter", state, close);
        return buyAll(state);
      }
      if (tradableBatches >= FALLBACK_BATCH) {
        wantLong = true;
        enteredOnce = true;
        peak = null;
        logTrade("enter-fallback", state, close);
        return buyAll(state);
      }
      return [];
    }

    // Stopped out earlier: one strict re-entry on a genuine reversal.
    if (reEntries < 1) {
      const ret240 = trailingReturn(REENTRY_LOOKBACK);
      if (ret240 !== null && ret240 > REENTRY_RETURN) {
        wantLong = true;
        reEntries += 1;
        peak = null;
        logTrade("re-enter", state, close);
        return buyAll(state);
      }
    }
    return [];
  },
});
