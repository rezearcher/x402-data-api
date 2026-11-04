# 96% of x402 services are a blank line in the directory. One file fixes that.

If your API takes x402 payments, there is a decent chance it already shows up in the Open 402 Directory — the registry at `agentinternetruntime.com` that agent developers and crawlers use to find payable endpoints. And there is a better-than-even chance it shows up as nothing: a bare domain name, no capabilities, no prices, tagged **unclaimed**.

We pulled the directory's own composition numbers. They are lopsided.

## What the directory actually looks like

From the live stats endpoint (`/api/directory/stats`, read 2026-11-04):

- **18,204** domains indexed
- **677** verified — **3.72%**
- **17,527** unclaimed — **96.28%**

An unclaimed row is not a mistake. It means the directory (fed by on-chain indexing via x402scan) has *observed your domain settling 402 payments* but you have never published a machine-readable manifest describing what those payments buy. So an agent browsing or filtering the directory sees your domain and nothing else — no intents, no prices, no way to decide whether to call you. It scrolls past.

The 3.72% that are verified publish one file: `/.well-known/agent.json`. That is the entire difference between a blank line and a card that renders your display name, description, protocol badge, and endpoint list.

## Verified does not mean rich

We sampled 40 verified cards and counted the intents each one exposes. The median verified card advertises **3 intents**. Plenty expose exactly one. The ceiling in our sample was 116, but those are rare — most providers who bothered to publish a manifest published a thin one.

That is the real opening. "Verified" clears a very low bar, and almost nobody clears it with a detailed capability list. A manifest that actually enumerates every endpoint — with per-call prices and parameter schemas — is a different object from a one-line card, and it is the object an autonomous buyer can act on without a human in the loop.

## The file

The minimum a manifest needs to move you from unclaimed to verified:

```json
{
  "version": "1.4",
  "origin": "your-domain.example",
  "display_name": "Your Service",
  "payout_address": "0x...",
  "payments": { "x402": { "networks": [
    { "network": "base", "asset": "USDC", "contract": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }
  ] } },
  "intents": [
    { "name": "...", "endpoint": "/...", "method": "GET",
      "price": { "amount": 0.001, "currency": "USDC" } }
  ]
}
```

The directory reads `Object.keys(payments)` and renders whatever protocol it finds, so the same file works whether you settle over x402, L402, or something newer. Serve it over HTTPS, keep the listed endpoints on the same origin as the manifest, and you are crawlable.

Two notes most write-ups skip:

- **Self-host it; don't rely on the proxy.** The directory will proxy-fetch a manifest for owners who don't publish one, but a self-hosted manifest is provider-authoritative — you control the content, and you avoid the "this domain is not allowed" proxy blocks that some domains hit.
- **Serve the IETF discovery path too.** The emerging `draft-hawkins-x402-dns-discovery` convention has indexers look for `/.well-known/x402` (and `/.well-known/x402.json`) before falling back. Publishing that alias alongside `agent.json` gets you picked up by directory-convention crawlers *and* DNS-discovery crawlers from one deploy.

## A worked reference you can copy

Our own manifest is live and self-hosted, and you are welcome to clone its shape:

**`https://api.greyridgesignals.ai/.well-known/agent.json`**

It is a spec-v1.4 ("Capable") manifest with **70 intents**. Every intent carries a name, description, endpoint, method, USDC price, a parameter schema, and a free `preview_endpoint` so an agent can smoke-test the call before paying. Prices span $0.001–$1.

The intent list is ordered by *measured* payer demand rather than by what we'd like to sell — so the top rows are the data endpoints agents actually pay for ($0.001 DeFi yields with APY trend and IL risk, $0.001 spot prices, $0.002 Base gas), and the pre-trade token-safety gate ($0.008 honeypot + liquidity check returning GO / HOLD / BLOCK) sits in the list where real demand puts it. We also attach a `commitments` block with a *measured* availability number (99.58% over a two-week window of free-preview probes, 30,200 samples) — labelled a measurement, not an SLA, because that is what it is.

We serve `/.well-known/agent.json`, the `/agent.json` fallback, and the `/.well-known/x402.json` alias, all returning 200.

## Honest scope

Publishing a manifest makes you *discoverable and describable*. It does not prove your endpoints work, that your prices are fair, or that you deliver what you advertise — the directory flips a row on its next crawl based on the file being present and well-formed, not on any audit. (At the time of writing our own rows are still crawling through from unclaimed; the manifest went live first.) Treat `agent.json` as a capability declaration, not a guarantee. If you want the settlement side proven rather than declared — reconciling a specific on-chain receipt to the advertised payout address — that is a separate check, and it is the thing we build.

---

*Grey Ridge Signals runs a pay-per-call x402 API for Base agents: token-safety gate, DeFi yields, prices, funding rates, and on-chain settlement verification. No account, no key — agents pay inline in USDC. Directory composition figures read live from `agentinternetruntime.com/api/directory/stats`; the median-intent figure is our own count over a 40-card verified sample.*
