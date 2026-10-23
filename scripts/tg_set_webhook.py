#!/usr/bin/env python3
"""Register (or inspect) the Telegram webhook for the Base Token Gate bot.

The Worker serves the bot at POST /tg/webhook and authenticates every inbound
update with the TELEGRAM_WEBHOOK_SECRET (Telegram echoes it in the
X-Telegram-Bot-Api-Secret-Token header). This script points Telegram at that
endpoint and installs the same secret, so the handler and Telegram agree.

Usage:
  # one-time, after `wrangler secret put TELEGRAM_BOT_TOKEN` + TELEGRAM_WEBHOOK_SECRET
  TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... python3 scripts/tg_set_webhook.py set
  TELEGRAM_BOT_TOKEN=... python3 scripts/tg_set_webhook.py info      # inspect current webhook
  TELEGRAM_BOT_TOKEN=... python3 scripts/tg_set_webhook.py delete    # unregister (disable bot)

The webhook URL defaults to the production Worker; override with WEBHOOK_BASE.
Only `message`/`edited_message` updates are requested (least privilege — the bot
never needs inline queries, chat-member events, etc.).
"""
import json
import os
import sys
import urllib.request

API = "https://api.telegram.org/bot{token}/{method}"
DEFAULT_BASE = os.environ.get("WEBHOOK_BASE", "https://x402-data-api.sigrunner.workers.dev")


def call(token: str, method: str, payload: dict | None = None) -> dict:
    url = API.format(token=token, method=method)
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, headers={"content-type": "application/json"},
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else "info"
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("ERROR: set TELEGRAM_BOT_TOKEN (the @BotFather token).", file=sys.stderr)
        return 2

    if action == "set":
        secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET")
        if not secret:
            print("ERROR: set TELEGRAM_WEBHOOK_SECRET (must match the Worker secret).", file=sys.stderr)
            return 2
        url = DEFAULT_BASE.rstrip("/") + "/tg/webhook"
        res = call(token, "setWebhook", {
            "url": url,
            "secret_token": secret,
            "allowed_updates": ["message", "edited_message"],
            "drop_pending_updates": True,
        })
        print(json.dumps(res, indent=2))
        return 0 if res.get("ok") else 1

    if action == "delete":
        res = call(token, "deleteWebhook", {"drop_pending_updates": True})
        print(json.dumps(res, indent=2))
        return 0 if res.get("ok") else 1

    res = call(token, "getWebhookInfo")
    print(json.dumps(res, indent=2))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
