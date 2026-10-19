`core/crypto/risk_engine.py` treats a missing GoPlus record as "unchecked" (the right call) — but for fresh Base tokens that is most candidates, so the "false pearl" warning never fires where it matters. A second source that doesn't need a pre-indexed record: Grey Ridge `/chain/token-report` does a live sell-simulation + liquidity + owner/proxy/mint/pause checks from Base chain state and returns `SAFE|CAUTION|AVOID`.

Free, no wallet (3 real-token checks/IP/day):
```python
import requests
def base_second_opinion(addr):
    r = requests.get("https://x402-data-api.sigrunner.workers.dev/chain/token-report/preview",
                     params={"token": addr}, timeout=10)
    return r.json() if r.ok else None   # verdict, risk_score, security.isHoneypot, security.sellable, liquidity
```
Call it only when `fetch_token_security()` returns None so it adds a flag to your alert without a veto. Paid route for higher volume: $0.01/call USDC on Base via x402. Give me a token you want checked and I'll paste the output here.
