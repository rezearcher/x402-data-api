// Mock Base JSON-RPC that reproduces the production failure mode: the transfer
// probe's eth_call gets 429'd by the provider. Everything else answers normally
// (a canned-but-plausible Base ERC-20) so the endpoint reaches the probe.
// STORM_K = number of probe requests to 429 before letting them through.
import http from "node:http";
import { keccak256 } from "viem";

const PORT = Number(process.env.MOCK_PORT || 9111);
const STORM_K = Number(process.env.STORM_K ?? 8);
const HOLDER = "0x1111111111111111111111111111111111111111";
const PROBE_VALUE_HEX = "0x" + (31337n * 10n ** 18n).toString(16).padStart(64, "0");

let probeSeen = 0;      // transfer-probe requests observed
const log = [];

function mappingSlotKey(holder, slot) {
  const h = holder.slice(2).toLowerCase().padStart(64, "0");
  const s = slot.toString(16).padStart(64, "0");
  return keccak256(`0x${h}${s}`);
}
const SLOT0_KEY = mappingSlotKey(HOLDER, 0).toLowerCase();

// A token whose balances sit at mapping slot 0, like AERO.
function answer(method, params) {
  if (method === "eth_chainId") return "0x2105";
  if (method === "eth_blockNumber") return "0x1000";
  if (method === "eth_getCode") return "0x608060405234801561001057600080fd5b50";
  if (method === "eth_getStorageAt") return "0x" + "0".repeat(64);
  if (method === "eth_getBalance") return "0x0";
  if (method === "eth_getTransactionCount") return "0x1";
  if (method === "eth_gasPrice") return "0x5f5e100";
  if (method === "eth_getBlockByNumber") return { number: "0x1000", timestamp: "0x66f00000", baseFeePerGas: "0x5f5e100", gasLimit: "0x1c9c380", gasUsed: "0x0", hash: "0x" + "1".repeat(64) };
  if (method === "eth_call") {
    const call = params?.[0] ?? {};
    const data = (call.data || call.input || "0x").toLowerCase();
    const sel = data.slice(0, 10);

    // transfer-probe: from the synthetic holder, transfer() selector
    if (call.from?.toLowerCase() === HOLDER && sel === "0xa9059cbb") return { kind: "transfer" };
    if (sel === "0x06fdde03") return "0x" + "Mock".padEnd(0, " ").length.toString(16).padStart(64, "0"); // name()
    if (sel === "0x95d89b41") return "0x" + "MCK".length.toString(16).padStart(64, "0"); // symbol()
    if (sel === "0x313ce567") return "0x" + (18).toString(16).padStart(64, "0"); // decimals()
    if (sel === "0x18160ddd") return "0x" + (10n ** 24n).toString(16).padStart(64, "0"); // totalSupply()
    if (sel === "0x8da5cb5b") return "0x"; // owner() -> renounced
    if (sel === "0x70a08231") {
      // balanceOf: only the synthetic holder, only when its slot was overridden
      const who = "0x" + data.slice(34).toLowerCase();
      const diff = params?.[2]?.[call.to]?.stateDiff ?? {};
      const hasSlot0 = Object.keys(diff).some((k) => k.toLowerCase() === SLOT0_KEY);
      if (who === HOLDER && hasSlot0) return PROBE_VALUE_HEX;
      return "0x" + "0".repeat(64);
    }
    return "0x" + "0".repeat(64);
  }
  if (method === "eth_simulateV1") return { calls: [] };
  return null;
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let j = {};
    try { j = JSON.parse(body); } catch { /* ignore */ }
    const method = j.method;
    if (method === "eth_call") {
      // A new token-report starts here; give each report its own storm window so
      // the two variants are compared on identical terms.
      if (!(j.params?.[0]?.from?.toLowerCase() === HOLDER && (j.params?.[0]?.data || "").toLowerCase().startsWith("0xa9059cbb"))) {
        probeSeen = 0;
      }
    }
    const out = answer(method, j.params);
    if (out && out.kind === "transfer") {
      probeSeen++;
      const throttled = probeSeen <= STORM_K;
      log.push(`probe#${probeSeen} ${throttled ? "429" : "200"}`);
      if (throttled) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id ?? 1, error: { code: -32005, message: "rate limit exceeded" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id ?? 1, result: "0x" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id ?? 1, result: out }));
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock rpc on :${PORT} STORM_K=${STORM_K}`));
process.on("SIGTERM", () => { console.log("PROBE LOG:", log.join(" ")); process.exit(0); });
