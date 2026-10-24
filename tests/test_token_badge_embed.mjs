/**
 * Contract tests for tokenBadgeEmbed — the copy-paste embed snippet behind the
 * Line-A token-safety shields badge (src/index.ts). The badge is the swap-gate
 * analog of /scan/mcp/badge: a live safe/caution/avoid verdict a dev embeds on
 * a token page or README, linking back to the paid gate. These pin the snippet
 * contract so the badge stays CONNECTED (the shields endpoint image resolves,
 * the click-through lands on the public /check verdict page, the shields `url`
 * param is properly percent-encoded so the endpoint URL survives nesting).
 *
 *   node tests/test_token_badge_embed.mjs
 *
 * Real export from the Worker module via the same type-stripping loader the
 * other suites use — tests the shipped code.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { tokenBadgeEmbed } = await import("../src/index.ts");

const ORIGIN = "https://api.greyridgesignals.ai";
const WETH = "0x4200000000000000000000000000000000000006";

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log("ok - " + name);
}

const e = tokenBadgeEmbed(ORIGIN, WETH);

check("image_url is a shields endpoint badge", () => {
  assert.ok(e.image_url.startsWith("https://img.shields.io/endpoint?url="), "must be a shields endpoint badge: " + e.image_url);
});

check("shields url param percent-encodes the nested endpoint URL", () => {
  // The inner /chain/token/badge?token=… URL must be encoded so shields treats
  // it as one opaque param — a raw '?' or '&' would truncate it.
  const enc = encodeURIComponent(ORIGIN + "/chain/token/badge?token=" + WETH);
  assert.ok(e.image_url.includes(enc), "encoded endpoint url missing from: " + e.image_url);
  assert.ok(!e.image_url.includes("token=" + WETH + "&style"), "inner url leaked unencoded");
});

check("endpoint points at the live token-safety badge route", () => {
  const dec = decodeURIComponent(e.image_url.split("url=")[1].split("&")[0]);
  assert.strictEqual(dec, ORIGIN + "/chain/token/badge?token=" + WETH);
});

check("click-through lands on the public /check verdict page for the token", () => {
  assert.strictEqual(e.link, ORIGIN + "/check?token=" + WETH);
});

check("markdown is a linked image pointing image->/check", () => {
  assert.strictEqual(e.markdown, `[![token-safety](${e.image_url})](${e.link})`);
});

check("html is an anchor-wrapped img with alt text", () => {
  assert.ok(e.html.includes(`href="${e.link}"`), "link missing in html");
  assert.ok(e.html.includes(`src="${e.image_url}"`), "image missing in html");
  assert.ok(e.html.includes('alt="token-safety"'), "alt text missing in html");
});

check("arbitrary 0x token is carried through verbatim", () => {
  const tok = "0xABCdeF0000000000000000000000000000001234";
  const e2 = tokenBadgeEmbed(ORIGIN, tok);
  assert.ok(e2.link.endsWith("/check?token=" + tok));
  assert.ok(decodeURIComponent(e2.image_url).includes("token=" + tok));
});

console.log(`\n# tokenBadgeEmbed contract: ${pass}/${pass} passed`);
