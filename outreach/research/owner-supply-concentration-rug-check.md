A honeypot check asks one question: can I sell this token after I buy it? For a whole class of rugs the answer is yes, right up until the moment it matters. The contract is clean. Selling works. There is no transfer tax, no blacklist, no mint function. Then one wallet that was quietly holding most of the supply sells into the pool, and the price hits the floor before your agent's next block.

That is a concentration rug, and it is the gap a sell-simulation alone leaves wide open.

## The incidents this metric is for

In April 2025 an unofficial token promoted from Base's own X account lost about 90% of its value within an hour. On-chain analysts traced the collapse to the largest holders, who controlled roughly 47% of supply, selling almost immediately after launch; three wallets that bought before the promotion post cashed out for about $666K. Earlier, the $BALD token on Base was drained for a reported $25.6M when its deployer pulled the liquidity two days after launch. Neither of these needed a honeypot. The sell function worked perfectly. The supply was simply in too few hands.

The 2026 memecoin checklists all say the same thing in different words. DEXTools flags a top-holder share above 2 to 3%. KuCoin's launch guide tells founders to keep their own holding under 5% of supply. Concentration is the signal. The hard part is measuring it on-chain, at trade time, inside the same call that already checks whether you can sell at all.

## What we shipped

Our token-security read now derives single-owner supply concentration and folds it into the same GO / HOLD / BLOCK gate that already runs the honeypot and sizing checks. The number comes straight from the chain: `balanceOf(owner()) / totalSupply`, expressed in basis points, computed the moment you ask.

Five well-known Base tokens, scanned live while writing this (2026-10-24):

| Token | owner() | Owner share of supply |
|-------|---------|----------------------|
| WETH | none (no owner) | null |
| AERO | none (no owner) | null |
| USDC | EOA owner | 0.0% |
| cbBTC | EOA owner | 0.0% |
| DEGEN | contract owner | 0.52% |

Every one is clean on this axis, which is exactly what you want from blue-chips: the owner address either does not exist or holds almost nothing. The metric earns its keep on the token that is NOT on this list, where the owner holds 40, 60, 90 percent and one transaction can end the chart.

## How it scores, honestly

Concentration adds risk; it never fabricates certainty. The tiers live in the code, not a black box:

- An EOA owner holding at least 50% of supply adds 20 points and the reason "a single sell could crash the price."
- At least 20% adds 12. At least 5% adds 5.
- A contract owner is weighted lower (8 / 5 / 2 across the same bands) because a contract holding supply is often a treasury, timelock, or locker rather than a person about to dump.
- Ownership renounced, no owner, a non-standard `balanceOf`, or an unreadable total supply all return null and add zero. We degrade open: a read we cannot make never becomes a fake 0%, and never becomes a fake alarm.

Concentration alone never forces a BLOCK. It is one weighted input, because a high owner share is a reason to size down, not automatically proof of a honeypot. The gate still makes the sellability call separately.

## What it does not do (scope, stated plainly)

This is single-owner concentration: the share held by the one privileged `owner()` address. It does NOT measure aggregate top-holder concentration across many wallets, and it does NOT return a holder count. The April 2025 case, where 47% sat across three coordinating wallets, is exactly the multi-wallet pattern a single-owner read does not catch on its own. That needs an off-chain indexer, and we say so in the response itself rather than imply coverage we do not have. GoPlus and indexer-backed services add holder_count and top-holder breakdowns that we do not. What we add is the owner-share number on Base, on-chain, in one keyless call sitting next to the honeypot and sizing verdict, for $0.009.

## Try it

Scan a demo token free, no key and no signup:

[Free owner-concentration and honeypot read on DEGEN](https://api.greyridgesignals.ai/chain/token-security/preview?token=degen)

Any real Base ERC-20 address gets three free checks per IP per day on the same preview route. The paid [token-security route](https://api.greyridgesignals.ai/chain/token-security?token=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) runs any token for $0.009, settled in USDC on Base over x402, and the [agent docs](https://api.greyridgesignals.ai/llms.txt) wire it into an autonomous trading loop in a few lines. Honeypot, sizing, buy/sell tax, and now owner concentration, in one call. This is static on-chain analysis, not a guarantee and not financial advice.
