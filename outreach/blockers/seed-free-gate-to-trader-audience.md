# Rez atom — seed the free swap-gate where retail Base traders actually are

**Status:** leading-candidate bottleneck after 40+ flat cycles. Pending the zero-Rez-channel
elimination queued as research `cf57d3ffed`; if that finds a cheap channel we don't need you.
**Downside:** zero capital, bounded — you post a free, genuinely useful tool. Upside: first real
human users of the one product with proven demand + margin (the BlockRun reseller model).

## Why this is the atom
Everything is built and verified live: `/gate/swap` (GO/HOLD/BLOCK pre-trade token-safety at
$0.008 wholesale), `/chain/token-report`, `/scan/mcp`, the fiat Stripe sub, and the fully
self-serve `/partners` reseller funnel with on-chain `?ref=` attribution. The wallet is flat
because **no paying human has seen it**, not because anything is missing. Every zero-capital
distribution channel an automated loop can touch is exhausted or out of its hands:

- cold-outreach: dead (144 pulls, $0)
- agent-dev GitHub inbound: 0% convert (they're other agents, not buyers)
- awesome-list / integration PRs (ClawRouter #503, DopamineDesk, ArbiVault): all ball-in-court on maintainers
- SEO (github.io pages, scorecards): real but slow-burn, weeks to rank, and needs backlinks

The one audience with real willingness-to-pay for `/gate/swap` is **retail Base traders /
memecoin buyers** — people about to ape into a token who want a honeypot/sellability check first.
They congregate on Farcaster, X (crypto-Twitter), and a few Telegram trading groups. Reaching
them in-the-moment needs a human social presence an automated loop doesn't have. That's you.

## The move (free tool first, no pitch — ~15 min, repeatable)
Post the **free** preview as a useful public utility. Lead with the tool working, not with a sale.
The free preview is live and keyless:

    https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=degen

Returns a GO/HOLD/BLOCK verdict with reasons (honeypot, sellability, admin controls, v3 liquidity
vs notional). 3 free/day/IP.

### Farcaster (best fit — crypto-native, Base-native, low spam-sensitivity)
Cast from the Grey Ridge or your personal account:

> Built a free pre-trade safety check for Base tokens — paste a token, get GO / HOLD / BLOCK before
> you swap (honeypot + sellability sim, admin-control flags, live v3 liquidity vs your size). No
> wallet connect, no signup. Try it: x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=degen
>
> If you run a bot or bankr-style agent you can wire the same verdict and keep the margin — details
> under /partners.

Then reply to 2-3 recent casts where someone got rugged / asks "is X token safe?" with a real
verdict from the tool (genuine help, not a drop-in link).

### X / crypto-Twitter
Same copy, trimmed to 280. Reply to "got rugged" / "is this a honeypot" threads with a live verdict.

### One Telegram Base-trading group you're in
Pin-worthy: "free honeypot/sellability check, no connect — <preview link>". Only where it's welcome.

## What success looks like (so we know it worked)
Any one trader appending `?ref=` or hitting a paid `/gate/swap` call = first external USDC on the
revenue sensor. The `/partners/report?ref=<tag>` page proves attribution on-chain. Even 20 curious
clicks on the free preview is the first real human signal in 40 cycles.

## If you'd rather not post personally
Give the loop a throwaway Farcaster or X handle (API token) and it will run the seeding itself on a
measured cadence. That single credential is the whole unlock.
