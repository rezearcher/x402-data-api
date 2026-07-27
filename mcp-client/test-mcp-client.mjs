#!/usr/bin/env node

/**
 * Test harness for x402-data-api-mcp stdio server.
 *
 * Spawns the compiled dist/server.js, sends JSON-RPC over its stdin,
 * and prints parsed responses.
 *
 * Usage:
 *   node test-mcp-client.mjs            # free tools only
 *   X402_WALLET_PRIVATE_KEY=0x... node test-mcp-client.mjs
 */

import { spawn } from "node:child_process";

const workerUrl = process.env.WORKER_BASE_URL ?? "https://x402-data-api.sigrunner.workers.dev";
const serverPath = new URL("./dist/server.js", import.meta.url).pathname;

// ─── JSON-RPC helpers ────────────────────────────────────────────────────────────

function jsonRpc(method, params = {}) {
  return { jsonrpc: "2.0", id: crypto.randomUUID(), method, params };
}

// ─── Spawn with line-buffered stdio ──────────────────────────────────────────────

const proc = spawn("node", [serverPath], {
  env: { ...process.env, WORKER_BASE_URL: workerUrl },
  stdio: ["pipe", "pipe", "inherit"],
});

const reader = proc.stdout[Symbol.asyncIterator]();

async function send(msg) {
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

async function recv(timeoutMs = 8000) {
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const { value } = await reader.next();
    clearTimeout(timer);
    const line = typeof value === "string" ? value : Buffer.from(value).toString("utf-8");
    return JSON.parse(line.trim());
  } catch {
    clearTimeout(timer);
    return { error: `no response within ${timeoutMs}ms` };
  }
}

// ─── Actual tools reported by the live Worker ────────────────────────────────────

const EXPECTED_TOOLS = [
  "enrich_tech_risk", "enrich_domain", "scan_mcp_server", "scan_mcp_preview",
  "crypto_prices", "crypto_funding", "defi_yields", "pm_markets",
  "crypto_prices_preview", "crypto_funding_preview", "defi_yields_preview",
  "pm_markets_preview",
  "chain_block_number", "chain_gas_price", "chain_balance", "chain_token_balance",
  "chain_tx", "chain_wallet", "chain_token_security",
  "chain_block_number_preview", "chain_gas_price_preview", "chain_token_security_preview",
];

let passed = 0;
let failed = 0;

function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.log(`  ✗ ${label}: ${detail}`); failed++; }

try {
  // ── 0. Read past the initialized notification if the Worker sends one ──
  //    (MCP spec: server sends initialized notification after receiving initialize)

  // ── 1. tools/list ──
  console.log("\n=== [1/5] tools/list ===");
  await send(jsonRpc("tools/list"));
  const listRes = await recv();
  const tools = listRes?.result?.tools ?? [];

  console.log(`  → ${tools.length} tools returned`);

  let missing = 0;
  for (const name of EXPECTED_TOOLS) {
    if (!tools.some((t) => t.name === name)) {
      console.error(`  ✗ MISSING: ${name}`);
      missing++;
    }
  }
  if (missing === 0) ok("all 22 expected tools present");
  else fail("tools/list", `${missing} expected tools missing`);

  // ── 2. Free preview: chain_block_number_preview ──
  console.log("\n=== [2/5] chain_block_number_preview ===");
  await send(jsonRpc("tools/call", {
    name: "chain_block_number_preview",
    arguments: { chain: "base" },
  }));
  const chainRes = await recv();
  const chainText = (chainRes?.result?.content ?? []).map((c) => c.text).join("\n");
  if (chainText && chainText.includes("block_number")) ok("returns block number");
  else fail("chain_block_number_preview", chainText.slice(0, 200));

  // ── 3. Free preview: crypto_prices_preview ──
  console.log("\n=== [3/5] crypto_prices_preview ===");
  await send(jsonRpc("tools/call", {
    name: "crypto_prices_preview",
    arguments: { symbols: "BTC,ETH" },
  }));
  const priceRes = await recv();
  const priceText = (priceRes?.result?.content ?? []).map((c) => c.text).join("\n");
  if (priceText && priceText.includes("price")) ok("returns prices");
  else fail("crypto_prices_preview", priceText.slice(0, 200));

  // ── 4. Free preview: chain_gas_price_preview ──
  console.log("\n=== [4/5] chain_gas_price_preview ===");
  await send(jsonRpc("tools/call", {
    name: "chain_gas_price_preview",
    arguments: { chain: "base" },
  }));
  const gasRes = await recv();
  const gasText = (gasRes?.result?.content ?? []).map((c) => c.text).join("\n");
  if (gasText && (gasText.includes("gas") || gasText.includes("wei") || gasText.includes("gwei"))) ok("returns gas price");
  else fail("chain_gas_price_preview", gasText.slice(0, 200));

  // ── 5. Free preview: chain_token_security_preview ──
  console.log("\n=== [5/5] chain_token_security_preview ===");
  await send(jsonRpc("tools/call", {
    name: "chain_token_security_preview",
    arguments: {
      chain: "base",
      token_address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Ef6ed9",
    },
  }));
  const secRes = await recv();
  const secText = (secRes?.result?.content ?? []).map((c) => c.text).join("\n") || JSON.stringify(secRes);
  if (secText) ok("returns token security data");
  else fail("chain_token_security_preview", secText.slice(0, 200));

  // ── Summary ──
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
} finally {
  proc.kill();
}
process.exit(failed > 0 ? 1 : 0);
