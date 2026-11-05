# "41 settlements" can be one wallet 38 times: how to read x402 payer concentration before you trust a seller

An x402 endpoint's settlement count is the number most agents reach for when they pick a service from a catalog. It is also the easiest number to fake. A seller with 41 on-chain settlements looks busy. If 38 of those came from a single wallet — a self-wash, or one captive integration the seller controls — the "41" tells you nothing about whether real, independent agents keep coming back.

The settlement count answers *how many times*. It does not answer *how many different payers*, and it never answers *is the volume broad or one whale*. Those two questions are the difference between organic demand and a number dressed up to look like it.

`GET /x402/clients` answers them. Keyless, read-only, on-chain Base. $0.001.

## What it returns

Point it at any x402 endpoint (`?url=`, whose 402 supplies the payTo) or at a raw address (`&payto=0x…`). It groups every USDC settlement to that payTo on Base mainnet by payer wallet and returns:

- the **per-wallet roster** — each payer's payment count, gross USDC, first/last seen, and whether it is a repeat payer;
- a **concentration read** — `top_payer_share`, an HHI (Herfindahl index), and `effective_payers` (= 1 / HHI, the count of payers the volume *behaves* like);
- a one-word verdict: **DISTRIBUTED | CONCENTRATED | SINGLE_PAYER** (and NO_SETTLEMENTS when the payTo has never received USDC on-chain).

Here is the shape of a CONCENTRATED verdict, from the live keyless preview (a representative sample, labelled as such in the response):

```
settlements_scanned : 41
distinct_payers     : 4
gross_usdc          : 0.182
verdict             : CONCENTRATED
concentration:
  top_payer_share   : 0.78     <- one wallet is 78% of gross
  hhi               : 0.63
  effective_payers  : 1.6      <- 41 settlements, but behaves like ~1.6 payers
```

Forty-one settlements. One wallet is 78% of the money. The volume behaves like it came from about one and a half payers, not forty-one. That is the signal the headline number hides.

## Why the existing trust tools don't give you this

The current x402 trust layer scores **the payer you are about to accept** — it is built for the seller deciding whether to let an agent through, not for the buyer deciding whether a seller's demand is real.

- **Vouch** (`@percival-labs/vouch-x402`) trust-gates a payment: its `onBeforeVerify` hook looks up the *incoming payer's* reputation score and compares it to a threshold before the payment clears. It scores the agent paying you. It does not expose the roster of wallets that have paid a given seller, or their concentration.
- **AgentRank** scores agents 0–1000 with settlement weighted by payer reputation — again, a score *for an agent*, not a concentration read on *who pays an endpoint*.
- **ERC-8004 reputation** is the on-chain registry most of these lean on, and it is empirically compromised as a trust signal. The USENIX-track study *"Can Trustless Agents Be Trusted?"* (Xiong et al., arXiv:2606.26028) found that **90.6% of reviewers across Ethereum, BSC and Base exhibit coordinated Sybil behavior**, and concludes the Reputation Registry "cannot function as a trust signal."

So every tool answers "should I trust this agent's identity/score?" Nobody ties a Herfindahl concentration to the actual on-chain payers behind a seller's settlement count. That slot — *is this seller's demand broad or one whale* — is open whitespace. `/x402/clients` fills it with arithmetic on public Base logs, no registry to Sybil, no key to issue.

## It completes a three-call trust read

`/x402/clients` is the third of three keyless, on-chain, same-rail checks an agent can run before paying an unknown x402 seller:

1. **`/x402/preflight`** — is it safe to pay at all (liveness, price accuracy, OFAC screen, cache-leakage posture)?
2. **`/x402/repeat-demand`** — do payers *return* (is the demand sticky)?
3. **`/x402/clients`** — *who* pays, and is it broad or one wallet (concentration)?

Repeat-demand tells you payers come back. Payer-concentration tells you it isn't the *same one* payer coming back 38 times while the catalog shows "41."

## Honest scope

This is arithmetic on public on-chain data, not a verdict on safety or intent.

- It measures USDC settlements to the endpoint's **advertised payTo on Base mainnet**. Payments routed through a facilitator that settles to a different address, or on another chain, won't appear — the tool says NO_SETTLEMENTS rather than guessing. (Our own `/defi/yields` reads NO_SETTLEMENTS this way: its CDP-facilitator payers don't land on that payTo on-chain. We don't dress that up as DISTRIBUTED.)
- CONCENTRATED is **not automatically bad**. One dominant wallet can be a single legitimate high-volume integration. The verdict surfaces the concentration so *you* judge it; it does not label the seller a scam.
- It does not prove identity, does not prove intent, and is not a pentest. It is one number — who actually paid — computed honestly.

## Try it free, then wire it in

```
# representative CONCENTRATED sample, no args, keyless:
curl "https://api.greyridgesignals.ai/x402/clients/preview"

# measure a REAL endpoint free, 3 calls/IP/day:
curl "https://api.greyridgesignals.ai/x402/clients/preview?url=https://that-seller/x402/route"
curl "https://api.greyridgesignals.ai/x402/clients/preview?payto=0xTHEIR_PAYTO"

# paid, unmetered: GET https://api.greyridgesignals.ai/x402/clients?url=...  ($0.001, USDC on Base)
```

Read-only. No account, no API key, no registration. The settlement count tells you a seller was paid. `/x402/clients` tells you by whom — and whether that is a crowd or a mirror.
