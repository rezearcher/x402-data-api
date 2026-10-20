Franklin Trading's risk engine (`src/trading/risk.ts`) checks cash, fees, position and exposure caps, but nothing in the README says it checks whether a Base token can actually be *sold* before a 0x quote/swap goes out. For new or long-tail Base tokens that's the loss the caps don't catch (honeypot, sell tax, admin-controlled transfers, thin liquidity vs. trade size).

We run a pay-per-call pre-trade gate on x402 (USDC on Base), so it uses the same payment path Franklin already has:

- `GET /gate/swap?token=0x…&side=buy|sell&notional_usd=…` returns a one-word go / hold / block decision plus reason. Price is $0.008 per call.
- Free preview, no wallet or key (3 real-token checks per IP per day): `curl -s "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=0x<BASE_TOKEN>"`
- Full report with honeypot, sellability, transfer-tax and admin-control fields: `/chain/token-report/preview?token=0x<BASE_TOKEN>`

It would drop in as one tool that the risk engine calls before any Base live fill, rejecting on `block`. Which Base token do you want to try first? If it helps I'll write the tool against your `src/tools/` layout.
