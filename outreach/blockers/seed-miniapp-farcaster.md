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

## The one action — now ONE CLICK (pick whichever account you have)

The copy + embed are pre-filled. Open the link on the device logged into the
account, review, tap **Cast** / **Post**. That's the whole atom.

**Warpcast (Farcaster — best: renders the interactive Mini App card in-feed):**

    https://warpcast.com/~/compose?text=Aping%20a%20new%20Base%20token%3F%20Paste%20the%20contract%20and%20get%20GO%20%2F%20HOLD%20%2F%20BLOCK%20before%20you%20sign%20%E2%80%94%20honeypot%2C%20sell-tax%20and%20liquidity%20checks%20in%20one%20tap.%20Free%2C%20no%20wallet%20connect%2C%20no%20login.%0A%0ABase%20Token%20Gate%20%F0%9F%91%87&embeds[]=https%3A%2F%2Fx402-data-api.sigrunner.workers.dev%2Fminiapp

**X / Twitter (shows the card image + link):**

    https://twitter.com/intent/tweet?text=Aping%20a%20new%20Base%20token%3F%20Paste%20the%20contract%2C%20get%20GO%20%2F%20HOLD%20%2F%20BLOCK%20before%20you%20sign%20%E2%80%94%20honeypot%2C%20sell-tax%20%26%20liquidity%20checks%20in%20one%20tap.%20Free%2C%20no%20wallet%20connect%3A&url=https%3A%2F%2Fx402-data-api.sigrunner.workers.dev%2Fminiapp

Fallback if you'd rather write it yourself — raw copy:

   > Before you ape into a Base token: paste the contract and get GO / HOLD / BLOCK —
   > honeypot + sellability sim, admin-control checks, and your trade size vs pool
   > liquidity. One answer, free. 👇
   > https://x402-data-api.sigrunner.workers.dev/miniapp

(Optional, to LIST in the Farcaster app store — not needed to share): publish a
   signed domain-association at `/.well-known/farcaster.json`. This needs your
   custody key; generate via the Farcaster developer tools and paste the JSON back
   to the loop and it will add the route.

## Where to cast for the moment of pain
- Reply to Clanker token-launch casts / memecoin alpha channels on Base.
- Base/degen trader channels (`/base`, `/memecoins`, token-launch feeds).
The free check + composeCast share means each use can surface it to the sharer's
followers — the distribution compounds without more posting.
