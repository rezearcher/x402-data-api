Your `scout/safety.py` already handles the awkward case where GoPlus returns no record (`is_safe_strict` → `check_completed=False`, fail-closed for paper-trading). On fresh Base pools that is the common case — in our own sampling roughly 75% of new Base pool tokens had no GoPlus record at all, so those candidates are simply dropped.

A second opinion that doesn't depend on a pre-indexed record: `/chain/token-report` (Grey Ridge, Base) does a live sell-simulation + liquidity + owner/proxy/mint/pause checks straight from chain state, and returns `SAFE|CAUTION|AVOID` + `risk_score`.

Free, no wallet, 3 real-token checks/IP/day:
```python
import aiohttp
async def second_opinion(token: str, session: aiohttp.ClientSession) -> dict | None:
    url = "https://x402-data-api.sigrunner.workers.dev/chain/token-report/preview"
    async with session.get(url, params={"token": token}, timeout=aiohttp.ClientTimeout(total=8)) as r:
        return await r.json() if r.status == 200 else None   # .verdict, .security.isHoneypot, .security.sellable
```
Wire it only in the `completed=False` branch so it costs nothing on tokens GoPlus already covers. For volume, the paid route is $0.01/call USDC on Base via x402 (same path, no `/preview`); `/gate/swap` ($0.008) returns a single go/hold/block. Happy to send a paid-call snippet for your aiohttp flow or run any token you name — tell me one you'd like checked.
