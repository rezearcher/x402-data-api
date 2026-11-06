/** node tests/test_llms_price_sync.mjs — llms.txt prices follow the effective (floored) catalog. */
import assert from "node:assert";
import { register } from "node:module";
register(new URL("./cfw-hooks.mjs", import.meta.url));
const { syncAdvertisedPrices } = await import("../src/index.ts");

const cat = [["/a/cold", "GET", "0.004", "4000", "d", []], ["/b/post", "POST", "0.002", "2000", "d", []]];
const txt = [
  "- GET https://x.example/a/cold?x=1 — $0.002 — stale literal",
  "- POST https://x.example/b/post — $0.002 — unchanged",
  "- GET https://x.example/not/in-catalog — $0.003 — untouched",
  "prose mentioning GET /a/cold — $0.002 — not a list line",
].join("\n");
const out = syncAdvertisedPrices(txt, cat).split("\n");
assert.match(out[0], /— \$0\.004 — stale literal/);
assert.match(out[1], /— \$0\.002 — unchanged/);
assert.match(out[2], /— \$0\.003 — untouched/);
assert.equal(out[3], txt.split("\n")[3]);
console.log("ok - llms price sync (4 cases)");
