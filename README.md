[![make.fun](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/ASEP9929/makefun-btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/ASEP9929/makefun-btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)

# Patient trend-rider — BTC trading bot for the 24h cbBTC/USDC race

Entry for the [make.fun bounty](https://make.fun/bounty/btc-race-24h-20261123-0511): a bot that
trades Coinbase Wrapped BTC (cbBTC) against USDC, minute by minute, with $1,000 of
paper money, for the highest net PnL on the 24 hours that start 15 minutes after
the deadline. Nothing is traded for real.

## Strategy

On 1-minute bars the market is mostly noise (1m return std ~8 bps) while a full
round trip costs ~26–40 bps, so fast signals bleed out. This bot trades rarely
and only with the multi-hour trend:

- **Entry:** once 30 closes are known, buy 100% of cash the first time the
  trailing 30-bar return turns positive.
- **Fallback:** if no entry signal has fired by tradable batch 720 (halfway),
  buy anyway, so the entry always makes at least one trade.
- **Exit:** trailing stop — sell everything if the close falls 2.5% below the
  highest close since the position filled.
- **Re-entry (at most once):** after a stop-out, buy again only if the trailing
  240-bar return exceeds +1.0% — a genuine reversal, not noise.

## Dev-window result (local grade, kit harness, process driver)

- **Net PnL: +35.893065 USDC** (return +3.59%)
- Trades: 1 · win rate 1.000 · max drawdown 1.98% · exposure 97.4%
- Fees: 0.814524 USDC (net PnL at 2x fees: +35.065617 USDC)
- Guardrails met. Two executions reproduced byte for byte (deterministic).
- Downtrend stress test (dev window reversed in time): loss capped at about
  −$18 vs buy-and-hold's −$38.

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript, stdlib only). Speaks
  `agent-fun/bars-replay/v1` via the kit SDK shim in `vendor/`.
- `vendor/makefun-bars.ts` — kit SDK shim, copied byte for byte from the kit.
- `LICENSE` — MIT.
