# Rez atom — seed the Base Token Gate Mini App on Farcaster

**Status:** product BUILT + LIVE; only the one-time seed cast needs Rez's identity.
**Why Rez:** posting a cast / signing the domain-association requires a Farcaster
account (custody key). Everything else is done.

## What's live (zero-capital, no Rez needed)
- Mini App: https://x402-data-api.sigrunner.workers.dev/miniapp
  (also https://api.greyridgesignals.ai/miniapp — use the workers.dev host for the
  cast embed; the custom domain can 403 datacenter IPs incl. Farcaster's crawler)
- Interactive GO / HOLD / BLOCK gate over the free `/gate/swap/preview` (3 checks/day/IP),
  with a one-tap "Share this check" that re-casts via `composeCast` (viral loop).
- Cast card image (3:2): /miniapp/card.svg
- Valid `fc:miniapp` + legacy `fc:frame` embed meta tags (verified live).
- Upsell: humans → /pricing ($9.99/mo, card); agents → x402 /gate/swap ($0.008/call).

## The one action (≈2 min)
1. Open the embed preview tool to confirm the card renders:
   https://farcaster.xyz/~/developers/mini-apps/embed  (paste the /miniapp URL)
2. Cast from the Grey Ridge (or your) Farcaster account. Suggested copy:

   > Before you ape into a Base token: paste the contract and get GO / HOLD / BLOCK —
   > honeypot + sellability sim, admin-control checks, and your trade size vs pool
   > liquidity. One answer, free. 👇
   > https://x402-data-api.sigrunner.workers.dev/miniapp

3. (Optional, to LIST in the Farcaster app store — not needed to share): publish a
   signed domain-association at `/.well-known/farcaster.json`. This needs your
   custody key; generate via the Farcaster developer tools and paste the JSON back
   to the loop and it will add the route.

## Where to cast for the moment of pain
- Reply to Clanker token-launch casts / memecoin alpha channels on Base.
- Base/degen trader channels (`/base`, `/memecoins`, token-launch feeds).
The free check + composeCast share means each use can surface it to the sharer's
followers — the distribution compounds without more posting.
