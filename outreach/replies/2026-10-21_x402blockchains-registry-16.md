# X402blockchains/x402-registry #16 — registry listing review

- Date: 2026-10-21
- Thread: https://github.com/X402blockchains/x402-registry/issues/16
- Their ask (2026-10-21T01:49Z): submit a proposal under proposals/ with (1) logo/ownership/support, (2) routes+prices+facilitator aligned to live catalogue (flagged price mismatch: app said $0.002, /chain/eth-usd requests $0.001), (3) a Base mainnet settlement tx + decoded receipt (operator test acceptable when labelled), (4) integration instructions.
- My action: opened proposal PR #19 (proposals/greyridge-market-data.md); replied on #16 linking it.
  - PR: https://github.com/X402blockchains/x402-registry/pull/19
  - Reply: https://github.com/X402blockchains/x402-registry/issues/16#issuecomment-6306466420
- Satisfied: #1 (logo greyridgesignals.ai/favicon.svg 200), #2 (price range corrected to $0.001-$0.05; facilitator=cdp), #4 (full integration flow).
- 2026-10-21 (this cycle): item #3 RESOLVED. Built `/internal/find-settlement` (secret-gated worker endpoint) — scans Base via the Cloudflare-side rotating baseRpc with eth_getLogs (chunk=800, the range public RPCs accept; blockscout 403s even from CF). Found 23 real settlements to PAY_TO; pulled + decoded one via eth_getTransactionReceipt.
  - Tx: https://basescan.org/tx/0x2821af0057408caf18c5034182ab63c5904e3dffbde0ecb89e92c76e860a7432 — operator buyer 0xc4852c→PAY_TO 0x5765ae, 0.01 USDC, CDP facilitator relayer 0xb87e1a…5860 (EIP-3009 exact), block 52863233, status 0x1, 2026-10-20T17:03:33Z. Labelled operator test per review guidance.
  - Appended decoded receipt to PR #19 (proposals/greyridge-market-data.md); commented on #16: https://github.com/X402blockchains/x402-registry/issues/16#issuecomment-6307202833
- STATUS: all 4 review points delivered, ball fully in reviewer's court (recheck pending). Do NOT re-send.
- Note: findable settlements to PAY_TO are all from 0xc4852c (operator canaries) — the one real external payer 0xec2abd (7 on-chain-data calls) settled >20h/beyond the small-chunk getLogs reach, not pulled. Memory "seeding inflates scoreboard" confirmed: the +0.78 vs baseline is our own canary payments, not external.
