# Blocker: marketing-director channel credentials (the ONE atom)

Bot is built + runs autonomously in DRY-RUN until these exist. Run once as rez:
`! grsg-set-channel-creds`  (hidden input, validated, stored to ~/.config/greyridge/channel_creds.env).

## Reddit script app (the only genuinely-new credential; ~60 sec)
1. Logged in as rezarcher, go to https://old.reddit.com/prefs/apps  (old UI = clearest)
2. Bottom → "create another app…"
3. name=`greyridge-marketing` · radio=**script** · description/about=blank · redirect uri=`http://localhost:8080`
4. "create app". In the box:
   - **client_id** = short ~14-char string directly UNDER "personal use script" (not labeled — commonly missed)
   - **client_secret** = value next to "secret:"
5. grsg-set-channel-creds asks: client_id, client_secret, username `rezarcher`, password.
   - 2FA on rezarcher? enter password as `password:TOTP6DIGITS`, or tell Claude to switch to refresh-token flow.

## Hacker News
Enter username `greyridge` + password (account already made).

## Verify
`python3 scripts/marketing_channel.py creds-check` → both backends WIRED.
First live post per channel gets one human OK; routine measured-data posts after are auto.
Ready asset: outreach/posts/rmcp_census_2026-10-22.md (dry-run passed, claims traced).
