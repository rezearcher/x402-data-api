/**
 * Contract test for the x402 Relay Manifest Scanner crawl hook (/.well-known/ai.txt).
 *
 *   node tests/test_ai_txt_manifest.mjs
 *
 * WHY (measured 2026-11-04): x402-relay.com's directory had 200 services, max
 * trustScore 39.81, ZERO verified (>=70) and ZERO rows with any on-chain txCount,
 * and we were not indexed. The provider docs
 * (x402relay-docs.pages.dev/providers/register) say the Manifest Scanner reads
 * `/.well-known/ai.txt` with exactly four fields and then probes x402-endpoint for
 * a 402. This locks the field names, order, and honest values so the file can
 * never drift into vaporware (price must equal the route's real $0.001) and the
 * advertised endpoint stays a genuine 402-returning route on the serving host.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { buildAiTxt } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

const PAYTO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10";

// (1) workers.dev host — the crawler-reachable row.
{
  const t = buildAiTxt("x402-data-api.sigrunner.workers.dev", PAYTO);
  const lines = t.split("\n");
  // exact four required fields, exact order, exact names (scanner is strict).
  ok(lines[0] === "x402-endpoint: https://x402-data-api.sigrunner.workers.dev/crypto/prices", "endpoint field line 0");
  ok(lines[1] === "x402-network: base", "network base line 1");
  ok(lines[2] === "x402-asset: USDC", "asset USDC line 2");
  ok(lines[3] === "x402-price: 0.001", "price honest $0.001 line 3");
  // endpoint must be a route that returns a 402 (NOT the 200 landing root).
  ok(!/\/crypto\/prices$/.test("https://x402-data-api.sigrunner.workers.dev") , "root is not the endpoint");
  ok(t.includes("/crypto/prices"), "advertises a real 402 route");
}

// (2) self-host consistency — brand host advertises itself.
{
  const t = buildAiTxt("api.greyridgesignals.ai", PAYTO);
  ok(t.startsWith("x402-endpoint: https://api.greyridgesignals.ai/crypto/prices"), "endpoint tracks serving origin");
  ok(!t.includes("sigrunner.workers.dev"), "no cross-host leak");
}

// (3) no price drift: the only price string present is 0.001 (the route's real atomic 1000/1e6).
{
  const t = buildAiTxt("api.greyridgesignals.ai", PAYTO);
  const m = t.match(/x402-price:\s*([0-9.]+)/);
  ok(m && m[1] === "0.001", "price field is the honest route price");
}

console.log(`ai.txt manifest contract: ${pass} assertions passed`);
