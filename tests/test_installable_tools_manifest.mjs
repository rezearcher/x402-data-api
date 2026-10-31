/**
 * Contract test for the installable framework-tool index published on the x402
 * discovery surfaces.
 *
 *   node tests/test_installable_tools_manifest.mjs
 *
 * A trading agent never "discovers an API" — it runs a FRAMEWORK and installs
 * tools. So the path from discovery to a paid call is the one-line install for
 * the caller's own framework, published where it discovers the routes. This
 * test pins that both machine-readable discovery surfaces (/.well-known/x402
 * and /.well-known/agent-capabilities.json) carry the same installable_tools
 * index, that each entry has a real repo + a runnable install command, and
 * that the routes a package claims to wrap actually exist in the live catalog
 * (no drift / no vaporware). Node >= 22.18 strips types; cloudflare:workers is
 * shimmed by cfw-hooks.mjs.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

const env = { PAY_TO: "0x0000000000000000000000000000000000000001" };

// --- /.well-known/x402 --------------------------------------------------------
const manifest = await (await app.request("/.well-known/x402", {}, env)).json();
ok(manifest.integrations && Array.isArray(manifest.integrations.installable_tools),
  "x402 manifest exposes integrations.installable_tools[]");
const tools = manifest.integrations.installable_tools;
ok(tools.length >= 3, `at least the 3 framework SDK packages published (got ${tools.length})`);

// The set of paid routes the manifest actually serves (so claims can't drift).
const liveRoutes = new Set(manifest.resources.map((r) => new URL(r.resource).pathname));

const frameworks = tools.map((t) => t.framework);
for (const want of ["Vercel AI SDK", "LangChain.js", "CrewAI / plain Python"]) {
  ok(frameworks.includes(want), `installable_tools includes ${want}`);
}

for (const t of tools) {
  ok(typeof t.package === "string" && t.package.length > 0, `${t.framework}: has a package name`);
  ok(/^github\.com\/rezearcher\//.test(t.repository.replace(/^https?:\/\//, "")),
    `${t.framework}: repository is a rezearcher public mirror (${t.repository})`);
  // Install command is runnable: npm git-install for TS, pip git-install for Python.
  if (t.language === "Python") {
    // Either a git-install from a rezearcher mirror OR a published PyPI name.
    ok(/^pip install (git\+https:\/\/github\.com\/rezearcher\/|greyridge-x402-tools)/.test(t.install),
      `${t.framework}: pip install command (${t.install})`);
  } else {
    ok(/^npm i github:rezearcher\//.test(t.install),
      `${t.framework}: npm git-install command (${t.install})`);
  }
  ok(Number.isInteger(t.tool_count) && t.tool_count > 0, `${t.framework}: positive tool_count`);
  ok(Array.isArray(t.wraps) && t.wraps.length === t.tool_count,
    `${t.framework}: wraps[] length matches tool_count (${t.wraps.length} vs ${t.tool_count})`);
  // Every wrapped route must be a real paid route in the same manifest — no vaporware.
  for (const p of t.wraps) {
    ok(liveRoutes.has(p), `${t.framework}: wrapped route ${p} is a live catalog route`);
  }
  // Honesty: no AI tells, no fabricated-value claims in the note.
  ok(!/claude|anthropic|as an ai|language model/i.test(t.note), `${t.framework}: no AI/vendor tells in note`);
}

// --- /.well-known/agent-capabilities.json ------------------------------------
const caps = await (await app.request("/.well-known/agent-capabilities.json", {}, env)).json();
ok(Array.isArray(caps.installable_tools) && caps.installable_tools.length === tools.length,
  "agent-capabilities.json carries the same installable_tools index");
ok(JSON.stringify(caps.installable_tools) === JSON.stringify(tools),
  "both discovery surfaces publish an identical installable_tools index (no drift)");

console.log(`installable-tools manifest contract: ${pass} checks passed`);
