# The Base trading-agent toolkit: market data, pre-trade safety and payment checks in one index

If you build an autonomous agent that trades or allocates on Base, you need three kinds of calls before it moves money: market data it can trust, a safety check on what it is about to touch, and a check on the paid APIs it depends on. Grey Ridge publishes all three. Most have a free preview you can hit with curl and no key. This page is the index.

Scope, stated once: these are programmatic screens, not guarantees. A "clear" result means no known problem matched the checks listed; it does not mean safe.

## 1. Market data your agent can call without an API key

**Funding rates across six venues.** One call returns perpetual funding for Hyperliquid, OKX, dYdX, Binance, Bybit and Gate, with open interest where the venue exposes it, a spread in basis points and the best long and short venue. Live right now on BTC, the preview shows a 0.88 bps spread with Hyperliquid as the best long venue and OKX as the best short.

```
curl https://api.greyridgesignals.ai/crypto/funding/preview
```

- [Six-venue funding rates for CEX/DEX arb, no API key](https://api.greyridgesignals.ai/research/six-venue-funding-rates-cex-dex-arb-no-api-key)
- [Funding feed in two lines of Python](https://api.greyridgesignals.ai/research/funding-rates-feed-five-venues-two-lines-of-python)
- [Why a raw spread misleads: screening out thin-book venues](https://api.greyridgesignals.ai/research/executable-funding-arb-screening-thin-book-venues)

**DeFi yields.** Pool APY, TVL and a risk-adjusted figure per pool.

```
curl https://api.greyridgesignals.ai/defi/yields/preview
```

- [Keyless DeFi yields API for Base trading agents](https://api.greyridgesignals.ai/research/keyless-defi-yields-api-for-base-trading-agents)
- [Pull yields into your agent with one x402 call](https://api.greyridgesignals.ai/research/pull-defi-yields-into-your-base-agent-one-x402-call)
- [A go/no-go entry verdict instead of a raw APY](https://api.greyridgesignals.ai/research/defi-yield-entry-verdict-go-no-go-for-your-base-agent)
- [The same data as tools for the Vercel AI SDK](https://api.greyridgesignals.ai/research/defi-data-tools-for-your-vercel-ai-sdk-agent)

## 2. Pre-trade safety: check the token and the counterparty first

- [A free keyless pre-trade gate](https://api.greyridgesignals.ai/research/pre-trade-safety-gate-keyless-free-preview): honeypot and risk checks before a swap.
- [A gate that also sizes the trade](https://api.greyridgesignals.ai/research/pre-trade-gate-that-sizes-your-trade): entry and exit simulation, not just a yes or no.
- [Versus static rug-check APIs](https://api.greyridgesignals.ai/research/pre-trade-gate-vs-static-rugcheck-apis): where a one-time lookup falls short and what a live simulation adds.
- [Owner supply concentration](https://api.greyridgesignals.ai/research/owner-supply-concentration-rug-check): the rug signal a honeypot test alone misses.
- [Upgradeable proxy and EIP-7702 detection](https://api.greyridgesignals.ai/research/pre-trade-gate-upgradeable-proxy-and-eip7702-detection)
- [Wallet screening against the OFAC SDN list](https://api.greyridgesignals.ai/research/screen-a-wallet-for-ofac-sanctions-before-your-agent-trades). The live preview endpoint returns a verdict plus which list matched:

```
curl https://api.greyridgesignals.ai/chain/wallet-screen/preview
```

- [Run the gate in CI](https://api.greyridgesignals.ai/research/trade-safety-gate-cli-for-ci) and [embed a live token-safety badge](https://api.greyridgesignals.ai/research/embed-live-token-safety-badge).

## 3. Check the APIs your agent pays for

An agent that pays per call is exposed to endpoints that charge more than advertised, fail to deliver after payment, or never settle. The pre- and post-payment checks are collected here: [x402 payment due diligence before and after your agent pays](https://api.greyridgesignals.ai/research/x402-payment-due-diligence-before-and-after-your-agent-pays).

## Where to start

If you only have five minutes: run the funding preview and the wallet-screen preview above, then wire the pre-trade gate in front of your swap call. All three previews are free and keyless; paid routes are priced per call in USDC over x402.

Securing the MCP servers your agent connects to is a separate topic: [MCP server security, start to finish](https://api.greyridgesignals.ai/research/mcp-server-security-guide-scan-badge-monitor).
