# Bounty Execution Plan — $20 / 0 USDC to First External Integrate-and-Pay

**Date:** 2026-07-18
**Author:** Hermes (t_33de6690)
**Status:** PROPOSED — awaiting Rez greenlight for $20 spend

---

## 1. Thesis (from the steer card)

The root cause of $0 revenue is that ALL 5 distribution channels are passive submit-and-wait. Adding a 6th passive listing won't change the dynamic. The steer is to shift from **inbound (list-and-wait)** to **outbound (incentivize-a-customer).** Pay $20 (0 USDC from the $33 Base mainnet wallet) to the first external developer who completes the full earning path end-to-end.

**The bet:** $20 to answer "does the product work but nobody knows about it?" with a real person who has actually used the paid API.

---

## 2. What the Winner Does (the 4-Step Path)

1. **Discover** x402-data-api via any channel (X/Twitter, HN, Reddit, MCPize, word-of-mouth)
2. **Make a paid call** — receives HTTP 402 → signs EIP-3009 authorization → receives data
3. **Report publicly** what data they used and how — in a verifiable public forum (X/Twitter thread, GitHub Issue on x402-data-api repo, Discord post)
4. **Claim the bounty** by providing their Base wallet address for USDC payment

---

## 3. Verification Protocol

| Check | Method | Evidence |
|-------|--------|----------|
| Paid call happened | Check Base mainnet USDC transfer to `PAY_TO` wallet (`0x5765…`) | On-chain tx hash |
| Call was external | Verify origin IP is not Rez's IPs, not the Worker's self-calls, not known agent infra | Cloudflare logs + wallet address not in Rez's wallets |
| Public report exists | Link to X/Twitter, GitHub Issue, or Discord post | URL |
| Not a sock puppet | GitHub account age > 30 days OR X account with history > 10 posts | Manual check |
| Wallet receives bounty | Transfer $20 USDC on Base to winner wallet | On-chain tx hash |

**Anti-gaming:** The winner's wallet must NOT match any wallet Rez has used for self-payments (empirically: 31/31 inbound USDC txs are Rez's own wallets per DISTRIBUTION_READY.md). If the winner's wallet appears in past self-payment history, the bounty is void.

---

## 4. Materials to Distribute (Drafted)

Three announcement channels, pre-drafted:

### 4A. X/Twitter Post (from @sigrunner or @rezearcher)

> I built an API that sells crypto/Base/PolyMarket data for $0.001–$0.02 per call over x402.
> No API key. No subscription. Just HTTP 402 → sign → get data.
>
> **$20 bounty to the first developer (not me, not a bot) who makes a paid call and posts about what they built with it.**
>
> 18 endpoints + 22-tool MCP server. Full spec: https://x402-data-api.sigrunner.workers.dev
>
> cc @xpay @base

### 4B. Hacker News Show HN

Title: Show HN: x402 data API – pay-per-call crypto/Base data, $20 bounty for first external user

Body:

> I built a pay-per-call API on Base mainnet using the x402 protocol. 18 endpoints across crypto prices, DeFi yields, Polymarket markets, Base RPC (balance, tx, token-security honeypot detection), DNS/WHOIS enrichment — all via HTTP 402 → EIP-3009 sign → get data. No API key, no subscription, no account.
>
> It's also a 22-tool MCP server at the /mcp endpoint (streamable-http).
>
> **$20 USDC bounty to the first developer who makes a paid call and shares what they used it for.** I need to know if the product works but nobody knows about it, or if it's genuinely not useful — and with $0 revenue after 7 days of passive listing on every directory I could find, the honest answer is "I don't know."
>
> One bounded bet of $20 beats adding another passive listing.
>
> https://x402-data-api.sigrunner.workers.dev
> ARCHITECTURE.md: https://github.com/rezearcher/x402-data-api (if public)

### 4C. Reddit Post (r/ClaudeAI, r/cryptodevs, or agent-dev forum)

Title: I built a paid MCP server for crypto data — $20 bounty to the first user

Body:

> Built a pay-per-call MCP server for Base on-chain data, Polymarket markets, DeFi yields, and token security (honeypot/rug detection).
>
> 22 tools, all gated behind the x402 protocol — HTTP 402 → sign → get data. No subscription, no API key, $0.001–$0.02 per call.
>
> **$20 to the first developer who integrates it, makes a paid call, and posts about it.** I need a real user to tell me where the onboarding friction is.
>
> MCP endpoint: https://x402-data-api.sigrunner.workers.dev/mcp
> Docs: same URL in browser for openapi.json and well-known/x402
>
> Shipping this on MCPize and Apify next.

---

## 5. Distribution Plan

| Channel | When | Delivered by |
|---------|------|-------------|
| X/Twitter announcement | After Rez greenlight | Rez (has the account keys) |
| HN Show HN | After Rez greenlight | Rez or post from Hermes |
| Reddit posts | After Rez greenlight | Rez |
| MCPize listing (existing t_eb76234a) | Already in flight | Hermes |
| Add bounty tag to MCPize listing if supported | During MCPize setup | Hermes to investigate |

---

## 6. Budget

| Item | Cost |
|------|------|
| Bounty payout: 0 USDC ($20) | $20 |
| Winner's first call cost (paid to the API) | ~$0.01–$0.10 |
| **Total max outlay** | **$20.10** |
| Wallet available | $33 USDC on Base mainnet |
| Remaining after bounty | ~$13 USDC |

---

## 7. Timeline

- **Day 0:** Rez approves $20 → post announcements on X, HN, Reddit
- **Day 1–14:** Bounty open. Monitor on-chain for new USDC to `PAY_TO` wallet
- **Day 14:** If no taker → thesis re-examination. Maybe the data isn't valuable enough, or the onboarding friction is too high, or $20 isn't enough incentive
- **Rolling:** Winner claims → verify → pay → document learnings → decide next channel strategy

---

## 8. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Bot or agent claims bounty pretending to be human | Low | Wallet history + account age check + manual review of public post |
| Winner never claims (forgets address) | Low | Bounty is public — they'll claim |
| $20 isn't enough incentive | Medium | It's a bounded bet. If no taker in 14 days, the thesis needs re-examination |
| More than one person completes the path | Low within 14 days | First verified claim wins. Document the runners-up for follow-up |
| Someone games it with multiple wallets | Low | Wallet history check + public post verification |
| $20 spend without Rez approval | **ZERO** — this plan does not execute without Rez greenlight | Blocked below |

---

## 9. Go/No-Go Decision for Rez

To dispatch this bounty, Rez needs to:

- [ ] **Approve the $20 spend** from the Base mainnet wallet ($33 USDC available)
- [ ] **Choose posting account:** Post from @sigrunner or @rezearcher (or both)?
- [ ] **Confirm wallet to use for payout:** Same `PAY_TO` as the API? Or a separate wallet?
- [ ] **Optional: Review and adjust** any of the drafted posts above
- [ ] **Greenlight go-time** — the moment to post

**Once approved, execution is fully autonomous:**
1. Posts go live on X, HN, Reddit
2. On-chain monitor watches for new inbound USDC to `PAY_TO`
3. When winner claims → verify → notify Rez for payout approval (or pre-approve and auto-pay)
4. Bounty = done. Log learnings to docs/BOUNTY_RESULTS.md
