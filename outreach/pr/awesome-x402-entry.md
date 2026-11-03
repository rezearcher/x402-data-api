# PR to xpaysh/awesome-x402 (builder/gh role must open; marketing role has no gh)
Edit README.md: (1) REMOVE line 355 entry (dead host, "17 endpoints", no verify tools). (2) ADD under `### Agent Verification & Security` (README L728), same list format:

- [Grey Ridge Signals — x402 Preflight & Receipt Verify](https://api.greyridgesignals.ai/x402/preflight) - Free keyless MCP/uvx (`uvx --from greyridge-x402-tools greyridge-x402-verify`) for both sides of a payment. Pre-pay `/x402/preflight` ($0.001): will it settle, price_accuracy vs advertised, delivery-LEAK check, OFAC/scam screen -> PAY|CAUTION|AVOID. Post-pay `/x402/receipt-verify` ($0.004): bring your Base tx + URL, dual-RPC fail-closed reconciliation vs advertised payTo/amount -> SETTLED|UNDERPAID|WRONG_RECIPIENT|NOT_FOUND. ([OpenAPI](https://api.greyridgesignals.ai/openapi.json) | [Discovery](https://api.greyridgesignals.ai/.well-known/x402) | [PyPI](https://pypi.org/project/greyridge-x402-tools/) | [Guide](https://api.greyridgesignals.ai/research/x402-payment-due-diligence-before-and-after-your-agent-pays))

PR title: Move Grey Ridge Signals to Agent Verification & Security; update host + add preflight/receipt-verify
Hedge: cite USENIX 2026 (arXiv 2607.19545), not CVE claims.
