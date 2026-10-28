/**
 * Static domain-ownership verify routes under /.well-known/.
 *
 *   node tests/test_wellknown_verify.mjs
 *
 * These one-line text files prove we control api.greyridgesignals.ai to the
 * directories/registries that gate a verified-seller listing (402index.io, the
 * MCP Registry, agent-tools.cloud). A verified listing is a discovery surface —
 * it lets an agent-tooling index rank our paid x402 routes — so a broken or
 * drifted token silently drops us from that surface. Lock the exact bodies and
 * the text/plain content type (the verifier does a byte-compare on the body).
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

const cases = [
  ["/.well-known/agent-tools-verify.txt", "atc_t_f4tvFe_XZtW8_rm2laZiN9CRlsvwSu"],
  ["/.well-known/402index-verify.txt", "619f23496d826b50e86afc72eaae3aa523868d4dba61161bfdb8640e88d4f4a5"],
  ["/.well-known/mcp-registry-auth", "v=MCPv1; k=ed25519; p=/fl+vN2K62tQL/mmihmc7e7ASuNrfc3SrSjOsji3fko="],
];

for (const [path, expected] of cases) {
  const res = await app.request(path, {}, {});
  eq(res.status, 200, `${path} serves 200`);
  const body = await res.text();
  eq(body, expected, `${path} body is the exact verify token`);
  ok((res.headers.get("content-type") || "").includes("text/plain"), `${path} is text/plain`);
}

console.log(`test_wellknown_verify: ${pass} checks passed`);
