# Rez atom — seed the Base Token Gate Mini App on Farcaster

**Status:** product BUILT + LIVE; the `/.well-known/farcaster.json` manifest + PNG
icon are now live too. Only a one-time account action needs Rez's identity — EITHER
a single seed cast (fast) OR, better, one signed domain-association to list the app
in the Farcaster/Base.dev catalog (persistent, self-ranking).
**Why Rez:** posting a cast / signing the domain-association requires a Farcaster
or Base account (custody key). Everything else is done and deployed.

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

## The stronger, persistent option — LIST in the catalog (one signature, then it ranks itself)

A cast scrolls away in hours. A **catalog listing persists and ranks**: Farcaster
search + the Base.dev Mini App leaderboard give "automatic distribution" to the
top apps in the Base App — the same retail-trader audience, reached without
posting anything, forever. The manifest that unlocks this is **already live and
complete** — the only missing piece is a one-time signature.

- Live now: `https://x402-data-api.sigrunner.workers.dev/.well-known/farcaster.json`
  — serves full discovery metadata (name, 512×512 PNG icon, description,
  `primaryCategory: finance`, tags, splash). Verified valid JSON.
- Missing: `accountAssociation` — the signed proof that this domain belongs to
  your Farcaster/Base account. It cannot be generated server-side.

**The one action (≈1 minute):**
1. In Warpcast → **Settings → Developer → Domains** (or the Base.dev manifest
   tool at base.dev), enter the domain `x402-data-api.sigrunner.workers.dev`.
2. It gives you a signed `{header, payload, signature}` JSON — the domain
   association.
3. Paste it back to the loop, OR set it yourself as a Worker secret:
   `wrangler secret put MINIAPP_ACCOUNT_ASSOCIATION` (paste the JSON string).
   The manifest route then includes it automatically — no code change, no redeploy.

After that, the app is eligible for Farcaster search and the Base.dev catalog with
no further action. This beats a cast on every axis (persistent, ranked, no repeat
posting) and is the recommended path.

## Where to cast for the moment of pain
- Reply to Clanker token-launch casts / memecoin alpha channels on Base.
- Base/degen trader channels (`/base`, `/memecoins`, token-launch feeds).
The free check + composeCast share means each use can surface it to the sharer's
followers — the distribution compounds without more posting.
