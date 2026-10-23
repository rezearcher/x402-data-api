# Grey Ridge creds checklist (2026-10-22) — one pass, knock them out

The bot is autonomous (no post-checking). This is the one-time credential handoff. Storage:
channel creds → `grsg-set-channel-creds` (writes ~/.config/greyridge/channel_creds.env);
infra secrets → 1Password `op://Division/...` (already how deploy works).

## TIER A — marketing bot channels (one run of `grsg-set-channel-creds` does all three)
| # | Cred | Where to get it | Unlocks | Works now? |
|---|------|-----------------|---------|-----------|
| A1 | **Reddit login** (user `rezarcher` + password) | you have it | Reddit posting via browser (no API needed) | ✅ now |
| A2 | **HN login** (user `greyridge` + password) | you have it | HN posting via browser | ✅ now |
| A3 | **Bluesky** handle + **app-password** | bsky.app → Settings → Privacy & Security → App Passwords → Add | Bluesky posting (clean API, automation-friendly) | ✅ now |
| A1b | *(optional)* Reddit API app id/secret | Developer Platform registration — you're on day 1/5; approve then create a `script` app | upgrades A1 from browser → official API | ~5 days |

→ Run `grsg-set-channel-creds` once. Reddit/HN just need the login (browser posting); Bluesky needs an app-password. With these, the bot auto-publishes to site + bluesky + reddit + hn.

## TIER B — DONE, do not re-ask (these were already added; stale sensor alerts said otherwise)
- **Stripe** — ✅ LIVE (fiat rail armed 2026-10-21). The "PAYMENT_RAIL blocker" sensor is STALE. No action.
- **DeepSeek** — ✅ already wired. `DEEPSEEK_API_KEY` is currently ABSENT = intentionally NOT spending (hunt-fleet lanes paused for cost). The "0.9d runway / top-up" alert is STALE. No top-up needed; adding money would be spending we don't want.

## TIER C — already have / parked (no action unless it breaks)
- CF_WORKERS_TOKEN — ✅ in 1Password (powers deploy + the site channel)
- GH_TOKEN — ✅ fixed this session (`grsg-set-gh-token`)
- Grey Ridge email agent-send (GCP domain-wide delegation) — parked, low priority, mailbox works for you directly

## TIER D — optional, only when a channel proves it earns
- Farcaster custody key + Neynar API key (crypto-retail channel + the mini-app we built)
- X/Twitter developer app (paid/gated — only if worth the cost)
- Telegram BotFather token (bot-embedding partnerships)
- Gemini API key / ElevenLabs / fal.ai (bulk + hero content-gen for the video/voice pipelines — capped)
- AWS seller account + tax/bank/KYC (durable fiat marketplace track, slow ~2–6wk)

## The move
1. `grsg-set-channel-creds` → Tier A (bot goes fully live on 4 channels). ~3 min.
2. Tier B1 Stripe → the actual dollars rail. (B2 DeepSeek if runway is low.)
Everything else is optional/parked.
