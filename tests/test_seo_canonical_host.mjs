/**
 * Regression guard for the keystone SEO canonicalization fix (src/index.ts
 * CANONICAL_ORIGIN). The Worker answers on BOTH the workers.dev host and the
 * promoted brand host api.greyridgesignals.ai. Before this fix every self-
 * referential SEO signal (canonical, og:url, robots Sitemap:, sitemap <loc>)
 * hardcoded workers.dev, so Googlebot on the brand host was told its canonical
 * lived elsewhere and DROPPED the page — site:api.greyridgesignals.ai = 0
 * despite HTTP 200. This pins that every SEO signal now resolves to the single
 * canonical brand host, regardless of the request host, and that the non-SEO
 * miniapp manifest page is left on its signed, domain-bound host.
 *
 *   node tests/test_seo_canonical_host.mjs
 *
 * Node >= 22.18 strips types; cloudflare:workers is shimmed by cfw-hooks.mjs.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const app = (await import("../src/index.ts")).default;

const CANON = "https://api.greyridgesignals.ai";
const WORKERS = "x402-data-api.sigrunner.workers.dev";

let pass = 0;
async function check(name, fn) {
  await fn();
  pass++;
  console.log(`ok - ${name}`);
}

// Drive every route from the workers.dev host to prove the canonical signal is
// host-independent: even when served from workers.dev, the page must declare the
// brand host as canonical so link equity consolidates there.
// Pass an empty env so request-scoped middleware (traffic-log DO binding, etc.)
// sees c.env = {} and no-ops cleanly instead of dereferencing an undefined env.
function req(path) {
  return app.request(`https://${WORKERS}${path}`, undefined, {});
}

await check("robots.txt Sitemap points at the canonical brand host", async () => {
  const txt = await (await req("/robots.txt")).text();
  assert.ok(txt.includes(`Sitemap: ${CANON}/sitemap.xml`), `robots Sitemap not canonical: ${txt}`);
  assert.ok(!txt.includes(WORKERS), `robots still references workers.dev: ${txt}`);
});

await check("sitemap.xml <loc> entries are all on the canonical brand host", async () => {
  const xml = await (await req("/sitemap.xml")).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length >= 10, `expected a populated sitemap, got ${locs.length} locs`);
  for (const loc of locs) {
    assert.ok(loc.startsWith(`${CANON}/`), `sitemap loc not canonical: ${loc}`);
    assert.ok(!loc.includes(WORKERS), `sitemap loc still workers.dev: ${loc}`);
  }
});

await check("homepage canonical + og:url are the canonical brand host", async () => {
  const html = await (await req("/")).text();
  assert.ok(html.includes(`<link rel="canonical" href="${CANON}/"`), "home canonical not brand host");
  assert.ok(html.includes(`<meta property="og:url" content="${CANON}/"`), "home og:url not brand host");
  // The functional MCP config / display links may still show workers.dev, but
  // the two canonicalization signals above must not.
  assert.ok(!html.includes(`rel="canonical" href="https://${WORKERS}`), "home canonical still workers.dev");
});

await check("/token-safety canonical + og:url are the canonical brand host", async () => {
  const html = await (await req("/token-safety")).text();
  assert.ok(html.includes(`<link rel="canonical" href="${CANON}/token-safety"`), "token-safety canonical not brand host");
  assert.ok(html.includes(`<meta property="og:url" content="${CANON}/token-safety"`), "token-safety og:url not brand host");
});

await check("/check?token= og:url + og:image are the canonical brand host", async () => {
  const t = "0x4200000000000000000000000000000000000006";
  const html = await (await req(`/check?token=${t}`)).text();
  assert.ok(html.includes(`<meta property="og:url" content="${CANON}/check?token=${t}"`), "check og:url not brand host");
  assert.ok(html.includes(`<meta property="og:image" content="${CANON}/check/card.svg?token=${t}"`), "check og:image not brand host");
});

await check("miniapp manifest page is deliberately LEFT on its signed domain-bound host", async () => {
  // The Farcaster miniapp account-association manifest is cryptographically bound
  // to its host, so the miniapp page's og:url must NOT be rewritten to the brand
  // host. This asserts the fix was surgical and did not touch it.
  const html = await (await req("/miniapp")).text();
  assert.ok(!html.includes(`og:url" content="${CANON}/miniapp"`), "miniapp og:url wrongly rewritten to brand host");
});

console.log(`\n${pass} checks passed`);
