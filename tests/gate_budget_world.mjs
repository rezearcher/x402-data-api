/**
 * Offline model of the Base RPC world plus a counting fetch shim, used to measure
 * and pin the Cloudflare per-request subrequest budget of the /gate/swap path.
 *
 * The shim enforces the free-plan cap the way workerd does: the 51st fetch of one
 * request throws "Too many subrequests". Every fetch is attributed to a component
 * (code, name, supply, meta, proxy, owner, sim-discovery, sim-probe, tax, liquidity,
 * sourcify, goplus, price, other) from the request body, so the table is measured,
 * not estimated. Nothing here touches the network.
 */
import { keccak256 } from "viem";

export const CAP = 50;
const PROBE_HOLDER = "0x1111111111111111111111111111111111111111";
const PROBE_VALUE = 31337n * 10n ** 18n;
const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const pad = (a) => a.slice(2).toLowerCase().padStart(64, "0");
const slotKey = (holder, slot) => keccak256(`0x${pad(holder)}${word(slot)}`);

const ZOS_IMPL = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";
const FACTORY = "0x33128a8fc17869897dce68ed026d694621f6fdfd";
const WETH = "0x4200000000000000000000000000000000000006";

function abiString(s) {
  const hex = Buffer.from(s).toString("hex");
  return "0x" + word(32) + word(s.length) + hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
}

export const TOKENS = {
  usdc: { addr: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", slot: 9n, name: "USD Coin", symbol: "USDC", decimals: 6, proxy: true, owner: true, pool: true },
  weth: { addr: WETH, slot: 3n, name: "Wrapped Ether", symbol: "WETH", decimals: 18, proxy: false, owner: false, pool: false },
  aero: { addr: "0x940181a94a35a4569e4529a3cdfb74e38fd98631", slot: 0n, name: "Aerodrome", symbol: "AERO", decimals: 18, proxy: false, owner: true, pool: true },
  // OpenZeppelin v5 upgradeable tokens keep _balances at a keccak-derived slot that
  // is only knowable by the 7201 formula; the test passes it in as a bigint.
  odd: { addr: "0xabababababababababababababababababababab", slot: 37n, name: "Odd Token", symbol: "ODD", decimals: 18, proxy: false, owner: true, pool: true },
};

/**
 * modes per provider url: "ok" | "429" | "timeout" | "ignore-override"
 * `modeFor(url, callIndex)` may be supplied for dynamic behaviour.
 */
export function createWorld({ token, providerMode = () => "ok", rpcs, honeypot = false } = {}) {
  const log = []; // one entry per fetch of the CURRENT request
  let cursor = 0; // index of the first log entry of the current request
  const state = { count: 0 };

  const classify = (url, init) => {
    const u = String(url);
    let body = null;
    try { body = init?.body ? JSON.parse(init.body) : null; } catch { /* non-json */ }
    if (rpcs.includes(u)) {
      if (Array.isArray(body)) return { kind: body[0]?.method === "eth_getStorageAt" ? "proxy" : "liquidity", detail: `batch x${body.length}` };
      const m = body?.method;
      const p = body?.params ?? [];
      if (m === "eth_getCode") return { kind: p[0]?.toLowerCase() === token.addr ? "code" : "owner", detail: "getCode" };
      if (m === "eth_getStorageAt") return { kind: "proxy", detail: "getStorageAt" };
      if (m === "eth_simulateV1") return { kind: "tax", detail: "simulateV1" };
      if (m === "eth_call") {
        const data = (p[0]?.data ?? "").toLowerCase();
        const override = p[2];
        if (data.startsWith("0xa9059cbb") && override) return { kind: "sim-probe", detail: "transfer" };
        if (data.startsWith("0x70a08231") && override) return { kind: "sim-discovery", detail: "balanceOf+override" };
        if (data.startsWith("0x06fdde03")) return { kind: "name", detail: "name()" };
        if (data.startsWith("0x18160ddd")) return { kind: "supply", detail: "totalSupply()" };
        if (data.startsWith("0x95d89b41") || data.startsWith("0x313ce567")) return { kind: "meta", detail: data.slice(0, 10) };
        if (data.startsWith("0x8da5cb5b") || data.startsWith("0x70a08231")) return { kind: "owner", detail: data.slice(0, 10) };
      }
      return { kind: "other", detail: String(m) };
    }
    if (u.endsWith("/supported")) return { kind: "facilitator", detail: "x402 getSupported" };
    if (u.includes("sourcify")) return { kind: "sourcify", detail: "sourcify" };
    if (u.includes("gopluslabs")) return { kind: "goplus", detail: "goplus" };
    if (u.includes("llama")) return { kind: "price", detail: "llama" };
    return { kind: "other", detail: u };
  };

  const answerRpc = (req, url) => {
    const { method, params = [] } = req;
    const to = (params[0]?.to ?? "").toLowerCase();
    const data = (params[0]?.data ?? "").toLowerCase();
    const reply = (result) => ({ jsonrpc: "2.0", id: req.id, result });
    if (method === "eth_getCode") {
      const a = (params[0] ?? "").toLowerCase();
      return reply(a === token.addr || a === "0x" + "ee".repeat(20) ? "0x6080604052" + "63" + "40c10f19" + "14" : "0x");
    }
    if (method === "eth_getStorageAt") {
      if (token.proxy && params[1] === ZOS_IMPL) return reply("0x" + word(BigInt("0x" + "ee".repeat(20))));
      return reply("0x" + word(0));
    }
    if (method === "eth_simulateV1") {
      const blk = params[0]?.blockStateCalls?.[0];
      const amt = BigInt("0x" + blk.calls[1].data.slice(-64));
      return reply([{ calls: [
        { status: "0x1", returnData: "0x" + word(0) },
        { status: "0x1", returnData: "0x" },
        { status: "0x1", returnData: "0x" + word(amt) },
      ] }]);
    }
    if (method === "eth_call") {
      const ov = params[2] ?? {};
      const ovKey = Object.keys(ov).find((k) => k.toLowerCase() === to);
      const override = ovKey ? ov[ovKey].stateDiff : undefined;
      if (to === FACTORY) return reply("0x" + word(BigInt("0x" + "dd".repeat(20))));
      if (to === token.addr || to === WETH || to === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913") {
        if (data.startsWith("0x06fdde03")) return reply(abiString(token.name));
        if (data.startsWith("0x95d89b41")) return reply(abiString(token.symbol));
        if (data.startsWith("0x313ce567")) return reply("0x" + word(token.decimals));
        if (data.startsWith("0x18160ddd")) return reply("0x" + word(10n ** 24n));
        if (data.startsWith("0x8da5cb5b")) return reply("0x" + (token.owner ? pad("0x" + "ee".repeat(20)) : word(0)));
        if (data.startsWith("0x70a08231")) {
          const holder = "0x" + data.slice(34, 74);
          if (override && override[slotKey(holder, token.slot)] && to === token.addr) return reply("0x" + word(PROBE_VALUE));
          return reply("0x" + word(to === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" && holder !== PROBE_HOLDER && !token.owner ? 10n ** 14n : 10n ** 21n));
        }
        if (data.startsWith("0xa9059cbb")) {
          const funded = override && override[slotKey(PROBE_HOLDER, token.slot)];
          if (honeypot) return { jsonrpc: "2.0", id: req.id, error: { code: 3, message: "execution reverted: blocked" } };
          if (!funded) return { jsonrpc: "2.0", id: req.id, error: { code: 3, message: "execution reverted: insufficient balance" } };
          return reply("0x" + word(1));
        }
      }
      return reply("0x");
    }
    return { jsonrpc: "2.0", id: req.id, error: { message: "method not found" } };
  };

  const makeFetch = (realFetch) => async (url, init) => {
    state.count++;
    const cls = classify(url, init);
    const entry = { n: state.count - cursor, url: String(url), ...cls, mode: "ok" };
    log.push(entry);
    if (state.count - cursor > CAP) {
      entry.mode = "cap";
      throw new Error("Too many subrequests.");
    }
    const u = String(url);
    if (rpcs.includes(u)) {
      const mode = providerMode(u, entry.n, cls);
      entry.mode = mode;
      if (mode === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
      if (mode === "429") return new Response("rate limited", { status: 429 });
      const body = JSON.parse(init.body);
      if (mode === "nosim" && body.method === "eth_simulateV1") {
        return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not available on this plan: eth_simulateV1. Upgrade your plan" } });
      }
      if (mode === "ignore-override" && !Array.isArray(body) && body.params?.[2]) {
        const stripped = { ...body, params: [body.params[0], body.params[1]] };
        return Response.json(answerRpc(stripped, u));
      }
      if (Array.isArray(body)) return Response.json(body.map((r) => answerRpc(r, u)));
      return Response.json(answerRpc(body, u));
    }
    if (u.endsWith("/supported")) {
      return Response.json({
        kinds: ["eip155:8453", "eip155:137", "eip155:42161", "eip155:84532"].flatMap((network) =>
          ["exact", "upto"].map((scheme) => ({ x402Version: 2, scheme, network }))),
        extensions: [], signers: {},
      });
    }
    if (u.includes("sourcify")) return new Response("{}", { status: 404 });
    if (u.includes("gopluslabs")) return Response.json({ result: {} });
    if (u.includes("llama") && u.includes("percentage")) return Response.json({ coins: { "coingecko:ethereum": 1.2 } });
    if (u.includes("llama")) return Response.json({ coins: { "coingecko:ethereum": { price: 3000, symbol: "ETH", confidence: 0.99, timestamp: 1 } } });
    return new Response("{}", { status: 404 });
  };

  return {
    makeFetch,
    noteExtra(kind, detail) { state.count++; log.push({ n: state.count - cursor, url: "internal", kind, detail, mode: "ok" }); },
    resetRequest() { cursor = state.count; log.length = 0; },
    entries: () => log.slice(),
    count: () => state.count - cursor,
    byKind() {
      const out = {};
      for (const e of log) out[e.kind] = (out[e.kind] ?? 0) + 1;
      return out;
    },
    simAttempts() {
      // attempts per provider for sim discovery + probe
      const out = {};
      for (const e of log) if (e.kind === "sim-discovery" || e.kind === "sim-probe") {
        out[e.url] ??= { discovery: 0, probe: 0 };
        out[e.url][e.kind === "sim-probe" ? "probe" : "discovery"]++;
      }
      return out;
    },
  };
}

/** minimal in-memory stand-in for caches.default (Cache API). Counts operations. */
export function fakeCacheApi({ only = "/v1/balance-slot/" } = {}) {
  // Defaults to the slot cache only: the whole-report gate cache would turn a second
  // request into a zero-fetch hit and hide the thing being measured.
  const store = new Map();
  const ops = { match: 0, put: 0 };
  const cache = {
    async match(req) { if (!req.url.includes(only)) return undefined; ops.match++; const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { if (!req.url.includes(only)) return; ops.put++; store.set(req.url, res.clone()); },
  };
  return { cache, ops, store };
}
