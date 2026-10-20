**A live x402 v2 seller on Base mainnet for pre-trade token checks: one call returns go / hold / block**

If you build an agent that buys tokens, one cheap call before the swap can tell it whether the token is a honeypot, whether it can be sold, how deep the liquidity is, and what the owner can still do (mint, pause, blacklist, upgrade).

- **Free preview, no wallet:** `curl -s https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=weth`
  (demo tokens: usdc, weth, cbbtc, aero, degen). It returns the same response shape as the paid route: `{decision: go|hold|block, verdict, risk_score, liquidity_usd, flags[]}`.
- **Paid route:** `GET /gate/swap?token=<any Base ERC-20>&side=buy&notional_usd=250`, $0.008 USDC on Base (`eip155:8453`, exact scheme), x402 v2. A full report is `/chain/token-report`.
- Discovery: `/.well-known/x402`, `/openapi.json`, and a remote MCP server at `/mcp`.

Limits, stated up front: it is a heuristic signal and not a guarantee. DEX buy/sell tax percentages are not measured. Only `transferTaxBps` is measured, via `eth_simulateV1` on a plain transfer. Base only. I measured the preview latency at about 0.9 s median over 12 runs. That is a single sample, not an SLA.

I'd like to hear which token you'd test it on first and what response fields your agent needs. I'll add them if they are cheap to measure.
