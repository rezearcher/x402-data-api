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
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
// ─── x402 payment helpers ────────────────────────────────────────────────────────
let authedFetch = globalThis.fetch;
const WALLET_KEY = process.env.X402_WALLET_PRIVATE_KEY;
const WORKER_URL = (process.env.WORKER_BASE_URL ?? "https://x402-data-api.sigrunner.workers.dev").replace(/\/$/, "");
if (WALLET_KEY) {
    try {
        // Dynamic imports — only loads when a wallet key is provided
        const { wrapFetchWithPayment } = await import("@x402/fetch");
        const { x402Client } = await import("@x402/core/client");
        const { registerExactEvmScheme } = await import("@x402/evm/exact/client");
        const { privateKeyToAccount } = await import("viem/accounts");
        const hexKey = WALLET_KEY.startsWith("0x") ? WALLET_KEY : `0x${WALLET_KEY}`;
        const account = privateKeyToAccount(hexKey);
        const client = new x402Client();
        registerExactEvmScheme(client, { signer: account });
        authedFetch = wrapFetchWithPayment(globalThis.fetch, client);
        console.error(`[x402] wallet active: ${account.address}`);
    }
    catch (err) {
        console.error(`[x402] failed to initialise wallet: ${err instanceof Error ? err.message : String(err)}`);
        console.error("[x402] falling back to unauthenticated fetch (free tools only)");
    }
}
else {
    console.error("[x402] no wallet key provided — free/preview tools only");
}
// ─── MCP server ──────────────────────────────────────────────────────────────────
const SERVER_INFO = {
    name: "x402-data-api-mcp",
    version: "0.1.0",
};
const server = new Server(SERVER_INFO, {
    capabilities: {
        tools: {},
    },
});
/**
 * Proxy an MCP JSON-RPC payload to the live Worker's /mcp endpoint and return
 * the parsed response.
 */
async function proxyToWorker(body) {
    const url = `${WORKER_URL}/mcp`;
    const res = await authedFetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    // Try direct JSON first (non-streaming / JSON-RPC success)
    try {
        return JSON.parse(text);
    }
    catch {
        // SSE format — extract the last `data: ...` JSON line
        let lastJson = null;
        for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ")) {
                try {
                    lastJson = JSON.parse(trimmed.slice(6));
                }
                catch {
                    // skip non-JSON data lines
                }
            }
        }
        if (lastJson)
            return lastJson;
    }
    return {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: `Worker returned HTTP ${res.status}` },
    };
}
// ─── Handler: list tools ─────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await proxyToWorker({
        jsonrpc: "2.0",
        id: "list",
        method: "tools/list",
        params: {},
    });
    const data = result?.result ?? result;
    return data;
});
// ─── Handler: call tool ──────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await proxyToWorker({
        jsonrpc: "2.0",
        id: "call",
        method: "tools/call",
        params: { name, arguments: args },
    });
    const data = result?.result ?? result;
    return data;
});
// ─── Startup ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[x402-data-api-mcp] server ready on stdio");
//# sourceMappingURL=server.js.map