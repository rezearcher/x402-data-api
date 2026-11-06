import { test } from "node:test";
import assert from "node:assert/strict";
import { extractAddress, extractCoins } from "../src/parse.mjs";

test("extractAddress pulls the first 0x…40-hex Base address", () => {
  assert.equal(
    extractAddress("check 0x940181a94a35a4569e4529a3cdfb74e38fd98631 before buying"),
    "0x940181a94a35a4569e4529a3cdfb74e38fd98631"
  );
  assert.equal(extractAddress("no address here"), undefined);
  assert.equal(extractAddress(""), undefined);
  assert.equal(extractAddress(null), undefined);
});

test("extractCoins maps common tickers/names to CoinGecko ids, de-duped", () => {
  assert.equal(extractCoins("price of ETH and BTC please"), "ethereum,bitcoin");
  assert.equal(extractCoins("how much is solana worth"), "solana");
  // de-dupe: eth + ethereum collapse to one id
  assert.equal(extractCoins("ETH ethereum ether"), "ethereum");
  assert.equal(extractCoins("nothing recognizable"), undefined);
  assert.equal(extractCoins(""), undefined);
});

test("extractCoins caps at the 25-token route limit", () => {
  const many = Array(40).fill("btc eth sol usdc xrp doge bnb ada avax matic link arb op").join(" ");
  const out = extractCoins(many);
  assert.ok(out);
  assert.ok(out.split(",").length <= 25);
});
