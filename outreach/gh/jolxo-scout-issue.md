Jolxo Scout checks GoPlus / honeypot.is on Base and drops flagged coins — but both are lookup databases, so a fresh Base coin with no record yields nothing to act on. Grey Ridge `/chain/token-report` does a live sell-simulation + liquidity depth + owner/proxy/mint/pause check straight from Base chain state and returns `SAFE|CAUTION|AVOID` + `risk_score` — a third signal for your 1–5 risk score that works on unindexed tokens.

Free, no wallet (3 real-token checks/IP/day), e.g. for `/coin <CA>`:
```python
import requests
def base_chain_check(ca):
    r = requests.get("https://x402-data-api.sigrunner.workers.dev/chain/token-report/preview",
                     params={"token": ca}, timeout=10)
    return r.json() if r.ok else None   # verdict, risk_score, security.isHoneypot, security.sellable, liquidity
```
For the 4-hourly scan across hundreds of coins the free tier is too small; the paid route is $0.01/call USDC on Base via x402 (same path minus `/preview`). Send me a Base contract you're unsure about and I'll paste the full report here.
