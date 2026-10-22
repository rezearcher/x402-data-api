# Blocker: publish the MCP Server Security Scanner to Apify Store

**Status:** build complete, waiting on one Rez action (Apify account connect + publish).
**Why this matters:** Apify Store is the first distribution channel in 100+ cycles that gives us *all three* things we've lacked — a human developer audience, organic in-store discovery, and built-in fiat billing (Apify collects, pays us monthly). No listing-PR gate, no agent-discovery desert. The Actor is already built and its engine is verified.

## What's built (zero-capital, done)

`integrations/apify/` in the `greyridge-x402-tools` repo — a complete Apify Actor:
- `.actor/actor.json`, `.actor/input_schema.json`, `.actor/dataset_schema.json`
- `Dockerfile` (official `apify/actor-node:20` base)
- `package.json` (pulls the scan engine from the public MIT package — one source of truth)
- `src/main.js` — fetches a target's `tools/list`, runs our verbatim offline engine, pushes **one report per scan** (the pay-per-result billing unit)
- `README.md` — store listing copy (professional Grey Ridge voice)

Engine output verified locally against a poisoned+clean sample: critical+high findings, verdict=block, risk 60/100.

## Unit economics (computed, not guessed)

- Incumbent on Apify (`abhi72/mcp-security-scanner`): **$0.10/scan**. Our engine is more capable.
- Suggested launch price: **$0.05/scan** (half the incumbent) → 78.9% margin, **$0.0394 net/scan** after Apify's 20% + infra. Alternatively value-price a security audit at **$0.25/scan** (still cheap) → ~$0.20 net/scan.
- **Capital at risk: $0.** Rev-share, no upfront. Worst case is a mispriced Actor at negative infra margin; our price >> infra (~$0.0006/scan), so the floor is ~$0.

## The one action (Rez)

Requires an Apify account (identity) + a payout method (for the monthly 80% payout). Everything else is done.

```bash
# 1. one-time: install the CLI and log in (or sign up at https://console.apify.com)
npm install -g apify-cli
apify login                      # opens browser / takes an API token from console.apify.com/account/integrations

# 2. publish from the built Actor dir
cd ~/projects/x402-data-api/.work/greyridge-x402-tools/integrations/apify
apify push                       # builds the Docker image on Apify and creates the Actor

# 3. in the Apify Console for the new Actor:
#    - Publication tab -> set to Public, category "Developer tools" / "AI"
#    - Monetization -> pricing model "Pay per result", price per 1,000 results:
#        $50 (=$0.05/scan, beat incumbent)  OR  $250 (=$0.25/scan, value price)
#    - connect a payout method for the monthly payout
```

After publish, the Actor is discoverable in Apify Store under "MCP security" and billed in fiat with no further operator work. Verify first revenue in the Actor's Insights dashboard.

## Notes
- The Actor never invokes a target tool (static `tools/list` analysis only) — safe to run against any server.
- No x402, no wallet, no self-pay: the engine runs offline inside the Actor; Apify bills the end user.
