# x402-pilot (DrVelvetFog) — conformance proof ready, HOLD on posting

**Thread:** https://github.com/DrVelvetFog/x402-pilot/issues/13 · PR https://github.com/DrVelvetFog/x402-pilot/pull/14
**Lane:** a (reply→paid) — warmest live lead; DrVelvetFog said: "run it through
the routing agent, preview first, then a paid call if it checks out… wire it in
as an example target, credited."

## State (2026-10-21 01:33Z)
- Oct 19 12:33Z — posted paste-ready preview+paid example (answered their ask).
- Oct 20 22:11Z — opened PR #14 (`examples/live-evm-verify-target.md`) + comment.
- **~3h since my last comment — DO NOT double-post.** Respect no-double-send;
  ball is in their court. Post the proof below only if they reply, or after a
  respectful interval (≥ ~24h of silence) as a single value-add follow-up.

## The proof (ran THEIR own tool against our live routes)
Cloned DrVelvetFog/x402-pilot, ran its `x402-conformance-mcp` `decode_402` with
`url=` against our live 402s. Reproduce any time: `scripts/verify_x402pilot_conformance.sh`.

```
/chain/token-report?token=usdc  status=402 expected402=true v=2 | 2 pass / 0 blocker / 0 info
/gate/swap?token=weth           status=402 expected402=true v=2 | 2 pass / 0 blocker / 0 info
```

Before today there was 1 advisory `info` ("no explicit decimals"). Shipped
`feat(x402): publish USDC decimals in 402 offer extra` (commit f7ff505,
deployed) — now **zero findings** on their decoder. These are the exact
`exact`-EVM Base targets their `/x402-verify` flow wants.

## Draft follow-up (post only when appropriate — see HOLD above)
> Ran the live routes through x402-pilot's own `x402-conformance-mcp`
> `decode_402` — both the SAFE/CAUTION/AVOID verdict route and the swap gate
> come back `expected402=true`, x402 v2, **2 pass / 0 blocker / 0 info** (I
> published the USDC `decimals` in the offer `extra` so your decoder stops
> warning). Free no-wallet preview is on `…/preview`; paid is the same path.
> Want me to drop the two-line curl so the routing agent can do preview→paid in
> one go?
