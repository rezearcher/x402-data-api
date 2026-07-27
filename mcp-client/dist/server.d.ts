#!/usr/bin/env node
/**
 * x402-data-api-mcp — MCP stdio server wrapping the x402-data-api Worker's MCP endpoint.
 *
 * Proxies all MCP JSON-RPC calls (tools/list, tools/call, initialize, etc.)
 * to the live Worker at WORKER_BASE_URL/mcp.
 *
 * When X402_WALLET_PRIVATE_KEY is set, paid tools (which return HTTP 402) are
 * automatically settled using @x402/fetch's wrapFetchWithPayment — the
 * installer's wallet signs the x402 challenge and retries. Free/preview tools
 * pass through without payment.
 *
 * Usage:
 *   X402_WALLET_PRIVATE_KEY=0x... npx x402-data-api-mcp
 *   # or for free tools only (no wallet):
 *   npx x402-data-api-mcp
 */
export {};
//# sourceMappingURL=server.d.ts.map