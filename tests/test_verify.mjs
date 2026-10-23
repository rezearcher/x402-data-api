/**
 * Ownership-verification (Authorization Standard Tier 1) tests.
 *
 *   node tests/test_verify.mjs
 *
 * Exercises the headless DNS-01-style domain-control challenge + click-through
 * authorization: deterministic per-host token, authorization gate, DNS poll via
 * the DoH resolver (stubbed), KV recordkeeping, and the status/badge reads.
 * Node >= 22.18 strips types; the virtual cloudflare:workers module is shimmed.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app } = await import("../src/index.ts");

function makeFakeKV() {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

const HOST = "demo.example";
const MCP_URL = "https://demo.example/mcp";

// Compute the expected token exactly as the Worker does, to drive the DNS stub.
async function expectedToken(host) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("grsg-mcp-verify:v1:" + host));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return "grsg-verify=" + hex.slice(0, 40);
}

// DoH stub: returns the TXT challenge only when `present` is true.
function installDohStub(host, token, present) {
  globalThis.fetch = async (url) => {
    const uStr = String(url);
    if (uStr.includes("cloudflare-dns.com") && uStr.includes("_grsg-verify." + host)) {
      const Answer = present ? [{ data: `"${token}"` }] : [];
      return new Response(JSON.stringify({ Answer }), {
        status: 200,
        headers: { "content-type": "application/dns-json" },
      });
    }
    throw new Error("unexpected fetch in verify test: " + uStr);
  };
}

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed += 1;
}

const token = await expectedToken(HOST);
assert.ok(/^grsg-verify=[0-9a-f]{40}$/.test(token), "token shape");

// 1. /scan/verify (HTML) shows the exact TXT record + the deterministic token.
{
  const res = await app.request("/scan/verify?url=" + encodeURIComponent(MCP_URL), {}, { API_KEYS: makeFakeKV() });
  const body = await res.text();
  ok(res.status === 200, "verify page 200");
  ok(body.includes("_grsg-verify." + HOST), "shows TXT record name");
  ok(body.includes(token), "shows deterministic token value");
  ok(/authorization standard v2026-10-23/i.test(body), "shows versioned authorization");
}

// 2. check without authorize => authorization_required, nothing stored.
{
  const kv = makeFakeKV();
  installDohStub(HOST, token, true);
  const res = await app.request("/scan/verify/check?url=" + encodeURIComponent(MCP_URL), {}, { API_KEYS: kv });
  const j = await res.json();
  ok(res.status === 400, "no-authorize => 400");
  ok(j.error === "authorization_required", "authorization gate fires");
  ok(kv.store.size === 0, "nothing recorded without authorization");
}

// 3. authorize=1 but TXT absent => pending, nothing stored.
{
  const kv = makeFakeKV();
  installDohStub(HOST, token, false);
  const res = await app.request("/scan/verify/check?authorize=1&url=" + encodeURIComponent(MCP_URL), {}, { API_KEYS: kv });
  const j = await res.json();
  ok(j.verified === false && j.pending === true, "absent TXT => pending");
  ok(j.add_record && j.add_record.value === token, "pending returns the record to add");
  ok(kv.store.size === 0, "no record stored on pending");
}

// 4. authorize=1 + TXT present => verified, KV recordkeeping with authz artifact.
{
  const kv = makeFakeKV();
  installDohStub(HOST, token, true);
  const res = await app.request(
    "/scan/verify/check?authorize=1&url=" + encodeURIComponent(MCP_URL),
    { headers: { "cf-connecting-ip": "203.0.113.9", "user-agent": "claim-test" } },
    { API_KEYS: kv },
  );
  const j = await res.json();
  ok(j.verified === true, "present TXT + authorize => verified");
  ok(decodeURIComponent(j.owner_badge_markdown).includes("/scan/verify/badge"), "owner badge markdown returned");
  ok(decodeURIComponent(j.scan_badge_markdown).includes("/scan/mcp/badge"), "scan badge markdown returned");
  const rec = JSON.parse(kv.store.get("verify:" + HOST));
  ok(rec && rec.authz_accepted === true && rec.authz_version === "2026-10-23", "authorization artifact recorded");
  ok(rec.ip === "203.0.113.9" && rec.ua === "claim-test", "IP + UA recorded for recordkeeping");
  ok(rec.mcp_url === MCP_URL, "mcp_url recorded");
}

// 5. status + ownership badge reflect a recorded verification.
{
  const kv = makeFakeKV();
  kv.store.set("verify:" + HOST, JSON.stringify({ host: HOST, verified_at: "2026-10-23T00:00:00Z", authz_version: "2026-10-23", mcp_url: MCP_URL }));
  const st = await (await app.request("/scan/verify/status?domain=" + HOST, {}, { API_KEYS: kv })).json();
  ok(st.verified === true && st.verified_at === "2026-10-23T00:00:00Z", "status reads KV record");
  const bg = await (await app.request("/scan/verify/badge?domain=" + HOST, {}, { API_KEYS: kv })).json();
  ok(bg.message === "verified owner" && bg.color === "brightgreen", "owner badge green when verified");
  const bgu = await (await app.request("/scan/verify/badge?domain=unclaimed.example", {}, { API_KEYS: kv })).json();
  ok(bgu.message === "unclaimed" && bgu.color === "lightgrey", "owner badge grey when unclaimed");
}

// 6. host validation: garbage input is rejected (no scan, no challenge).
{
  const res = await app.request("/scan/verify/check?authorize=1&domain=not_a_host", {}, { API_KEYS: makeFakeKV() });
  ok(res.status === 400, "invalid host => 400");
}

// 7. cross-domain replay guard: a token is bound to its own host.
{
  const other = await expectedToken("other.example");
  ok(other !== token, "token differs per host (no cross-domain replay)");
}

console.log(`verify tests: ${passed}/${passed} passed`);
