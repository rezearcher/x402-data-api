/**
 * Contract test: no advertised discovery example may hardcode the computed-only
 * admin-control sentinel.
 *
 * The phrase "no high-risk admin controls detected" is emitted by exactly ONE
 * legitimate code path — the live analyzer's fallback reason in src/index.ts
 * (verdict === "SAFE" && reasons.length === 0). openapi.json / the 402 challenge
 * / CDP Bazaar metadata are generated WITHOUT running that analyzer, so the
 * sentinel can only appear in the advertised spec if someone baked it as static
 * example data for a specific token. That is exactly the defect this guards:
 * the GET /gate/swap discovery example claimed USDC had "no high-risk admin
 * controls detected" while the live route (and the sibling token-security
 * example) correctly surfaced USDC's mint/blacklist/pause/upgradeable controls.
 * It sat live in every agent's decide-to-pay surface for ~30 days, making our
 * flagship gate look LESS thorough than GoPlus at the moment of purchase, because
 * nothing asserted the advertised examples match what the gate actually detects.
 *
 *   node tests/test_discovery_example_honesty.mjs
 *
 * The invariant is DERIVED (the sentinel is a runtime-computed value, never valid
 * as a baked literal), not a per-token allow/deny list, so it tracks the catalog.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app } = await import("../src/index.ts");

const env = {
  PAY_TO: "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10",
  NETWORK: "eip155:8453",
  FACILITATOR_URL: "http://facilitator.test",
  USAGE_COUNTER: { idFromName: (x) => x, get: () => ({ async fetch() { return Response.json({}); } }) },
};
globalThis.fetch = async (url) => {
  const u = String(url);
  if (["http://facilitator.test/supported", "https://facilitator.xpay.sh/supported"].includes(u))
    return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }], extensions: [], signers: {} });
  throw Error("unexpected upstream in discovery-example-honesty test: " + u);
};

const SENTINEL = "no high-risk admin controls detected";
const oasText = await (await app.request("/openapi.json", {}, env)).text();

assert.ok(
  !oasText.includes(SENTINEL),
  `openapi.json carries the computed-only admin sentinel "${SENTINEL}" as baked example data. ` +
    `That phrase is a live-analyzer fallback (never valid as a static example): a baked example asserting it ` +
    `for a specific token contradicts what the gate actually detects and misrepresents our admin-control depth.`,
);

console.log(`ok - advertised spec carries no hardcoded admin-control over-claim`);
console.log("PASS - discovery example honesty");
