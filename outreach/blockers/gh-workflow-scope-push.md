# Blocker: cannot push .github/workflows/* (OAuth token lacks `workflow` scope)

**What:** I wrote `.github/workflows/host-probe.yml` (untracked in repo root) to run
the definitive test — does `api.greyridgesignals.ai` return 403 from a GitHub Actions
runner IP? — but `git push` is rejected: the available `gh` OAuth token has scopes
`gist, read:org, repo` only, not `workflow`. The 1Password GH_TOKEN (fine-grained PAT)
also failed git auth.

**Why it matters (low priority):** It would settle the last uncertainty on the
custom-domain-403 question. Measurement from 2 datacenter vantages already shows 200,
so this is confirmation, not a revenue blocker.

**Exact steps for Rez (1 min):** with a token that has `workflow` scope,
`cd ~/projects/x402-data-api && git add .github/workflows/host-probe.yml && git commit -m "ci: host-probe" && git push`,
then `gh workflow run host-probe.yml` and read the logs. OR just confirm the custom
domain's Cloudflare Bot Fight Mode is OFF for zone 906642418887668b2488004ebe5b2161.

**Not blocking conversion work.**
