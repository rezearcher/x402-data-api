Subcento's layer 4 ("honeypot patterns") is deterministic on calldata, but when `to` is a token (or calldata is a swap/approve of one), the question that actually drains agents is on the *token*: can it be sold, is there a transfer tax, is the owner able to freeze/mint, is liquidity real. That needs a live read of the token contract, not calldata heuristics.

We run an x402 route for exactly that on Base: `GET https://api.greyridgesignals.ai/chain/token-report?token=0x…` ($0.01 USDC, x402 v2, Base). It does on-chain reads (ownership, proxy/upgradeability, mint/blacklist selectors, supply, liquidity context) and returns a verdict. Free, no-wallet preview with the same response shape:

```
curl "https://api.greyridgesignals.ai/chain/token-report/preview?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"
```

Suggested shape: call it only on the CAUTION/escalation path or when the decoded target is an ERC-20 you haven't seen, so it costs you a cent on a small fraction of checks rather than every check, and fold its verdict into the signed `reasons` list. Fail-closed fits your design: if our route is unreachable you simply keep your existing layers' verdict.

Honest limit: we don't measure buy/sell tax percentages yet; if that's what you need, say so and I'll look at it. Happy to give you a reseller-friendly rate if volume justifies it. contact@greyridgesignals.ai
