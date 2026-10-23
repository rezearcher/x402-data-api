# Blocker: Telegram bot token (one-time, ~3 min) — unlocks the Base Token Gate bot

**Why this matters:** Base memecoin traders don't read our SEO pages or scroll a
Farcaster catalog — they paste contract addresses into Telegram groups and bots.
Our own API copy already names "Telegram bots that gate a buy on sellability" as
the target audience. The bot is **fully built and deployed** (`POST /tg/webhook`
in `src/index.ts`); it stays inert until the token + secret are set. This puts the
free GO/HOLD/BLOCK verdict + the paid 0.01-USDC sizing unlock directly in the
paying audience's native habitat — the most qualified distribution surface we have.

**What only Rez can do (needs a Telegram account):**

1. In Telegram, message **@BotFather** → `/newbot` → pick a name (e.g.
   "Base Token Gate") and a username ending in `bot` (e.g. `BaseTokenGateBot`).
   BotFather replies with a **bot token** like `8012345678:AAE...`.
2. (optional, recommended) `/setdescription`, `/setabouttext`, `/setuserpic`
   so it reads as a real product in the bot's profile card.

**Then (no Rez identity needed — can be run by the loop once the token exists):**

```bash
cd /home/rez/projects/x402-data-api
# pick any high-entropy webhook secret (both sides must match)
SECRET=$(openssl rand -hex 24)

# install the two Worker secrets
echo "$BOT_TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN
echo "$SECRET"    | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET

# point Telegram at our Worker + install the matching secret
TELEGRAM_BOT_TOKEN="$BOT_TOKEN" TELEGRAM_WEBHOOK_SECRET="$SECRET" \
  python3 scripts/tg_set_webhook.py set

# verify
TELEGRAM_BOT_TOKEN="$BOT_TOKEN" python3 scripts/tg_set_webhook.py info
```

**ATOM (Rez only):** create the bot via @BotFather and paste the bot token here
(or straight into `wrangler secret put TELEGRAM_BOT_TOKEN`). Everything else —
secret generation, webhook registration, verification — is scripted and zero-capital.

**Security posture (already enforced in code):**
- Inbound updates authenticated by `X-Telegram-Bot-Api-Secret-Token` == the
  Worker's `TELEGRAM_WEBHOOK_SECRET`; forged POSTs are 403'd (no spam-to-arbitrary-chat).
- Handler fails closed + inert when either secret is unset (never crashes the Worker).
- 20 checks / chat / hour KV cap protects the on-chain read budget.
- The bot serves only the FREE verdict + a link; all payment still settles on the
  existing on-chain `/gate/swap/unlock` route — no new money surface, no self-dealing.
