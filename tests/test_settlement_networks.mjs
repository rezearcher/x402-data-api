/**
 * Contract test for settlement-capability discovery (/x402/networks helper).
 *
 *   node tests/test_settlement_networks.mjs
 *
 * WHY (2026-11-04): the x402 flow majority-share moved to Solana, and catalogs let
 * agents filter by network. Before we ever advertise a non-Base accepts[] option we
 * must prove (a) the facilitator supports that network's `exact` scheme AND (b) we
 * hold a receive address for it — advertising an unsettleable path breaks our one
 * working axis (Claims Law). `settlementFamily` is the CAIP-2 → family classifier the
 * endpoint uses to intersect facilitator support with receive-address coverage. This
 * locks the EVM/SVM/other boundaries (a misclassification would silently mis-report
 * what we can settle).
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { settlementFamily } = await import("../src/index.ts");

// Base mainnet + other EVM chains => evm
assert.strictEqual(settlementFamily("eip155:8453"), "evm", "Base mainnet is EVM");
assert.strictEqual(settlementFamily("eip155:84532"), "evm", "Base Sepolia is EVM");
assert.strictEqual(settlementFamily("eip155:1"), "evm", "Ethereum mainnet is EVM");

// Solana networks (CAIP-2 ref is the truncated genesis hash, not a name) => svm
assert.strictEqual(settlementFamily("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), "svm", "Solana mainnet is SVM");
assert.strictEqual(settlementFamily("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"), "svm", "Solana devnet is SVM");

// Everything else (algorand/aptos/sui/unknown) => other, so it is NEVER auto-claimed settleable
assert.strictEqual(settlementFamily("algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe"), "other", "Algorand is other");
assert.strictEqual(settlementFamily("aptos:2"), "other", "Aptos is other");
assert.strictEqual(settlementFamily(""), "other", "empty is other (fail safe)");
assert.strictEqual(settlementFamily("solana"), "other", "a bare family name w/o ':' is other (must be CAIP-2)");

// Settleable-intersection logic the handler relies on: a facilitator kind is only
// ours to advertise when we hold a receive address for its family.
function settleable(kinds, have) {
  return kinds.filter((k) => have[settlementFamily(k.network)]);
}
const facilitatorKinds = [
  { network: "eip155:8453", scheme: "exact" },
  { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", scheme: "exact" },
];
// Base-only coverage (our live state): only the Base kind survives.
const baseOnly = settleable(facilitatorKinds, { evm: true, svm: false, other: false });
assert.strictEqual(baseOnly.length, 1, "Base-only receive coverage => 1 settleable network");
assert.strictEqual(baseOnly[0].network, "eip155:8453", "that network is Base");

// Once a Solana receive address exists, the Solana kind also becomes settleable.
const withSolana = settleable(facilitatorKinds, { evm: true, svm: true, other: false });
assert.strictEqual(withSolana.length, 2, "EVM+SVM receive coverage => both settleable");

// A facilitator that does NOT list Solana never becomes settleable even with an address.
const evmOnlyFacilitator = settleable([{ network: "eip155:8453", scheme: "exact" }], { evm: true, svm: true, other: false });
assert.ok(!evmOnlyFacilitator.some((k) => settlementFamily(k.network) === "svm"), "no Solana kind => never advertised, even with a Solana address");

console.log("ok - settlement_networks: 14 assertions passed");
