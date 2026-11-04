import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeResourceBinding,
  extractResourceUrl,
  resourceMatchesUrl,
} from "../dist/index.js";

const URL1 = "https://seller.example/x402/data";

// --- extractResourceUrl: both x402 resource shapes + junk -------------------
test("extractResourceUrl reads a plain string", () => {
  assert.equal(extractResourceUrl("https://a.example/x"), "https://a.example/x");
});
test("extractResourceUrl reads the Coinbase middleware object { url, ... }", () => {
  assert.equal(
    extractResourceUrl({ url: "https://a.example/x", description: "d", mimeType: "application/json" }),
    "https://a.example/x",
  );
});
test("extractResourceUrl returns null for empty / missing / non-url shapes", () => {
  assert.equal(extractResourceUrl(""), null);
  assert.equal(extractResourceUrl("   "), null);
  assert.equal(extractResourceUrl(null), null);
  assert.equal(extractResourceUrl({ description: "no url here" }), null);
  assert.equal(extractResourceUrl(42), null);
});

// --- resourceMatchesUrl: host+path, trailing slash, relative, query ---------
test("resourceMatchesUrl matches on host + path, ignoring query/fragment", () => {
  assert.equal(resourceMatchesUrl("https://seller.example/x402/data?x=1", URL1 + "?y=2#f"), true);
});
test("resourceMatchesUrl is trailing-slash insensitive", () => {
  assert.equal(resourceMatchesUrl("https://seller.example/x402/data/", URL1), true);
});
test("resourceMatchesUrl resolves a RELATIVE declared resource against the endpoint", () => {
  assert.equal(resourceMatchesUrl("/x402/data", URL1), true);
  assert.equal(resourceMatchesUrl("/x402/other", URL1), false);
});
test("resourceMatchesUrl false on a different host", () => {
  assert.equal(resourceMatchesUrl("https://evil.example/x402/data", URL1), false);
});
test("resourceMatchesUrl null when a side can't be parsed", () => {
  assert.equal(resourceMatchesUrl(null, URL1), null);
  assert.equal(resourceMatchesUrl("not a url", "also not"), null);
});

// --- computeResourceBinding: the four verdicts ------------------------------
test("DECLARED when the live 402 declares a matching resource", () => {
  const rb = computeResourceBinding(URL1, true, URL1, "exact", true);
  assert.equal(rb.verdict, "DECLARED");
  assert.equal(rb.matches, true);
  assert.equal(rb.schemeBindsResource, false); // never cryptographic — disclosed
  assert.equal(rb.requestedUrl, URL1);
  assert.equal(rb.nonceConsumed, true);
  assert.match(rb.note, /matching the url you paid/);
  assert.match(rb.note, /consumed on-chain/); // nonceConsumed=true note branch
});

test("SUBSTITUTABLE when the 402 declares NO resource (cross-resource substitution)", () => {
  const rb = computeResourceBinding(URL1, true, null, "exact", true);
  assert.equal(rb.verdict, "SUBSTITUTABLE");
  assert.equal(rb.challengeResource, null);
  assert.match(rb.note, /declares NO `resource`/);
  assert.match(rb.note, /ANY x402 resource sharing this payTo \+ amount/);
});

test("RESOURCE_MISMATCH when the 402 declares a different resource (fail-closed)", () => {
  const rb = computeResourceBinding(URL1, true, "https://seller.example/x402/PREMIUM", "exact", true);
  assert.equal(rb.verdict, "RESOURCE_MISMATCH");
  assert.equal(rb.matches, false);
  assert.match(rb.note, /does NOT match the url you fetched/);
});

test("UNVERIFIED when no live 402 was read (e.g. expected-bound / POST / probe off)", () => {
  const rb = computeResourceBinding(URL1, false, null, null, null);
  assert.equal(rb.verdict, "UNVERIFIED");
  assert.match(rb.note, /could not read a live 402 challenge/);
});

test("UNVERIFIED when no requested url was captured", () => {
  const rb = computeResourceBinding(null, true, URL1, "exact", true);
  assert.equal(rb.verdict, "UNVERIFIED");
  assert.match(rb.note, /no requested url/);
});

test("DECLARED discloses transplantable risk when the nonce is NOT consumed", () => {
  const rb = computeResourceBinding(URL1, true, URL1, "exact", false);
  assert.equal(rb.verdict, "DECLARED");
  assert.match(rb.note, /NOT confirmed consumed/);
  assert.match(rb.note, /transplantable/);
});

test("DECLARED with unknown nonce state adds no consumed/transplantable clause", () => {
  const rb = computeResourceBinding(URL1, true, URL1, "exact", null);
  assert.equal(rb.verdict, "DECLARED");
  assert.doesNotMatch(rb.note, /transplantable/);
  assert.doesNotMatch(rb.note, /consumed on-chain/);
});
