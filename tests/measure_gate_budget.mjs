/**
 * Prints measured fetch counts per component for /gate/swap/preview.
 *   node tests/measure_gate_budget.mjs
 */
import { register } from "node:module";
register(new URL("./cfw-hooks.mjs", import.meta.url));
import { createWorld, fakeCacheApi, TOKENS } from "./gate_budget_world.mjs";

const mod0 = await import("../src/index.ts");
const RPCS = [
  "https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org",
  "https://base-pokt.nodies.app", "https://base-mainnet.public.blastapi.io",
  "https://base.gateway.tenderly.co", "https://gateway.tenderly.co/public/base",
  "https://base.api.onfinality.io/public",
];
const realFetch = globalThis.fetch;
const ctx = { waitUntil() {}, passThroughOnException() {} };

export const loadFresh = () => import(`../src/index.ts?cold=${Math.random()}`);
export const PROVIDERS = RPCS;

export async function runOnce({ tokenKey, providerMode, cold = false, honeypot = false, world: w, cacheApi, budget, mod: modIn, path = "/gate/swap/preview" }) {
  const world = w ?? createWorld({ token: TOKENS[tokenKey], providerMode, rpcs: RPCS, honeypot });
  globalThis.fetch = world.makeFetch(realFetch);
  if (cacheApi) {
    const counted = {
      async match(r) { world.noteExtra("cache", `match ${new URL(r.url).pathname}`); return cacheApi.cache.match(r); },
      async put(r, x) { world.noteExtra("cache", `put ${new URL(r.url).pathname}`); return cacheApi.cache.put(r, x); },
    };
    globalThis.caches = { default: counted };
  } else delete globalThis.caches;
  const mod = modIn ?? (cold ? await import(`../src/index.ts?cold=${Math.random()}`) : mod0);
  world.resetRequest();
  const addr = TOKENS[tokenKey].addr;
  const tokenParam = tokenKey === "odd" ? addr : tokenKey;
  const kv = new Map();
  const env = {
    API_KEYS: {
      async get(k) { world.noteExtra("kv", `get ${k}`); return kv.get(k) ?? null; },
      async put(k, v) { world.noteExtra("kv", `put ${k}`); kv.set(k, v); },
    },
  };
  const go = () => mod.default.fetch(new Request(`https://api.greyridgesignals.ai${path}?token=${tokenParam}`, { headers: { "cf-connecting-ip": "203.0.113.9" } }), env, ctx);
  const res = await (budget ? mod.withSubrequestBudget(go, budget) : go());
  const body = await res.json();
  globalThis.fetch = realFetch;
  return { world, body, status: res.status, mod };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const scen = {
    healthy: () => "ok",
    "half-429": (u) => (RPCS.indexOf(u) % 2 === 0 ? "429" : "ok"),
    "all-timeout": () => "timeout",
    "slow-first-3": (u) => (RPCS.indexOf(u) < 3 ? "timeout" : "ok"),
  };
  for (const tokenKey of ["usdc", "weth", "aero", "odd"]) {
    for (const [name, mode] of Object.entries(scen)) {
      const { world, body } = await runOnce({ tokenKey, providerMode: mode, cold: true });
      console.log(`\n== ${tokenKey} / ${name}: total=${world.count()} decision=${body.decision} sellability_unverified=${body.sellability_unverified}`);
      console.log("   by kind:", JSON.stringify(world.byKind()));
      console.log("   sim attempts per provider:", JSON.stringify(Object.fromEntries(Object.entries(world.simAttempts()).map(([u, v]) => [u.slice(8, 26), `${v.discovery}d/${v.probe}p`]))));
      console.log("   reason:", body.reason, "| liq:", body.liquidity_usd, "| flags:", (body.flags ?? []).join(" | ").slice(0, 300));
    }
  }
}
