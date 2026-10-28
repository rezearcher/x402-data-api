/**
 * Contract test for the /scan/badge-gen results UI.
 *
 *   node tests/test_badge_gen_triple.mjs
 *
 * The badge generator is the page an MCP-server author lands on from the
 * SEO/directory funnel. Each distinct embed the author copies is a dofollow
 * backlink + a billboard, so the page must surface all THREE embeddable
 * badges — security verdict, Claude Directory readiness, and leaderboard
 * rank — each with its own copy control and README-markdown target.
 * This pins that the markup + client script wiring are present so a refactor
 * cannot silently drop a badge (which would quietly cost us backlinks).
 * Node >= 22.18 strips types; cloudflare:workers is shimmed by cfw-hooks.mjs.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

const res = await app.request("/scan/badge-gen", {}, {});
ok(res.status === 200, "badge-gen returns 200");
const html = await res.text();

// Three output slots, each a distinct badge axis.
ok(html.includes('id=img_sec'), "security badge slot present");
ok(html.includes('id=img_dir'), "directory-readiness badge slot present");
ok(html.includes('id=img_rank'), "rank badge slot present");

// Three copyable README-markdown blocks, each with its own copy control.
ok(html.includes('id=md_sec') && html.includes('data-copy=md_sec'), "security markdown + copy wired");
ok(html.includes('id=md_dir') && html.includes('data-copy=md_dir'), "directory markdown + copy wired");
ok(html.includes('id=md_rank') && html.includes('data-copy=md_rank'), "rank markdown + copy wired");

// The script must construct all three shields endpoints from the scanned URL.
ok(html.includes('/scan/mcp/badge?url='), "builds security shields endpoint");
ok(html.includes('/scan/verify/badge?kind=directory&url='), "builds directory shields endpoint");
ok(html.includes('/scan/leaderboard/rank-badge?url='), "builds rank shields endpoint");

// Rank markdown must link the ranked hub (not the per-server report) so the
// backlink lands on the crawled leaderboard surface.
ok(html.includes('mcp-server-scorecards.html'), "rank badge links the ranked hub");

// Claims-Law honesty: the page must not oversell "clear" as "safe".
ok(/clear.{0,40}not a guarantee of safety|“clear” is not/i.test(html) || html.includes("not a guarantee of safety"),
  "retains the 'clear is not safe' honesty note");

console.log(`ok - badge-gen triple-embed: ${pass} checks passed`);
