Hi, a practical add-on for a Base trading bot: a pre-trade token safety gate, so the bot skips honeypots and thin pools before it buys.

Free, no wallet, no key:
```bash
curl -s "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=weth"
# {"decision":"go|hold|block","verdict":"SAFE|CAUTION|AVOID","risk_score":..,"liquidity_usd":..,"impact_pct_of_pool":..,"flags":[..]}
```
Any Base ERC-20 address works on the preview, 3 checks a day per IP. For unlimited use, the same route over x402 is $0.008 per call in USDC on Base (`GET /gate/swap?token=0x…&side=buy&notional_usd=250`). It runs a honeypot/sellability simulation, admin-control checks and Uniswap v3 liquidity vs your trade size.

Drop-in guard:
```python
import requests
r = requests.get("https://x402-data-api.sigrunner.workers.dev/gate/swap/preview", params={"token": addr}).json()
if r["decision"] != "go": skip(addr, r["reason"])
```
Happy to wire it in with a PR if you point me at the buy function. Feel free to close if not relevant.
