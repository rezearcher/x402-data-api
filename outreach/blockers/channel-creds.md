# Blocker: marketing channel credentials (the one atom)
Run once as rez: `grsg-set-channel-creds` — prompts for
- Reddit script-app client id/secret (reddit.com/prefs/apps -> create "script"), username `rezarcher`, password
- HN login `greyridge`
Then verify: `python3 scripts/marketing_channel.py creds-check` shows both backends ok.
First live post of each channel needs a human OK row in the approvals ledger.
Ready asset: outreach/posts/rmcp_census_2026-10-22.md -> r/mcp (dry-run passed, claims traced).
Fallback with zero creds: paste that file into reddit.com/r/mcp/submit manually (~2 min).
