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
