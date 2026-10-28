/**
 * Contract tests for the per-server MCP Security RANK badge
 * (src/index.ts: findLbCard / rankBadge / rankBadgeMarkdown — the pure core
 * behind GET /scan/leaderboard/rank-badge).
 *
 *   node tests/test_rank_badge.mjs
 *
 * The demand-creating half of the leaderboard engine: a grade-A author embeds
 * "#3 of N · grade A" in their README (vanity/marketing), and every embed is a
 * dofollow backlink to the ranked hub + a scan-funnel billboard. These pin:
 *   - rank matches the hub ranking key (findLbCard uses lbRankLess order);
 *   - match is host-first, then slug, then name;
 *   - a shields.io endpoint object with grade-keyed colour is produced;
 *   - degrade-open: unknown server -> grey "scan free" recruitment card, not throw;
 *   - the markdown wraps the shields endpoint in the hub backlink.
 * Node >= 22.18 strips types; cloudflare:workers is shimmed by cfw-hooks.mjs.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { findLbCard, rankBadge, rankBadgeMarkdown, lbRankLess } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// Deliberately out of rank order on input — the A must win rank #1.
const cards = [
  { name: "beta.ai", slug: "beta-ai", url: "https://beta.ai/mcp", grade: "B", verdict: "review", risk_score: 20, blocker_count: 1, ready: false },
  { name: "Alpha Docs", slug: "alpha-docs", url: "https://alpha.example.com/mcp", grade: "A", verdict: "clear", risk_score: 2, blocker_count: 0, ready: true },
  { name: "Gamma", slug: "gamma", url: "https://gamma.io/sse", grade: "F", verdict: "block", risk_score: 85, blocker_count: 3, ready: false },
];

// --- ranking: A ranks #1 ---
const ranked = [...cards].sort(lbRankLess);
ok(ranked[0].grade === "A", "A grade sorts to rank #1");

// --- host-first match ---
const byHost = findLbCard(cards, { url: "https://alpha.example.com/mcp" });
ok(byHost && byHost.rank === 1 && byHost.card.grade === "A", "host match finds Alpha at rank 1");

// www. and scheme-less normalise to the same host
const byHostWww = findLbCard(cards, { url: "www.alpha.example.com" });
ok(byHostWww && byHostWww.card.slug === "alpha-docs", "www./scheme-less host still matches");

// --- slug match ---
const bySlug = findLbCard(cards, { slug: "gamma" });
ok(bySlug && bySlug.card.grade === "F", "slug match finds Gamma");

// --- name match (case-insensitive) ---
const byName = findLbCard(cards, { name: "beta.ai" });
ok(byName && byName.card.slug === "beta-ai", "name match finds beta.ai");

// --- unknown -> null ---
ok(findLbCard(cards, { url: "https://nope.example/mcp" }) === null, "unknown server -> null");

// --- rankBadge shields object: found ---
const b = rankBadge(byHost, cards.length);
ok(b.schemaVersion === 1 && b.label === "MCP Security Rank", "shields envelope correct");
ok(b.message === "#1 of 3 · grade A", "message carries rank + total + grade");
ok(b.color === "brightgreen", "grade A -> brightgreen");
ok(rankBadge(bySlug, cards.length).color === "red", "grade F -> red");

// --- rankBadge shields object: not found -> grey recruitment card ---
const miss = rankBadge(null, cards.length);
ok(miss.color === "lightgrey" && /scan free/i.test(miss.message), "unranked -> grey 'scan free' CTA");

// --- markdown wraps shields endpoint in the hub backlink ---
const md = rankBadgeMarkdown("https://example.workers.dev", { url: "https://alpha.example.com/mcp" });
ok(md.startsWith("[![MCP Security Rank](https://img.shields.io/endpoint?url="), "markdown uses shields endpoint");
ok(md.includes("rank-badge") && md.includes("github.io"), "markdown points at rank-badge endpoint + hub backlink");

console.log(`\n  rank-badge contract: ${pass}/${pass} checks passed`);
