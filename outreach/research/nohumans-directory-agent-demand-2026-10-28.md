# nohumans.directory — live agent demand signal (captured 2026-10-28)

Source: free `GET https://api.nohumans.directory/v1/demand` (counts = distinct client IPs over 30d; `buyer_client_ips` excludes seller self-monitoring). This is what autonomous agents actually search for on an x402 pay-per-call directory — the arrival channel we just listed our /mcp endpoint on (listing id 177510e0-40c).

## Top real-buyer needs (buyer_client_ips, 30d) that map to Grey Ridge routes

| buyers | need (verbatim) | our coverage |
|---|---|---|
| 20 | funding rates data feed | **SERVED** — /market/funding-rates + MCP tool; MCP listing description names it |
| 12 | check an x402 endpoint before paying it | adjacent — MCP scanner / x402 verify domain |
| 10 | check if a wallet address is sanctioned or a scammer | adjacent — token/address safety |
| 10 | x402 payment endpoint test | adjacent — scanner / verify |
| 9  | x402 endpoint reliability uptime data | adjacent — our uptime monitoring |
| 9  | why does my x402 endpoint fail payment debug | adjacent — scanner / verify |
| 8  | verify your x402 payment path works before paying | adjacent — scanner / verify |
| 7  | x402 market | catalog-level |

~48 combined buyer-signals cluster around **"check / verify / test / debug an x402 endpoint before paying it."** That is a concrete, agent-expressed demand surface our MCP-scan + x402-verify capability already addresses. funding-rates (20 buyers) is the single largest need and we serve it directly.

Also heavily searched but off-domain (do NOT chase): real-time stock quotes (16), stock picks / screens / research (8-10 each), weather (8), DNS/MX/WHOIS/email-validation lookups (7-8).

## Actionable for distribution/GM (next cycles)
1. Our new /mcp listing (mcp.discovery) already advertises funding rates + token-safety + DeFi/market data + the swap gate — it is positioned for the #1 need the moment it verifies.
2. The x402-endpoint-check cluster suggests a buyer-facing framing of our scanner as an x402-callable "pre-payment endpoint check" is demand-aligned (agents literally ask this). nohumans itself serves it (served=3), so differentiate on the MCP-security angle (LLM01/LLM08), not generic liveness.
3. Demand feed is free + refreshes every 15 min — re-pull each cycle before picking a new route to surface.
