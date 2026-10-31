/**
 * Agent-readiness discovery surfaces — the machine-readable entrypoints an
 * agent-readiness scanner (Cloudflare's isitagentready.com) and agent clients
 * key off. Before this, api.greyridgesignals.ai scored LEVEL 1/5 with the
 * commerce.x402 check reading NEUTRAL "not a commerce site" because the root
 * emitted ZERO Link header and six well-knowns 404'd — our earning DATA routes
 * sat behind a "non-commerce" score agents use as a selection filter.
 *
 *   node tests/test_agent_readiness.mjs
 *
 * Locks: root Link header advertises the x402 service rel; Markdown content
 * negotiation; the six new well-knowns serve 200 with the right shape; the A2A
 * card carries supportedInterfaces; robots.txt declares Content-Signal.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

// --- root Link header + markdown negotiation ---------------------------------
{
  const res = await app.request("/", {}, {});
  const link = res.headers.get("link") || "";
  ok(link.includes('</.well-known/x402>; rel="service"'), "root Link header advertises x402 service rel");
  ok(link.includes('rel="agent-card"'), "root Link header advertises agent-card");
  ok(link.includes('rel="mcp-server"'), "root Link header advertises mcp-server");
  ok(link.includes('rel="service-desc"'), "root Link header advertises openapi service-desc");
}
{
  const res = await app.request("/", { headers: { accept: "text/markdown" } }, {});
  eq(res.status, 200, "root with Accept: text/markdown serves 200");
  ok((res.headers.get("content-type") || "").includes("text/markdown"), "root negotiates text/markdown");
  const body = await res.text();
  ok(body.startsWith("# Grey Ridge Signals"), "markdown body is the agent catalog");
  ok(body.includes("/.well-known/x402"), "markdown points at the payment manifest");
}

// --- new well-knowns serve 200 with the right shape --------------------------
{
  const res = await app.request("/.well-known/api-catalog", {}, {});
  eq(res.status, 200, "api-catalog 200");
  ok((res.headers.get("content-type") || "").includes("application/linkset+json"), "api-catalog is linkset+json");
  const j = JSON.parse(await res.text());
  ok(Array.isArray(j.linkset) && j.linkset[0]["service-desc"][0].href.includes("/openapi.json"), "api-catalog links the OpenAPI desc");
}
{
  const res = await app.request("/.well-known/mcp/server-card.json", {}, {});
  eq(res.status, 200, "mcp server-card 200");
  const j = await res.json();
  eq(j.transport, "streamable-http", "mcp card declares streamable-http");
  ok(j.url.endsWith("/mcp"), "mcp card url is /mcp");
  eq(j.payments.protocol, "x402", "mcp card declares x402 payment");
}
{
  const res = await app.request("/.well-known/agent-skills/index.json", {}, {});
  eq(res.status, 200, "agent-skills index 200");
  const j = await res.json();
  ok(j.count > 10 && j.skills.length === j.count, "agent-skills index lists skills");
  ok(j.skills.every((s) => s.pricing && s.href.startsWith("https://")), "each skill has pricing + absolute href");
}
{
  const res = await app.request("/.well-known/oauth-protected-resource", {}, {});
  eq(res.status, 200, "oauth-protected-resource 200");
  const j = await res.json();
  ok(Array.isArray(j.authorization_servers), "oauth metadata has authorization_servers (empty = x402, honest)");
  eq(j.payment.protocol, "x402", "oauth metadata documents the real x402 mechanism");
}
{
  const res = await app.request("/auth.md", {}, {});
  eq(res.status, 200, "auth.md 200");
  ok((res.headers.get("content-type") || "").includes("text/markdown"), "auth.md is text/markdown");
  ok((await res.text()).includes("x402"), "auth.md documents x402 auth");
}
{
  const res = await app.request("/.well-known/security.txt", {}, {});
  eq(res.status, 200, "security.txt 200");
  const body = await res.text();
  ok(body.includes("Contact:") && body.includes("Expires:"), "security.txt has RFC 9116 Contact + Expires");
}

// --- A2A card supportedInterfaces -------------------------------------------
{
  const res = await app.request("/.well-known/agent-card.json", {}, {});
  eq(res.status, 200, "agent-card 200");
  const j = await res.json();
  ok(Array.isArray(j.supportedInterfaces) && j.supportedInterfaces.length > 0, "agent-card has non-empty supportedInterfaces");
  ok(j.supportedInterfaces.every((i) => i.transport && i.url), "each interface has transport + url");
}

// --- mcp server-card has serverInfo.name (MCP discovery requirement) ---------
{
  const res = await app.request("/.well-known/mcp/server-card.json", {}, {});
  const j = await res.json();
  ok(j.serverInfo && j.serverInfo.name === "grey-ridge-x402", "mcp card exposes serverInfo.name");
}

// --- auth.md H1 contains "auth.md" (scanner requirement) ---------------------
{
  const res = await app.request("/auth.md", {}, {});
  const body = await res.text();
  ok(/^#\s.*auth\.md/im.test(body), "auth.md H1 contains 'auth.md'");
}

// --- /api + /api/v1 x402 signpost 402 (commerce.x402 detection) --------------
for (const p of ["/api", "/api/v1"]) {
  const res = await app.request(p, {}, { PAY_TO: "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10" });
  eq(res.status, 402, `${p} returns HTTP 402 (x402 signpost)`);
  const j = await res.json();
  eq(j.x402Version, 2, `${p} body is an x402 v2 challenge`);
  ok(Array.isArray(j.accepts) && j.accepts[0].network === "eip155:8453" && j.accepts[0].asset.startsWith("0x"), `${p} accepts[] declares Base USDC`);
  ok(j.resource.url.includes("/.well-known/x402"), `${p} points at the manifest (signpost, not a dup SKU)`);
}

// --- robots.txt Content-Signal ----------------------------------------------
{
  const res = await app.request("/robots.txt", {}, {});
  const body = await res.text();
  ok(/Content-Signal:\s*search=yes/i.test(body), "robots.txt declares Content-Signal directives");
}

console.log(`test_agent_readiness: ${pass} checks passed`);
