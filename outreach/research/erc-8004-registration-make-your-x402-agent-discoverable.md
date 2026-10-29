# ERC-8004 registration-v1: make your x402 agent discoverable (and payable)

Two standards are converging on the same problem from opposite ends. Google's
**A2A** and Anthropic's **MCP** describe how agents *communicate*. **ERC-8004**
describes how agents *trust each other* — a three-registry standard (Identity,
Reputation, Validation) that lets agents from different organizations interact
without any prior relationship. It's explicitly framed as a trustless extension
of A2A.

There's a deliberate hole in ERC-8004's scope: **payment**. The spec leaves
settlement to other rails and only lets you *reference* a payment proof (for
example, an x402 receipt) inside reputation data. So when a registry or an
explorer discovers your agent through ERC-8004, it learns your identity and your
endpoints — but nothing about whether, or how, you can be paid.

That's the gap worth closing, and it's the one we built for.

## What we published: a keyless, x402-payable registration file

Grey Ridge's data API now serves an ERC-8004 **registration-v1** file at a fixed
well-known path — no key, no signup, one GET:

```
GET https://api.greyridgesignals.ai/.well-known/erc-8004.json
```

It declares, in machine-readable form:

| Field | Value |
|-------|-------|
| `type` | `eip-8004#registration-v1` |
| `x402Support` | `true` |
| `pricing` | `{ chain: base, currency: USDC, per_task: 0.008 }` |
| `supportedTrust` | `["reputation"]` |
| `address` | `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10` |
| `services` | x402 manifest · A2A agent card · MCP endpoint |
| `routes` | **64** callable routes, each with endpoint + per-call USDC price |

The 64 routes aren't a hand-kept list that drifts out of sync — they're derived
from the same demand-ordered catalog that powers the live x402 manifest, priced
from **$0.001 to $0.05** per call. An agent that reads the registration file sees
exactly what it can call and what each call costs, before it spends anything.

## The three files point at each other

Discovery only works if the breadcrumbs are bidirectional. All three well-known
files now cross-link:

- **ERC-8004 registration** (`/.well-known/erc-8004.json`) →
  `discovery` has already been stamped into the x402 manifest with
  `x402_payable: true` plus pointers to the A2A card and this registration file.
- **A2A agent card** (`/.well-known/agent-card.json`) carries a
  `registrations[]` entry (`protocol: erc-8004`, `network: eip155:8453`,
  the agent address) and a `payments` block declaring `supported: ["x402"]`.
- **x402 manifest** (`/.well-known/x402`) carries a `discovery` block linking
  back to both the A2A card and the ERC-8004 registration.

So a trustless-agent registry, an ERC-8004 explorer, or an A2A-native client can
enter from *any* of the three and reach the other two — identity, communication,
and payment, resolved in a single keyless fetch each.

## What this is — and what it isn't

Be precise about the layers, because ERC-8004 has several:

- **This is the registration file** — the off-chain, discoverable document the
  spec's Identity Registry points *to*. It's live on both hosts, returns HTTP
  200 today, and is what a registry ingests to list you.
- **This is not an on-chain identity mint.** ERC-8004's Identity Registry issues
  an ERC-721 per agent; minting that token (and pushing the `erc-8004:base`
  additional-registry record) is a separate on-chain step via the ERC-8004 SDK.
  Base mainnet deployment of that registry is still rolling out; base-sepolia is
  live. We publish the file the registry consumes — we don't claim to have
  minted an on-chain token you can go verify today.
- **`supportedTrust: ["reputation"]`** means we opt into the reputation model,
  not the validation model. Honest about which registry we participate in.

If you're building a trading or research agent on Base, the practical takeaway is
simpler than the standard: you can be discovered *and* priced in one document,
and the payment rail (x402, gasless USDC) is wired in rather than bolted on
afterward. Copy the shape of our registration file, point its `services` at your
own A2A card, x402 manifest, and MCP endpoint, and any ERC-8004-aware consumer
can find you.

Read the live file: `curl https://api.greyridgesignals.ai/.well-known/erc-8004.json`

---

*Grey Ridge Signals Group LLC. Pricing, routes, and the registration fields above
are served live and change as the catalog does — the numbers here are claim-traced
to the file at publish time. ERC-8004 is an emerging standard; verify the canonical
EIP for exact registry semantics.*
