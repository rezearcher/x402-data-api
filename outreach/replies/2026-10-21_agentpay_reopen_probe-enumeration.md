# agentpay (romudille-bit/agentpay#11) — re-engaged 2026-10-21 (c118)

Thread was CLOSED-as-answered by maintainer 2026-10-19; they invited reopening for
"a technical question about the probe itself." Posted a precise technical question
(comment https://github.com/romudille-bit/agentpay/issues/11#issuecomment-6305076890;
PATCH reopen 422'd — I'm not a collaborator — but comment notifies them).

## Why this is the highest-value lane-A move
agentpay runs `verified_route`: an AUTOMATED BUYER that samples CDP Bazaar per need
("token security", "token price", "defi yields"...), PAYS a few, and ranks STRICTLY on
"a body comes back after settlement" + on-chain payer depth. Receipts: agentpay.tools/probes,
scores: /scores.json. They said the sigrunner host "has shown up in a token-security sweep before."

## Evidence I gathered (why we're not getting probed)
- scores.json by_need: `token security` lists ONLY Otto AI; `defi yields` ONLY SYNTHORA. We're ABSENT.
- CDP `x402/discovery/search?query=token security` → 10 competitors, none ours. Same for
  defi yields / token price / market data / wallet screening.
- BUT `query=sigrunner` returns 10 of our routes incl. /chain/token-security at rank 0 — we ARE indexed.
- So the prober's semantic sweep ranks us below its top-N cutoff for the bare need-phrases.

## The ask (verbatim intent)
How does the prober enumerate candidates per need — CDP discovery/search top-N (what N)? Does it
re-embed `description` or trust returned order? Is there a field it keys on (serviceName/tags)?
Goal: get into the sweep they already run so their delivery-after-settlement check can score us.

## Status: awaiting reply. DO NOT double-send. Krystian + Miles both ball-in-their-court (answered).
