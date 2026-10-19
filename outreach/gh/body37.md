Hi — x402 tooling like this tends to need a concrete paid endpoint to wire against, so a practical one: a pre-sign token/contract safety check.

We run a pay-per-call x402 API on Base (USDC, no key/account):

- `GET https://x402-data-api.sigrunner.workers.dev/chain/token-security?token=0x…` — honeypot/owner/tax flags
- `GET https://x402-data-api.sigrunner.workers.dev/gate/swap/preview` — free pre-swap gate preview (no payment); paid version $0.008
- `/chain/token-report`, `/chain/proxy-info`, `/chain/total-supply` — $0.003–0.01

Free previews need no wallet, so you can see the exact response shape first. Manifest: https://x402-data-api.sigrunner.workers.dev/.well-known/x402

Happy to send a ready-to-paste example for this repo. Feel free to close if not relevant.
