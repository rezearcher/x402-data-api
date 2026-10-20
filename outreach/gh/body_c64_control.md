Idea for control: a pre-admission check when a third-party MCP server is registered/added — static scan of its advertised tools (hidden unicode, tool poisoning, hidden instructions in descriptions), verdict clear/review/block.

We run one as a free, no-wallet endpoint, so a gateway can call it from a registration hook/plugin with no new dependency:

    curl -s "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://HOST/mcp"
    # private/OAuth server: POST the tools/list result as {"tools":[...]} to the same URL
    # CLI gate (exit 2 = block): npx github:rezearcher/greyridge-x402-tools#v0.1.1 mcpscan <url>

Preview returns tools scanned, severity counts, risk score, verdict; it never calls tools. Itemized findings with evidence + OWASP LLM mapping are a paid route ($0.05 USDC via x402), optional. Static analysis only: it won't catch a server that changes behavior after admission. Happy to run it on any server you name and paste the full JSON here. If this isn't wanted, please just close. — Matthew, Grey Ridge Signals Group LLC (contact@greyridgesignals.ai)
