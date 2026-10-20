# BLOCKER: CDP facilitator keys → get into the canonical x402 discovery Bazaar

**Filed:** 2026-10-20 (cycle 2026-10-20ag)
**Severity: P0 distribution.** This is the single biggest reason we have zero external paid calls.

## The finding (evidence)

- The Coinbase **CDP x402 discovery Bazaar** is the canonical, programmatically-queried
  service-discovery pool for x402 buyers/routers:
  `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`
- It currently holds **1000+ resources across 392 distinct hosts**.
- **We are 0 of 1000** — completely absent.
- Our **direct competitors ARE listed** there: `onchainpulse…/api/facet/honeypot`,
  `token-risk.com/v1/scan`, `humanmirror.fr/api/x402/safe-preflight`, `app.fortiblox.com/api/tokens`.
- agentpay.tools (a confirmed real external USDC payer that probes + pays Bazaar services
  2×/week) also shows **0 of our routes** in its 351-service pool — consistent with it drawing
  from CDP discovery, which we're absent from.

## Root cause

A resource only appears in CDP discovery if it **settles through the Coinbase CDP facilitator**.
We currently settle through `facilitator.xpay.sh`, which exposes **no discovery endpoint** —
so our routes are catalogued in **no facilitator-driven Bazaar** (only crawler indexes like x402scan).

Our code **already fully supports** the CDP facilitator — it activates automatically the moment
two Worker secrets are present (`src/index.ts:1420-1432`, `FACILITATOR_MODE="cdp"` is already set
in `wrangler.toml:35`). Nothing else needs changing. This is turnkey.

## THE ATOM (Rez only — needs a Coinbase Developer Platform account)

1. Go to https://portal.cdp.coinbase.com/access/api
2. Create an **API key with the x402 scope** (Secret API Key — gives a Key ID + a Key Secret).
   This is **free**; it does not deploy capital or move funds. The key only authorizes our Worker
   to call Coinbase's facilitator to verify/settle the USDC payments buyers already send us.
3. Set the two values as Cloudflare Worker secrets (from the repo dir):
   ```
   npx wrangler secret put CDP_API_KEY_ID       # paste the Key ID
   npx wrangler secret put CDP_API_KEY_SECRET    # paste the Key Secret (the full PEM / Ed25519 secret)
   ```
4. Redeploy (push to main triggers GH Actions deploy, or `npx wrangler deploy`).

## Verify (anyone, after the keys land)

```
curl -s https://x402-data-api.sigrunner.workers.dev/health
# expect: {"ok":true,"facilitator":"cdp"}   (was "xpay")
```
Then, within a day or two of the first settlement/verify, confirm we appear:
```
curl -s "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?limit=1000" \
  | grep -c sigrunner    # expect > 0
```

## Why this is worth it

CDP discovery is table-stakes x402 distribution — it's where the broadest set of autonomous
buyers and routers look for services. Being absent there means the entire facilitator-driven
buyer population cannot find us, no matter how good the endpoints are. This unblocks the agentpay
paid-probe lever as a side effect.
