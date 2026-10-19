Offering a real, live paid endpoint you can use as an example/demo target in the BofAI/x402 docs, with a free no-wallet preview so readers see the response shape before wiring payment.

- Free: `GET https://x402-data-api.sigrunner.workers.dev/defi/protocol-risk/preview` (risk score for a DeFi protocol) and `/chain/token-report/preview?token=weth` (trade-safety verdict for a Base token).
- Paid (x402 v2, USDC on Base, no API key): the same paths minus `/preview`, $0.005–$0.01/call — a small, realistic amount for a 402 round-trip demo. Full route list: `https://x402-data-api.sigrunner.workers.dev/openapi.json`.

Happy to PR a short "paying a real endpoint" example using your client if that's useful. Which language/transport would you want it in?
