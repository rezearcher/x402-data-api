/**
 * MCP connect-time identity tests.
 *
 *   node tests/test_mcp_identity.mjs
 *
 * The live remote MCP server (official registry isLatest, Glama auto-listing)
 * renders serverInfo.name + the initialize `instructions` field FIRST on every
 * client connect. These assert that handshake carries the security-positioned
 * brand, the registry-aligned version, and an honest (Claims-Law) capability +
 * /pricing description — turning the connect event into a funnel touch.
 *
 * Node >= 22.18 strips types; the virtual cloudflare:workers module is shimmed.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app } = await import("../src/index.ts");

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
  console.log("  ok -", msg);
}

// Parse an SSE `event: message\ndata: {json}` body into the JSON-RPC payload.
function parseSse(text) {
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  assert.ok(line, "SSE body has a data: line");
  return JSON.parse(line.slice("data:".length).trim());
}

async function initialize() {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  };
  const res = await app.request(
    "/mcp",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    },
    { API_KEYS: null },
  );
  const text = await res.text();
  return parseSse(text).result;
}

console.log("MCP identity (initialize handshake):");
const result = await initialize();
const info = result.serverInfo || {};

// 1. Security-positioned display identity (not the generic package id).
ok(typeof info.name === "string" && info.name.length > 0, "serverInfo.name present");
ok(info.name !== "x402-data-api", "serverInfo.name is rebranded (not generic x402-data-api)");
ok(/grey ?ridge/i.test(info.name), "serverInfo.name carries the Grey Ridge security brand");

// 2. Version aligned with the official registry isLatest (0.1.4).
ok(info.version === "0.1.4", "serverInfo.version === 0.1.4 (registry isLatest aligned)");

// 3. Honest, funnel-routing instructions string (Claims Law: not a guarantee).
const instr = result.instructions;
ok(typeof instr === "string" && instr.trim().length > 0, "result.instructions is a non-empty string");
ok(instr.includes("/pricing"), "instructions route to the /pricing funnel");
ok(/not a guarantee|not .*safe/i.test(instr), "instructions carry the Claims-Law honesty caveat (not a guarantee of safety)");
ok(/LLM01|LLM08|prompt-injection|tool-poisoning/i.test(instr), "instructions name the static-detection scope");
// 4. No agent-steering / self-incriminating hidden directives (we are a scanner
//    that flags exactly this).
ok(!/always call|do not tell|don't tell|ignore (previous|prior)|hidden/i.test(instr), "instructions contain no agent-steering directives");

console.log(`\nAll ${passed} MCP-identity checks passed.`);
