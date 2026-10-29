/**
 * ERC-8004 registration-v1 file + A2A agent-card cross-link.
 *
 *   node tests/test_erc8004_registration.mjs
 *
 * /.well-known/erc-8004.json is the machine input an ERC-8004 / A2A discovery
 * crawler (HOL's Universal Agent Registry protocol-detection, the QuickNode
 * ERC-8004 explorer, Agent Arena) ingests to classify this agent into the
 * "Best x402 Payable" category. The shape must match the registration-v1 files
 * those crawlers already parse: top-level x402Support:boolean,
 * pricing{chain,currency,per_task}, services[{name,endpoint}] for x402/a2a/MCP,
 * supportedTrust, registrations. A drift here silently drops us from that
 * discovery surface, so lock the shape. Served keylessly (env carries only the
 * receiving wallet) so any crawler ingests it without a broker account.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app } = await import("../src/index.ts");

const PAY_TO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10";
const env = { PAY_TO };
const BASE = "https://x402-data-api.sigrunner.workers.dev";

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

// --- /.well-known/erc-8004.json ---
{
  const res = await app.request("/.well-known/erc-8004.json", {}, env);
  eq(res.status, 200, "erc-8004.json serves 200");
  ok((res.headers.get("content-type") || "").includes("application/json"), "erc-8004.json is application/json");
  const d = await res.json();

  // Canonical registration-v1 fields the crawlers key on.
  eq(d.type, "https://eips.ethereum.org/EIPS/eip-8004#registration-v1", "type is the eip-8004 registration-v1 URL");
  eq(d.x402Support, true, "x402Support is the boolean true (not a string)");
  eq(d.active, true, "active is true (the API is live)");
  eq(d.pricing.chain, "base", "pricing.chain is base");
  eq(d.pricing.currency, "USDC", "pricing.currency is USDC");
  ok(typeof d.pricing.per_task === "number" && d.pricing.per_task > 0, "pricing.per_task is a positive number");

  // Identity / settlement address is our real receiving wallet, echoed from env.
  eq(d.address, PAY_TO, "address is the receiving wallet from env");
  eq(d.agentAddress, PAY_TO, "agentAddress is the receiving wallet from env");

  // services[] canonical names + endpoints.
  const svc = Object.fromEntries((d.services || []).map((s) => [s.name, s.endpoint]));
  eq(svc["x402"], BASE + "/.well-known/x402", "x402 service points at the payment manifest");
  eq(svc["a2a"], BASE + "/.well-known/agent-card.json", "a2a service points at the agent card");
  eq(svc["MCP"], BASE + "/mcp", "MCP service points at the MCP endpoint");

  ok(Array.isArray(d.supportedTrust) && d.supportedTrust.includes("reputation"), "supportedTrust includes reputation");
  // registrations stays empty until an on-chain ERC-8004 identity is minted.
  ok(Array.isArray(d.registrations) && d.registrations.length === 0, "registrations is an empty array (no on-chain mint yet)");

  // Grey Ridge extension: honest full pricing beyond the single per_task.
  eq(d.payment.network, "eip155:8453", "payment.network is Base");
  eq(d.payment.asset, "USDC", "payment.asset is USDC");
  ok(/^[0-9.]+-[0-9.]+$/.test(d.price_range_usdc || ""), "price_range_usdc is a min-max string");
  ok(Array.isArray(d.routes) && d.routes.length > 1, "routes is a populated array");
  ok(d.routes.every((r) => r.endpoint && r.endpoint.startsWith(BASE) && r.price_usdc), "every route has an endpoint + price");
  eq(d.route_count, d.routes.length, "route_count matches routes length");
  // per_task is the flagship pre-trade gate price (the headline x402-payable product).
  const gate = d.routes.find((r) => r.endpoint === BASE + "/gate/swap");
  ok(gate, "the /gate/swap flagship route is present");
  eq(d.pricing.per_task, Number(gate.price_usdc), "per_task equals the flagship /gate/swap price");
  // Range brackets the flagship price (sanity: per_task within [min,max]).
  const [minP, maxP] = (d.price_range_usdc || "0-0").split("-").map(Number);
  ok(d.pricing.per_task >= minP && d.pricing.per_task <= maxP, "per_task falls within the advertised price range");
}

// --- /.well-known/agent-card.json cross-link ---
{
  const res = await app.request("/.well-known/agent-card.json", {}, env);
  eq(res.status, 200, "agent-card.json serves 200");
  const d = await res.json();
  ok(Array.isArray(d.registrations) && d.registrations.length >= 1, "card has a registrations array");
  const reg = d.registrations.find((r) => r.protocol === "erc-8004");
  ok(reg, "card references the erc-8004 registration");
  eq(reg.registrationUri, BASE + "/.well-known/erc-8004.json", "registrationUri points at erc-8004.json");
  eq(reg.agentAddress, PAY_TO, "registration agentAddress is the receiving wallet");
  ok(d.payments && Array.isArray(d.payments.supported) && d.payments.supported.includes("x402"), "card declares x402 in payments.supported");
  eq(d.payments.network, "eip155:8453", "card payments.network is Base");
  eq(d.payments.asset, "USDC", "card payments.asset is USDC");
}

console.log(`test_erc8004_registration: ${pass} checks passed`);
