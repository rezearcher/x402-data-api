# CDP Facilitator settlement flow & wallet requirements — ground truth

**Task:** t_5410c2d1 (research). **Measured:** 2026-10-28T05:55Z against live
production (`x402-data-api.sigrunner.workers.dev`), the live CDP discovery API, and
the live CDP seller docs. Every claim below is either a doc quote with URL or a
command result reproduced in this file.

---

## 0. TL;DR — the card's premise is half wrong, and the half that's wrong matters

| Card claim | Verdict |
|---|---|
| "~$0.001 USDC spend required to re-list" | **Wrong framing.** The money *recirculates*: buyer-wallet → our own payTo. Net capital cost ≈ **$0.00**. Facilitator fee is **$0 for the first 1,000 settlements/month**. Gas is paid by the facilitator, not us. |
| "One settlement re-enters search" | **Half true.** One settlement indexes/re-snapshots **that one route**, in ≤15 min. It is **not durable**: a route with **no settlement for 30 days is removed from catalog *and* search**. So it is a recurring obligation, not a one-time fix. |
| "We are not in `/discovery/resources` search" | **Wrong.** We hold **47 catalog records / 46 distinct routes** under our payTo. The service is listed. `/discovery/resources` is an 89,579-item paginated list — "2 of ours in the first 1000" is a **pagination artifact**, not absence. |
| "The 7 missed queries are an indexing failure" | **Wrong, and this is the important correction.** All 7 missed queries map to routes that are **already catalogued**. Zero of them are blocked by indexing. They are blocked by **stored-description vocabulary** and **payer depth**. |
| "Description audit is separate from the indexing issue" | **Wrong — they are coupled.** The catalog stores a **snapshot taken at settlement** and never re-crawls. A description rewrite **does not publish** until a settlement pushes it. Description fix *requires* the settlement; settlement *is* the publish button. |

**One-line remediation:** rewrite descriptions to buyer vocabulary, then run **one
existing script call per rewritten route** (`scripts/refresh_bazaar_catalog.js --route <path>`)
to publish the new snapshot. Do **not** bulk-index the 20 unindexed routes — none of
them is on the critical path for the missed queries.

---

## 1. Exact settlement mechanism (guardrail 1: "the exact endpoint or method")

### 1a. What triggers indexing (authoritative)

Source: <https://docs.cdp.coinbase.com/x402/seller/get-discovered.md>

> **Getting into the index is automatic.** There is no registration form or approval
> step. To get a resource indexed, **complete a successful paid call through the CDP
> Facilitator**.
> ...Indexing runs asynchronously in two phases. **Phase one triggers as soon as the
> response is successfully settled** and surfaces the endpoint in the catalog (Bazaar
> MCP tools and `facilitator/list-resources`), typically **within 15 minutes**...
> ...**The payment's `resource` is what gets linked back to the bazaar extension** that
> was declared in the 402 response.
> ...**Resources that go 30 days without a settlement are removed from both the
> catalog and search results**, so a listed route needs ongoing traffic to stay listed.

Also from the same doc: ranking is recomputed on a **6-hour schedule**, weighted by
**buyer reach, transaction volume, recency**; `description` is capped at **500 chars**
(longer → `verify`/`settle` rejected); the catalog **does not verify** that a resource
accepts payment or returns data; metadata is screened for **prompt-injection risk**
(text that instructs an agent rather than describing an endpoint → delisted).

### 1b. The wire format

- Facilitator base: `https://api.cdp.coinbase.com/platform/v2/x402`
- `POST /platform/v2/x402/verify` → then `POST /platform/v2/x402/settle`
- Auth: **CDP JWT** (Ed25519-signed, `apiKeyId` + `apiKeySecret`), `Authorization: Bearer <jwt>`,
  JWT `uri` claim bound to `POST api.cdp.coinbase.com/platform/v2/x402/settle`.
- Body: `{ "x402Version": 2, "paymentPayload": {...}, "paymentRequirements": {...} }`
- Response header **`EXTENSION-RESPONSES`** carries per-extension status:
  `success` | `processing` | `rejected` — this is the verification surface.
- Payment scheme: `exact` on `eip155:8453` (Base), asset USDC
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, `payTo 0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10`.

### 1c. How we execute it (already built — do not re-implement)

`scripts/refresh_bazaar_catalog.js` (23 routes in its `ROUTES` manifest) implements
the whole flow: GET the route → parse the `payment-required` 402 → sign EIP-3009 with
`buyer-wallet.json` → attach `extensions.bazaar` + `paymentPayload.resource` → POST to
our own relay → relay mints the CDP JWT server-side and calls verify then settle.

Our relay, `src/index.ts:976` `POST /internal/cdp-settle-raw`:

```
POST /internal/cdp-settle-raw      (auth: CDP_INTERNAL_SECRET, dedicated — not the RapidAPI secret)
body: { paymentPayload, paymentRequirements }
→ verifies (JWT bound to /platform/v2/x402/verify), settles only if verify==200 (JWT bound to /platform/v2/x402/settle)
→ returns { verify: {status, extensionResponses, body}, settle: {...} }
```

Note the relay deliberately captures and returns the `extension-responses` header
(`src/index.ts:1008`) — so a `success` there is the proof the bazaar extension was
accepted, not just that USDC moved.

**EIP-3009 means the payer needs no ETH.** Our buyer wallet has **0 ETH** and that is
fine: the facilitator submits `transferWithAuthorization` and pays the gas.

---

## 2. Wallet status (guardrail 4: "do we have a controlled USDC wallet?")

**Yes — funded and unblocked. No new wallet is needed.**

```
RPC https://base-rpc.publicnode.com  block 53188473
buyer wallet 0xC4852c26498d3187dEc2ce1b19e840710e302d1e
  ETH : 0.0        (irrelevant — EIP-3009, facilitator pays gas)
  USDC: 1.23       (1,230,000 units)
```

`buyer-wallet.json` is present, gitignored, and already used by every seed/smoke
script. `BAZAAR_SEED_STATUS.md` records 0.002 USDC — **stale by 2 orders of relative
magnitude**; the live balance is 1.23 USDC. Total cost of every remediation in this
document is < $0.10, so the wallet is ~12× over-provisioned.

Facilitator fee (source: `x402/seller/facilitator.md`): **$0.001 per on-chain
transaction after the first 1,000/month are free.** We are nowhere near 1,000.

---

## 3. Is ONE settlement sufficient? (guardrail 2) — **No, and here is the exact shape**

- **To appear in the catalog for a route:** yes, one settled call, ≤15 min, per route.
- **To keep appearing:** **no.** Doc: *"Resources that go 30 days without a settlement
  are removed from both the catalog and search results."* Measured live: our
  `/chain/*` batch settled 2026-10-20T17:03Z, so that whole cohort **drops out on
  2026-11-19** unless refreshed. This is exactly what
  `scripts/refresh_bazaar_catalog.js`'s 20 h cooldown exists to prevent.
- **To rank:** no. Ranking is 6-hourly and weighted by **buyer reach / volume /
  recency**. One self-paid call adds exactly `l30DaysTotalCalls +1, uniquePayers +1`.

Measured counter-example that proves rank is payer-depth driven, not vocabulary driven:

| Route | Our `l30DaysTotalCalls` / `uniquePayers` | Query | Our rank |
|---|---|---|---|
| `/defi/yields` | 11 / **7** | "defi yields" | **#1** |
| `/gate/swap` | 4 / 2 | "pre-trade safety gate" | #10 |
| `/chain/gas-price` | 5 / 2 | "gas price base" | #4 |
| `/chain/token-security` | 8 / 2 | "honeypot detector base erc20" | **absent** |
| `/crypto/funding` | 2 / **1** | "crypto funding rates" | **absent** |
| `/pm/markets` | 4 / 2 | "prediction market odds" | **absent** |
| `/api.x402node.dev/chain/honeypot` (competitor) | **113 / 22** | "honeypot detector base erc20" | **#1** |

The only route where we have 7 payers is the only route where we rank #1. That is the
whole ranking story in one row.

---

## 4. The real root cause of the 7 missed queries (the card got this backwards)

Measured, per query, against the **stored** catalog descriptions of all 46 indexed
routes (substring test on the stored text, not the live text):

| Missed query | Our routes holding *all* query keywords in stored description | Diagnosis |
|---|---|---|
| is this token a scam | **none — 0/46 contain "scam"** | **vocabulary gap** (guaranteed miss) |
| prediction market odds | **none — 0/46 contain "odds"** | **vocabulary gap** (guaranteed miss) |
| token risk report | none hold the "risk"+"report" bigram (5 hold one) | **vocabulary gap** |
| rug pull check base token | `/chain/token-report` | payer depth (1 payer) |
| honeypot detector base erc20 | `/chain/token-security`, `/chain/token-report`, `/gate/swap` | payer depth (2 payers vs 22) |
| crypto funding rates | `/crypto/funding` | payer depth (1 payer) |
| token safety check before swap | `/chain/token-report` | partial — ranks via `/gate/swap` only at #10 |

**So the misses split into two fixable classes, and indexing is in neither:**

1. **Vocabulary gaps (free to fix, guaranteed win if published):** `scam`, `odds`,
   `risk report` appear **nowhere** in anything we publish. A buyer typing
   "is this token a scam" cannot match us at any rank. The #1 competitor's
   description literally begins *"Is this token a scam?"*.
2. **Payer-depth gaps (not fixable by any description or settlement):** honeypot, rug
   pull, funding rates. We already own the vocabulary; we lack 20 payers.

**And here is the coupling the card missed — proof that we store a stale snapshot:**

`/chain/token-security`

- **Live 402 body** (`resource.description`): *"Is this Base token a honeypot — can a
  real wallet actually sell it? ..."* ← buyer-phrased (the c115 rewrite, live since 10-20)
- **Catalog-stored description**: *"Token security / honeypot detector for a Base
  mainnet ERC-20: EIP-1967/1822 proxy + upgradeability detection, bytecode dispatcher
  scan..."* ← workshop-phrased, **pre-rewrite**
- Catalog record: `lastUpdated 2026-10-20T17:03:33.4Z` vs `quality.lastCalledAt
  2026-10-20T17:03:32.666Z` — **41 s apart**. `lastUpdated` tracks the last settlement,
  not the last content change.

`/gate/swap` — same drift: live says *"Is this Base token safe to swap right now? ...
is it a honeypot, can you sell it, is your trade too big for the pool?"*; stored says
*"Pre-trade token security GO / HOLD / BLOCK gate ..."*. Two of two sampled routes are
stale.

**Consequence:** rewriting descriptions is worth **nothing** until a settlement
publishes them, and a settlement is worth **little** unless the description it
publishes is buyer-vocabulary. They are one action, not two. The card's instruction to
treat them as "separate" would have produced two half-fixes that each do nothing.

Bonus defect found: `/chain/token-security`'s stored `extensions.bazaar.info.output.example`
is frozen at **2026-07-17** and contains
`honeypot_sim.note: "Could not locate this token..."` — i.e. the catalog is showing
buyers a **failing example payload** as our advertised output. A settlement re-snapshot
is the only way to clear it.

---

## 5. Best candidate endpoint (guardrail 3: lowest risk, highest visibility)

Restricting to *already-indexed* routes (the only ones where a settlement changes
anything for the missed queries), ranked by visibility gained per cent:

### Primary: `/chain/token-security` — **$0.009** (9,000 units)
- Covers **5 of the 10** quarried queries (the entire token-safety cluster).
- Its stored description is the **worst offender**: workshop vocabulary, zero "scam",
  and a broken output example on display.
- GET, read-only, no state change, no payment path, deterministic input (`?token=`).
- Repricing risk: none (we control it).

### Cheapest: `/chain/fee-estimate` — **$0.002** (2,000 units)
- Lowest absolute cost, read-only. But it is **unindexed**, so a settlement here only
  buys a first-time listing (arguably useful: gas/fee feeds are the proven-earning
  price-data lane per STRATEGY.md c116). Use only if the goal is pure minimum spend.

### Highest pure-vocabulary delta: `/pm/markets` — **$0.005** (5,000 units)
- `odds` appears in **0 of 46** stored descriptions; "prediction market odds" is a
  16-buyer query we cannot match at all. Adding "odds / implied probability / chance /
  yes-vs-no price" is a guaranteed relevance jump. Read-only GET.

**Do not** spend on `/gate/swap` — it is already our best-ranked route (#10, and rank #1
by vocabulary) and the marginal return is nil.

### Cost of the full, honest sweep

| Scope | Routes | Cost (recirculating) | Net |
|---|---|---|---|
| 7 query-relevant routes | token-security, token-report, gate/swap, crypto/funding, pm/markets, defi/yields, gas-price | ≈ $0.04 | ≈ **$0.00** |
| + all 20 unindexed | fee-estimate, network-status, whois, enrich/*, chain/price feeds, /mcp | ≈ +$0.05 | ≈ **$0.00** |
| **Everything** | 66 | **< $0.10** | **≈ $0.00** (facilitator fee $0 <1,000/mo; gas on facilitator; principal returns to our own payTo) |

### Recommended action (not executed here — this card is TYPE: research)

1. Rewrite the 7 descriptions to lead with the buyer's sentence (`scam`, `odds`,
   `rug pull`, `can I sell`, `is this safe to buy`) — keep under 500 chars.
2. `node scripts/refresh_bazaar_catalog.js --route /chain/token-security` (and the
   other 6), which publishes each new snapshot and resets the 30-day clock.
3. Verify with `EXTENSION-RESPONSES: ...success` in the relay's `settle` block, then
   poll `/discovery/merchant?payTo=0x5765…` until `lastUpdated` moves.
4. Do **not** index the 20 unindexed routes as a discovery play; they are not why any
   query is missed. (`/chain/prices` is the one exception worth a call for strategic
   reasons — price feeds are the only proven-earning lane.)

---

## 6. Fraud line & revenue-ledger contamination (guardrail 5)

**CDP's docs contain no fraud/anti-wash policy for self-testing.** The only related
prohibitions are (a) metadata that is prompt-injection rather than endpoint
description, and (b) the 30-day inactivity drop. The "fraud line" is an **internal
policy**, not a CDP rule. It is already encoded, and it holds:

- `src/index.ts:3764` `TrafficLog.SELF_PAYERS` = `{payTo, buyer-wallet, secondary self
  wallet}`. `src/index.ts:3785` excludes them from external-payer counts;
  `:3813` counts them in a separate `self_calls` bucket. Referral reconciliation splits
  real buyers from self the same way.
- `scripts/verify_revenue_ledger.py:46` `SELF_ADDRS` = `{buyer-wallet, payTo}` → any
  on-chain row from these settlements classifies `self_traffic` and is **never** counted
  in `revenue_usd_corrected` / `gap.json`.
- The relay (`/internal/cdp-settle-raw`) **does not write the revenue ledger at all**.
- `scripts/refresh_bazaar_catalog.js:24` documents this exclusion as its guardrail.

**Residual contamination risk that is real and is not in the CDP docs:**

1. **Third-party de-washers will see it.** We rely on wknipe Clean Index,
   x402-measure and x402rep as ground truth, and each of them explicitly flags
   single-payer / self-settlement patterns as wash. A 1-payer +1-call bump per route is
   *visible* to them, even though our own ledger excludes it. That is a reputation cost
   on the exact feeds we use to size the market.
2. **`pm/markets` example payloads** — the frozen `/chain/token-security` example shows
   a failure note. Re-snapshotting fixes this; leaving it is a live credibility defect
   independent of ranking.
3. **Rate:** one settlement per route per 30-day window, never in bursts. 66 routes in
   one minute is the pattern a detector calls manufactured. Sequential, ≤20/day.
4. **A `rejected` bazaar extension still settles USDC.** The relay only gates on
   `verify==200`, not on the extension status — so a rejected extension silently spends
   money and indexes nothing. Always read `settle.extensionResponses`.

---

## 7. Reproduce

```bash
# catalog inventory for our receiver wallet (47 records / 46 paths)
curl -s "https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10&limit=60"

# global list size (89,579) — pagination artifact, not absence
curl -s "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?limit=1000" | jq '.pagination.total'

# live vs stored description drift
curl -s "https://x402-data-api.sigrunner.workers.dev/chain/token-security?token=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" | jq -r '.resource.description'
#   ... compare with the 'description' field of the same record from the merchant API

# wallet readiness (no ETH needed)
#   buyer wallet 0xC4852c26498d3187dEc2ce1b19e840710e302d1e : USDC 1.23, ETH 0.0
```

Sources: `docs.cdp.coinbase.com/x402/seller/get-discovered.md`,
`.../x402/seller/facilitator.md`, `.../api-reference/v2/rest-api/x402-facilitator`
(retrieved 2026-10-28).
