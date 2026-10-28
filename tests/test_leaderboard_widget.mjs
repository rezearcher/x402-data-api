/**
 * Contract tests for the embeddable MCP security leaderboard widget
 * (src/index.ts: leaderboardSvg / leaderboardStaticSvg / lbRankLess — the pure
 * render + rank core behind GET /scan/leaderboard.svg + /scan/leaderboard/embed).
 *
 *   node tests/test_leaderboard_widget.mjs
 *
 * The distribution play: a zero-dep SVG any MCP blog / aggregator / grade-A author
 * drops in as <a href=HUB><img src=/scan/leaderboard.svg></a> — the wrapping <a> is
 * a backlink to our crawled github.io scorecard corpus; the SVG is a live billboard
 * funnelling scans -> badge-claim -> $9.99/mo sub. These assertions pin:
 *   - ranking matches the hub key (grade A..F, then directory-ready, then risk asc);
 *   - the SVG is a well-formed self-contained image carrying a server name + grade;
 *   - degrade-open: empty cards -> a static branded scan-CTA card, NEVER a throw;
 *   - the honest-scope label (OWASP LLM01/LLM08, never "safe") is present;
 *   - the injection base-rate headline is computed across the ranked set.
 * Node >= 22.18 strips types; cloudflare:workers is shimmed by cfw-hooks.mjs.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { leaderboardSvg, leaderboardStaticSvg, lbRankLess } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

const cards = [
  { name: "beta.ai", slug: "beta-ai", grade: "B", verdict: "review", risk_score: 20, blocker_count: 1, ready: false },
  { name: "alpha.ai", slug: "alpha-ai", grade: "A", verdict: "clear", risk_score: 0, blocker_count: 0, ready: true },
  { name: "flagd.ai", slug: "flagd-ai", grade: "F", verdict: "block", risk_score: 85, blocker_count: 4, ready: false },
  { name: "alpha2.ai", slug: "alpha2-ai", grade: "A", verdict: "clear", risk_score: 5, blocker_count: 0, ready: false },
];

// 1 — ranking: A before B before F; within A, directory-ready wins the tie.
const sorted = [...cards].sort(lbRankLess);
ok(sorted[0].name === "alpha.ai", "grade A + ready sorts first");
ok(sorted[1].name === "alpha2.ai", "second A (not ready, higher risk) before B");
ok(sorted[2].grade === "B" && sorted[3].grade === "F", "B before F at the tail");

// 2 — SVG is a self-contained image (no external refs that would leak/boomerang).
const svg = leaderboardSvg(cards, 10, "dark");
ok(svg.startsWith("<svg") && svg.trimEnd().endsWith("</svg>"), "well-formed svg element");
ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), "has svg namespace");
ok(!/<image|href=|url\(/.test(svg), "no external image/href/url refs — fully inline");

// 3 — renders real ranked content: a server name + its grade letter + the #1 rank.
ok(svg.includes("alpha.ai"), "top server name rendered");
ok(/>A<\/text>/.test(svg), "a grade letter is rendered in a badge");
ok(svg.includes("MCP Security Leaderboard"), "titled");

// 4 — honest scope (SCOPE_AND_REPORT_STANDARD): names LLM01/LLM08, never 'safe'.
ok(/LLM01\/LLM08/.test(svg), "OWASP LLM01/LLM08 scope label present");
ok(!/\bsafe\b/i.test(svg) && !/pentest/i.test(svg), "never claims 'safe' / 'pentest'");

// 5 — injection base-rate headline computed across the ranked set (review+block
// are flagged, clear is not: 2 of 4 = 50%).
ok(svg.includes("2/4 flagged (50%)"), "injection base-rate headline computed");

// 6 — the funnel CTA (scan yours free) is in the footer.
ok(/scan yours free/i.test(svg) && /greyridgesignals\.ai/.test(svg), "free-scan CTA + brand in footer");

// 7 — ?n= caps the visible rows (never throws, honors the subset).
const svg2 = leaderboardSvg(cards, 2, "dark");
ok(svg2.includes("alpha.ai") && !svg2.includes("flagd.ai"), "n=2 shows only the top 2 rows");

// 8 — light theme switches the background (white) without changing structure.
const light = leaderboardSvg(cards, 10, "light");
ok(light.includes('fill="#ffffff"'), "light theme white background");
ok(light.includes("MCP Security Leaderboard"), "light theme still titled");

// 9 — DEGRADE-OPEN: no cards -> static branded scan-CTA card, never a throw/empty.
const empty = leaderboardSvg([], 10, "dark");
ok(empty.startsWith("<svg") && /scan your mcp server free/i.test(empty), "empty -> static scan-CTA card");
ok(leaderboardStaticSvg("dark").includes("LLM01/LLM08"), "static card keeps honest scope label");

// 10 — missing grade/risk fields degrade to em-dash, never crash or print 'undefined'.
const partial = leaderboardSvg([{ name: "x.ai", slug: "x-ai" }], 10, "dark");
ok(partial.startsWith("<svg") && !partial.includes("undefined"), "partial card renders, no 'undefined'");

console.log(`✓ leaderboard widget: ${pass} checks passed`);
