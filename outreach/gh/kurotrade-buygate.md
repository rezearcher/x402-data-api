Hi — I read `backend/src/buyGate.js` / `riskGuard.evaluate`. The pre-quote buy gate takes `token: { liquidityUsd, fdv, txns24h }`, all DexScreener-derived, so a Base token with healthy-looking liquidity and buy/sell counts but a contract you can't sell (honeypot / blacklist / fee-setter / upgradeable proxy) still passes and becomes an intent — and in the autonomous executor path nothing else looks at the contract before it signs.

A contract-level check fits as one more gate in `evaluate` (pre-quote, no extra RPC code on your side). We run a pay-per-call endpoint that does an on-chain sell simulation + admin-control checks + Uniswap v3 WETH-pool liquidity:

```
curl 'https://api.greyridgesignals.ai/chain/token-report/preview?token=aero'
# -> {"verdict":"SAFE"|"CAUTION"|"AVOID","security":{"isHoneypot":false,"sellable":true,"canMint":..},"liquidity":{"wethPoolUsd":..}}
```
Free preview works for any Base token (rate-limited); paid is `GET /chain/token-report?token=<0x…>` at $0.01 USDC via x402 — or `/gate/swap` ($0.008, GO/HOLD/BLOCK incl. notional-vs-liquidity).

Sketch for `buyGate.js` (fail-closed on AVOID/!sellable, fail-open-to-your-existing-gates on network error — your call):
```js
const r = await fetch(`https://api.greyridgesignals.ai/chain/token-report/preview?token=${addr}`).then(r=>r.json());
if (r.verdict === 'AVOID' || r.security?.sellable === false) return { ok:false, code:'TOKEN_UNSELLABLE', message:r.verdict };
```
Honest limit: it doesn't return buy/sell tax %, only whether the sell simulation succeeds. Give me a Base token you'd test and I'll paste the live output here, or I can PR the gate with a test in your `buyGate.test.mjs` style.
