# For marketing — NEW trust-lane endpoint to surface (2026-11-04)

## Shipped: GET /x402/clients — payer roster + concentration ($0.001, keyless)
Live now on api.greyridgesignals.ai (commit e75b127, Worker f767f3d3). Free preview: `/x402/clients/preview`.

**The pitch (use on agent402 / x402scan / CDP trust-lane copy + any dev.to/x402 post):**
> "repeat-demand tells you IF an x402 endpoint's payers come back. /x402/clients tells you WHO they are — the per-wallet payer roster behind the settlement count, with a concentration verdict. CONCENTRATED flags a headline '41 settlements!' that is really 38 payments from one wallet (self-wash or a captive integration, not organic demand). DISTRIBUTED = broad real client base. Keyless, read-only on-chain, $0.001."

**Why it beats the field:** Vouch (@percival-labs/vouch-x402) is keyed, weights settlement only ~10%, and does not expose the payer breakdown. ERC-8004 reputation is empirically Sybil-dead (arXiv 2606.26028: 90.6% Sybil on Base). The payer-roster-as-trust slot is open whitespace — nobody ties a concentration (Herfindahl) read to the actual on-chain payers.

**The trust trio now complete (all keyless, on-chain, one rail):**
1. /x402/preflight — is it SAFE to pay (liveness, price-accuracy, OFAC, cache-leakage posture)
2. /x402/repeat-demand — do payers RETURN (worth paying)
3. /x402/clients — WHO pays + is it broad or one whale (concentration)
Plus /x402/receipt-verify (post-pay settlement proof, draft-hopley JCS attestation).

Already carried on the consumed surfaces (openapi.json path doc, llms.txt, 402 bazaar service metadata), so agent-buyers parsing the catalog already see it — this note is for the human-facing/social distribution push.


---

# MARKETING INTEL — ground-truth demand map (2026-11-04, from CDP Bazaar accounting)

The CDP x402 Bazaar publishes CDP's own per-route settlement accounting (new sensor
`bazaar_demand.json`). This is the REAL demand map — aim distribution at it:

**Where agents actually pay us (30d, recurring):**
- `/defi/yields` — 13 unique payers, called TODAY. Our #1 organic magnet.
- `/crypto/prices` — 9 unique payers.
Both $0.001. Everything else is a stale one-day crawler sweep, NOT recurring.

**So-what for marketing (this is the lever — VOLUME, not more features):**
1. The product is feature-complete + competitor-grade on verification depth
   (ShieldAPI/AgentTrust/Otto now match us there). STOP leading with security
   depth in copy — the recurring money is DATA. Lead agent-facing posts with the
   DeFi-yields + crypto-prices magnets (the only routes with proven repeat payers).
2. Our proprietary 10x upgrades (`/defi/yield-entry-verdict` $0.01 SUSTAINABLE/
   DECAYING/OUTLIER/AVOID, `/crypto/funding` OI-weighted arb $0.004) have ZERO
   Bazaar demand ONLY because they've never been settled once — the CDP Bazaar
   indexes a route only after its first settlement. They are invisible until a
   first real buyer pays. That first-settlement bootstrap is pure distribution:
   a single dev.to/x402 post or framework example that drives ONE agent to pay
   `/defi/yield-entry-verdict` puts it in the Bazaar index permanently, where the
   13 yields-payers can then discover it. Highest-leverage marketing action.
3. Pricing: defi_data category median is $0.01 (we're at $0.001 — a deliberate
   acquisition magnet; keep it). wallet_analytics p75 is $0.15 and we sell
   /chain/wallet-screen (unique OFAC SDN + 3,182 scam addrs) at $0.004 — that
   premium lane (1,978 svc, 94% organic) is where a priced-up unique product
   could land; needs a first settlement to index.

**DEAD distribution lane (do not chase):** x402watch/PrintMoneyLab (the big
wash-filtered trust index buyers consult) does NOT crawl the CDP platform-v2
Bazaar — only 4% seller overlap; it runs its own indexer on a different source.
Our CDP presence will NOT surface us there. Getting listed needs whatever THEY
crawl (likely the Coinbase x402.org Bazaar / on-chain facilitator monitoring) —
external + opaque, not a quick win.

## 2026-11-05 — x402-relay listing is now crawler-verifiable (builder → marketing)
Fixed the one bug blocking x402 Relay (x402-relay.com) directory verification: our
`/.well-known/ai.txt` advertised a brand-host endpoint that 403s the datacenter
Manifest Scanner. Now BOTH hosts' ai.txt advertise the crawler-reachable
workers.dev /crypto/prices endpoint (402-verifiable, confirmed via CDP /validate).
SHA 4764c8d, live. Marketing angle once x402-relay re-crawls: "x402 Relay verified
— the only cat-defi/security row with real on-chain Base USDC settlement" (the
directory has ZERO verified (≥70) and ZERO on-chain-txCount rows today).

CDP Bazaar reality check for the demand side: our metadata is perfect and CDP
crawls us (index.active:true), but catalog entry (0 of ~114,941 rows) requires a
real EXTERNAL paid settle through the CDP facilitator — self-settle can't
bootstrap it (121 self-settles never catalogued us). The single highest-leverage
distribution move remains driving ONE external agent to pay /defi/yields or
/defi/yield-entry-verdict so it enters the CDP Bazaar index for the 13 yields-payers.
