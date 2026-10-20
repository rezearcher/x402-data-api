Thanks for landing #4148 (`haven_check_token_safety`), and for the careful treatment of the free preview versus the paid rail. Two notes that may help your docs/tests:

- The preview is intentionally the same response shape as the paid `/gate/swap`, so a caller who wants the full decision under budget gates can use the standard `haven_quote_x402` -> `haven_pay_x402_quote` path against `https://x402-data-api.sigrunner.workers.dev/gate/swap?token=<addr>&side=buy&notional_usd=100` ($0.008 USDC, Base). The 402 quote is authoritative for price.
- Failure semantics you chose (explicit non-pass) match how we treat it: if the preview ever returns non-200, treat the token as unchecked. We're deploying a fix this week for a Cloudflare rate cap that could cause intermittent 500s on busy days, so that `TOKEN_SAFETY_CHECK_UNAVAILABLE` path may fire occasionally until then.

If you'd like a stable demo alias list or a documented status URL for the check, tell me what you need.
