Hi — maintainers of an MCP gateway/platform often need a pre-admission check on third-party MCP servers (tool poisoning, hidden instructions, hidden unicode in tool descriptions). We run a static scanner for exactly that, with a free no-wallet preview you can try now:

```
npx github:rezearcher/greyridge-x402-tools mcpscan https://your-mcp-host/mcp
# exit 2 on block, so it works as a CI / admission gate
```
Preview returns tools scanned, severity counts, risk score and verdict (clear/review/block). It only reads advertised tool metadata (tools/list); it never calls tools. Itemized findings with evidence + OWASP LLM01/LLM08 mapping are the paid `GET /scan/mcp?url=` at $0.05 USDC via x402 on Base, so a gateway could call it programmatically when a server is registered. Also a GitHub Action: `rezearcher/greyridge-x402-tools@main`.

Happy to run the full scan on any server you point me at and paste the JSON here. Not a fit? Just close this. — Matthew, Grey Ridge Signals Group LLC (contact@greyridgesignals.ai)
