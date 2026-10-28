/**
 * Contract test for the DeFi-yields chain-alias resolver.
 *
 *   node tests/test_defi_chain_alias.mjs
 *
 * DefiLlama identifies chains by a canonical display name ("Ethereum",
 * "OP Mainnet", "Avalanche", "BSC", "Hyperliquid L1"), but a trading agent
 * filtering /defi/yields (our single most-paid external route, 5 of 11 distinct
 * payers) naturally passes the short ticker it uses everywhere else
 * (chain=eth, arb, op, avax, matic, sol, bnb). Those never equal the canonical
 * name, so the exact-match chain filter returned an empty array on a PAID route
 * -> the count=0 silent-success defect, a churned repeat buyer on route #1.
 * resolveChainAlias maps the natural abbreviation to the canonical name while
 * staying precise and degrade-open: an exact canonical name falls through
 * unchanged (byte-identical results) and an unknown chain passes through so the
 * exact filter still returns []. This test locks that contract against the real
 * export. cloudflare:workers is shimmed by cfw-hooks.mjs. Node >= 22.18 strips types.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { resolveChainAlias } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

// The real failures we are fixing: short names an agent naturally passes that
// used to return [] on a paid route now resolve to the canonical DefiLlama name
// (lowercased, because every caller compares pool.chain.toLowerCase()).
eq(resolveChainAlias("eth"), "ethereum", "eth -> ethereum (4923 pools, was 0)");
eq(resolveChainAlias("ETH"), "ethereum", "ETH case-insensitive");
eq(resolveChainAlias("arb"), "arbitrum", "arb -> arbitrum (896 pools)");
eq(resolveChainAlias("op"), "op mainnet", "op -> op mainnet (400 pools)");
eq(resolveChainAlias("optimism"), "op mainnet", "optimism -> op mainnet");
eq(resolveChainAlias("avax"), "avalanche", "avax -> avalanche (275 pools)");
eq(resolveChainAlias("matic"), "polygon", "matic -> polygon (514 pools)");
eq(resolveChainAlias("poly"), "polygon", "poly -> polygon");
eq(resolveChainAlias("sol"), "solana", "sol -> solana (2760 pools, was 0)");
eq(resolveChainAlias("bnb"), "bsc", "bnb -> bsc");
eq(resolveChainAlias("binance"), "bsc", "binance -> bsc");
eq(resolveChainAlias("hl"), "hyperliquid l1", "hl -> hyperliquid l1");
eq(resolveChainAlias("ftm"), "fantom", "ftm -> fantom");
eq(resolveChainAlias("zksync"), "zksync era", "zksync -> zksync era");
eq(resolveChainAlias("  Arb  "), "arbitrum", "whitespace trimmed");

// Degrade-open: an exact canonical name an agent already passes is NOT in the
// table and must fall through UNCHANGED (lowercased) so results stay identical.
eq(resolveChainAlias("Ethereum"), "ethereum", "canonical Ethereum passes through unchanged");
eq(resolveChainAlias("Base"), "base", "canonical Base passes through unchanged");
eq(resolveChainAlias("op mainnet"), "op mainnet", "canonical op mainnet passes through");
eq(resolveChainAlias("Solana"), "solana", "canonical Solana passes through");
eq(resolveChainAlias("BSC"), "bsc", "canonical BSC passes through");

// Precise + no silent drop: a bogus chain passes through (filter returns [],
// never a fabricated result) and empty means no filter.
eq(resolveChainAlias("zzznotreal"), "zzznotreal", "bogus chain passes through (exact filter -> [])");
eq(resolveChainAlias(""), "", "empty -> no filter");
eq(resolveChainAlias("   "), "", "whitespace-only -> no filter");

console.log(`defi chain-alias resolver contract: ${pass}/${pass} checks passed`);
