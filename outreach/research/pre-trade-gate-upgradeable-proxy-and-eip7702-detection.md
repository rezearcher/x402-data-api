Your trading agent ran the honeypot check and it came back clean. The token sells, the tax is zero, the liquidity is deep. So it buys. What the honeypot check never told it: the contract behind that token can be *rewritten by its admin the day after you hold it* — new mint function, a freshly added blacklist, a pause switch — because the token is an upgradeable proxy. The price looked fine because the danger isn't in the price. It's in who controls the code.

That is the blind spot we close. `/chain/token-security` reads the on-chain *shape* of the contract — not just "is it a honeypot right now," but "can this change under me," and "is the thing I'm about to touch even a normal contract at all."

## The two signals a price-based rug check can't see

**1. Upgradeable proxy — mutable logic.** Most Base token-safety APIs score the bytecode in front of them. If the token is a proxy, the bytecode they scored is a 40-byte forwarder; the real logic lives behind it and the admin can swap it. We resolve the proxy slots (EIP-1967/1822 and the older OpenZeppelin zOS convention) and report the implementation, the admin, and whether it is upgradeable.

Here is the live call on USDC on Base — a legitimate, blue-chip token that is *still* an upgradeable admin-controlled proxy (run it yourself against the free preview):

```
GET https://x402-data-api.sigrunner.workers.dev/chain/token-security/preview?token=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
```

```json
"proxy": {
  "is_proxy": true,
  "proxy_standard": "OZ zOS AdminUpgradeabilityProxy (pre-EIP-1967)",
  "implementation_address": "0x2ce6311ddae708829bc0784c967b7d77d19fd779",
  "admin_address": "0x4fc7850364958d97b4d3f5a08f79db2493f8ca44",
  "is_upgradeable": true
},
"is_eip7702_delegate": false
```

Verdict: `review`, risk_score **65**, with the flag spelled out in plain words:

> *upgradeable proxy (OZ zOS AdminUpgradeabilityProxy (pre-EIP-1967)) — contract logic can be changed by the admin after you hold this token*

Note what that is *not*: it is not "AVOID." USDC is fine. The point is the signal is honest and graded — a real upgradeable proxy on a scam token reads the same way, and now your agent can tell the difference between "immutable, trust the bytecode" and "mutable, a human still holds the keys." A static honeypot verdict flattens both into "clean."

**2. EIP-7702 delegation — is this address even a normal contract?** Since the Pectra upgrade, an ordinary wallet (EOA) can delegate its code to another contract. That is the mechanism behind the 2026-era sweeper wave: Wintermute found in mid-2025 that **over 80% of EIP-7702 delegations pointed to a single copy-pasted sweeper contract** it nicknamed "CrimeEnjoyor," and Scam Sniffer tied roughly **$150,000** in losses to one malicious batched transaction linked to Inferno Drainer ([The Block](https://www.theblock.co/post/356481/wintermute-warns-pectra-upgrade-leaves-ethereum-users-at-risk-of-automated-attacks)). SlowMist's recommendation was that tooling should *show you the delegation target* before you trust an address. Our response carries exactly that field: `is_eip7702_delegate` and, when set, the `delegate_address` the code points to — so an agent can refuse to treat a delegated EOA as if it were a plain token contract.

## Scope — said straight

This is static on-chain detection of contract *shape*: proxy upgradeability, admin control, mint/pause/blacklist/fee-setter selectors, ownership renouncement, and whether an address is an EIP-7702 delegate. It is a fast heuristic signal, not an audit, not a guarantee, not financial advice — every response carries that disclaimer. It protects your **buy decision** by refusing to call a mutable contract immutable. It does **not** protect a human who signs a phishing delegation on their own wallet — that is a wallet-UX problem, and we don't claim to solve it. True claims only.

## Where it sits

| | Reads proxy upgradeability? | Flags EIP-7702 delegate? | Per-call |
|---|---|---|---|
| **Grey Ridge `/chain/token-security`** | **Yes — slots + admin + is_upgradeable** | **Yes — `is_eip7702_delegate` + target** | **$0.009 USDC** |
| Static honeypot / rugcheck APIs | Scores the bytecode in front of them | No | ~$0.005–$0.03 |

If you only need the proxy resolution and not the full safety scan, `/chain/proxy-info` returns implementation/admin/beacon + `is_proxy` on its own for **$0.002** a call.

## Wire it in

Free preview, no key, any real Base token (3/day/IP) or the demo set `usdc|weth|cbbtc|aero|degen`:

```
GET https://x402-data-api.sigrunner.workers.dev/chain/token-security/preview?token=usdc
```

Paid route (HTTP 402 → pay $0.009 in USDC inline → full verdict + flags), the call your agent fires before it trusts a token's code:

```
GET https://x402-data-api.sigrunner.workers.dev/chain/token-security?token=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
```

Base-native, no account, paid inline per call over x402. Point it at the last token your agent bought and see what the honeypot check didn't mention.
