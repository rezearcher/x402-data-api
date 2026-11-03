Most x402 verification tools want you to sign up, fund a wallet or call a hosted API. If your agent stack is Python, there is a shorter path: one `uvx` line that starts a local MCP server with two read-only checks, one before you pay and one after.

## The one line

```
uvx --from greyridge-x402-tools greyridge-x402-verify
```

Add it to any MCP client (Claude Desktop, Cursor, Claude Code) as a stdio server:

```json
{ "mcpServers": { "x402-verify": { "command": "uvx", "args": ["--from", "greyridge-x402-tools", "greyridge-x402-verify"] } } }
```

The package is `greyridge-x402-tools` 0.6.0 on PyPI. No API key and no wallet. The server speaks stdio and forwards the two checks to our hosted endpoints, so you get current logic without reinstalling.

## The two tools

I started the 0.6.0 server and listed its tools. It exposes exactly two:

| Tool | When | What it answers |
|---|---|---|
| `x402_preflight` | Before paying | Will it settle (PAY / CAUTION / AVOID)? Is the charged price the advertised one? Does it leak the resource unpaid? Is the payee sanctioned or a known scammer? |
| `x402_receipt_verify` | After paying | Did a Base transaction really pay the expected recipient the expected USDC amount? |

Both are free as a preview: 3 checks per IP per day on real URLs and transactions.

## What a live call returns

I called `x402_receipt_verify` through the stdio server on a real Base transaction (`0x3e96…a0b1`, 0.005 USDC to our own payTo address), claiming a different recipient (`0x…dEaD`). The result:

- `verdict`: `WRONG_RECIPIENT`
- `settled`: `false`
- `tx_status`: `success`
- `network`: `eip155:8453`
- a Basescan link for the transaction

The transaction succeeded on-chain, but it did not pay the address I claimed, so it is not reported as settled. The full verdict set is SETTLED, UNDERPAID, WRONG_RECIPIENT, NO_TRANSFER, REVERTED, NOT_FOUND and UNVERIFIED. The receipt is read from two RPC providers and cross-checked. If they disagree the result is UNVERIFIED rather than a guess. If only one answers, the response says `single-source` so you can see how much weight it carries.

## Why a post-payment check matters

The USENIX Security 2026 paper "When HTTP 402 Meets the Blockchain" analyzed 15 x402 facilitators and found 31 vulnerabilities. One class lets a payment pass off-chain verification while nothing settles on-chain. An on-chain receipt check does not trust the facilitator's word. See our [USENIX / V12 write-up](/research/usenix-v12-x402-attacks-verify-your-own-settlement) for the mapping.

## What it does not do

- It never pays and never holds keys. It only reads.
- `SETTLED` means the USDC transfer happened. It does not prove the seller returned a correct answer. Answer-quality audits such as Teppi's "A 2xx is not a delivery" cover that gap, and the two are complementary.
- `PAY` from preflight is a structural check, not a safety guarantee.

## Related

- [Before and after: the x402 due-diligence loop](/research/x402-payment-due-diligence-before-and-after-your-agent-pays)
- [Use the same checks as a free MCP tool in Claude or Cursor](/research/free-mcp-tool-verify-x402-payment-settled-claude-cursor)
