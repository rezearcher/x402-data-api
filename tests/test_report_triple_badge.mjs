/**
 * Contract test for the /scan/report trust-badge section.
 *
 *   node tests/test_report_triple_badge.mjs
 *
 * /scan/report is the crawlable per-server page an author lands on from search
 * or the MCP security directory — a second high-traffic surface alongside the
 * badge generator. Each distinct embed the author copies from it is a dofollow
 * backlink + a billboard, so the report must surface all THREE embeddable
 * badges (security verdict, Claude Directory readiness, leaderboard rank), each
 * with its own copy control and README markdown, exactly like /scan/badge-gen.
 * This pins the markup + copy wiring so a refactor cannot silently drop a badge
 * (which would quietly cost us backlinks). The badges are rendered server-side
 * (the scanned URL is known on the report), so no client fetch is involved.
 *
 * Node >= 22.18 strips types; cloudflare:workers is shimmed by cfw-hooks.mjs.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

const MCP_URL = "https://triple-badge-test.example/mcp";
const CLEAN_TOOLS = [
  { name: "read_file", description: "Reads a file and returns its contents.", inputSchema: { type: "object" } },
];

// Make the target reachable with a deterministic clean tools/list; everything
// else (drift API, DNS) degrades to a benign 404 so the report never throws.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const uStr = String(url);
  if (uStr === MCP_URL) {
    let method = "";
    try { method = JSON.parse(init.body || "{}").method || ""; } catch { /* ignore */ }
    if (method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {} } }),
        { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } });
    }
    if (method === "tools/list") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: CLEAN_TOOLS } }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
      { status: 200, headers: { "content-type": "application/json" } });
  }
  // Everything else (x402 facilitator lazy-init, drift API) goes to the real
  // network — the drift call degrades open and the facilitator init needs it.
  return realFetch(url, init);
};

try {
  const enc = encodeURIComponent(MCP_URL);
  const res = await app.request(`/scan/report?url=${enc}`, {}, {});
  ok(res.status === 200, "report returns 200 for a reachable server");
  const html = await res.text();

  // Three distinct badge images, one per trust axis, each built from the target URL.
  ok(html.includes("/scan/mcp/badge?url=" + encodeURIComponent(enc)) || html.includes("%2Fscan%2Fmcp%2Fbadge%3Furl%3D"),
    "security verdict shields endpoint present");
  ok(html.includes("verify%2Fbadge%3Fkind%3Ddirectory%26url%3D") || html.includes("/scan/verify/badge?kind=directory&url="),
    "directory-readiness shields endpoint present");
  ok(html.includes("leaderboard%2Frank-badge%3Furl%3D") || html.includes("/scan/leaderboard/rank-badge?url="),
    "rank shields endpoint present");

  // Three copyable README-markdown blocks, each with its own copy control.
  ok(html.includes("id=md_sec") && html.includes("data-copy=md_sec"), "security markdown + copy wired");
  ok(html.includes("id=md_dir") && html.includes("data-copy=md_dir"), "directory markdown + copy wired");
  ok(html.includes("id=md_rank") && html.includes("data-copy=md_rank"), "rank markdown + copy wired");

  // Rank markdown must link the ranked hub (crawled leaderboard surface), not the report.
  ok(html.includes("mcp-server-scorecards.html"), "rank badge links the ranked hub");

  // The shared copy-button handler must be wired (not the old single #copy/#md).
  ok(html.includes('button.ghost[data-copy]'), "shared data-copy handler present");
  ok(!html.includes('getElementById("copy")'), "stale single-badge copy handler removed");

  // Claims-Law honesty retained on this surface.
  ok(html.includes("not a guarantee of safety"), "retains the 'clear is not safe' honesty note");

  console.log(`ok - report triple-badge: ${pass} checks passed`);
} finally {
  globalThis.fetch = realFetch;
}
