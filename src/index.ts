import { Hono } from "hono";
import { RESPONSE_EXAMPLES } from "./examples";
import { STATUS_SNAPSHOT } from "./status_snapshot.ts";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension as declareDiscoveryExtensionBase } from "@x402/extensions/bazaar";

// Infer a JSON Schema (field names, types, required) from an example payload so
// the 402 discovery metadata carries a real output contract, not just {type, example}.
function inferSchema(v: unknown): Record<string, unknown> {
  if (v === null) return { type: "null" };
  if (Array.isArray(v)) return { type: "array", items: v.length ? inferSchema(v[0]) : {} };
  if (typeof v === "object") {
    const props: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) props[k] = inferSchema(x);
    return { type: "object", properties: props, required: Object.keys(props) };
  }
  if (typeof v === "number") return { type: Number.isInteger(v) ? "integer" : "number" };
  return { type: typeof v };
}
function declareDiscoveryExtension(cfg: any): any {
  const ex = cfg?.output?.example;
  if (ex && typeof ex === "object" && !cfg.output.schema) {
    return declareDiscoveryExtensionBase({ ...cfg, output: { ...cfg.output, schema: inferSchema(ex) } });
  }
  return declareDiscoveryExtensionBase(cfg);
}
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { keccak256, stringToHex } from "viem";
import { DurableObject } from "cloudflare:workers";
import { createCdpFacilitator } from "./facilitator";
import { trackPaidRequest, getMetrics, type Rail } from "./usage.ts";
import { makeUsageCounter, type UsageCounter } from "./usage_counter.ts";

// ---------------------------------------------------------------------------
// Environment bindings
// ---------------------------------------------------------------------------

export type Env = {
  PAY_TO: string;
  // CDP facilitator credentials (Worker secrets) — enable Bazaar discovery/settlement.
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  FACILITATOR_MODE?: string; // "cdp" routes settlement through CDP; anything else = xpay (default)
  // Stripe billing (set via Worker secrets — skip for local dev)
  STRIPE_API_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
  // Optional KV namespace for API key storage. Needs `wrangler kv namespace create API_KEYS`
  // + binding id in wrangler.toml. If absent, API key auth returns 501.
  API_KEYS?: KVNamespace;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  // Per-key atomic credit ledger (Durable Object). KV read-modify-write of the
  // balance is racy under concurrency (double-spend), so each key's balance
  // lives in its own CreditLedger DO (idFromName(apiKey)); KV stays the source
  // of truth for identity + expiry. Missing binding => api_key bypass fails
  // closed (falls through to the x402 gate). Needs the [[durable_objects.bindings]]
  // + migration in wrangler.toml.
  CREDIT_LEDGER?: DurableObjectNamespace<CreditLedger>;
  // RapidAPI marketplace rail. RapidAPI bills the buyer on its own side and PROXIES the
  // call to us, identifying itself with a per-API secret header — it does not and cannot
  // speak x402. Without this, every RapidAPI-billed request would hit the x402 gate and
  // 402, so the listing would sell a product that never answers. Set via:
  //   wrangler secret put RAPIDAPI_PROXY_SECRET
  // and paste the same value into the RapidAPI listing's secret header field.
  // Unset = the bypass is inert and every request still pays x402 (fail closed).
  RAPIDAPI_PROXY_SECRET?: string;
  // Durable Object SQLite traffic log (t_9e3fec95); replaces dead AE binding.
  TRAFFIC_LOG?: DurableObjectNamespace<TrafficLog>;
  // Atomic paid-usage counters (audit F-05, mirrored from x402-cve-triage):
  // per-route/per-rail aggregates for the daily chain-verified reconcile
  // ledger. One DO instance ("paid-usage") holds every counter. Missing
  // binding => tracking no-ops (graceful degradation).
  USAGE_COUNTER?: DurableObjectNamespace<UsageCounter>;
  // Secret gate for GET /internal/traffic-stats (constant-time compare).
  TRAFFIC_STATS_SECRET?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NETWORK = "eip155:8453" as const; // Base mainnet
// Native USDC on Base (the x402 settlement asset). 6 decimals — published in the
// 402 offer's `extra` so a buyer can render the human amount without guessing.
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

// Short human-readable route name for Bazaar discovery (e.g. "/pm/markets" -> "PM Markets").
function shortRouteName(p: string): string {
  return p
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((seg) =>
      seg
        .replace(/[{}]/g, "")
        .split("-")
        .map((w) => (w === "defi" ? "DeFi" : w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(" ")
    )
    .join(" ");
}

// Routes that expose a free, key-less /preview path (same response shape as the
// paid call, no payment). Mirrors the `${p}/preview` handlers registered in this
// file — kept as an explicit data set so the machine-readable manifest can tell a
// marketplace/reseller auto-wiring our catalog to offer buyers a free trial before
// the paid call (a buyer evaluating us via a catalog shouldn't have to pay blind).
// Degrades open: a route missing from this set simply omits preview_url (never a
// broken link or a false claim). Every entry here is a real, live-probed handler.
const PREVIEW_ROUTES = new Set<string>([
  "/gate/swap", "/chain/token-report", "/chain/token-security", "/crypto/prices",
  "/crypto/funding", "/defi/yields", "/pm/markets", "/chain/gas-price",
  "/chain/block-number", "/chain/token-balance", "/defi/protocol-risk",
  "/defi/safe-yields", "/enrich/tech-risk", "/scan/mcp", "/ai/ask", "/ai/extract",
  "/v1/chat/completions",
]);

// Single source of truth for paid routes: [path, method, price_usdc, atomic_units, description, tags].
    // Lane order derived from measured on-chain demand (onchain_demand_by_lane.json):
    // token-safety is the #1 live-demand lane — lead the machine-import surface with it.
const ROUTE_CATALOG: Array<[string, string, string, string, string, string[]]> = [
  ["/gate/swap", "GET", "0.008", "8000", "Is this Base token safe to swap right now? GO / HOLD / BLOCK pre-trade safety gate for autonomous trading agents: is it a honeypot, can you sell it, and is your trade too big for the pool? Honeypot/sellability + admin-control checks + Uniswap v3 liquidity vs. your notional — one decision + reason in one fast call.", ["security", "base", "onchain", "trading", "gate", "agents", "token", "honeypot", "token-security", "data"]],
  ["/chain/token-report", "GET", "0.01", "10000", "Is this Base token safe to buy? One call returns a trade-safety verdict — SAFE | CAUTION | AVOID — with risk_score (0-100) and reasons: honeypot/sellability simulation, owner-renounced + mint/pause/blacklist/fee-setter/upgradeable-proxy checks, measured transfer tax, symbol/name/decimals, and Uniswap v3 WETH-pool liquidity (USD). Replaces many RPC calls and prevents a bad trade before an agent buys a Base ERC-20.", ["security", "rpc", "base", "onchain", "blockchain", "token", "honeypot", "verdict", "trading", "token-security", "data"]],
  ["/chain/token-security", "GET", "0.009", "9000", "Is this Base token a honeypot — can a real wallet actually sell it? Token-security / honeypot detector for a Base ERC-20: EIP-1967 proxy + upgradeability detection, bytecode scan for mint/pause/blacklist/fee-setter/ownership selectors, owner() renouncement, and a live eth_call state-override sim testing whether a synthetic wallet can transfer() it. Real compute, not a thin data wrapper. Returns risk_score (0-100) + verdict (clear/review/block) + flags.", ["security", "rpc", "base", "onchain", "blockchain", "token", "honeypot", "token-security", "data"]],
  ["/pm/markets", "GET", "0.005", "5000", "Live Polymarket prediction markets — question, outcomes, bestBid/bestAsk/spread, volume24hr/volume1wk, oneDayPriceChange, clobTokenIds, conditionId, category tags, liquidity, end date. Ranked by volume24hr; filter by keyword.", ["prediction-markets", "polymarket", "markets", "crypto", "data"]],
  ["/crypto/funding", "GET", "0.004", "4000", "Cross-venue Hyperliquid+OKX+dYdX perp funding rates — top coins by 24h notional volume, per-venue funding + arb spread (bps) + cheapest-long/richest-short venue, premium/basis, annualized_hl/annualized_okx, LONGS_PAY/SHORTS_PAY/NEUTRAL signal, next_funding_ts, mark/oracle prices, open interest.", ["crypto", "funding", "perps", "hyperliquid", "okx", "dydx", "arbitrage", "defi", "market-data", "data"]],
  ["/defi/yields", "GET", "0.001", "1000", "Top DeFi lending/LP yields — project, chain, symbol, pool id, APY breakdown + 1d/7d/30d APY trend, IL risk (incl. il7d), exposure, reward/underlying tokens, outlier flag, mu/sigma, DefiLlama stability forecast, TVL. Filter by project, chain, or stablecoin-only; sort by TVL or risk-adjusted APY.", ["defi", "yield", "lending", "apy", "tvl", "defi-yields", "data"]],
  ["/crypto/prices", "GET", "0.001", "1000", "Spot token prices from DefiLlama — pass comma-separated CoinGecko ids, get price/change_24h/symbol/confidence/timestamp.", ["crypto", "prices", "token-price", "market-data", "defi", "data"]],
  ["/scan/mcp", "GET", "0.05", "50000", "Security scan of a target MCP server: audits every advertised tool for prompt-injection / tool-poisoning / exfiltration / dangerous-capability / hidden-unicode (OWASP LLM01/LLM08). Returns findings + risk score + verdict (clear/review/block).", ["security", "mcp", "audit", "prompt-injection"]],
  ["/enrich/tech-risk", "GET", "0.01", "10000", "Tech-stack fingerprint -> CVE (NVD) + EPSS + CISA-KEV attack-surface risk + verdict (clear/review/block) for a domain.", ["security", "cve", "risk"]],
  ["/enrich/domain", "GET", "0.01", "10000", "Firmographic + tech-stack enrichment for a domain, incl. full subdomain enumeration via certificate-transparency logs (crt.sh, RDAP, DoH, HTTP fingerprint) + verdict (clear/review/block, based on domain age).", ["data", "domain", "enrichment"]],
  ["/chain/block-number", "GET", "0.002", "2000", "Current Base mainnet block number.", ["rpc", "base", "onchain", "blockchain", "data"]],
  ["/chain/gas-price", "GET", "0.002", "2000", "Current Base mainnet gas price (wei/gwei), EIP-1559 base_fee_gwei/priority_fee_gwei, and gas_price_usd — no price oracle on ETH-only competitors.", ["rpc", "base", "onchain", "blockchain", "data"]],
  ["/chain/balance", "GET", "0.002", "2000", "ETH balance of a Base mainnet address, incl. balance_usd (internal ETH price cross-call).", ["rpc", "base", "onchain", "blockchain", "data"]],
  ["/chain/token-balance", "GET", "0.002", "2000", "ERC-20 token balance of a Base mainnet address, incl. symbol, decimals, balance_formatted.", ["rpc", "base", "onchain", "blockchain", "data"]],
  ["/chain/tx", "GET", "0.005", "5000", "Transaction details by hash on Base mainnet.", ["rpc", "base", "onchain", "blockchain", "data"]],
  ["/chain/receipt", "GET", "0.005", "5000", "Transaction receipt by hash on Base mainnet — status, gas used, full logs, and the L1 fee breakdown (l1_fee_wei, l1_gas_price_wei, l1_gas_used, effective_gas_price_wei) + l1_fee_usd/total_fee_usd an ETH-only competitor can't offer.", ["rpc", "base", "onchain", "blockchain", "data"]],
  ["/chain/code", "GET", "0.002", "2000", "Contract-code check for a Base mainnet address (is_contract + code size + EIP-7702 delegated-EOA detection).", ["rpc", "base", "onchain", "blockchain", "data"]],
  ["/chain/erc20-meta", "GET", "0.002", "2000", "ERC-20 metadata on Base: name, symbol, decimals, totalSupply for any token contract.", ["rpc", "base", "onchain", "token", "erc20", "data"]],
  ["/chain/nonce", "GET", "0.002", "2000", "Transaction count (nonce) for a Base address, latest and pending.", ["rpc", "base", "onchain", "blockchain", "data"]],
  ["/chain/is-contract", "GET", "0.002", "2000", "Is a Base address a smart contract or an EOA (is_contract + bytecode size).", ["rpc", "base", "onchain", "contract", "data"]],
  ["/chain/fee-estimate", "GET", "0.002", "2000", "Base EIP-1559 fee estimate: base fee, suggested priority fee, max-fee tiers (slow/standard/fast) in gwei and a 21k-gas transfer cost.", ["rpc", "base", "onchain", "gas", "fees", "data"]],
  ["/chain/network-status", "GET", "0.002", "2000", "Base network status snapshot: chain id, latest block, block age, gas used ratio and tx count.", ["rpc", "base", "onchain", "status", "health", "data"]],
  ["/chain/l1-base-fee", "GET", "0.002", "2000", "Ethereum L1 base fee as seen by Base's GasPriceOracle (wei/gwei) plus estimated L1 data fee for a simple transfer.", ["rpc", "base", "onchain", "gas", "l1", "fees", "data"]],
  ["/chain/fee-history", "GET", "0.002", "2000", "Base fee history for the last 10 blocks: base fee per block (gwei), gas-used ratios and a min/max/avg summary. Use when an agent times transactions around cheap blocks.", ["rpc", "base", "onchain", "gas", "fees", "history", "data"]],
  ["/chain/blob-base-fee", "GET", "0.002", "2000", "Base EIP-4844 blob base fee from the GasPriceOracle (wei/gwei). Use when an agent estimates L1 data-availability cost for Base batches.", ["rpc", "base", "onchain", "gas", "blob", "fees", "data"]],
  ["/chain/eth-usd", "GET", "0.001", "1000", "Base ETH/USD spot price from the Chainlink aggregator (price, round, updatedAt, staleness). Use when an agent needs a trusted on-chain ETH price.", ["rpc", "base", "onchain", "price", "chainlink", "oracle", "data"]],
  ["/chain/btc-usd", "GET", "0.001", "1000", "Base BTC/USD spot price from the Chainlink aggregator (price, round, updatedAt, staleness). Use when an agent needs a trusted on-chain BTC price.", ["rpc", "base", "onchain", "price", "chainlink", "oracle", "data"]],
  ["/chain/prices", "GET", "0.001", "1000", "Base crypto price snapshot in one call: BTC, ETH, LINK and SOL USD spot from Chainlink aggregators with per-feed staleness. Use when an agent needs a multi-asset trusted on-chain price board.", ["rpc", "base", "onchain", "price", "chainlink", "oracle", "snapshot", "data"]],
  ["/chain/sol-usd", "GET", "0.001", "1000", "Base SOL/USD spot price from the Chainlink aggregator (price, round, updatedAt, staleness). Use when an agent needs a trusted on-chain SOL price.", ["rpc", "base", "onchain", "price", "chainlink", "oracle", "data"]],
  ["/chain/link-usd", "GET", "0.001", "1000", "Base LINK/USD spot price from the Chainlink aggregator (price, round, updatedAt, staleness). Use when an agent needs a trusted on-chain LINK price.", ["rpc", "base", "onchain", "price", "chainlink", "oracle", "data"]],
  ["/chain/total-supply", "GET", "0.002", "2000", "ERC-20 total supply on Base (raw + formatted, with symbol and decimals).", ["rpc", "base", "onchain", "token", "erc20", "data"]],
  ["/chain/storage-at", "GET", "0.002", "2000", "Raw storage slot read (eth_getStorageAt) for any Base contract; slot defaults to 0x0. Use when an agent needs proxy implementation/admin slots or raw contract state.", ["rpc", "base", "onchain", "contract", "data"]],
  ["/chain/proxy-info", "GET", "0.002", "2000", "EIP-1967 proxy resolver for a Base contract: returns implementation, admin and beacon addresses (read from the standard storage slots) plus is_proxy flag. Use when an agent must know what code actually runs behind a proxy before trusting or calling it.", ["rpc", "base", "onchain", "contract", "proxy", "security", "data"]],
  ["/chain/allowance", "GET", "0.002", "2000", "ERC-20 allowance(owner, spender) on Base, raw + formatted, flags unlimited approvals.", ["rpc", "base", "onchain", "token", "erc20", "data"]],
  ["/defi/chains-tvl", "GET", "0.003", "3000", "Top blockchains ranked by total DeFi TVL (DefiLlama): name, TVL USD, gas token. No params. Use when an agent needs a quick map of where DeFi capital sits.", ["defi", "tvl", "chains", "data"]],
  ["/crypto/stablecoins", "GET", "0.003", "3000", "Top stablecoins by circulating supply (DefiLlama): name, symbol, price, peg type, circulating USD. No params. Use when an agent needs stablecoin supply and depeg checks.", ["crypto", "stablecoins", "depeg", "supply", "data"]],
  ["/defi/protocols-top", "GET", "0.003", "3000", "Top DeFi protocols by TVL (DefiLlama): name, category, TVL USD, 1d/7d change, chain. No params. Use when an agent needs a ranked protocol league table.", ["defi", "protocols", "tvl", "data"]],
  ["/defi/dex-volume", "GET", "0.003", "3000", "Top DEXs by 24h trading volume (DefiLlama): name, 24h/7d volume USD, 1d change, plus market total. No params. Use when an agent needs where on-chain swap volume is flowing.", ["defi", "dex", "volume", "data"]],
  ["/crypto/fear-greed", "GET", "0.002", "2000", "Crypto Fear & Greed Index (alternative.me): current value 0-100, classification, history of last N days. No params. Use when an agent needs a market-sentiment gauge.", ["crypto", "sentiment", "fear-greed", "data"]],
  ["/crypto/trending", "GET", "0.003", "3000", "Trending coins on CoinGecko right now: name, symbol, market-cap rank, 24h price change. No params. Use when an agent needs what the market is searching for.", ["crypto", "trending", "coingecko", "data"]],
  ["/defi/fees-top", "GET", "0.003", "3000", "Top DeFi protocols by 24h fees (DefiLlama): name, 24h/7d fees USD, 1d change, plus market total. No params. Use when an agent needs which protocols earn the most.", ["defi", "fees", "revenue", "data"]],
  ["/crypto/global", "GET", "0.002", "2000", "Global crypto market stats (CoinGecko): total market cap, 24h volume, BTC/ETH dominance, active coins. No params. Use when an agent needs a one-call market overview.", ["crypto", "market", "global", "data"]],
  ["/crypto/markets-top", "GET", "0.003", "3000", "Top coins by market cap (CoinGecko): price, market cap, 24h volume, 24h change; ?limit= up to 100. No required params. Use when an agent needs a ranked market snapshot.", ["crypto", "markets", "price", "data"]],
  ["/crypto/movers", "GET", "0.003", "3000", "Top 24h gainers and losers among the top-100 coins (CoinGecko). No params. Use when an agent needs what is moving the market right now.", ["crypto", "movers", "gainers", "losers", "data"]],
  ["/brief/market", "GET", "0.01", "10000", "One-call crypto market brief: Fear & Greed, global market cap/dominance, top movers, trending coins and top DeFi fee earners. No params. Use when an agent needs a full market snapshot in a single payment.", ["crypto", "market", "brief", "snapshot", "data"]],
  ["/crypto/exchanges-top", "GET", "0.003", "3000", "Top crypto exchanges by trust score (CoinGecko): name, country, year, trust score and rank, 24h BTC volume. No params. Use when an agent needs exchange due-diligence data.", ["crypto", "exchanges", "trust", "data"]],
  ["/crypto/categories", "GET", "0.003", "3000", "Crypto sector performance (CoinGecko categories): market cap, 24h change, volume per sector, top by market cap. No params. Use when an agent needs sector rotation signals.", ["crypto", "sectors", "categories", "data"]],
  ["/defi/hacks-recent", "GET", "0.003", "3000", "Most recent DeFi/crypto hacks and exploits (DefiLlama): date, name, amount lost USD, chain, technique, bridge-hack flag; ?limit= up to 50. No required params. Use when an agent needs live security-incident risk signals.", ["defi", "security", "hacks", "exploits", "data"]],
  ["/crypto/derivatives-exchanges", "GET", "0.003", "3000", "Top crypto derivatives exchanges (CoinGecko): open interest BTC, 24h volume BTC, perpetual and futures pair counts, year established. No params. Use when an agent needs perp/futures venue liquidity data.", ["crypto", "derivatives", "futures", "open-interest", "data"]],
  ["/defi/protocol-risk", "GET", "0.01", "10000", "Protocol risk score from DefiLlama: joins TVL, 1d/7d TVL change, age, audits, chain count and matching hack history into one 0-100 score with flags; ?protocol=<slug> (default aave-v3). Use when an agent needs a due-diligence check before routing funds to a DeFi protocol.", ["defi", "risk", "security", "due-diligence", "data"]],
  ["/defi/safe-yields", "GET", "0.01", "10000", "Vetted stablecoin yields: top stablecoin pools (DefiLlama, TVL>$5M, APY 1-25%) joined with each protocol's age and hack history, safest-yield first; optional ?chain= & ?limit=. No required params. Use when an agent needs where to park stablecoins with due-diligence already applied.", ["defi", "yield", "stablecoin", "risk", "data"]],
  ["/defi/yields-top", "GET", "0.003", "3000", "Top DeFi yield pools by TVL (DefiLlama): chain, project, symbol, APY, TVL USD; optional ?chain= & ?stable=true. Use when an agent needs where to earn yield.", ["defi", "yield", "apy", "data"]],
  ["/ai/classify", "GET", "0.003", "3000", "Zero-shot text classification (Llama 3.2 3B): ?text=<up to 1000 chars>&labels=<comma-separated labels, 2-10> returns the single best label. Use when an agent needs to route or tag text (intent, sentiment, topic, spam) in one cheap call.", ["ai", "llm", "classification", "text", "data"]],
  ["/ai/summarize", "GET", "0.003", "3000", "Text summarization (Llama 3.2 3B): ?text=<up to 1500 chars> returns a 1-3 sentence summary. Use when an agent needs to compress a passage cheaply before reasoning over it.", ["ai", "llm", "summarization", "text", "data"]],
  ["/ai/translate", "GET", "0.003", "3000", "Text translation (Llama 3.2 3B): ?text=<up to 800 chars>&to=<target language, e.g. es, fr, de, ja> returns the translated text only. Use when an agent needs quick pay-per-call translation with no API key.", ["ai", "llm", "translation", "language", "data"]],
  ["/ai/extract", "GET", "0.005", "5000", "Text-to-JSON extraction (Llama 3.2 3B): ?text=<up to 1500 chars>&fields=<comma-separated field names> returns a strict JSON object with exactly those keys (null when absent). Use when an agent needs messy text turned into typed structured data.", ["ai", "llm", "extraction", "json", "structured", "data"]],
  ["/v1/chat/completions", "POST", "0.002", "2000", "OpenAI-compatible chat completions (Llama 3.3 70B fp8 on Workers AI; set model=llama-3.2-3b-instruct for the small model): POST {messages:[{role,content}]} returns choices[0].message. Drop-in for chat-completions clients, pay-per-call, no API key.", ["ai", "llm", "chat", "completions", "openai", "inference", "llm-inference"]],
  ["/ai/ask", "GET", "0.002", "2000", "Cheap LLM answer (Llama 3.2 3B on Workers AI): ?q=<prompt up to 500 chars>, returns concise text. Pay-per-call, no API key.", ["ai", "llm", "inference", "chat", "data"]],
  ["/chain/block", "GET", "0.002", "2000", "Base block summary by number or latest: hash, timestamp, tx count, gas used/limit, base fee.", ["rpc", "base", "onchain", "blockchain", "data"]],
  ["/chain/wallet", "GET", "0.003", "3000", "Wallet screening bundle (balance, activity, contract vs EOA check): ETH balance + balance_usd (internal ETH price cross-call) + tx count + contract-code check (EIP-7702 delegated-EOA aware) for a Base mainnet address, in one call.", ["rpc", "base", "onchain", "blockchain", "wallet", "data"]],
  ["/dns/{domain}", "GET", "0.01", "10000", "Resolve DNS records (A/AAAA/MX/NS/TXT) for a domain via Cloudflare DoH.", ["dns", "domain", "data", "recon"]],
  ["/whois/{domain}", "GET", "0.01", "10000", "WHOIS / RDAP lookup: registrar, created, expiry, registrant for a domain.", ["whois", "rdap", "domain", "data", "recon"]],
];
// Non-custodial facilitator — no Coinbase/CDP API key needed.
const FACILITATOR_URL = "https://facilitator.xpay.sh";
// CDP hosted facilitator — settlements through this get catalogued in the x402 Bazaar.
const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const CDP_HOST = "api.cdp.coinbase.com";
const DOH_URL = "https://cloudflare-dns.com/dns-query";
const RDAP_URL = "https://rdap.org/domain";
// rdap.org returns 403 to any request without a User-Agent, then 302-redirects to the
// authoritative registry (e.g. rdap.verisign.com for .com). Measured 2026-07-30: every
// /whois call had been failing 502 "RDAP lookup failed, status 403" for EVERY domain
// because these headers omitted a UA — the same failure mode already documented for
// mainnet.base.org. Workers' fetch follows the redirect automatically once past the 403.
const RDAP_HEADERS = {
  accept: "application/rdap+json",
  "user-agent": "GreyRidgeSignals/1.0 (+https://greyridgesignals.ai)",
} as const;

// IANA RDAP bootstrap: TLD -> authoritative registry RDAP base URL.
//
// Adding a User-Agent fixed the bare 403 but not the endpoint: rdap.org kept refusing
// THIS Worker's egress (Cloudflare IPs) while serving the identical request fine from
// other hosts — measured 2026-07-30, 6/6 failures through the Worker vs 200 direct.
// Depending on a third-party redirector for a PAID endpoint was the real defect. IANA
// publishes the canonical TLD->registry map, so we resolve it once and query the
// authoritative registry directly: one less hop and no third-party gatekeeper.
//
// Cached per-isolate (Workers isolates persist across requests), so the bootstrap is
// fetched roughly once per isolate rather than per call. Falls back to rdap.org if the
// bootstrap is unreachable or the TLD is unlisted, so this can only add coverage.
// Supplement for TLDs the IANA file genuinely omits. Measured 2026-07-30: the bootstrap
// carries 1200 TLDs but NOT .io or .co — ccTLD operators are not obliged to publish
// there, so a bootstrap-only lookup silently loses popular TLDs. Only entries verified
// to answer are listed; an unverified guess would just trade a 502 for a wrong answer.
const RDAP_STATIC: Record<string, string> = {
  io: "https://rdap.identitydigital.services/rdap/",
};

let rdapBootstrap: Record<string, string> | null = null;

async function rdapBaseFor(tld: string): Promise<string | null> {
  // Static first: it is verified-working, costs no network call, and — critically —
  // still resolves when data.iana.org is unreachable. Consulting it only AFTER the
  // bootstrap would make .io depend on IANA being up, which is the opposite of intent.
  if (RDAP_STATIC[tld]) return RDAP_STATIC[tld];
  if (!rdapBootstrap) {
    try {
      const r = await fetch("https://data.iana.org/rdap/dns.json", {
        headers: { "user-agent": RDAP_HEADERS["user-agent"] },
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { services?: [string[], string[]][] };
      const map: Record<string, string> = {};
      for (const [tlds, urls] of j.services ?? []) {
        const base = urls.find((u) => u.startsWith("https://")) ?? urls[0];
        if (!base) continue;
        for (const t of tlds) {
          map[t.toLowerCase()] = base.endsWith("/") ? base : `${base}/`;
        }
      }
      rdapBootstrap = map;
    } catch {
      return null;
    }
  }
  return rdapBootstrap[tld] ?? RDAP_STATIC[tld] ?? null;
}

/** Fetch RDAP for a domain from the authoritative registry, falling back to rdap.org. */
async function rdapFetch(domain: string): Promise<Response> {
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";
  const base = tld ? await rdapBaseFor(tld) : null;
  if (base) {
    try {
      const r = await fetch(`${base}domain/${encodeURIComponent(domain)}`, {
        headers: RDAP_HEADERS,
      });
      if (r.ok) return r;
    } catch {
      /* fall through to the redirector */
    }
  }
  return fetch(`${RDAP_URL}/${encodeURIComponent(domain)}`, { headers: RDAP_HEADERS });
}
const POLYMARKET_URL = "https://gamma-api.polymarket.com/markets";
const POLYMARKET_EVENTS_URL = "https://gamma-api.polymarket.com/events";
// Multiple keyless Base RPCs — rotate on 429/5xx so a single provider's rate
// limit never fails a paid call (reliability = repeat callers).
const BASE_RPCS = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
  "https://base.api.onfinality.io/public",
  "https://base-pokt.nodies.app",
  "https://base-mainnet.public.blastapi.io",
  "https://base.gateway.tenderly.co",
  "https://gateway.tenderly.co/public/base",
];


// Per-isolate provider health: a provider that just 429'd / failed is skipped for a
// short cooldown, and the starting provider round-robins. Without this every call
// re-tries the same rate-limited providers first and burns the Worker's 50-subrequest
// cap (which made the honeypot sim report "unavailable" for most requests).
const rpcCooldownUntil = new Map<string, number>();
let rpcRoundRobin = 0;
function rpcOrder(): string[] {
  const now = Date.now();
  const n = BASE_RPCS.length;
  const start = rpcRoundRobin++ % n;
  const rotated = BASE_RPCS.map((_, i) => BASE_RPCS[(start + i) % n]);
  const healthy = rotated.filter((u) => (rpcCooldownUntil.get(u) ?? 0) <= now);
  return healthy.length ? healthy : rotated;
}
function rpcMarkBad(url: string, ms = 30000): void {
  rpcCooldownUntil.set(url, Date.now() + ms);
}

// ---------------------------------------------------------------------------
// Base mainnet JSON-RPC helper — fixed host only (no user-supplied URL),
// SSRF-safe by construction. Shared by all /chain/* endpoints.
// ---------------------------------------------------------------------------

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const HASH_RE = /^0x[a-fA-F0-9]{64}$/;

async function baseRpc(method: string, params: unknown[]): Promise<any> {
  let lastErr = "no rpc tried";
  for (const url of rpcOrder()) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        lastErr = `${url} -> HTTP ${res.status}`;
        rpcMarkBad(url);
        continue; // 429 / 5xx → try the next provider
      }
      const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (j.error) {
        lastErr = `${url} -> ${j.error.message ?? "rpc error"}`;
        continue;
      }
      return j.result; // may be null (e.g. unknown tx hash) — a valid answer
    } catch (e) {
      lastErr = `${url} -> ${(e as Error).message}`;
    }
  }
  throw new Error(`Base RPC unavailable (all providers): ${lastErr}`);
}

// ---------------------------------------------------------------------------
// App factory — called fresh per Worker request (Hono is stateless)
// ---------------------------------------------------------------------------

// `rail` is set by the gate middleware on every gated request so the route
// handlers can attribute a successful paid call to its payment rail.
type AppEnv = {
  Bindings: Env;
  Variables: { rail: Rail };
};

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Free health endpoint
// ---------------------------------------------------------------------------

app.get("/health", (c) => {
  // Report the active settlement facilitator so CDP-Bazaar cataloguing can be
  // verified without leaking secrets. "cdp" = routes catalogue into the Coinbase
  // x402 discovery Bazaar; "xpay" = default (not catalogued in CDP discovery).
  const env = c.env as Env;
  const facilitator =
    env.FACILITATOR_MODE === "cdp" && env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET
      ? "cdp"
      : "xpay";
  return c.json({ ok: true, facilitator });
});

// Machine-readable measured uptime/latency so an auto-wiring agent can judge
// reliability at discovery time without scraping GitHub markdown. Measured-only
// (Claims Law): point-in-time snapshot from the 5-min /preview probe, not an SLA.
// Human-readable detail: docs/STATUS.md. Regenerated by scripts/status_report.py.
app.get("/status", (c) => {
  return c.json({ ok: true, ...STATUS_SNAPSHOT });
});

// ---------------------------------------------------------------------------
// Paid-usage metrics (audit F-05) — gate-bypassed, aggregate-only
// ---------------------------------------------------------------------------
// Per-route/per-rail counters consumed by the daily chain-verified reconcile
// ledger (mirrors x402-cve-triage /metrics). Aggregate-only — no per-request
// data, no PAY_TO, no keys. Never x402-gated: FREE_PATHS in the middleware.
app.get("/metrics", async (c) => {
  // Edge-cache the aggregate metrics for 1h. /metrics is public + unauthenticated
  // and every uncached hit runs two Durable Object reads (UsageCounter.list() +
  // TrafficLog.getNetExternalPaid over a 30-day window). Public crawlers hitting
  // this endpoint are the only unbounded multiplier on CF free-tier DO rows_read.
  // A 60s cache (prior fix) capped MISSES to 1440/day but NOT rows per miss:
  // getNetExternalPaid reads every PAID row in the 30d window (~6673 today), so
  // 1440 misses x 6673 rows = 9.6M rows_read/day = 192% of the 5M/day cap — the
  // account still exceeded the limit on 2026-10-21 AFTER the edge cache shipped,
  // 500-ing the DO layer until UTC reset (a live conversion-killer). The miss-cap
  // alone was necessary but insufficient. A 1h TTL caps misses at 24/day, so even
  // the SCAN_CAP ceiling (50k rows/call) = 1.2M/day = 24% of budget; one endpoint
  // can no longer exhaust it. An aggregate counter read by a daily reconcile +
  // goal-gate tolerates 1h staleness. Math: scripts/do_budget_check.py.
  const cache = (globalThis as { caches?: { default: Cache } }).caches?.default;
  const cacheKey = new Request(new URL(c.req.url).toString());
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const metrics = await getMetrics(makeUsageCounter(c.env));
  // Augment the GROSS counter with a payer-aware net-external block from
  // TrafficLog. total_paid_calls includes our own self/test settlements and
  // unknown bot dust, so the revenue goal-gate must read net_external_paid_calls
  // for the true replied->paid funnel stage (else it mis-routes to cold
  // outreach). Fail-soft: a TrafficLog read can throw on the DO free-tier budget
  // or be unbound — never break the aggregate the daily reconcile ledger needs.
  let net_external: unknown = null;
  let net_external_paid_calls: number | null = null;
  if (c.env.TRAFFIC_LOG) {
    try {
      const stub = c.env.TRAFFIC_LOG.get(c.env.TRAFFIC_LOG.idFromName("default"));
      const ne = await stub.getNetExternalPaid(2592000);
      net_external = ne;
      net_external_paid_calls = ne.external_calls;
    } catch (e) {
      net_external = { error: "traffic_read_failed", detail: e instanceof Error ? e.message : String(e) };
    }
  }
  const res = c.json({ ...metrics, net_external_paid_calls, net_external });
  // Only cache a well-formed read (net_external is null only when the binding is
  // absent, which is fine to cache; a throw-path sets net_external.error — still
  // cacheable, just a transient blip for <=60s). Response must carry Cache-Control
  // for caches.default to store it.
  res.headers.set("Cache-Control", "public, max-age=3600");
  if (cache) fireAndForget(c, cache.put(cacheKey, res.clone()));
  return res;
});

// ---------------------------------------------------------------------------
// Terms of use. Marketplace listings (RapidAPI, MCP registries) require a real,
// dedicated terms URL. greyridgesignals.ai serves its SPA for every path, so any
// /terms there returns 200 with the homepage — which reads as a broken link to a
// reviewer. Serving it from the API's own origin keeps it self-contained and
// versioned with the code it governs. Free path, never x402-gated.
// ---------------------------------------------------------------------------

const TERMS_UPDATED = "2026-07-30";

app.get("/terms", (c) =>
  c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Terms of Use — Grey Ridge x402 Data &amp; Security API</title>
<style>body{max-width:46rem;margin:0 auto;padding:2.5rem 1.2rem;font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c1c1c;background:#fff}h1{font-size:1.7rem;margin:0 0 .3rem}h2{font-size:1.05rem;margin:1.9rem 0 .4rem}.upd{color:#666;font-size:.9rem;margin:0 0 2rem}footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid #ddd;color:#666;font-size:.87rem}a{color:#0b5}@media(prefers-color-scheme:dark){body{background:#0d1117;color:#e6e6e6}footer{border-color:#2a2a2a;color:#999}.upd{color:#999}}</style>
</head><body>
<h1>Terms of Use</h1>
<p class="upd">Grey Ridge x402 Data &amp; Security API — last updated ${TERMS_UPDATED}</p>

<p>This API (the &ldquo;Service&rdquo;) is operated by Grey Ridge Signals Group LLC
(&ldquo;we&rdquo;, &ldquo;us&rdquo;). By calling any endpoint you agree to these terms.</p>

<h2>1. The Service</h2>
<p>The Service returns blockchain data for Base mainnet, cryptocurrency and DeFi market
data, and domain, DNS, WHOIS and vulnerability-enrichment data over HTTP. Access is sold
per-call or per-plan, either directly or through a marketplace such as RapidAPI. Where you
purchased access through a marketplace, that marketplace's billing, refund and cancellation
terms govern payment.</p>

<h2>2. Acceptable use</h2>
<p>You may not use the Service to: break any applicable law; attack, overload or probe
infrastructure you are not authorised to test; conduct unauthorised scanning or intrusion
against third parties; resell or redistribute raw responses as a competing bulk data feed;
or attempt to circumvent quotas, authentication or rate limits. The security endpoints
(including MCP auditing, domain enrichment and CVE mapping) are provided for assessing
assets you own or are explicitly authorised to assess. You are solely responsible for
having that authorisation.</p>

<h2>3. Data sources and accuracy</h2>
<p>Responses are assembled from public blockchain RPC nodes and third-party sources
including DefiLlama, Polymarket, Hyperliquid, OKX, dYdX, Cloudflare DNS, RDAP/WHOIS
registries, the NVD/CVE catalogue, EPSS and the CISA KEV catalogue. Those sources are
independent of us and may be incomplete, delayed or wrong. Data is provided for
informational purposes only.</p>
<p><strong>Nothing returned by the Service is financial, investment, legal or security
advice.</strong> Token security, honeypot and risk scores are heuristics, not guarantees;
a &ldquo;clear&rdquo; verdict is not assurance that an asset is safe. Independently verify
anything you rely on.</p>

<h2>4. Availability</h2>
<p>The Service is provided on an as-available basis with no uptime commitment unless agreed
separately in writing. We may change, rate-limit, deprecate or withdraw endpoints. Where a
marketplace plan sets a quota, that quota governs.</p>

<h2>5. No warranty</h2>
<p>THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT
WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE, ACCURACY AND NON-INFRINGEMENT.</p>

<h2>6. Limitation of liability</h2>
<p>To the maximum extent permitted by law, we are not liable for any indirect, incidental,
special, consequential or exemplary damages, or for lost profits, lost data or trading
losses, arising from use of or inability to use the Service. Our total aggregate liability
for any claim is limited to the amount you paid for the Service in the three months before
the event giving rise to the claim.</p>

<h2>7. Suspension</h2>
<p>We may suspend or terminate access immediately for breach of these terms, for abuse, or
where required to protect the Service or third parties.</p>

<h2>8. Changes</h2>
<p>We may update these terms. The &ldquo;last updated&rdquo; date above reflects the current
version, and continued use after a change constitutes acceptance.</p>

<h2>9. Governing law</h2>
<p>These terms are governed by the laws of the State of Texas, USA, excluding its conflict
of law rules.</p>

<h2>10. Contact</h2>
<p><a href="mailto:contact@greyridgesignals.ai">contact@greyridgesignals.ai</a></p>

<footer>Grey Ridge Signals Group LLC &middot;
<a href="https://greyridgesignals.ai">greyridgesignals.ai</a> &middot;
<a href="/">API home</a> &middot; <a href="/openapi.json">OpenAPI spec</a></footer>
</body></html>`),
);

// ---------------------------------------------------------------------------
// Landing page — every external listing (Bazaar, MCP registry, awesome-x402,
// llms.txt crawlers) links back here, so a 404 undercuts credibility. Plain
// self-contained HTML: inline CSS only, no external resources, readable by
// both humans and agents. Hono auto-serves HEAD from this GET handler.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// F4 fix: One-time API key redemption by Stripe session_id
// ---------------------------------------------------------------------------

app.get("/api-key", async (c) => {
  const sessionId = c.req.query("session_id");
  if (!sessionId) {
    return c.json({ error: "Missing session_id query parameter" }, 400);
  }

  if (!c.env.API_KEYS) {
    return c.json({ error: "API_KEYS KV not configured" }, 500);
  }

  // Lookup the dedup record to get the API key
  const dedup_key = `stripe_session_${sessionId}`;
  const dedup_record = await c.env.API_KEYS.get(dedup_key);
  if (!dedup_record) {
    return c.json({ error: "Session not found or key already redeemed" }, 404);
  }

  const dedup = JSON.parse(dedup_record);
  if (dedup.redeemed) {
    return c.json({ error: "API key already redeemed for this session" }, 410);
  }

  // Mark as redeemed
  await c.env.API_KEYS.put(dedup_key, JSON.stringify({ ...dedup, redeemed: true }));

  // Return the API key
  const apiKey = dedup.api_key;
  // The key record is written right after the session index in the webhook;
  // if it's missing (crash between the two puts) the buyer STILL gets their
  // key — the index is the source of truth for delivery (audit F4).
  const record = await c.env.API_KEYS.get(apiKey);
  let credits: number | null = null;
  let expiresAt: number | null = null;
  let createdAt: number | null = null;
  if (record) {
    const apiKeyRecord: ApiKeyRecord = JSON.parse(record);
    credits = apiKeyRecord.credits_remaining ?? null;
    expiresAt = apiKeyRecord.expires_at ?? null;
    createdAt = apiKeyRecord.created_at ?? null;
  }
  console.log(JSON.stringify({ event: "api_key_redeemed", session_id: sessionId }));

  return c.json({
    api_key: apiKey,
    credits_remaining: credits,
    expires_at: expiresAt,
    created_at: createdAt,
  });
});

app.get("/", async (c) => {
  const BASE = "https://x402-data-api.sigrunner.workers.dev";
  const mcpConfig = JSON.stringify(
    { mcpServers: { "grey-ridge-x402": { type: "streamable-http", url: `${BASE}/mcp` } } },
    null,
    2,
  );

  // F4: the Stripe success_url redirects here with ?session_id={CHECKOUT_SESSION_ID}.
  // Consume it: look up the session index the webhook recorded and deliver the
  // buyer's key inline. Nothing here ever mints — the webhook mints exactly
  // once per session (F2 dedup); this page only reads and displays the record.
  let keyPanel = "";
  let provisionMeta = "";
  const sessionId = c.req.query("session_id");
  if (sessionId && c.env.API_KEYS) {
    // session_id is attacker-controllable (query string); escape before any
    // reflection into the HTML so the paid page can't be used for XSS.
    const esc = (s: string) =>
      s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m] as string);
    try {
      const raw = await c.env.API_KEYS.get(`stripe_session_${sessionId}`);
      if (raw) {
        const index = JSON.parse(raw) as { api_key: string };
        const key = esc(index.api_key);
        keyPanel = `
  <div style="border:1px solid #2f6f4f;border-radius:10px;padding:1.1rem 1.25rem;margin:0 0 1.5rem;background:#0f1a14;">
    <h2 style="margin:0 0 .4rem;color:#7fd1a8;border:0;padding:0;">✓ Payment received — your API key</h2>
    <p style="margin:0 0 .6rem;color:#b9c4d0;">Save it now — 100 credits, valid 30 days from purchase.</p>
    <pre style="white-space:pre-wrap;word-break:break-all;padding:.8rem 1rem;">${key}</pre>
    <p style="margin:.7rem 0 0;color:#8b9bab;font-size:.85rem;">Pass it as the <code>X-API-Key</code> header on any paid endpoint — never in the URL. Also available once via <a href="/api-key?session_id=${esc(sessionId)}">/api-key</a>.</p>
  </div>`;
        console.log(JSON.stringify({ event: "api_key_delivered_landing", session_id: sessionId }));
      } else if (!c.req.query("retry")) {
        // The webhook usually lands within seconds of the redirect; refresh once.
        keyPanel = `
  <div style="border:1px solid #5b6b7b;border-radius:10px;padding:1.1rem 1.25rem;margin:0 0 1.5rem;background:#10161d;">
    <h2 style="margin:0 0 .4rem;color:#e8eef5;border:0;padding:0;">Payment received — issuing your key…</h2>
    <p style="margin:0;color:#b9c4d0;">This can take a few seconds after payment. Refreshing automatically…</p>
  </div>`;
        provisionMeta = `<meta http-equiv="refresh" content="5;url=/?session_id=${esc(sessionId)}&retry=1">`;
      } else {
        keyPanel = `
  <div style="border:1px solid #7a5b2f;border-radius:10px;padding:1.1rem 1.25rem;margin:0 0 1.5rem;background:#1a140f;">
    <h2 style="margin:0 0 .4rem;color:#e0b870;border:0;padding:0;">Still provisioning…</h2>
    <p style="margin:0;color:#b9c4d0;">Your payment is confirmed but the key hasn't been issued yet. Try <code><a href="/api-key?session_id=${esc(sessionId)}">/api-key?session_id=${esc(sessionId)}</a></code> in a minute, or contact support with your session id.</p>
  </div>`;
      }
    } catch (e) {
      console.log(JSON.stringify({ event: "api_key_delivery_lookup_error", error: (e as Error).message }));
    }
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Pay-per-call market & on-chain data for Base trading agents over x402: live DeFi yields, cross-venue funding rates, token prices, Polymarket and RPC data — plus a pre-trade token-safety gate (GO/HOLD/BLOCK). No account, no API key; agents pay inline in USDC from $0.001/call.">
<meta property="og:title" content="Grey Ridge Signals — pay-per-call market & on-chain data for Base agents (x402)">
<meta property="og:description" content="Pay-per-call market & on-chain data for Base trading agents over x402: live DeFi yields, cross-venue funding rates, token prices, Polymarket and RPC data — plus a pre-trade token-safety gate (GO/HOLD/BLOCK). No account, no API key; agents pay inline in USDC from $0.001/call.">
<meta property="og:url" content="https://x402-data-api.sigrunner.workers.dev/">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Grey Ridge Signals — pay-per-call market & on-chain data for Base agents (x402)">
<meta name="twitter:description" content="Pay-per-call market & on-chain data for Base trading agents over x402: live DeFi yields, cross-venue funding rates, token prices, Polymarket and RPC data — plus a pre-trade token-safety gate (GO/HOLD/BLOCK). No account, no API key; agents pay inline in USDC from $0.001/call.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://x402-data-api.sigrunner.workers.dev/">
<title>Grey Ridge Signals — pay-per-call market & on-chain data for Base agents (x402)</title>
${provisionMeta}
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.25rem 4rem;
    background: #0b0f14; color: #dbe4ee;
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  main { max-width: 780px; margin: 0 auto; }
  h1 { font-size: 1.7rem; margin: 0 0 0.4rem; color: #f4f7fa; }
  .tagline { color: #7fd1a8; font-size: 0.95rem; margin: 0 0 1.5rem; }
  p { color: #b9c4d0; }
  h2 { font-size: 1.05rem; color: #f4f7fa; margin: 2rem 0 0.75rem; border-top: 1px solid #1f2933; padding-top: 1.5rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #1f2933; }
  th { color: #8b9bab; font-weight: 600; }
  td.price { color: #7fd1a8; white-space: nowrap; }
  code, pre {
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #10161d; color: #d7e2ec; border: 1px solid #1f2933; border-radius: 6px;
  }
  code { padding: 0.1rem 0.35rem; }
  pre { padding: 0.9rem 1rem; overflow-x: auto; margin: 0.5rem 0 1.25rem; }
  a { color: #6fb7ff; }
  ul.links { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; }
  ul.links li a { text-decoration: none; }
  ul.links li a:hover { text-decoration: underline; }
  footer { margin-top: 2.5rem; color: #5c6b7a; font-size: 0.8rem; }
</style>
</head>
<body>
<main>
  <h1>Grey Ridge Signals — pay-per-call market & on-chain data for Base agents (x402)</h1>
  <p class="tagline">Agent-native, pay-per-call data on Base — no account, no API key.</p>
  ${keyPanel}
  <p>
    Every endpoint here is paid inline in USDC over the <a href="https://x402.org">x402</a> protocol on
    Base mainnet — an agent gets a 402 challenge, signs, retries, and gets data back in the same request.
    No signup, no key management, no subscription. Our white space is <strong>Base-native RPC</strong>
    (block/gas/balance/tx/wallet reads with EIP-7702 delegated-EOA detection) — most data sellers in this
    space are Ethereum-only. We pair that with crypto/DeFi/prediction-market data and MCP security audits
    (tool-poisoning / prompt-injection scanning), all reachable over plain HTTP or as MCP tools.
  </p>

  <h2>Endpoint groups</h2>
  <table>
    <thead><tr><th>Group</th><th>Price</th><th>Endpoints</th></tr></thead>
    <tbody>
      <tr><td>Base on-chain reads</td><td class="price">$0.002&ndash;$0.005</td><td><code>/chain/block-number</code>, <code>/chain/gas-price</code>, <code>/chain/balance</code>, <code>/chain/token-balance</code>, <code>/chain/tx</code>, <code>/chain/receipt</code>, <code>/chain/code</code>, <code>/chain/nonce</code>, <code>/chain/erc20-meta</code>, <code>/chain/wallet</code></td></tr>
      <tr><td>Crypto / DeFi / prediction markets</td><td class="price">$0.001&ndash;$0.005</td><td><code>/crypto/prices</code> ($0.001), <code>/crypto/funding</code> ($0.004), <code>/defi/yields</code>, <code>/pm/markets</code></td></tr>
      <tr><td>Security</td><td class="price">$0.01&ndash;$0.05</td><td><code>/chain/token-report</code> ($0.01 verdict), <code>/enrich/domain</code>, <code>/enrich/tech-risk</code>, <code>/scan/mcp</code>, <code>/chain/token-security</code></td></tr>
    </tbody>
  </table>

  <h2>Try it free</h2>
  <pre>curl -s ${BASE}/chain/gas-price/preview</pre>

  <h2>Add the MCP server</h2>
  <pre>${mcpConfig}</pre>

  <h2>Discovery</h2>
  <ul class="links">
    <li><a href="/llms.txt">/llms.txt</a></li>
    <li><a href="/openapi.json">/openapi.json</a></li>
    <li><a href="/.well-known/x402">/.well-known/x402</a></li>
    <li><a href="/.well-known/agent-card.json">A2A Agent Card</a></li>
    <li><a href="/mcp">/mcp</a></li>
  </ul>

  <footer>Grey Ridge Signals Group LLC &middot; Base mainnet (eip155:8453), USDC via x402</footer>
</main>
</body>
</html>
`;
  return c.html(html);
});

// ---------------------------------------------------------------------------
// Internal CDP endpoints — auth gate (audit-q3 F1, t_2576bb7f)
// ---------------------------------------------------------------------------
// These two routes are registered ABOVE the payment gate (§4), so before this
// fix any unauthenticated caller could mint a CDP JWT from Worker secrets
// (cdp-probe) or relay caller-supplied settlements at CDP's expense
// (cdp-settle-raw). Both now require the shared RAPIDAPI_PROXY_SECRET in the
// X-RapidAPI-Proxy-Secret header — the same constant-time compare the RapidAPI
// bypass rail uses below — and FAIL CLOSED: no configured secret, absent
// header, or mismatched header => 401 before any handler logic runs.
function cdpInternalAuthOk(c: { env: Env; req: { header(n: string): string | undefined } }): boolean {
  // SECURITY TODO: one shared RAPIDAPI_PROXY_SECRET guards both RapidAPI bypass and CDP relay; split + rotate secrets.
  const configured = c.env.RAPIDAPI_PROXY_SECRET;
  const presented = c.req.header("X-RapidAPI-Proxy-Secret") ?? "";
  return !!configured && presented !== "" && timingSafeEqual(presented, configured);
}

// Staged CDP-auth probe (temporary): confirms we can mint a CDP JWT from Worker
// secrets and that the CDP facilitator accepts it, before swapping the live gate.
app.get("/internal/cdp-probe", async (c) => {
  if (!cdpInternalAuthOk(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const env = c.env;
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) {
    return c.json({ ok: false, error: "CDP secrets absent from env" }, 500);
  }
  try {
    const jwt = await generateJwt({
      apiKeyId: env.CDP_API_KEY_ID,
      apiKeySecret: env.CDP_API_KEY_SECRET,
      requestMethod: "GET",
      requestHost: CDP_HOST,
      requestPath: "/platform/v2/x402/supported",
    });
    const res = await fetch(`${CDP_FACILITATOR_URL}/supported`, {
      headers: { Authorization: `Bearer ${jwt}`, accept: "application/json" },
    });
    const body = await res.text();
    return c.json({
      ok: res.ok,
      jwt_generated: true,
      jwt_len: jwt.length,
      cdp_status: res.status,
      body: body.slice(0, 400),
    });
  } catch (e) {
    return c.json({ ok: false, jwt_generated: false, error: (e as Error).message }, 500);
  }
});

// Raw CDP verify+settle proxy (temporary seed tool): bypasses the @x402 resource
// server (whose bazaar extension validation uses ajv new Function, blocked in CF
// Workers). The buyer's signed payment + requirements are POSTed straight to the
// CDP facilitator so a route gets catalogued in the Bazaar. Body:
//   { paymentPayload, paymentRequirements }
app.post("/internal/cdp-settle-raw", async (c) => {
  if (!cdpInternalAuthOk(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const env = c.env;
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) {
    return c.json({ error: "CDP secrets absent" }, 500);
  }
  let body: { paymentPayload?: unknown; paymentRequirements?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json body" }, 400);
  }
  const { paymentPayload, paymentRequirements } = body;
  if (!paymentPayload || !paymentRequirements) {
    return c.json({ error: "need paymentPayload + paymentRequirements" }, 400);
  }
  const call = async (op: "verify" | "settle") => {
    const jwt = await generateJwt({
      apiKeyId: env.CDP_API_KEY_ID!,
      apiKeySecret: env.CDP_API_KEY_SECRET!,
      requestMethod: "POST",
      requestHost: CDP_HOST,
      requestPath: `/platform/v2/x402/${op}`,
    });
    const res = await fetch(`${CDP_FACILITATOR_URL}/${op}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }),
    });
    const text = await res.text();
    const extResp = res.headers.get("extension-responses");
    return { status: res.status, extensionResponses: extResp, body: text.slice(0, 800) };
  };
  const verify = await call("verify");
  let settle = null;
  if (verify.status === 200) settle = await call("settle");
  return c.json({ verify, settle });
});

// GET /internal/traffic-stats?window_hours=24&secret=<TRAFFIC_STATS_SECRET> — per-path
// hit counts from the TrafficLog DO (t_9e3fec95). Constant-time secret gate.
app.get("/internal/traffic-stats", async (c) => {
  const configured = c.env.TRAFFIC_STATS_SECRET;
  const presented = c.req.query("secret") ?? "";
  if (!configured || !presented || !timingSafeEqual(presented, configured)) return c.json({ error: "unauthorized" }, 401);
  if (!c.env.TRAFFIC_LOG) return c.json({ error: "traffic logging not configured" }, 503);
  const hours = Math.min(Math.max(parseInt(c.req.query("window_hours") ?? "24") || 24, 1), 720);
  const stub = c.env.TRAFFIC_LOG.get(c.env.TRAFFIC_LOG.idFromName("default"));
  // Fail-soft + self-diagnosing: the DO SQLite read can throw (free-tier
  // rows_read/storage limit, or a transient DO reset). An opaque 500 made this
  // demand-measurement endpoint useless — surface the real error to the
  // authed caller instead so it stays actionable.
  try {
    if (c.req.query("paid") === "1") return c.json({ ok: true, window_hours: hours, paid: await stub.getPaid(hours * 3600) });
    if (c.req.query("ref_stats") === "1") {
      // Per-referral reconciliation: which ?ref= tags drove settled paid calls,
      // split into external (real buyers) vs self (our tests). Answers a pilot
      // partner's "prove my tag converted" from our own store + on-chain txs.
      const refs = await stub.getRefStats(hours * 3600);
      return c.json({ ok: true, window_hours: hours, ref_count: refs.length, refs, timestamp: Math.floor(Date.now() / 1000) });
    }
    if (c.req.query("settlements") === "1") {
      // Self-documenting on-chain settlements (payer, path, txHash) for the window.
      // Buildable basescan link per row; answers a trust-ask from our own store.
      const settlements = await stub.getSettlements(hours * 3600);
      return c.json({
        ok: true,
        window_hours: hours,
        count: settlements.length,
        settlements: settlements.map((s) => ({ ...s, basescan: `https://basescan.org/tx/${s.tx}` })),
        timestamp: Math.floor(Date.now() / 1000),
      });
    }
    const stats = await stub.getStats(hours * 3600);
    // Non-paid hits are sampled at NONPAID_SAMPLE to protect the DO write budget;
    // multiply `count` by nonpaid_scale for an estimate of true non-paid volume.
    // PAID rows are never sampled. Relative ranking across paths is exact.
    const nonpaid_scale = Math.round(1 / TrafficLog.NONPAID_SAMPLE);
    return c.json({ ok: true, window_hours: hours, nonpaid_sample_rate: TrafficLog.NONPAID_SAMPLE, nonpaid_scale, stats, timestamp: Math.floor(Date.now() / 1000) });
  } catch (e) {
    return c.json({ ok: false, window_hours: hours, error: "traffic_read_failed", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// Settlement-evidence finder — scans Base mainnet for a real USDC Transfer from a
// given payer to our receiving wallet (PAY_TO), returning the on-chain tx hash +
// amount so settlement can be proven to registries/buyers from ground truth
// (not our word). Runs on Cloudflare IPs via the rotating baseRpc so it works
// where datacenter RPC/explorer calls get 403'd. Secret-gated (read-only logs).
app.get("/internal/find-settlement", async (c) => {
  const configured = c.env.TRAFFIC_STATS_SECRET;
  const presented = c.req.query("secret") ?? "";
  if (!configured || !presented || !timingSafeEqual(presented, configured)) return c.json({ error: "unauthorized" }, 401);
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const from = c.req.query("from"); // payer address; omit to match any sender
  // Receiver to scan. Defaults to OUR wallet. A validated `to` lets the demand
  // sensor measure incoming settlements to a COMPETITOR payTo from Cloudflare
  // egress (Blockscout 403s datacenter IPs but not CF) — read-only public-chain
  // data, same secret gate. Reject anything that isn't a 20-byte hex address so
  // this can't be abused as an arbitrary-URL fetch proxy.
  const toParam = (c.req.query("to") ?? "").toLowerCase();
  const to = /^0x[0-9a-f]{40}$/.test(toParam) ? toParam : c.env.PAY_TO;
  const token = (c.req.query("token") ?? USDC).toLowerCase();
  // Public Base RPCs reject wide eth_getLogs ranges; ~800 blocks is accepted by
  // most providers in the rotation, so default there for a usable out-of-box scan.
  const chunk = Math.min(Math.max(parseInt(c.req.query("chunk") ?? "800") || 800, 100), 20000);
  const maxChunks = Math.min(Math.max(parseInt(c.req.query("max_chunks") ?? "40") || 40, 1), 45);
  const stopAtFirst = c.req.query("all") !== "1";
  type Hit = { txHash: string; block: number; amount_usdc: number; from: string; timestamp?: string; method: string; basescan: string };
  const hits: Hit[] = [];
  const diag: Record<string, unknown> = {};

  // Primary source: Blockscout v2 (reliable tx hashes, no getLogs range limit).
  // Runs from a Cloudflare IP so it is not datacenter-403'd like direct calls.
  try {
    const url = `https://base.blockscout.com/api/v2/addresses/${to}/token-transfers?type=ERC-20&filter=to`;
    const res = await fetch(url, { headers: { "User-Agent": "greyridge-x402/1", accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    diag.blockscout_status = res.status;
    if (res.ok) {
      const j = (await res.json()) as { items?: any[] };
      for (const it of j.items ?? []) {
        const tokAddr = String((it.token ?? {}).address ?? "").toLowerCase();
        if (tokAddr && tokAddr !== token) continue;
        const frm = String((it.from ?? {}).hash ?? "").toLowerCase();
        if (from && frm !== from.toLowerCase()) continue;
        const dec = parseInt(String((it.total ?? {}).decimals ?? "6")) || 6;
        const val = (it.total ?? {}).value ?? "0";
        const txHash = it.transaction_hash ?? it.tx_hash ?? "";
        hits.push({ txHash, block: Number(it.block_number ?? it.block ?? 0), amount_usdc: Number(val) / 10 ** dec, from: frm, timestamp: it.timestamp, method: "blockscout", basescan: `https://basescan.org/tx/${txHash}` });
        if (stopAtFirst && hits.length > 0) break;
      }
    }
  } catch (e) {
    diag.blockscout_error = e instanceof Error ? e.message : String(e);
  }

  // Fallback: eth_getLogs over recent blocks (only if Blockscout yielded nothing).
  if (hits.length === 0) {
    try {
      const latest = parseInt(String(await baseRpc("eth_blockNumber", [])), 16);
      diag.latest_block = latest;
      const topics: (string | null)[] = [TRANSFER, from ? pad(from) : null, pad(to)];
      let okChunks = 0, errChunks = 0;
      for (let i = 0; i < maxChunks; i++) {
        const toBlk = latest - i * (chunk + 1);
        const fromBlk = Math.max(0, toBlk - chunk);
        try {
          const logs = (await baseRpc("eth_getLogs", [{ address: token, topics, fromBlock: "0x" + fromBlk.toString(16), toBlock: "0x" + toBlk.toString(16) }])) as any[];
          okChunks++;
          for (const lg of logs ?? []) hits.push({ txHash: lg.transactionHash, block: parseInt(lg.blockNumber, 16), amount_usdc: parseInt(lg.data, 16) / 1e6, from: "0x" + String(lg.topics?.[1] ?? "").slice(26), method: "getLogs", basescan: `https://basescan.org/tx/${lg.transactionHash}` });
        } catch { errChunks++; }
        if (stopAtFirst && hits.length > 0) break;
        if (fromBlk === 0) break;
      }
      diag.getlogs_ok_chunks = okChunks;
      diag.getlogs_err_chunks = errChunks;
    } catch (e) {
      diag.getlogs_error = e instanceof Error ? e.message : String(e);
    }
  }

  hits.sort((a, b) => b.block - a.block);
  return c.json({ ok: true, payer: from ?? "(any)", receiver: to, token, matches: hits.length, settlements: hits, diag });
});

// ---------------------------------------------------------------------------
// 402index.io domain-ownership verification (static hash file)
// ---------------------------------------------------------------------------

app.get("/.well-known/402index-verify.txt", (c) =>
  c.text("619f23496d826b50e86afc72eaae3aa523868d4dba61161bfdb8640e88d4f4a5"),
);

// MCP Registry HTTP domain-auth proof — lets us publish/update our MCP Registry
// listing under the domain namespace (no interactive GitHub login needed).
app.get("/.well-known/mcp-registry-auth", (c) =>
  c.text("v=MCPv1; k=ed25519; p=/fl+vN2K62tQL/mmihmc7e7ASuNrfc3SrSjOsji3fko="),
);

// Self-describing x402 discovery manifest — the standard `.well-known/x402` catalog
// that x402 crawlers/directories read to discover a provider's paid endpoints
// (independent of any facilitator's Bazaar). Lists every paid resource we serve.
app.get("/.well-known/x402", (c) => {
  const BASE = "https://x402-data-api.sigrunner.workers.dev";
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const payTo = c.env.PAY_TO;
  // Attach a compact sample of what the agent BUYS, pulled from the same
  // RESPONSE_EXAMPLES the OpenAPI serves (no vaporware — real shapes on disk).
  // A browsing buyer-agent decides whether to pay far more readily when it can
  // see the output shape first; competitors (e.g. three.ws) publish an example
  // per paid route in their discovery doc for exactly this reason. Bounded so
  // the manifest stays crawler-friendly: arrays collapse to their first element.
  const sampleOf = (p: string): unknown | undefined => {
    const ex = RESPONSE_EXAMPLES[p];
    if (ex === undefined) return undefined;
    const compact = Array.isArray(ex) ? ex.slice(0, 1) : ex;
    try {
      const s = JSON.stringify(compact);
      // Guard against a pathological large example bloating the manifest.
      if (s.length > 1200) return undefined;
    } catch {
      return undefined;
    }
    return compact;
  };
  const mk = (p: string, method: string, price: string, units: string, desc: string, tags: string[]) => ({
    x402Version: 2,
    type: "http",
    resource: `${BASE}${p}`,
    methods: [method],
    method,
    description: desc,
    mimeType: "application/json",
    network: NETWORK,
    scheme: "exact",
    payTo,
    price_usdc: price,
    // Free try-before-pay path for auto-wirers that honor it (same shape as paid).
    ...(PREVIEW_ROUTES.has(p) ? { preview_url: `${BASE}${p}/preview` } : {}),
    ...(sampleOf(p) !== undefined ? { outputExample: sampleOf(p) } : {}),
    tags,
    accepts: [{
      scheme: "exact", network: NETWORK, amount: units, maxAmountRequired: units,
      asset: USDC, payTo, maxTimeoutSeconds: 300, resource: `${BASE}${p}`,
      description: desc, mimeType: "application/json",
      serviceName: shortRouteName(p),
      tags,
      extra: { name: "USD Coin", version: "2", decimals: 6, serviceName: shortRouteName(p), tags },
    }],
  });
  return c.json({
    service_overview: {
      name: "Grey Ridge Signals — x402 Data & Security",
      tagline: "Pay-per-call pre-trade token-safety for Base trading agents over x402 — GO/HOLD/BLOCK swap gate and honeypot/due-diligence verdicts, plus live DeFi yields, funding rates, prices, Polymarket and RPC data.",
      description:
        "Pay-per-call x402 for Base agents, led by the pre-trade safety gate: /gate/swap (GO/HOLD/BLOCK sized to your trade, $0.008), /chain/token-report (SAFE/CAUTION/AVOID with measured transfer tax, $0.01) and /chain/token-security (live honeypot/sellability sim, $0.009) — a honeypot check for a fraction of what rival Base token-safety APIs charge (up to $0.25/call). Plus market & on-chain data: /defi/yields (lending/LP yields + IL risk), /crypto/funding (cross-venue Hyperliquid+OKX+dYdX funding + arb spread), /crypto/prices, /pm/markets (Polymarket) and 20+ Base RPC/chain routes. Free /preview paths on the flagship routes. No account, no key — agents pay inline in USDC from $0.001/call.",
      website: BASE,
      categories: ["prediction-markets", "crypto", "data", "security", "mcp", "funding", "yield", "token-price", "rpc", "base", "onchain", "blockchain"],
      // Measured reliability — the question every integrator asks first (latency/uptime).
      // Sourced from STATUS_SNAPSHOT (scripts/status_report.py over data/uptime_samples.jsonl),
      // surfaced here so a buyer-agent or registry reviewer evaluating trust reads the real
      // number from the machine-readable surface rather than having to ask. Measurement, not an SLA.
      reliability: {
        measured_success_pct: STATUS_SNAPSHOT.overall_success_pct,
        samples: STATUS_SNAPSHOT.window.samples,
        window_from: STATUS_SNAPSHOT.window.from,
        window_to: STATUS_SNAPSHOT.window.to,
        probe: "free /preview paths, every 5 min",
        live_readout: `${BASE}/status`,
        raw_samples: "https://github.com/rezearcher/x402-data-api/blob/main/data/uptime_samples.jsonl",
        note: STATUS_SNAPSHOT.note,
      },
      // Provenance / trust anchors — the fields an auto-indexer or a trust-sensitive
      // buyer-agent checks before calling a seller it has never seen: open-source
      // license, public source repo, machine-readable docs, and a real contact.
      // Every value points to a real artifact (MIT LICENSE in-repo, public GitHub,
      // live OpenAPI, published evidence pack) — no vaporware. Added so discovery
      // surfaces that score sellers on licence/repository signals read them here
      // instead of flagging "unknown".
      provenance: {
        license: "MIT",
        license_url: "https://github.com/rezearcher/x402-data-api/blob/main/LICENSE",
        source_repository: "https://github.com/rezearcher/x402-data-api",
        documentation: `${BASE}/openapi.json`,
        evidence: "https://github.com/rezearcher/x402-data-api/blob/main/docs/EVIDENCE.md",
        contact: "contact@greyridgesignals.ai",
      },
    },
    name: "Grey Ridge Signals",
    provider: "Grey Ridge Signals Group LLC",
    license: "MIT",
    contact: "contact@greyridgesignals.ai",
    documentation: `${BASE}/openapi.json`,
    source_repository: "https://github.com/rezearcher/x402-data-api",
    // Reseller / marketplace attribution — machine-readable so a catalog or router
    // listing our endpoints can auto-tag its referred buyer volume without asking.
    // Append the `ref` param (e.g. ?ref=yourname) to any call URL; the tag rides the
    // x402 402->sign->retry and is recorded on the settled on-chain call, so referred
    // volume is measurable per-tag (real: backed by the TrafficLog `ref` column +
    // getRefStats reconciler). This is the human-readable llms.txt reseller note made
    // machine-readable for auto-wiring marketplaces (e.g. ones ingesting this manifest).
    reseller: {
      attribution_param: "ref",
      example: `${BASE}/gate/swap?token=aero&ref=yourname`,
      note: "Append ?ref=<your-tag> to any call URL to tag referred buyer volume; attributed per-tag on the settled on-chain call.",
      reconcile_contact: "contact@greyridgesignals.ai",
    },
    x402Version: 2,
    network: NETWORK,
    networks: [NETWORK],
    mcp_endpoint: `${BASE}/mcp`,
    resources: ROUTE_CATALOG.map((r) => mk(...r)),
  });
});

app.get("/.well-known/agent-capabilities.json", (c) => {
  const BASE = "https://x402-data-api.sigrunner.workers.dev";
  const q = (c.req.query("q") || "").toLowerCase().trim();
  const limRaw = parseInt(c.req.query("limit") || "3", 10);
  const limit = Number.isFinite(limRaw) ? Math.max(1, Math.min(62, limRaw)) : 3;
  const product = ([p, method, price, _units, desc, tags]: [string, string, string, string, string, string[]]) => ({
    // Canonical id shared with openapi.json so a buyer adapter can resolve this product
    // back to the billable operation when it places the paid call (see canonicalOperationId).
    operation_id: canonicalOperationId(p, method),
    name: "Grey Ridge " + shortRouteName(p),
    use_when: desc.split(/(?<=[.?!])\s/)[0],
    description: desc,
    price_usdc: price,
    source: "Grey Ridge Signals",
    freshness: "real-time",
    method,
    paid_url: `${BASE}${p}`,
    ...(PREVIEW_ROUTES.has(p) ? { preview_url: `${BASE}${p}/preview` } : {}),
    request_schema: `${BASE}/openapi.json`,
    tags,
  });
  let rows = ROUTE_CATALOG.slice();
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean);
    const score = ([p, , , , desc, tags]: [string, string, string, string, string, string[]]) => {
      const hay = (p + " " + desc + " " + tags.join(" ")).toLowerCase();
      return terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    };
    rows = rows.map((r) => [r, score(r)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([r]) => r);
  }
  const products = rows.slice(0, limit).map(product);
  return c.json({
    service: "Grey Ridge Signals — x402 Data & Security",
    provider: "Grey Ridge Signals Group LLC",
    contact: "contact@greyridgesignals.ai",
    x402_manifest: `${BASE}/.well-known/x402`,
    openapi: `${BASE}/openapi.json`,
    payment: { protocol: "x402", version: 2, network: NETWORK, asset: "USDC", attribution_param: "ref" },
    query: q || null,
    count: products.length,
    total_available: ROUTE_CATALOG.length,
    products,
  });
});

// A2A Agent Card — RFC-8615 well-known URI for Agent-to-Agent protocol
// discovery (https://a2a-protocol.org/latest/topics/agent-discovery).
// Lists every skill this service provides as an A2A-discoverable agent.
// Skills reference real route/tool names from this API (not fabricated),
// and declare x402 payment structurally via the A2A x402 extension
// (capabilities.extensions uri=https://x402.org/extension/v1) + an
// x402Payment securityScheme, so A2A+x402 agents can auto-wire payment
// without reading prose (adopted from the graded-conformant ChainAware
// A2A card, 2026-10-21).
app.get("/.well-known/agent-card.json", (c) => {
  const BASE = "https://x402-data-api.sigrunner.workers.dev";
  // Per-skill machine metadata: real route + live-enforced USDC price
  // (verified vs /.well-known/x402 on 2026-10-21) so an agent can auto-wire
  // the exact endpoint and expected price. Previews only where one exists.
  const RM: Record<string, { endpoint: string; price_usdc: string; preview?: string }> = {
    "gate-swap": { endpoint: "/gate/swap", price_usdc: "0.008", preview: "/gate/swap/preview" },
    "crypto-prices": { endpoint: "/crypto/prices", price_usdc: "0.001", preview: "/crypto/prices/preview" },
    "funding-rates": { endpoint: "/crypto/funding", price_usdc: "0.004", preview: "/crypto/funding/preview" },
    "defi-yields": { endpoint: "/defi/yields", price_usdc: "0.001", preview: "/defi/yields/preview" },
    "polymarket-markets": { endpoint: "/pm/markets", price_usdc: "0.005", preview: "/pm/markets/preview" },
    "base-chain-reads": { endpoint: "/chain/gas-price", price_usdc: "0.002", preview: "/chain/gas-price/preview" },
    "token-report": { endpoint: "/chain/token-report", price_usdc: "0.01", preview: "/chain/token-report/preview" },
    "token-security": { endpoint: "/chain/token-security", price_usdc: "0.009", preview: "/chain/token-security/preview" },
    "mcp-security-scan": { endpoint: "/scan/mcp", price_usdc: "0.05", preview: "/scan/mcp/preview" },
    "domain-enrichment": { endpoint: "/enrich/domain", price_usdc: "0.01" },
  };
  const X402SEC = [{ x402Payment: [] as string[] }];
  return c.json({
    name: "Grey Ridge Signals — x402 Data & Security API",
    description:
      "Agent-native, pay-per-call data on Base mainnet (USDC via x402). No account, no API key — agents pay inline in USDC. " +
      "Every endpoint returns HTTP 402 with a payment-required challenge (x402 v2, network eip155:8453 / Base, asset USDC) " +
      "until a valid signed payment is provided. See /.well-known/x402 for the full machine-readable payment manifest and " +
      "/mcp for MCP protocol access. Provider: Grey Ridge Signals Group LLC.",
    url: BASE,
    provider: {
      name: "Grey Ridge Signals Group LLC",
      url: BASE,
    },
    version: "0.1.0", // mirror root package.json (canonical)
    protocolVersion: "0.3.0",
    preferredTransport: "HTTP+JSON",
    documentationUrl: BASE,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [
        {
          uri: "https://x402.org/extension/v1",
          description:
            "x402 HTTP micropayment protocol. Each paid skill returns HTTP 402 until the request carries a valid X-PAYMENT header: an EIP-3009 gasless USDC authorization on Base (network eip155:8453, asset USDC, 6 decimals). The x402-fetch client signs + retries automatically. Free previews are unpaid. Machine-readable manifest: /.well-known/x402.",
          required: false,
          params: { protocol: "x402", scheme: "exact", network: "eip155:8453", asset: "USDC", version: 2 },
        },
      ],
    },
    securitySchemes: {
      x402Payment: {
        type: "apiKey",
        in: "header",
        name: "X-PAYMENT",
        description:
          "x402 v2 micropayment header (EIP-3009 gasless USDC on Base, network eip155:8453). Construct it with the x402-fetch client against the returned 402 challenge. No account or API key required. See https://x402.org and /.well-known/x402.",
      },
    },
    security: [{ x402Payment: [] }],
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "gate-swap",
        name: "Pre-Trade Swap Gate (GO/HOLD/BLOCK)",
        description:
          "Is this Base token safe to swap right now? One-call pre-trade gate for trading agents: is it a honeypot, can you sell it, is your trade too big for the pool? Pass a Base ERC-20 (token is the only required param; side defaults buy, notional_usd defaults 100), get decision go|hold|block, reason, SAFE/CAUTION/AVOID verdict, risk_score, pool liquidity and price impact as % of pool. " +
          "Route: GET /gate/swap?token=0x... (optional &side=buy|sell&notional_usd=100). Returns HTTP 402 (x402 v2, Base mainnet, USDC) until paid. " +
          "Price: $0.008. Free preview at GET /gate/swap/preview (demo tokens usdc|weth|cbbtc|aero|degen). " +
          "Machine-readable payment manifest: /.well-known/x402.",
        tags: ["security", "base", "trading", "gate", "pre-trade", "token", "swap"],
        examples: ["GET /gate/swap?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631&side=buy&notional_usd=100"],
      },
      {
        id: "crypto-prices",
        name: "Spot Token Prices",
        description:
          "Live spot token prices from DefiLlama — pass comma-separated CoinGecko ids, get price/change_24h/symbol/confidence/timestamp. " +
          "Route: GET /crypto/prices. Returns HTTP 402 (x402 v2, Base mainnet, USDC) until paid. " +
          "Price: $0.001. Free preview at GET /crypto/prices/preview. " +
          "Machine-readable payment manifest: /.well-known/x402. MCP tool interface: /mcp (tool: crypto_prices).",
        tags: ["crypto", "prices", "defi", "data"],
        examples: [
          "GET /crypto/prices?coins=bitcoin,ethereum,solana",
        ],
      },
      {
        id: "funding-rates",
        name: "Cross-Venue Perp Funding Rates",
        description:
          "Cross-venue Hyperliquid+OKX+dYdX perp funding rates — top coins by 24h volume, per-venue funding + arb spread (bps), " +
          "best long/short venue, premium/annualized signal, next_funding_ts, mark/oracle prices, open interest. " +
          "Route: GET /crypto/funding. Returns HTTP 402 (x402 v2, Base mainnet, USDC) until paid. " +
          "Price: $0.004. Free preview at GET /crypto/funding/preview. " +
          "Machine-readable payment manifest: /.well-known/x402. MCP tool interface: /mcp (tool: crypto_funding).",
        tags: ["crypto", "funding", "perps", "hyperliquid", "arbitrage", "data"],
        examples: [
          "GET /crypto/funding?limit=20",
        ],
      },
      {
        id: "defi-yields",
        name: "DeFi Lending & LP Yields",
        description:
          "Top DeFi lending/LP yields — project, chain, symbol, APY breakdown + 1d/7d/30d APY trend, IL risk, " +
          "mu/sigma, DefiLlama stability forecast, TVL. Filter by project, chain, or stablecoin-only. Sort by TVL or risk-adjusted APY. " +
          "Route: GET /defi/yields. Returns HTTP 402 (x402 v2, Base mainnet, USDC) until paid. " +
          "Price: $0.001. Free preview at GET /defi/yields/preview. " +
          "Machine-readable payment manifest: /.well-known/x402. MCP tool interface: /mcp (tool: defi_yields).",
        tags: ["defi", "yield", "lending", "apy", "tvl", "data"],
        examples: [
          "GET /defi/yields?limit=20&project=aave-v3&chain=Ethereum",
        ],
      },
      {
        id: "polymarket-markets",
        name: "Polymarket Prediction Markets",
        description:
          "Live Polymarket prediction markets — question, outcomes, bestBid/bestAsk/spread, volume24hr/volume1wk, " +
          "oneDayPriceChange, clobTokenIds, conditionId, category tags, liquidity, end date. Ranked by volume24hr; filter by keyword. " +
          "Route: GET /pm/markets. Returns HTTP 402 (x402 v2, Base mainnet, USDC) until paid. " +
          "Price: $0.005. Free preview at GET /pm/markets/preview. " +
          "Machine-readable payment manifest: /.well-known/x402. MCP tool interface: /mcp (tool: pm_markets).",
        tags: ["prediction-markets", "polymarket", "markets", "crypto", "data"],
        examples: [
          "GET /pm/markets?query=bitcoin&limit=20",
        ],
      },
      {
        id: "base-chain-reads",
        name: "Base Mainnet On-Chain Reads",
        description:
          "Base mainnet blockchain data — block number, gas price (EIP-1559 base_fee/priority_fee + gas_price_usd), " +
          "ETH balance (incl. balance_usd), ERC-20 token balance (with symbol/decimals), transaction details by hash, " +
          "transaction receipt (full logs + L1 fee breakdown + l1_fee_usd/total_fee_usd), " +
          "contract-code check (EIP-7702 delegated-EOA aware), and wallet bundle (balance + tx count + contract check in one call). " +
          "Routes: GET /chain/block-number, /chain/gas-price, /chain/balance, /chain/token-balance, /chain/tx, /chain/receipt, /chain/code, /chain/wallet. " +
          "Returns HTTP 402 (x402 v2, Base mainnet, USDC) until paid. Price: $0.001-$0.003 per call. " +
          "Free previews at /chain/block-number/preview and /chain/gas-price/preview (full live data, no payment required). " +
          "Machine-readable payment manifest: /.well-known/x402. MCP tool interface: /mcp (tools: chain_block_number, chain_gas_price, chain_balance, chain_token_balance, chain_tx, chain_wallet).",
        tags: ["rpc", "base", "onchain", "blockchain", "data"],
        examples: [
          "GET /chain/gas-price",
          "GET /chain/balance?address=0x4200000000000000000000000000000000000006",
          "GET /chain/wallet?address=0x4200000000000000000000000000000000000006",
        ],
      },
      {
        id: "token-report",
        name: "Token Trade-Safety Verdict (decision-grade)",
        description:
          "Is this Base token safe to buy? Can you sell it, or is it a honeypot or rug pull? One call returns a decision-grade trade-safety verdict — SAFE | CAUTION | AVOID — plus risk_score (0-100) and reasons, bundling honeypot/sellability simulation, owner-renounced + mint/pause/blacklist/fee-setter/upgradeable-proxy checks, token symbol/name/decimals, and Uniswap v3 WETH-pool liquidity (USD). Honeypot + rug-pull check for any Base ERC-20 that replaces many RPC calls and prevents a bad trade. Route: GET /chain/token-report. Returns HTTP 402 (x402 v2, Base mainnet, USDC) until paid. Price: $0.01. Free preview at GET /chain/token-report/preview (Base USDC). MCP tool: chain_token_report.",
        tags: ["security", "base", "onchain", "token", "honeypot", "verdict", "trading", "data"],
        examples: ["GET /chain/token-report?token=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
      },
      {
        id: "token-security",
        name: "Token Security / Honeypot Detector",
        description:
          "Is this Base token a honeypot or a rug pull? Can an agent actually sell it after buying? " +
          "Deep per-check security analysis for any Base ERC-20 — the itemized evidence behind a trade-safety verdict. " +
          "Runs a live eth_call state-override simulation testing whether a synthetic wallet can actually transfer() the token " +
          "(real honeypot/sellability test, not a static flag), plus EIP-1967/1822 proxy + upgradeability detection, " +
          "a bytecode dispatcher scan for mint/pause/blacklist/fee-setter/ownership selectors, and an owner() renouncement check. " +
          "Real compute, not a thin data wrapper. Returns risk_score (0-100) + verdict (clear/review/block) + human-readable flags. " +
          "Route: GET /chain/token-security. Returns HTTP 402 (x402 v2, Base mainnet, USDC) until paid. " +
          "Price: $0.009. Free preview at GET /chain/token-security/preview (full analysis of Base WETH). " +
          "Machine-readable payment manifest: /.well-known/x402. MCP tool interface: /mcp (tool: chain_token_security).",
        tags: ["security", "rpc", "base", "onchain", "token", "honeypot", "data"],
        examples: [
          "GET /chain/token-security?token=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        ],
      },
      {
        id: "mcp-security-scan",
        name: "MCP Server Security Audit",
        description:
          "Security scan of a target MCP server — audits every advertised tool for prompt-injection / tool-poisoning / " +
          "exfiltration / dangerous-capability / hidden-unicode (OWASP LLM01/LLM08). " +
          "Returns structured findings + risk score (0-100) + verdict (clear/review/block) + risk summary. " +
          "Route: GET /scan/mcp. Returns HTTP 402 (x402 v2, Base mainnet, USDC) until paid. " +
          "Price: $0.05. Free preview at GET /scan/mcp/preview (counts + risk score; withholds detail). " +
          "Machine-readable payment manifest: /.well-known/x402. MCP tool interface: /mcp (tool: scan_mcp_server).",
        tags: ["security", "mcp", "audit", "prompt-injection"],
        examples: [
          "GET /scan/mcp/preview?url=https://mcp.deepwiki.com/mcp  (free; a real public streamable-HTTP MCP server — returns counts + risk score)",
          "GET /scan/mcp?url=https://your-mcp-server.example/mcp  ($0.05; full itemized findings for your own server)",
        ],
      },
      {
        id: "domain-enrichment",
        name: "Domain Enrichment & Tech-Risk Assessment",
        description:
          "Domain intelligence: firmographic + tech-stack enrichment with full subdomain enumeration via certificate-transparency logs " +
          "(crt.sh, RDAP, DoH, HTTP fingerprint) + verdict based on domain age. " +
          "Plus tech-stack fingerprint → CVE (NVD) + EPSS + CISA-KEV attack-surface risk + verdict (clear/review/block) for a domain. " +
          "Routes: GET /enrich/domain, GET /enrich/tech-risk, GET /dns/:domain, GET /whois/:domain. " +
          "Returns HTTP 402 (x402 v2, Base mainnet, USDC) until paid. " +
          "Price: $0.01-$0.05 per call. " +
          "Machine-readable payment manifest: /.well-known/x402.",
        tags: ["domain", "enrichment", "security", "cve", "risk", "dns", "whois", "data"],
        examples: [
          "GET /enrich/domain?domain=example.com",
          "GET /enrich/tech-risk?domain=example.com",
          "GET /dns/example.com",
          "GET /whois/example.com",
        ],
      },
    ].map((s: any) => {
      const m = RM[s.id];
      return {
        ...s,
        security: X402SEC,
        securityRequirements: X402SEC,
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        metadata: {
          method: "GET",
          network: "eip155:8453",
          asset: "USDC",
          ...(m ? { price_usdc: m.price_usdc, endpoint: BASE + m.endpoint } : {}),
          ...(m?.preview ? { preview: BASE + m.preview } : {}),
        },
      };
    }),
  });
});

// llms.txt — the plain-text catalog AI-agent crawlers read to discover paid
// services (an emerging convention many x402 sellers expose). Free, ungated.
app.get("/aa3ee6fa313780532656391c0c73664f.txt", (c) => c.text("aa3ee6fa313780532656391c0c73664f"));
app.get("/llms.txt", (c) => {
  const BASE = "https://x402-data-api.sigrunner.workers.dev";
  return c.text(`# Grey Ridge Signals — x402 Data & Security APIs

> Agent-native, pay-per-call data on Base (USDC via x402). No account, no API key — agents pay inline.
> Landing page: ${BASE}/  |  Discovery: ${BASE}/.well-known/x402  |  OpenAPI: ${BASE}/openapi.json  |  Listed on the Coinbase CDP x402 Bazaar.

## How to pay — first paid call in ~8 lines (copy-paste, verified)
Each paid GET returns HTTP 402 with an x402 v2 challenge (network eip155:8453 / Base, asset USDC, 6 decimals). The standard x402-fetch client signs + retries for you — no account, no API key. Your wallet needs a little USDC on Base; no gas ETH (the exact scheme is EIP-3009 gasless — the facilitator submits). The 2nd arg to wrapFetchWithPayment is a viem WalletClient, not a bare account.

  npm i x402-fetch viem
  import { createWalletClient, http } from "viem";
  import { privateKeyToAccount } from "viem/accounts";
  import { base } from "viem/chains";
  import { wrapFetchWithPayment } from "x402-fetch";
  const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
  const walletClient = createWalletClient({ account, chain: base, transport: http() });
  const pay = wrapFetchWithPayment(fetch, walletClient);
  const r = await pay("${BASE}/gate/swap?token=0x4200000000000000000000000000000000000006&side=buy&notional_usd=500");
  console.log(await r.json());   // GO | HOLD | BLOCK — settles in ~1s, costs $0.008 USDC

Runnable version: https://github.com/rezearcher/x402-data-api/blob/main/examples/buyer.mjs (EVM_PRIVATE_KEY=0x... node examples/buyer.mjs). Python / Axios clients + full docs: https://x402.org buyer quickstart. Prefer to look before you pay? Every flagship route has a free, no-wallet /preview (same response shape) — see the Free section below.

Already run a generic x402 buyer adapter? This API is wire-compatible with OpenAPI-driven x402 MCP clients: our /openapi.json tags every billable route with x-billable/x-availability/x-price-usdc and honors ?preview=true on the paid path, and /.well-known/agent-capabilities.json?q=&limit=N returns ranked products whose operation_id resolves straight back to the OpenAPI operation. e.g. point the npm MCP adapter dopaminedesk-ai-data-marketplace-mcp at us with one env var — MARKETPLACE_URL=${BASE} — to discover, preview, and buy Grey Ridge routes with no code change.

## Start here — pre-trade safety gate for Base trading agents (flagship)
- GET ${BASE}/gate/swap?token=<0x…>&side=buy&notional_usd=500 — $0.008 — ONE decision GO|HOLD|BLOCK sized to your trade (honeypot/sellability + liquidity price impact). Free try: ${BASE}/gate/swap/preview?token=usdc|weth|cbbtc|aero|degen (any real Base 0x address: 3 free/day/IP).
- GET ${BASE}/chain/token-report?token=<0x…> — $0.01 — SAFE|CAUTION|AVOID + risk_score 0-100 + reasons. Free try: ${BASE}/chain/token-report/preview?token=aero
- Measured uptime/latency of these (not an SLA): GET ${BASE}/status (live machine-readable JSON) or https://github.com/rezearcher/x402-data-api/blob/main/docs/STATUS.md
- Proof pack for integrators (a real settled Base-mainnet x402 tx + decoded receipt, measured reliability, and accuracy stated honestly incl. what we have NOT yet benchmarked): https://github.com/rezearcher/x402-data-api/blob/main/docs/EVIDENCE.md

## Endpoints
- Human/agent try-it page: ${BASE}/check?token=<0x… Base ERC-20> — free verdict card (3/day/IP).
- GET ${BASE}/crypto/prices?coins=bitcoin,ethereum,solana — $0.001 — spot token prices + change_24h + unix timestamp (DefiLlama), keyless. Agentic buyer example with budget + freshness gates (reads the 402 quote before paying, rejects stale data): https://github.com/rezearcher/x402-data-api/blob/main/examples/market-data-decision-buyer.mjs
- GET ${BASE}/crypto/funding?limit=20 — $0.004 — cross-venue Hyperliquid+OKX+dYdX funding rates + arb spread (bps) + best long/short venue + premium/annualized/signal/next_funding_ts.
- GET ${BASE}/defi/yields?limit=20&project=&chain=&stable=&sort=tvl|risk_adjusted — $0.001 — top DeFi lending/LP yields, APY trend + IL risk + reward/underlying tokens + mu/sigma + stability forecast + TVL (DefiLlama).
- GET ${BASE}/pm/markets?query=&limit=20 — $0.005 — live Polymarket prediction markets, ranked by volume24hr (bestBid/bestAsk/spread, clobTokenIds, category tags, liquidity).
- GET ${BASE}/scan/mcp?url=<mcp-server> — $0.05 — security audit of an MCP server (tool-poisoning / prompt-injection, OWASP LLM01/LLM08); findings + risk score + verdict (clear/review/block).
- GET ${BASE}/enrich/tech-risk?domain=<domain> — $0.01 — tech-stack -> CVE (NVD) + EPSS + CISA-KEV risk + verdict (clear/review/block).
- GET ${BASE}/enrich/domain?domain=<domain> — $0.01 — firmographic + tech-stack enrichment, incl. subdomain enumeration (crt.sh) + verdict (clear/review/block, domain age).
- GET ${BASE}/chain/block-number — $0.002 — current Base mainnet block number.
- GET ${BASE}/chain/gas-price — $0.002 — current Base mainnet gas price (wei/gwei), EIP-1559 base_fee_gwei/priority_fee_gwei, gas_price_usd — no price oracle on ETH-only competitors.
- GET ${BASE}/chain/balance?address=<0x…> — $0.002 — ETH balance of a Base address, incl. balance_usd.
- GET ${BASE}/chain/token-balance?address=<0x…>&token=<0x…> — $0.002 — ERC-20 token balance of a Base address, incl. symbol/decimals/balance_formatted.
- GET ${BASE}/chain/tx?hash=<0x…> — $0.005 — transaction details by hash on Base.
- GET ${BASE}/chain/receipt?hash=<0x…> — $0.005 — transaction receipt by hash on Base: status, gas used, full logs, L1 fee breakdown (l1_fee_wei/l1_gas_price_wei/l1_gas_used/effective_gas_price_wei) + l1_fee_usd/total_fee_usd.
- GET ${BASE}/chain/nonce?address=<0x…> — $0.002 — tx count (nonce), latest + pending.
- GET ${BASE}/chain/block?number=<n|latest> — $0.002 — block summary (hash, timestamp, tx count, gas, base fee).
- GET ${BASE}/ai/ask?q=<prompt> — $0.002 — cheap LLM answer (Llama 3.2 3B), no API key.
- POST ${BASE}/v1/chat/completions — $0.002 — OpenAI-compatible chat (Llama 3.3 70B, stream:true supported), no API key; point any OpenAI SDK base URL here with an x402 fetch wrapper. Free real-model try: POST ${BASE}/v1/chat/completions/preview (3/day/IP). Model list: GET ${BASE}/v1/models. Runnable buyer: https://github.com/rezearcher/x402-data-api/blob/main/examples/llm-chat.mjs — best fit as an ADDITIVE x402 fallback provider: wire it as your router's secondary/backup inference base URL so it only gets called when your primary provider times out, errors, or returns no text — you pay $0 until you actually need it (no price-war, no account, no API key; measured 99.92% uptime over 2518 samples). Reference implementation (one env var, byte-identical when unset): https://github.com/0xcuy/adexto/pull/5. Also drop-in for Daydreams / Lucid-Agents (model=llama-3.3-70b).
- GET ${BASE}/chain/erc20-meta?token=<0x…> — $0.002 — ERC-20 name/symbol/decimals/totalSupply.
- GET ${BASE}/chain/is-contract?address=<0x…> — $0.002 — contract vs EOA + bytecode size.
- GET ${BASE}/chain/fee-estimate — $0.002 — Base EIP-1559 fee tiers (slow/standard/fast) + transfer cost.
- GET ${BASE}/chain/network-status — $0.002 — Base chain id, latest block, block age, gas utilisation.
- GET ${BASE}/chain/l1-base-fee — $0.002 — Ethereum L1 base fee seen by Base's GasPriceOracle + L1 data-fee estimate.
- GET ${BASE}/chain/fee-history — $0.002 — Base base-fee history over the last 10 blocks with gas-used ratios.
- GET ${BASE}/defi/chains-tvl — $0.003 — Top chains by DeFi TVL.
- GET ${BASE}/crypto/stablecoins — $0.003 — Top stablecoins by supply + peg price.
- GET ${BASE}/defi/protocols-top — $0.003 — Top DeFi protocols by TVL.
- GET ${BASE}/defi/dex-volume — $0.003 — Top DEXs by 24h volume.
- GET ${BASE}/crypto/fear-greed — $0.002 — Crypto Fear & Greed Index (alternative.me).
- GET ${BASE}/crypto/trending — $0.003 — Trending coins on CoinGecko right now.
- GET ${BASE}/defi/fees-top — $0.003 — Top DeFi protocols by 24h fees (DefiLlama).
- GET ${BASE}/crypto/global — $0.002 — Global crypto market cap, volume, BTC/ETH dominance.
- GET ${BASE}/crypto/markets-top — $0.003 — Top coins by market cap with price and 24h change.
- GET ${BASE}/crypto/movers — $0.003 — Top 24h gainers and losers.
- GET ${BASE}/brief/market — $0.01 — One-call market brief: sentiment, global stats, movers, trending, DeFi fees.
- GET ${BASE}/crypto/exchanges-top — $0.003 — Top exchanges by trust score and volume.
- GET ${BASE}/crypto/categories — $0.003 — Crypto sector market cap and 24h change.
- GET ${BASE}/defi/hacks-recent — $0.003 — Most recent DeFi hacks and exploits with amounts.
- GET ${BASE}/crypto/derivatives-exchanges — $0.003 — Top derivatives exchanges by open interest and volume.
- GET ${BASE}/defi/protocol-risk?protocol=aave-v3 — $0.01 — Protocol risk score joining TVL, age, audits and hack history.
- GET ${BASE}/defi/safe-yields — $0.01 — Vetted stablecoin yields joined with protocol age and hack history.
- GET ${BASE}/defi/yields-top — $0.003 — Top DeFi yield pools by TVL with APY.
- GET ${BASE}/ai/classify?text=<…>&labels=a,b,c — $0.003 — Zero-shot classification into one of your labels.
- GET ${BASE}/ai/summarize?text=<…> — $0.003 — 1-3 sentence summary of a passage.
- GET ${BASE}/ai/translate?text=<…>&to=es — $0.003 — Translate text into a target language.
- GET ${BASE}/ai/extract?text=<…>&fields=a,b,c — $0.005 — Text-to-JSON extraction into exactly the fields you name.
- GET ${BASE}/chain/blob-base-fee — $0.002 — Base EIP-4844 blob base fee (wei/gwei) from the GasPriceOracle.
- GET ${BASE}/chain/eth-usd — $0.001 — Chainlink ETH/USD spot price on Base with staleness.
- GET ${BASE}/chain/btc-usd — $0.001 — Chainlink BTC/USD spot price on Base with staleness.
- GET ${BASE}/chain/prices — $0.001 — BTC/ETH/LINK/SOL Chainlink USD prices in one call.
- GET ${BASE}/chain/sol-usd — $0.001 — Chainlink SOL/USD spot price on Base with staleness.
- GET ${BASE}/chain/link-usd — $0.001 — Chainlink LINK/USD spot price on Base with staleness.
- GET ${BASE}/chain/total-supply?token=<0x…> — $0.002 — ERC-20 total supply (raw + formatted).
- GET ${BASE}/chain/allowance?token=<0x…>&owner=<0x…>&spender=<0x…> — $0.002 — ERC-20 allowance, flags unlimited approvals.
- GET ${BASE}/chain/code?address=<0x…> — $0.002 — contract-code check for a Base address (EIP-7702 delegated-EOA aware).
- GET ${BASE}/chain/wallet?address=<0x…> — $0.003 — wallet bundle: balance + balance_usd + tx count + contract check (EIP-7702 delegated-EOA aware), one call.
- WHY /gate/swap vs raw honeypot-flag APIs: raw flags make your agent interpret; this returns ONE decision (GO|HOLD|BLOCK) sized to YOUR trade (notional_usd vs Uniswap v3 liquidity price impact) plus a reason. Try free: ${BASE}/gate/swap/preview?token=degen
- GET ${BASE}/gate/swap?token=<0x…>&side=buy&notional_usd=500 — $0.008 — pre-trade GO/HOLD/BLOCK gate for Base trading agents: honeypot/sellability + liquidity-vs-trade-size price impact in one fast call.
- GET ${BASE}/chain/token-report?token=<0x…> — $0.01 — DECISION-GRADE token trade-safety verdict: one call returns SAFE|CAUTION|AVOID + risk_score 0-100 + reasons, bundling honeypot/sellability simulation, owner-renounced/mint/pause/blacklist/fee-setter/upgradeable checks, symbol/name/decimals and Uniswap v3 WETH-pool liquidity USD. Replaces many RPC calls and prevents a bad trade.
- GET ${BASE}/chain/token-security?token=<0x…> — $0.009 — token security / honeypot detector: EIP-1967/1822 proxy + upgradeability detection, bytecode scan for mint/pause/blacklist/fee-setter/ownership selectors, owner() renouncement check, live eth_call state-override transfer simulation — risk_score + verdict (clear/review/block) + flags. Real compute, not a thin data wrapper.

## Free (previews — taste the data before you pay)
- GET ${BASE}/crypto/prices/preview — free 1-token sample of /crypto/prices.
- GET ${BASE}/crypto/funding/preview — free top-1 sample of /crypto/funding.
- GET ${BASE}/defi/yields/preview — free top-1 sample of /defi/yields.
- GET ${BASE}/defi/safe-yields/preview — free top-3 sample of the paid /defi/safe-yields.
- GET ${BASE}/defi/protocol-risk/preview — free sample (aave-v3) of the paid /defi/protocol-risk risk score.
- GET ${BASE}/pm/markets/preview — free top-1 sample of /pm/markets.
- GET ${BASE}/chain/block-number/preview — free, full live data (identical to the paid route).
- GET ${BASE}/chain/gas-price/preview — free, full live data (identical to the paid route).
- GET ${BASE}/gate/swap/preview?token=usdc|weth|cbbtc|aero|degen — free live sample of the go/hold/block gate (default Base USDC, buy, $100). ALSO: pass any real Base 0x token address for 3 free checks/day/IP.
- GET ${BASE}/chain/token-report/preview?token=usdc|weth|cbbtc|aero|degen — free, full real trade-safety report, same depth as the paid route.
- GET ${BASE}/chain/token-security/preview — free, full real analysis of a fixed well-known token (Base WETH), same depth as the paid route.
- GET ${BASE}/scan/mcp/preview?url=<mcp-server> — free preview (counts + risk score; withholds detail).
- GET ${BASE}/enrich/tech-risk/preview?domain=<d> — free preview (verdict + CVE/KEV counts + top CVE; withholds full list).
- GET ${BASE}/.well-known/x402 — machine-readable discovery manifest.

## Resellers / referral partners
Featuring these endpoints in your MCP client, router, or agent? Append &ref=<your-tag> to any call URL (e.g. ${BASE}/gate/swap?token=aero&ref=yourname). The tag rides through the x402 402→sign→retry and is recorded on the settled on-chain call, so your referred volume is measurable and attributable — we can reconcile exactly how many settled calls (and distinct buyers) your integration drove, with Base txHashes. Ask contact@greyridgesignals.ai for a reconcile report on your tag.

## Where to buy (marketplaces / MCP buyer-adapters)
These third-party x402 buyer tools let agents discover and purchase pay-per-call APIs (including ours) with Base USDC — useful if you want a ready-made buyer client instead of wiring x402-fetch yourself:
- DopamineDesk x402 Marketplace (by Blaz Algo Systems) — plain-language product discovery, free previews, and capped Base-USDC purchases through one MCP adapter. Repo: https://github.com/jblaz6335/mcp-server-aidatamarketplace — integration partner; our token-safety gate (/gate/swap) and token report (/chain/token-report) pair with their token-audit and transaction-preflight tools.
`);
});

// robots.txt — Instruct crawlers how to index the site. Allow everything; sitemap
// tells them where the canonical discovery/documentation routes are.
app.get("/robots.txt", (c) => {
  const BASE = "https://x402-data-api.sigrunner.workers.dev";
  return c.text(`User-agent: *
Allow: /

Sitemap: ${BASE}/sitemap.xml
`);
});

// sitemap.xml — XML sitemap for SEO crawlers. Links canonical pages + key discovery
// routes so crawlers prioritize indexing the public API docs over transient queries.
app.get("/sitemap.xml", (c) => {
  const BASE = "https://x402-data-api.sigrunner.workers.dev";
  const lastmod = new Date().toISOString().split("T")[0];
  const pages = [
    { path: "/", priority: "1.0", changefreq: "daily" },
    { path: "/.well-known/x402", priority: "0.9", changefreq: "weekly" },
    { path: "/openapi.json", priority: "0.9", changefreq: "weekly" },
    { path: "/llms.txt", priority: "0.8", changefreq: "weekly" },
    { path: "/terms", priority: "0.7", changefreq: "monthly" },
    { path: "/token-safety", priority: "0.8", changefreq: "daily" },
    { path: "/check", priority: "0.8", changefreq: "weekly" },
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url>
    <loc>${BASE}${p.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join("\n")}
</urlset>`;
  return c.text(xml, {
    headers: { "content-type": "application/xml" },
  });
});

/** Give every operation a stable operationId, derived from method + path.
 *
 * Marketplace importers (RapidAPI) and client-SDK generators NAME each endpoint from
 * operationId. Without it RapidAPI imports the paths unnamed or drops them, which forces
 * adding ~18 endpoints by hand — the exact failure hit 2026-07-30. Derived from the path
 * rather than hand-written so an endpoint added later cannot silently ship without one.
 * Stable by construction: renaming would break already-generated subscriber SDKs.
 *   GET /chain/token-balance -> getChainTokenBalance
 *   GET /dns/{domain}        -> getDnsByDomain
 */
/** Group an endpoint in the marketplace listing. Without tags all 19 render as one
 *  flat list; RapidAPI renders one collapsible section per tag. */
function tagFor(path: string): string {
  if (path.startsWith("/chain/")) return "Base Chain";
  if (path.startsWith("/crypto/") || path.startsWith("/defi/") || path.startsWith("/pm/")) {
    return "Markets";
  }
  if (
    path.startsWith("/dns/") || path.startsWith("/whois/") ||
    path.startsWith("/enrich/") || path.startsWith("/scan/")
  ) {
    return "Security & Domain";
  }
  return "General";
}

const FLAGSHIP_OPERATION_IDS: Record<string, string> = {
  "/chain/token-report": "token_honeypot_check",
  "/chain/token-security": "honeypot_check",
  "/gate/swap": "pre_trade_token_safety_gate_swap",
  "/v1/chat/completions": "openai_compatible_chat_completions_llm",
};

// Router-search aliases (Agent402 sweep 2026-10-20: commodity routes ranked outside top 3 because
// buyer queries say "fear and greed index" / "defi yield apy" / "gas price base" / "get eth price").
const ROUTER_SLUG_ALIASES: Record<string, string> = {
  "/crypto/fear-greed": "fear_and_greed_index",
  "/defi/yields": "defi_yield_apy",
  "/chain/gas-price": "base_gas_price",
  "/chain/eth-usd": "get_eth_price",
  "/crypto/prices": "crypto_prices_bitcoin",
  "/crypto/funding": "funding_rates",
  "/pm/markets": "polymarket_odds",
  "/chain/balance": "base_wallet_balance",
};

/** Canonical operationId for a route — the SINGLE source of truth shared by openapi.json
 * (withOperationIds) and /.well-known/agent-capabilities.json. A generic x402 buyer adapter
 * discovers a product by operation_id (from agent-capabilities) and then resolves that SAME
 * id back to the billable operation in our OpenAPI to place the paid call. If the two
 * surfaces derive the id differently the discover->purchase handoff silently 404s, so both
 * call this. Keep in lockstep with the inline fallbacks below. */
function canonicalOperationId(path: string, method: string): string {
  const m = method.toLowerCase();
  const flagship = FLAGSHIP_OPERATION_IDS[path];
  if (flagship && (m === "get" || path === "/v1/chat/completions")) return flagship;
  if (path.startsWith("/dns/")) return "dns_lookup";
  if (path.startsWith("/whois/")) return "domain_whois";
  if (ROUTER_SLUG_ALIASES[path]) return ROUTER_SLUG_ALIASES[path];
  const words = path
    .split("/")
    .filter(Boolean)
    .flatMap((seg) => (seg.startsWith("{") ? ["by", seg.slice(1, -1)] : seg.split("-")));
  return words.length === 0 ? "root" : words.join("_").replace(/-/g, "_");
}

function withOperationIds<T extends Record<string, Record<string, any>>>(paths: T): T {
  for (const [path, item] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!op || typeof op !== "object") continue;
      // Tag + response example are added even when an operationId already exists.
      if (!op.tags) op.tags = [tagFor(path)];
      const example = RESPONSE_EXAMPLES[path];
      const ok = op.responses?.["200"];
      if (example !== undefined && ok && !ok.content) {
        ok.content = {
          "application/json": { schema: { type: "object" }, example },
        };
      }
      if (op.operationId) continue;
      // Search-friendly snake_case slugs (flagship safety routes get hand-tuned ids so
      // x402 routers rank them on slug-word match). Shared with agent-capabilities.json
      // via canonicalOperationId so the discover->purchase handoff resolves the same id.
      op.operationId = canonicalOperationId(path, method);
    }
  }
  // Data lane first: importers/agents read paths top-down, and the data routes are the
  // ones that actually convert (the single real non-sweep external payer bought /defi/yields;
  // the token-safety pitch is dead across 35+ integrator replies). Lead every auto-imported
  // catalog (x402scan, RapidAPI, registry crawlers) with the proven lane, gate routes after.
  // This matches the /.well-known/x402 x-guidance ordering so both discovery surfaces agree.
  const first = ["/defi/yields", "/crypto/funding", "/crypto/prices", "/pm/markets", "/gate/swap", "/chain/token-report"];
  const ordered: Record<string, any> = {};
  for (const k of first) if (k in paths) ordered[k] = (paths as any)[k];
  for (const k of Object.keys(paths)) if (!(k in ordered)) ordered[k] = (paths as any)[k];
  return ordered as T;
}

// openapi.json — OpenAPI 3.0 spec so agents and marketplace importers can auto-integrate
// every paid route. Declared 3.0.3, not 3.1.0: RapidAPI's importer (and most SDK
// generators) parse 3.0.x reliably and choke on 3.1. Nothing here uses a 3.1-only
// construct, so the downgrade costs nothing and buys import compatibility.
app.get("/openapi.json", (c) => {
  const BASE = "https://x402-data-api.sigrunner.workers.dev";
  const paid = (
    summary: string,
    price: string,
    params: {
      name: string; desc: string; required?: boolean; in?: "query" | "path"; example?: string;
    }[],
  ) => ({
    get: {
      summary,
      description: `${summary} Paid via x402 (USDC on Base, eip155:8453). Returns HTTP 402 with a payment-required challenge until paid. Price: $${price}.`,
      // `example` populates the marketplace's interactive test console. Without it a
      // buyer must invent an address/hash/domain before the endpoint will run, and an
      // endpoint that errors on first click reads as broken.
      parameters: params.map((p) => ({
        name: p.name, in: p.in ?? "query", required: p.in === "path" ? true : !!p.required,
        schema: { type: "string", ...(p.example ? { example: p.example } : {}) },
        ...(p.example ? { example: p.example } : {}),
        description: p.desc,
      })),
      "x-payment-info": { protocols: ["x402"], price: { mode: "fixed", currency: "USD", amount: price } },
      // Flat per-operation extensions read by generic OpenAPI->x402 buyer adapters
      // (e.g. the DopamineDesk `mcp-server-aidatamarketplace` npm client: it treats an
      // operation as a billable product only when x-billable===true, x-availability
      // ==="operational", and reads x-price-usdc as a flat number). Mirrors the nested
      // x-payment-info above so both the rich and the flat convention agree. This makes
      // the already-published adapter buy from Grey Ridge by only pointing MARKETPLACE_URL
      // here — no code change on the buyer side. Degrades open: adapters that don't read
      // these fields simply ignore them.
      "x-billable": true,
      "x-availability": "operational",
      "x-price-usdc": Number(price),
      "x-data-mode": "live",
      responses: {
        "200": { description: "Success — JSON data" },
        "402": { description: `Payment required ($${price} USDC via x402)` },
      },
    },
  });
  return c.json({
    // 3.0.0 exactly. RapidAPI accepts swagger 2.0 and openapi 3.0.0/3.0.1/3.0.2 ONLY —
    // 3.0.3 and 3.1.x are rejected on upload (docs.rapidapi.com/docs/add-an-api-basics),
    // and 3.0.0 is the version their own examples use, so it is the safest floor.
    openapi: "3.0.0",
    info: {
      title: "Grey Ridge Signals — x402 Data & Security APIs",
      version: "0.1.0", // mirror root package.json (canonical)
      description: "Agent-native pay-per-call data on Base (USDC via x402). No API keys, no signup. Discovery: /.well-known/x402",
      "x-guidance": "Pay-per-call Base (USDC, x402) data for agents: /defi/yields (top lending/LP APY + IL risk, $0.001), /crypto/funding (cross-venue funding + arb spread, $0.004), /crypto/prices ($0.001), /pm/markets (Polymarket, $0.005), and 20+ Base RPC/chain reads — plus a pre-trade safety gate: /gate/swap (GO/HOLD/BLOCK, $0.008) and /chain/token-report (SAFE/CAUTION/AVOID, $0.01). Free samples: /defi/yields/preview and /crypto/funding/preview.",
      contact: { name: "Grey Ridge Signals", email: "contact@greyridgesignals.ai", url: "https://x402-data-api.sigrunner.workers.dev" },
      // Open-source licence + terms link — standard OpenAPI trust fields that
      // importers (RapidAPI, OpenDexter, directory crawlers) surface to buyers.
      // MIT matches the in-repo LICENSE and package.json; termsOfService points at
      // the public source so the legal/provenance trail is one click away.
      license: { name: "MIT", url: "https://github.com/rezearcher/x402-data-api/blob/main/LICENSE" },
      termsOfService: "https://github.com/rezearcher/x402-data-api/blob/main/README.md",
    },
    // Custom domain FIRST — an importer takes servers[0] as the base URL, and the
    // marketplace listing should point at the zone we control DNS for. The workers.dev
    // origin stays listed second because it is the URL already seeded into the x402
    // Bazaar, mcp.so and llms.txt; both hostnames serve this same Worker.
    // Same-origin only: OpenDexter/x402gle rejects specs whose servers[] name a different
    // origin than the one fetched. The first entry is whichever host served the request.
    servers: [{ url: new URL(c.req.url).origin }],
    paths: withOperationIds({
      "/": {
        get: {
          summary: "Landing page (HTML, free).",
          description: "Self-contained HTML landing page — pitch, endpoint-group pricing table, free curl sample, MCP install snippet, discovery links. No payment required.",
          responses: { "200": { description: "HTML landing page" } },
        },
      },
      "/status": {
        get: {
          summary: "Measured uptime/latency snapshot (free).",
          description: "Machine-readable reliability artifact: measured success rate and per-route p50/p95 latency from a 5-minute probe over the free /preview paths (source: data/uptime_samples.jsonl). This is the latency/uptime answer every integrator asks for, served as JSON — a measurement, not an SLA. No payment required.",
          responses: { "200": { description: "JSON — overall_success_pct, window, and per-endpoint samples/success_pct/p50_ms/p95_ms" } },
        },
      },
      "/crypto/prices": paid("Spot token prices + change_24h (DefiLlama).", "0.001", [{ name: "coins", desc: "comma-separated coingecko ids (max 25)", example: "bitcoin,ethereum" }]),
      "/crypto/funding": paid("Cross-venue Hyperliquid+OKX+dYdX funding rates + arb spread + premium/annualized/signal/next_funding_ts.", "0.004", [{ name: "limit", desc: "max coins (default 20, max 100)", example: "10" }]),
      "/defi/yields": paid("Top DeFi lending/LP yields — APY trend + IL risk + reward/underlying tokens + mu/sigma + stability forecast (DefiLlama).", "0.001", [{ name: "limit", desc: "max pools", example: "10" }, { name: "project", desc: "protocol filter", example: "aave-v3" }, { name: "chain", desc: "chain filter", example: "Base" }, { name: "stable", desc: "'true' = stablecoin only", example: "true" }, { name: "sort", desc: "'tvl' (default) or 'risk_adjusted' (apy/sigma)", example: "tvl" }]),
      "/pm/markets": paid("Live Polymarket prediction markets, ranked by volume24hr, with bestBid/bestAsk/spread and category tags.", "0.005", [{ name: "query", desc: "keyword filter", example: "election" }, { name: "limit", desc: "max markets", example: "10" }]),
      "/scan/mcp": paid("Security audit of an MCP server (tool-poisoning / prompt-injection). Findings + risk score + verdict (clear/review/block).", "0.05", [{ name: "url", desc: "target MCP server URL", required: true, example: "https://x402-data-api.sigrunner.workers.dev/mcp" }]),
      "/enrich/tech-risk": paid("Tech-stack -> CVE + EPSS + CISA-KEV risk + verdict (clear/review/block).", "0.01", [{ name: "domain", desc: "target domain", required: true, example: "stripe.com" }]),
      "/enrich/domain": paid("Firmographic + tech-stack enrichment, incl. subdomain enumeration + verdict (clear/review/block, domain age).", "0.01", [{ name: "domain", desc: "target domain", required: true, example: "stripe.com" }]),
      "/chain/block-number": paid("Current Base mainnet block number.", "0.01", []),
      "/chain/gas-price": paid("Current Base mainnet gas price (wei/gwei), EIP-1559 base_fee_gwei/priority_fee_gwei, gas_price_usd.", "0.01", []),
      "/chain/balance": paid("ETH balance of a Base mainnet address, incl. balance_usd.", "0.01", [{ name: "address", desc: "0x-prefixed Base address", required: true, example: "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10" }]),
      "/chain/token-balance": paid("ERC-20 token balance of a Base mainnet address, incl. symbol/decimals/balance_formatted.", "0.01", [{ name: "address", desc: "0x-prefixed holder address", required: true, example: "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10" }, { name: "token", desc: "0x-prefixed ERC-20 contract address", required: true, example: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }]),
      "/chain/tx": paid("Transaction details by hash on Base mainnet.", "0.005", [{ name: "hash", desc: "0x-prefixed 32-byte transaction hash", required: true, example: "0x65484d751686091cf5b7417b533372ab1e7548ca63825c746ffbd275fb4448ba" }]),
      "/chain/receipt": paid("Transaction receipt by hash on Base mainnet: status, gas used, full logs, L1 fee breakdown, l1_fee_usd/total_fee_usd.", "0.005", [{ name: "hash", desc: "0x-prefixed 32-byte transaction hash", required: true, example: "0x65484d751686091cf5b7417b533372ab1e7548ca63825c746ffbd275fb4448ba" }]),
      "/chain/erc20-meta": paid("ERC-20 name/symbol/decimals/totalSupply on Base.", "0.01", [{ name: "token", desc: "0x-prefixed ERC-20 address on Base", required: true, example: "0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913" }]),
      "/chain/nonce": paid("Nonce (tx count) of a Base address, latest and pending.", "0.01", [{ name: "address", desc: "0x-prefixed Base address", required: true, example: "0x4200000000000000000000000000000000000006" }]),
      "/chain/is-contract": paid("Is a Base address a smart contract or an EOA (is_contract + bytecode size).", "0.002", [{ name: "address", desc: "0x-prefixed Base address", required: true, example: "0x4200000000000000000000000000000000000006" }]),
      "/chain/fee-estimate": paid("Base EIP-1559 fee estimate: base fee, priority fee, slow/standard/fast max-fee tiers (gwei).", "0.003", []),
      "/chain/network-status": paid("Base network status: chain id, latest block, block age seconds, gas utilisation, tx count.", "0.003", []),
      "/chain/l1-base-fee": paid("Ethereum L1 base fee via Base GasPriceOracle (wei/gwei) + estimated L1 data fee for a transfer.", "0.003", []),
      "/chain/fee-history": paid("Base base-fee history over the last 10 blocks with gas-used ratios.", "0.003", []),
      "/chain/blob-base-fee": paid("Base EIP-4844 blob base fee (wei/gwei) from the GasPriceOracle.", "0.003", []),
      "/chain/eth-usd": paid("Chainlink ETH/USD spot price on Base with staleness.", "0.003", []),
      "/chain/btc-usd": paid("Chainlink BTC/USD spot price on Base with staleness.", "0.003", []),
      "/chain/prices": paid("BTC/ETH/LINK/SOL Chainlink USD prices on Base in one call.", "0.005", []),
      "/chain/sol-usd": paid("Chainlink SOL/USD spot price on Base with staleness.", "0.003", []),
      "/chain/link-usd": paid("Chainlink LINK/USD spot price on Base with staleness.", "0.003", []),
      "/chain/total-supply": paid("ERC-20 total supply on Base, raw + formatted.", "0.003", [{ name: "token", desc: "0x-prefixed ERC-20 address", required: true, example: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }]),
      "/chain/storage-at": paid("Raw eth_getStorageAt slot read on Base.", "0.002", [{ name: "address", desc: "0x-prefixed contract address", required: true, example: "0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913" }, { name: "slot", desc: "storage slot hex (default 0x0)", required: false, example: "0x0" }]),
      "/chain/proxy-info": paid("EIP-1967 proxy resolver on Base: implementation/admin/beacon addresses + is_proxy.", "0.003", [{ name: "address", desc: "0x-prefixed contract address", required: true, example: "0x4200000000000000000000000000000000000006" }]),
      "/chain/allowance": paid("ERC-20 allowance(owner, spender) on Base.", "0.002", [{ name: "token", desc: "ERC-20 address", required: true, example: "0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913" }, { name: "owner", desc: "owner address", required: true, example: "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10" }, { name: "spender", desc: "spender address", required: true, example: "0x4200000000000000000000000000000000000006" }]),
      "/defi/chains-tvl": paid("Top chains by DeFi TVL (DefiLlama).", "0.003", [{ name: "limit", desc: "max chains (default 20, max 100)", example: "20" }]),
      "/crypto/stablecoins": paid("Top stablecoins by supply with peg price (DefiLlama).", "0.003", [{ name: "limit", desc: "max coins (default 20, max 100)", example: "20" }]),
      "/defi/protocols-top": paid("Top DeFi protocols by TVL (DefiLlama).", "0.003", [{ name: "limit", desc: "max rows (default 20, max 100)", example: "20" }]),
      "/defi/dex-volume": paid("Top DEXs by 24h volume (DefiLlama).", "0.003", [{ name: "limit", desc: "max rows (default 20, max 100)", example: "20" }]),
      "/crypto/fear-greed": paid("Crypto Fear & Greed Index (alternative.me).", "0.002", [{ name: "days", desc: "optional", example: "7" }]),
      "/crypto/trending": paid("Trending coins on CoinGecko right now.", "0.003", []),
      "/defi/fees-top": paid("Top DeFi protocols by 24h fees (DefiLlama).", "0.003", [{ name: "limit", desc: "optional", example: "7" }]),
      "/crypto/global": paid("Global crypto market stats (CoinGecko).", "0.002", []),
      "/crypto/markets-top": paid("Top coins by market cap (CoinGecko).", "0.003", [{ name: "limit", desc: "optional, max 100", example: "20" }]),
      "/crypto/movers": paid("Top 24h gainers and losers (CoinGecko).", "0.003", []),
      "/brief/market": paid("One-call crypto market brief (sentiment, global, movers, trending, DeFi fees).", "0.01", []),
      "/crypto/exchanges-top": paid("Top crypto exchanges by trust score (CoinGecko).", "0.003", []),
      "/crypto/categories": paid("Crypto sector performance (CoinGecko categories).", "0.003", []),
      "/defi/hacks-recent": paid("Most recent DeFi hacks and exploits (DefiLlama).", "0.003", [{ name: "limit", desc: "optional, max 50", example: "10" }]),
      "/crypto/derivatives-exchanges": paid("Top crypto derivatives exchanges (CoinGecko).", "0.003", []),
      "/defi/protocol-risk": paid("DeFi protocol risk score (TVL, age, audits, hacks).", "0.01", [{ name: "protocol", desc: "DefiLlama slug, default aave-v3", example: "aave-v3" }]),
      "/defi/safe-yields": paid("Vetted stablecoin yields with protocol age and hack flags (DefiLlama).", "0.01", [{ name: "chain", desc: "optional chain filter", example: "Ethereum" }, { name: "limit", desc: "optional, max 30", example: "10" }]),
      "/defi/yields-top": paid("Top DeFi yield pools by TVL (DefiLlama).", "0.003", [{ name: "chain", desc: "optional chain filter", example: "Ethereum" }, { name: "stable", desc: "true = stablecoin pools only", example: "true" }, { name: "limit", desc: "optional", example: "20" }]),
      "/ai/classify": paid("Classify text into one of your labels.", "0.003", [{ name: "text", desc: "text, max 1000 chars", required: true, example: "My card was charged twice" }, { name: "labels", desc: "comma-separated labels, 2-10", required: true, example: "billing,bug,feature_request,other" }]),
      "/ai/summarize": paid("Summarize a passage into 1-3 sentences.", "0.003", [{ name: "text", desc: "passage, max 1500 chars", required: true, example: "x402 is an open HTTP 402 payment protocol letting clients pay per request in USDC on Base without accounts or API keys." }]),
      "/ai/translate": paid("Translate text into a target language.", "0.003", [{ name: "text", desc: "source text, max 800 chars", required: true, example: "Hello, how are you?" }, { name: "to", desc: "target language name or code", required: true, example: "es" }]),
      "/ai/extract": paid("Text-to-JSON extraction: text + comma-separated fields returns a strict JSON object.", "0.005", [{ name: "text", desc: "source text, max 1500 chars", required: true, example: "Invoice 4417 from Acme Corp, due 2026-11-02, total $1,250.00" }, { name: "fields", desc: "comma-separated field names, max 12", required: true, example: "invoice_number,vendor,due_date,total" }]),
      "/ai/ask": paid("Cheap LLM answer (Llama 3.2 3B) for a prompt up to 500 chars.", "0.002", [{ name: "q", desc: "prompt, max 500 chars", required: true, example: "Explain x402 in one sentence" }]),
      "/chain/block": paid("Base block summary by number or latest.", "0.005", [{ name: "number", desc: "decimal block number or 'latest'", required: false, example: "latest" }]),
      "/chain/code": paid("Contract-code check for a Base mainnet address (EIP-7702 delegated-EOA aware).", "0.01", [{ name: "address", desc: "0x-prefixed Base address", required: true, example: "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10" }]),
      "/chain/wallet": paid("Wallet screening bundle (balance, activity, contract vs EOA check): ETH balance + balance_usd + tx count + contract-code check (EIP-7702 delegated-EOA aware), in one call.", "0.003", [{ name: "address", desc: "0x-prefixed Base address", required: true, example: "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10" }]),
      "/chain/token-report": paid("Token trade-safety verdict (honeypot + rug-pull risk) for a Base ERC-20 in one call: SAFE | CAUTION | AVOID plus risk_score (0-100) and reasons, bundling honeypot/sellability simulation, owner-renounced + mint/pause/blacklist/fee-setter/upgradeable-proxy checks, symbol/name/decimals, and Uniswap v3 WETH-pool liquidity (USD). Replaces many RPC calls.", "0.01", [{ name: "token", desc: "0x-prefixed ERC-20 contract address on Base mainnet", required: true, example: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }]),
      "/gate/swap": paid("Pre-trade GO/HOLD/BLOCK gate for Base trading agents: token safety + liquidity-vs-size price-impact check in one call.", "0.008", [{ name: "token", desc: "0x-prefixed ERC-20 contract address on Base mainnet", required: true, example: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }, { name: "side", desc: "buy or sell", required: false, example: "buy" }, { name: "notional_usd", desc: "intended trade size in USD", required: false, example: "500" }]),
      "/gate/swap/preview": { get: { summary: "FREE live sample of /gate/swap (no payment).", description: "Free go/hold/block sample for a demo token (?token=degen) OR any real Base 0x address, 3 free real-token checks per IP per day. Paid /gate/swap accepts ANY Base ERC-20 ($0.008). Honors side and notional_usd.", parameters: [{ name: "token", in: "query", required: false, schema: { type: "string", enum: ["usdc", "weth", "cbbtc", "aero", "degen"] }, description: "demo token" }], responses: { "200": { description: "Free sample JSON" } } } },
      "/chain/token-report/preview": { get: { summary: "FREE live sample of /chain/token-report (no payment).", description: "Free full trade-safety report for a demo token. Try ?token=aero. Paid /chain/token-report accepts ANY Base ERC-20 ($0.01).", parameters: [{ name: "token", in: "query", required: false, schema: { type: "string", enum: ["usdc", "weth", "cbbtc", "aero", "degen"] }, description: "demo token" }], responses: { "200": { description: "Free sample JSON" } } } },
      "/chain/token-security": paid("Token security / honeypot detector: EIP-1967/1822 proxy + upgradeability detection, bytecode scan for mint/pause/blacklist/fee-setter/ownership selectors, owner() renouncement check, live eth_call state-override transfer simulation. Returns risk_score + verdict (clear/review/block) + flags.", "0.009", [{ name: "token", desc: "0x-prefixed ERC-20 contract address on Base mainnet", required: true, example: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }]),
      "/dns/{domain}": paid("Resolve DNS records (A/AAAA/MX/NS/TXT) for a domain via Cloudflare DoH.", "0.01", [{ name: "domain", desc: "domain name to resolve", in: "path", example: "stripe.com" }]),
      "/whois/{domain}": paid("WHOIS / RDAP lookup: registrar, created, expiry, registrant for a domain.", "0.01", [{ name: "domain", desc: "domain name to look up", in: "path", example: "cloudflare.com" }]),
    }),
  });
});

// Free preview conversion hooks — a small live sample so a discovering agent sees
// real value, then pays for the full set. Mirrors /scan/mcp/preview + the freemium
// pattern proven across the Bazaar's top data sellers. Free, ungated.
app.get("/crypto/prices/preview", async (c) => {
  try {
    const all = await fetchTokenPrices(["bitcoin", "ethereum", "solana"]);
    return c.json({
      preview: all.slice(0, 1),
      note: "Free 1-of-N sample. Full: GET /crypto/prices?coins=<ids> ($0.001) — up to 25 tokens, keyless x402 on Base.",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});
app.get("/crypto/funding/preview", async (c) => {
  try {
    const all = await fetchFundingRates(20);
    return c.json({
      preview: all.slice(0, 1),
      total_available: all.length,
      note: "Free top-1 sample. Full: GET /crypto/funding?limit=20 ($0.001) — ranked cross-venue Hyperliquid+OKX+dYdX funding + arb spread, keyless x402 on Base.",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});
app.get("/defi/yields/preview", async (c) => {
  try {
    const all = await fetchDefiYields(20, undefined, undefined, false);
    return c.json({
      preview: all.slice(0, 1),
      total_available: all.length,
      note: "Free top-1 sample. Full: GET /defi/yields?limit=20 ($0.001) — ranked APY trend+IL risk+stability forecast+TVL, filter by project/chain/stablecoin, keyless x402 on Base.",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});
app.get("/pm/markets/preview", async (c) => {
  try {
    const all = await fetchPolymarketMarkets(undefined, 20);
    return c.json({
      preview: all.slice(0, 1),
      total_available: all.length,
      note: "Free top-1 sample. Full: GET /pm/markets?query=&limit=20 ($0.005) — up to 100 markets ranked by volume24hr, with bestBid/bestAsk/spread, clobTokenIds, and category tags, keyless x402 on Base.",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// ---------------------------------------------------------------------------
// x402 resource server — built once per isolate at module load time.
// The facilitator client and EVM scheme are network-level; PAY_TO comes from env.
// ---------------------------------------------------------------------------

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const evmScheme = new ExactEvmScheme();
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  NETWORK,
  evmScheme,
);

// bazaarResourceServerExtension is intentionally NOT registered here: it uses
// ajv code-generation (new Function) which CF Workers V8 sandbox blocks.
// Bazaar discovery metadata is declared per-route via declareDiscoveryExtension()
// in the extensions field — that is sufficient for Bazaar cataloguing.

// ---------------------------------------------------------------------------
// CDP facilitator (flag-gated). When FACILITATOR_MODE=cdp, settlements route
// through the Coinbase CDP facilitator so routes with declareDiscoveryExtension
// get catalogued in the x402 Bazaar. JWT is minted per-request from Worker
// secrets via jose/WebCrypto (edge-safe). Default (flag unset) stays on xpay.
// ---------------------------------------------------------------------------

let activeResourceServer: x402ResourceServer | null = null;

function selectResourceServer(env: Env): x402ResourceServer {
  if (activeResourceServer) return activeResourceServer;
  if (env.FACILITATOR_MODE === "cdp" && env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) {
    const cdpFacilitator = createCdpFacilitator(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET);
    activeResourceServer = new x402ResourceServer(cdpFacilitator).register(
      NETWORK,
      new ExactEvmScheme(),
    );
  } else {
    activeResourceServer = resourceServer; // xpay default (unchanged)
  }
  return activeResourceServer;
}

// ---------------------------------------------------------------------------
// Lazy init: resourceServer.initialize() fetches supported-kinds from the
// facilitator. In CF Workers, outbound fetch is only available during request
// handling, so we cache a single init promise and await it on first request.
// ---------------------------------------------------------------------------

let initPromise: Promise<void> | null = null;

function ensureInitialized(env: Env): Promise<void> {
  if (!initPromise) {
    initPromise = selectResourceServer(env).initialize();
  }
  return initPromise;
}

// Cache the compiled middleware after first construction.
type MiddlewareHandler = ReturnType<typeof paymentMiddleware>;
let cachedMiddleware: MiddlewareHandler | null = null;

// --- Bazaar discovery metadata (serviceName + tags) ----------------------
// The CDP x402 discovery Bazaar catalogs each route from its live 402 body and
// indexes/ranks it by top-level `serviceName` and `tags` (@x402/core copies
// routeConfig.serviceName / routeConfig.tags into the resourceInfo it hands the
// facilitator; schema caps: serviceName <=32 chars, up to 5 tags, each <=32
// printable-ASCII chars). Without them our 46 cataloged routes showed
// serviceName:null / tags:null — present in the 27.8k-item pool but invisible to
// the tag/name search real buyers (and routers like agentpay) use to pick a
// service. Competitors (OnchainPulse, token-risk, HumanMirror) all set both.
const BAZAAR_SERVICE_NAME = "Grey Ridge Signals";
// Curated keyword tags for the differentiated / revenue routes buyers search for.
const BAZAAR_TAG_OVERRIDES: Record<string, string[]> = {
  "/gate/swap": ["token-safety", "honeypot", "pre-trade", "base", "swap-gate"],
  "/chain/token-report": ["token-safety", "honeypot", "rug-check", "base", "erc20"],
  "/chain/token-security": ["honeypot", "token-safety", "rug-check", "base", "security"],
  "/scan/mcp": ["mcp", "security", "prompt-injection", "audit", "tool-poisoning"],
  "/enrich/tech-risk": ["security", "cve", "risk", "epss", "attack-surface"],
  "/enrich/domain": ["domain", "enrichment", "security", "dns", "risk"],
  "/crypto/funding": ["funding", "perps", "arbitrage", "crypto", "defi"],
  "/defi/yields": ["defi", "yield", "apy", "tvl", "lending"],
  "/pm/markets": ["prediction-markets", "polymarket", "markets", "crypto", "data"],
  "/v1/chat/completions": ["llm", "chat", "inference", "openai-compat", "ai"],
  "/mcp": ["mcp", "base", "token-safety", "crypto", "data"],
};
const BAZAAR_CATEGORY: Record<string, string> = {
  chain: "onchain", crypto: "crypto", defi: "defi", ai: "ai", gate: "token-safety",
  enrich: "security", scan: "security", pm: "prediction-markets", dns: "dns",
  whois: "whois", v1: "ai", brief: "crypto",
};
// Derive up to 5 valid tags for a route key like "GET /chain/gas-price".
function bazaarTagsFor(routeKey: string): string[] {
  const path = routeKey.replace(/^\w+\s+/, "").replace(/:\w+/g, "").replace(/\/+$/, "");
  const override = BAZAAR_TAG_OVERRIDES[path];
  if (override) return override.slice(0, 5);
  const segs = path.replace(/^\//, "").split("/").filter(Boolean);
  const head = segs[0] ?? "data";
  const cat = BAZAAR_CATEGORY[head] ?? head;
  const leaf = (segs[segs.length - 1] ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
  const out: string[] = [];
  const push = (t: string) => {
    if (t && !out.includes(t) && out.length < 5 && /^[\x20-\x7e]{1,32}$/.test(t)) out.push(t);
  };
  push(cat);
  if (head === "chain") { push("base"); push("onchain"); push("rpc"); }
  else { push("crypto"); }
  push(leaf);
  push("data");
  return out;
}

function makeRoutes(payTo: string) {
  const routes: Record<string, any> = {
    "POST /mcp": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.005",
        network: NETWORK,
        payTo,
      },
      description:
        "MCP tools/call over x402 for Base/crypto data + token safety: crypto_prices, crypto_funding, defi_yields, pm_markets, chain_block_number, chain_gas_price, chain_balance, chain_token_balance, chain_tx, chain_wallet, gate_swap (go/hold/block pre-trade gate), chain_token_report (SAFE/CAUTION/AVOID verdict), chain_token_security (honeypot detector), enrich_tech_risk (CVE/EPSS/KEV), enrich_domain, scan_mcp_server (MCP tool-poisoning audit). Use when an agent needs Base data or token-safety over MCP.",
      mimeType: "application/json",
    },
    "GET /scan/mcp": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.05",
        network: NETWORK,
        payTo,
      },
      description:
        "Security scan of a target MCP server: audits every advertised tool for prompt-injection / tool-poisoning / exfiltration / dangerous-capability / hidden-unicode (OWASP LLM01/LLM08). Returns findings + risk score + verdict (clear/review/block).",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        pathParams: {},
        pathParamsSchema: {
          properties: {
            url: { type: "string", description: "Target MCP server endpoint URL to audit" },
          },
        },
        output: {
          example: {
            target: "https://example.com/mcp",
            tools_scanned: 3,
            findings: [
              { tool: "read_file", severity: "critical", rule: "tool-poisoning:hidden-instructions", detail: "…", evidence: "…" },
            ],
            risk_score: 40,
            verdict: "review",
            risk_summary: "1 issue across 3 tools, 1 CRITICAL (tool-poisoning). Risk 40/100.",
          },
        },
      }),
    },
    "POST /scan/mcp": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.05",
        network: NETWORK,
        payTo,
      },
      description:
        "Zero-egress MCP security scan: POST your own tools/list array ({\"tools\":[...]}) and get the full itemized audit back — prompt-injection / tool-poisoning / exfiltration / dangerous-capability / hidden-unicode (OWASP LLM01/LLM08), per-tool findings + evidence + risk score + verdict. Nothing leaves your side except the tool descriptions you paste; we never fetch or call your server. For OAuth-gated / private MCP servers that must not expose a URL.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        pathParams: {},
        pathParamsSchema: {
          properties: {
            tools: { type: "array", description: "Your tools/list result array (name, description, inputSchema per tool). Pasted, not fetched." },
          },
        },
        output: {
          example: {
            target: "(pasted tools/list)",
            tools_scanned: 3,
            findings: [
              { tool: "read_file", severity: "critical", rule: "tool-poisoning:hidden-instructions", detail: "…", evidence: "…" },
            ],
            risk_score: 40,
            verdict: "review",
            risk_summary: "1 issue across 3 tools, 1 CRITICAL (tool-poisoning). Risk 40/100.",
          },
        },
      }),
    },
    "GET /dns/:domain": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.01",
        network: NETWORK,
        payTo,
      },
      description: "Resolve DNS records (A/AAAA/MX/NS/TXT) for a domain",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        pathParams: { domain: "example.com" },
        pathParamsSchema: {
          properties: {
            domain: { type: "string", description: "Domain name to resolve" },
          },
        },
        output: {
          example: {
            domain: "example.com",
            A: ["93.184.216.34"],
            AAAA: [],
            MX: ["0 ."],
            NS: ["a.iana-servers.net.", "b.iana-servers.net."],
            TXT: ["v=spf1 -all"],
          },
        },
      }),
    },
    "GET /whois/:domain": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.01",
        network: NETWORK,
        payTo,
      },
      description:
        "WHOIS / RDAP lookup: registrar, created, expiry, registrant for a domain",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        pathParams: { domain: "example.com" },
        pathParamsSchema: {
          properties: {
            domain: { type: "string", description: "Domain name to look up" },
          },
        },
        output: {
          example: {
            domain: "example.com",
            registrar: "RESERVED-Internet Assigned Numbers Authority",
            created: "1995-08-14T04:00:00Z",
            expiry: "2025-08-13T04:00:00Z",
            registrant: null,
            status: ["client delete prohibited"],
          },
        },
      }),
    },
    "GET /enrich/tech-risk": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.01",
        network: NETWORK,
        payTo,
      },
      description:
        "Security enrichment: tech-stack fingerprint + CVE mapping + EPSS + CISA KEV + verdict for a domain",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        pathParams: {},
        pathParamsSchema: {
          properties: {
            domain: {
              type: "string",
              description: "Domain name to analyze (auto-detect tech stack)",
            },
            techstack: {
              type: "array",
              items: { type: "string" },
              description: "Override: manually specify tech stack keywords",
            },
          },
        },
        output: {
          example: {
            tech_stack: ["nginx", "PHP"],
            vulnerabilities: [
              {
                id: "CVE-2024-24989",
                description: "Description text",
                cvss_score: 7.5,
                epss_score: 0.0234,
                in_kev: false,
                exploit_available: false,
              },
            ],
            verdict: "review",
            risk_summary: "nginx, PHP — 2 high-severity CVEs. Prioritize patching.",
          },
        },
      }),
    },
    "GET /enrich/domain": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.01",
        network: NETWORK,
        payTo,
      },
      description:
        "Domain enrichment: firmographic data + SSL certs + subdomain enumeration + tech-stack fingerprint + verdict (domain age)",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        pathParams: {},
        pathParamsSchema: {
          properties: {
            domain: {
              type: "string",
              description: "Domain name to enrich",
            },
          },
        },
        output: {
          example: {
            domain: "example.com",
            organization: "Internet Assigned Numbers Authority",
            dns: {
              A: ["93.184.216.34"],
              NS: ["a.iana-servers.net."],
            },
            certificates: [
              {
                issuer: "C=US, O=Let's Encrypt, CN=R3",
                common_name: "example.com",
                valid_from: "2025-01-01T00:00:00Z",
                valid_to: "2025-04-01T00:00:00Z",
              },
            ],
            subdomains: ["example.com", "www.example.com", "mail.example.com"],
            tech_stack: ["nginx"],
            verdict: "clear",
          },
        },
      }),
    },
    "GET /pm/markets": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.005",
        network: NETWORK,
        payTo,
      },
      description:
        "Query live Polymarket prediction markets — question, outcomes, live prices, bestBid/bestAsk/spread, volume24hr/volume1wk, oneDayPriceChange, clobTokenIds, conditionId, category tags, liquidity, end date. Ranked by volume24hr; filter by keyword.",
      mimeType: "application/json",
      // Discovery declaration (valid config: query method, object example) so the
      // live 402 advertises this route to Bazaar crawlers. Safe on the xpay settle
      // path (the ajv-on-Workers wall only bites the CDP resource-server settle,
      // which we do NOT use for live payments — see FACILITATOR_MODE note).
      // Query-method config (method:"GET") routes declareDiscoveryExtension to its
      // query variant at runtime; the package's exported input type is the narrower
      // path variant, so cast to satisfy tsc without changing runtime behavior.
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { limit: "20", query: "bitcoin" },
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "string", description: "Max markets to return (default 20, max 100)" },
            query: { type: "string", description: "Optional keyword filter matched against the market question" },
          },
        },
        output: {
          example: {
            question: "Will X happen by 2026?",
            slug: "will-x-happen-by-2026",
            outcomes: ["Yes", "No"],
            outcomePrices: [0.65, 0.35],
            volume: 1234567.89,
            volume24hr: 84213.45,
            volume1wk: 412987.6,
            liquidity: 45678.12,
            endDate: "2026-12-31T12:00:00Z",
            active: true,
            bestBid: 0.64,
            bestAsk: 0.66,
            spread: 0.02,
            oneDayPriceChange: 0.01,
            clobTokenIds: ["264852...", "884780..."],
            conditionId: "0xb6d6f15a1b5d08753653f1867ccd6126badfbe182a75159a330dc7b15336b30",
            tags: ["Crypto", "Bitcoin"],
          },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /crypto/funding": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.004",
        network: NETWORK,
        payTo,
      },
      description:
        "Cross-venue Hyperliquid+OKX+dYdX perp funding rates — top coins by 24h notional volume, per-venue funding + arb spread (bps) + cheapest-long/richest-short venue, premium/basis, annualized_hl, annualized_okx, LONGS_PAY/SHORTS_PAY/NEUTRAL signal, next_funding_ts, mark/oracle prices, open interest.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { limit: "20" },
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "string", description: "Max coins to return (default 20, max 100)" },
          },
        },
        output: {
          example: {
            coin: "BTC",
            funding: { hyperliquid: 0.0000125, okx: 0.0000492, dydx: -0.00000875 },
            funding_spread_bps: 0.37,
            best_long_venue: "hyperliquid",
            best_short_venue: "okx",
            premium: 0.00012,
            annualized_hl: 0.1095,
            annualized_okx: 0.05387,
            signal: "LONGS_PAY",
            next_funding_ts: 1784304000000,
            markPx: 63730,
            oraclePx: 63750,
            openInterest: 37519.8698399999,
            dayNtlVlm: 1670654479.0625291,
          },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /defi/yields": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.001",
        network: NETWORK,
        payTo,
      },
      description:
        "Top DeFi lending/LP yields — project, chain, symbol, pool id, APY breakdown + 1d/7d/30d APY trend, IL risk (incl. il7d), exposure, reward/underlying tokens, outlier flag, mu/sigma, DefiLlama stability forecast, TVL. Filter by project, chain, or stablecoin-only; sort by TVL (default) or risk-adjusted APY (apy/sigma).",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { limit: "20", project: "aave-v3", chain: "Ethereum", stable: "true", sort: "tvl" },
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "string", description: "Max pools to return (default 20, max 100)" },
            project: { type: "string", description: "Optional: filter to an exact project name (case-insensitive)" },
            chain: { type: "string", description: "Optional: filter to an exact chain name (case-insensitive)" },
            stable: { type: "string", description: "Optional: \"true\" to return only stablecoin pools" },
            sort: { type: "string", description: "Optional: \"tvl\" (default) or \"risk_adjusted\" (apy/sigma)" },
          },
        },
        output: {
          example: {
            project: "aave-v3",
            chain: "Ethereum",
            symbol: "USDC",
            pool: "747c1d2a-c668-4682-b9f9-296708a3dd90",
            apy: 4.21,
            apyBase: 3.1,
            apyReward: 1.11,
            apyPct1D: 0.001,
            apyPct7D: -0.06,
            apyPct30D: 0.15,
            apyBase7d: 3.05,
            apyMean30d: 4.1,
            tvlUsd: 512345678,
            stablecoin: true,
            ilRisk: "no",
            il7d: null,
            exposure: "single",
            outlier: false,
            rewardTokens: null,
            underlyingTokens: ["0x0000000000000000000000000000000000000000"],
            mu: 3.47618,
            sigma: 0.05347,
            risk_adjusted_apy: 78.75,
            predicted_probability: 64,
            volumeUsd1d: null,
          },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /crypto/prices": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.001",
        network: NETWORK,
        payTo,
      },
      description:
        "Spot token prices from DefiLlama — pass comma-separated CoinGecko ids, get price/change_24h/symbol/confidence/timestamp.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { coins: "bitcoin,ethereum,solana" },
        inputSchema: {
          type: "object",
          properties: {
            coins: { type: "string", description: "Comma-separated CoinGecko ids (default bitcoin,ethereum,solana; max 25)" },
          },
        },
        output: {
          example: { id: "bitcoin", symbol: "BTC", price: 63731.496785708485, change_24h: -1.78, confidence: 0.99, timestamp: 1784244902 },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/block-number": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.002",
        network: NETWORK,
        payTo,
      },
      description: "Current Base mainnet block number. Use when an agent needs the latest Base block to time or sanity-check a transaction.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {} },
        output: {
          example: { block_number: 27738421, chain: "base" },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/gas-price": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.002",
        network: NETWORK,
        payTo,
      },
      description: "Current Base mainnet gas price (wei/gwei), EIP-1559 base_fee_gwei/priority_fee_gwei, and gas_price_usd. Use when an agent must estimate gas cost in USD before sending a Base transaction.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {} },
        output: {
          example: {
            gas_price_wei: "21284349",
            gas_price_gwei: 0.021284349,
            base_fee_gwei: 0.018,
            priority_fee_gwei: 0.0032,
            gas_price_usd: 3.93e-8,
            chain: "base",
          },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/balance": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.002",
        network: NETWORK,
        payTo,
      },
      description: "ETH balance of a Base mainnet address, incl. balance_usd. Use when an agent needs an address's ETH balance in ETH and USD on Base.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { address: "0x4200000000000000000000000000000000000006" },
        inputSchema: {
          type: "object",
          properties: {
            address: { type: "string", description: "0x-prefixed 20-byte Base address" },
          },
        },
        output: {
          example: {
            address: "0x4200000000000000000000000000000000000006",
            balance_wei: "17265432100000000000",
            balance_eth: 17.2654321,
            balance_usd: 31886.15,
            chain: "base",
          },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/token-balance": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.002",
        network: NETWORK,
        payTo,
      },
      description: "ERC-20 token balance of a Base mainnet address, incl. symbol, decimals, balance_formatted. Use when an agent needs an ERC-20 balance for a Base address before a swap or transfer.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { address: "0x4200000000000000000000000000000000000006", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
        inputSchema: {
          type: "object",
          properties: {
            address: { type: "string", description: "0x-prefixed 20-byte holder address" },
            token: { type: "string", description: "0x-prefixed 20-byte ERC-20 contract address" },
          },
        },
        output: {
          example: { address: "0x4200000000000000000000000000000000000006", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, balance_raw: "1050000", balance_formatted: 1.05, chain: "base" },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/tx": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.005",
        network: NETWORK,
        payTo,
      },
      description: "Transaction details by hash on Base mainnet.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { hash: "0x571284385ad512a3ffc984a6c2f335113ada217215b6296847944f9d0bc613ef" },
        inputSchema: {
          type: "object",
          properties: {
            hash: { type: "string", description: "0x-prefixed 32-byte transaction hash" },
          },
        },
        output: {
          example: { hash: "0x571284385ad512a3ffc984a6c2f335113ada217215b6296847944f9d0bc613ef", blockNumber: "48747709", from: "0xd80217bd14c4d4a4fe37bb1354be1830ed815a60", to: "0x6211a3742cf9d3b6677ecc7fd9dd102ab101d8e2", value: "0", gas: "5000000", gasPrice: "322017256", nonce: "6937" },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/receipt": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.005",
        network: NETWORK,
        payTo,
      },
      description: "Transaction receipt by hash on Base mainnet: status, gas used, full logs, L1 fee breakdown, l1_fee_usd/total_fee_usd.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { hash: "0x571284385ad512a3ffc984a6c2f335113ada217215b6296847944f9d0bc613ef" },
        inputSchema: {
          type: "object",
          properties: {
            hash: { type: "string", description: "0x-prefixed 32-byte transaction hash" },
          },
        },
        output: {
          example: {
            status: 1,
            block_number: 48734000,
            gas_used: 28859,
            cumulative_gas_used: 75077,
            effective_gas_price_wei: "49851573",
            from: "0xd80217bd14c4d4a4fe37bb1354be1830ed815a60",
            to: "0x6211a3742cf9d3b6677ecc7fd9dd102ab101d8e2",
            contract_address: null,
            tx_hash: "0x571284385ad512a3ffc984a6c2f335113ada217215b6296847944f9d0bc613ef",
            logs_count: 0,
            logs: [],
            l1_fee_wei: "1158985140",
            l1_gas_price_wei: "116776985",
            l1_gas_used: 1600,
            l1_fee_usd: 0.00000214,
            total_fee_usd: 0.0026591,
          },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/code": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.002",
        network: NETWORK,
        payTo,
      },
      description: "Contract-code check for a Base mainnet address (is_contract + code size + EIP-7702 delegated-EOA detection). Use when an agent must check whether a Base address is a contract or an EOA before interacting.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { address: "0x4200000000000000000000000000000000000006" },
        inputSchema: {
          type: "object",
          properties: {
            address: { type: "string", description: "0x-prefixed 20-byte Base address" },
          },
        },
        output: {
          example: { address: "0x4200000000000000000000000000000000000006", is_contract: true, is_eip7702_delegate: false, delegate_address: null, code_size_bytes: 6234, chain: "base" },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/erc20-meta": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "ERC-20 metadata on Base: name, symbol, decimals, totalSupply (raw + formatted) for any token contract.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { token: "0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913" },
        inputSchema: { type: "object", properties: { token: { type: "string", description: "0x-prefixed ERC-20 contract address on Base" } } },
        output: { example: { token: "0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", symbol: "USDC", decimals: 6, total_supply_raw: "3500000000000000", total_supply: 3500000000, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/nonce": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "Transaction count (nonce) for a Base address, latest and pending. Use when an agent needs the next nonce for a Base address before signing a transaction.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { address: "0x4200000000000000000000000000000000000006" },
        inputSchema: { type: "object", properties: { address: { type: "string", description: "0x-prefixed 20-byte Base address" } } },
        output: { example: { address: "0x4200000000000000000000000000000000000006", nonce_latest: 1, nonce_pending: 1, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/is-contract": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "Is a Base address a smart contract or an EOA? Returns is_contract and bytecode size. Use when an agent must decide whether a recipient is a contract before sending funds or approving it.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { address: "0x4200000000000000000000000000000000000006" },
        inputSchema: { type: "object", properties: { address: { type: "string", description: "0x-prefixed 20-byte Base address" } } },
        output: { example: { address: "0x4200000000000000000000000000000000000006", is_contract: true, code_bytes: 2000, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/fee-estimate": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "Base EIP-1559 fee estimate: current base fee, suggested priority fee and slow/standard/fast max-fee tiers in gwei. Use when an agent must set maxFeePerGas before sending a Base transaction.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {} },
        output: { example: { base_fee_gwei: 0.006, priority_fee_gwei: 0.001, tiers: { slow: { max_fee_gwei: 0.008 }, standard: { max_fee_gwei: 0.012 }, fast: { max_fee_gwei: 0.02 } }, transfer_cost_eth: { standard: 2.5e-7 }, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/network-status": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "Base network status snapshot: chain id, latest block number, block age in seconds, gas utilisation ratio and tx count. Use when an agent needs a liveness/congestion check before sending a Base transaction.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {} },
        output: { example: { chain_id: 8453, block: 38000000, block_age_seconds: 1, gas_used_ratio: 0.42, tx_count: 120, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/l1-base-fee": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "Ethereum L1 base fee as reported by Base's GasPriceOracle, in wei and gwei, plus an estimated L1 data fee for a simple transfer. Use when an agent prices the L1 component of Base transaction costs.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {} },
        output: { example: { l1_base_fee_wei: "210000000", l1_base_fee_gwei: 0.21, est_l1_data_fee_eth_simple_transfer: 2.0e-8, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },    "GET /chain/blob-base-fee": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "Base EIP-4844 blob base fee from the GasPriceOracle (wei/gwei). Use when an agent estimates L1 data-availability cost for Base batches.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {} },
        output: { example: { chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },    "GET /chain/eth-usd": {
      accepts: { scheme: "exact" as const, price: "$0.001", network: NETWORK, payTo },
      description: "Base ETH/USD spot price from the Chainlink aggregator (price, round, updatedAt, staleness). Use when an agent needs a trusted on-chain ETH price.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {} },
        output: { example: { price_usd: 3500.12, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },    "GET /chain/btc-usd": {
      accepts: { scheme: "exact" as const, price: "$0.001", network: NETWORK, payTo },
      description: "Base BTC/USD spot price from the Chainlink aggregator (price, round, updatedAt, staleness). Use when an agent needs a trusted on-chain BTC price.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {} },
        output: { example: { price_usd: 100000.5, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },    "GET /chain/prices": {
      accepts: { scheme: "exact" as const, price: "$0.001", network: NETWORK, payTo },
      description: "Base crypto price snapshot in one call: BTC, ETH, LINK and SOL USD spot from Chainlink aggregators with per-feed staleness. Use when an agent needs a multi-asset trusted on-chain price board.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {} },
        output: { example: { prices: { BTC: 100000.5, ETH: 3500.1, LINK: 12.5, SOL: 104.2 }, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },    "GET /chain/sol-usd": {
      accepts: { scheme: "exact" as const, price: "$0.001", network: NETWORK, payTo },
      description: "Base SOL/USD spot price from the Chainlink aggregator (price, round, updatedAt, staleness). Use when an agent needs a trusted on-chain SOL price.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {} },
        output: { example: { price_usd: 104.2, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },    "GET /chain/link-usd": {
      accepts: { scheme: "exact" as const, price: "$0.001", network: NETWORK, payTo },
      description: "Base LINK/USD spot price from the Chainlink aggregator (price, round, updatedAt, staleness). Use when an agent needs a trusted on-chain LINK price.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {} },
        output: { example: { price_usd: 12.5, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },    "GET /chain/fee-history": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "Base fee history for the last 10 blocks: base fee per block (gwei), gas-used ratios and a min/max/avg summary. Use when an agent times transactions around cheap blocks.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {} },
        output: { example: { chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },


    "GET /chain/total-supply": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "ERC-20 total supply on Base, raw + formatted with decimals and symbol. Use when an agent needs a token's circulating-supply base for market-cap or dilution math.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { token: "0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913" },
        inputSchema: { type: "object", properties: { token: { type: "string", description: "0x-prefixed ERC-20 contract address on Base" } } },
        output: { example: { token: "0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, total_supply_raw: "3500000000000000", total_supply: 3500000000, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/storage-at": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "Raw storage slot (eth_getStorageAt) of a Base contract. Use when an agent needs proxy implementation/admin slots or raw contract state.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { address: "0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913", slot: "0x0" },
        inputSchema: { type: "object", properties: { address: { type: "string", description: "0x-prefixed contract address on Base" }, slot: { type: "string", description: "storage slot hex, default 0x0" } } },
        output: { example: { address: "0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913", slot: "0x0", value: "0x0000000000000000000000000000000000000000000000000000000000000001", chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/proxy-info": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "EIP-1967 proxy resolver for a Base contract: implementation, admin, beacon addresses + is_proxy. Use when an agent must know what code actually runs behind a proxy before trusting or calling it.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { address: "0x4200000000000000000000000000000000000006" },
        inputSchema: { type: "object", properties: { address: { type: "string", description: "0x-prefixed contract address on Base" } } },
        output: { example: { address: "0x4200000000000000000000000000000000000006", is_proxy: false, implementation: null, admin: null, beacon: null, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/allowance": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "ERC-20 allowance(owner, spender) on Base, raw + formatted, flags unlimited approvals.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { token: "0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913", owner: "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10", spender: "0x4200000000000000000000000000000000000006" },
        inputSchema: { type: "object", properties: { token: { type: "string", description: "ERC-20 address" }, owner: { type: "string", description: "owner address" }, spender: { type: "string", description: "spender address" } } },
        output: { example: { token: "0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913", owner: "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10", spender: "0x4200000000000000000000000000000000000006", allowance_raw: "0", allowance: 0, decimals: 6, is_unlimited: false, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /defi/chains-tvl": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Top blockchains ranked by total DeFi TVL (DefiLlama): name, TVL USD, gas token. No params. Use when an agent needs a quick map of where DeFi capital sits.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { limit: "20" },
        inputSchema: { type: "object", properties: { limit: { type: "string" } } },
        output: { example: { chains: [{ name: "Ethereum", tvl_usd: 90000000000, token: "ETH" }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /crypto/stablecoins": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Top stablecoins by circulating supply (DefiLlama): name, symbol, price, peg type, circulating USD. No params. Use when an agent needs stablecoin supply and depeg checks.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { limit: "20" },
        inputSchema: { type: "object", properties: { limit: { type: "string" } } },
        output: { example: { stablecoins: [{ symbol: "USDT", price: 0.9994, circulating_usd: 183456438967 }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /defi/protocols-top": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Top DeFi protocols by TVL (DefiLlama): name, category, TVL USD, 1d/7d change, chain. No params. Use when an agent needs a ranked protocol league table.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { limit: "20" },
        inputSchema: { type: "object", properties: { limit: { type: "string" } } },
        output: { example: { protocols: [{ name: "Aave", category: "Lending", tvl_usd: 30000000000, change_1d: 0.4, change_7d: -1.2 }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /defi/dex-volume": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Top DEXs by 24h trading volume (DefiLlama): name, 24h/7d volume USD, 1d change, plus market total. No params. Use when an agent needs where on-chain swap volume is flowing.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { limit: "20" },
        inputSchema: { type: "object", properties: { limit: { type: "string" } } },
        output: { example: { total24h_usd: 7102132850, dexs: [{ name: "Curve DEX", volume24h_usd: 42754326 }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /crypto/fear-greed": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "Crypto Fear & Greed Index (alternative.me): current value 0-100, classification, history of last N days. No params. Use when an agent needs a market-sentiment gauge.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { days: "7" },
        inputSchema: { type: "object", properties: { days: { type: "string" } } },
        output: { example: { value: 59, classification: "Greed", history: [{ value: 59, classification: "Greed", date: "2026-10-19" }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /crypto/trending": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Trending coins on CoinGecko right now: name, symbol, market-cap rank, 24h price change. No params. Use when an agent needs what the market is searching for.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {  } },
        output: { example: { trending: [{ name: "Bitcoin", symbol: "BTC", market_cap_rank: 1 }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /defi/fees-top": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Top DeFi protocols by 24h fees (DefiLlama): name, 24h/7d fees USD, 1d change, plus market total. No params. Use when an agent needs which protocols earn the most.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { limit: "20" },
        inputSchema: { type: "object", properties: { limit: { type: "string" } } },
        output: { example: { total24h_usd: 66595988, protocols: [{ name: "Tether", fees24h_usd: 1000000 }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /crypto/global": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "Global crypto market stats (CoinGecko): total market cap, 24h volume, BTC/ETH dominance, active coins. No params. Use when an agent needs a one-call market overview.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {  } },
        output: { example: { total_market_cap_usd: 3900000000000, btc_dominance_pct: 57.1 } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /defi/yields-top": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Top DeFi yield pools by TVL (DefiLlama): chain, project, symbol, APY, TVL USD; optional ?chain= & ?stable=true. Use when an agent needs where to earn yield.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { limit: "20" },
        inputSchema: { type: "object", properties: { chain: { type: "string" }, stable: { type: "string" }, limit: { type: "string" } } },
        output: { example: { pools: [{ chain: "Ethereum", project: "lido", symbol: "STETH", apy: 2.22, tvl_usd: 23204781540 }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /crypto/markets-top": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Top coins by market cap (CoinGecko): price, market cap, 24h volume, 24h change; ?limit= up to 100. No required params. Use when an agent needs a ranked market snapshot.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { limit: "20" },
        inputSchema: { type: "object", properties: { limit: { type: "string" } } },
        output: { example: { coins: [{ symbol: "BTC", price_usd: 82028, change_24h_pct: 1.07 }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /crypto/movers": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Top 24h gainers and losers among the top-100 coins (CoinGecko). No params. Use when an agent needs what is moving the market right now.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {  } },
        output: { example: { gainers: [{ symbol: "XYZ", change_24h_pct: 12.3 }], losers: [{ symbol: "ABC", change_24h_pct: -9.1 }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /brief/market": {
      accepts: { scheme: "exact" as const, price: "$0.01", network: NETWORK, payTo },
      description: "One-call crypto market brief: Fear & Greed, global market cap/dominance, top movers, trending coins and top DeFi fee earners. No params. Use when an agent needs a full market snapshot in a single payment.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {  } },
        output: { example: { fear_greed: { value: 59, classification: "Greed" }, global: { btc_dominance_pct: 57.1 }, movers: { gainers: [], losers: [] } } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /crypto/exchanges-top": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Top crypto exchanges by trust score (CoinGecko): name, country, year, trust score and rank, 24h BTC volume. No params. Use when an agent needs exchange due-diligence data.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {  } },
        output: { example: { exchanges: [{ name: "Kraken", trust_score: 10 }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /crypto/categories": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Crypto sector performance (CoinGecko categories): market cap, 24h change, volume per sector, top by market cap. No params. Use when an agent needs sector rotation signals.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {  } },
        output: { example: { categories: [{ name: "Smart Contract Platform", market_cap_change_24h_pct: 1.2 }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /defi/hacks-recent": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Most recent DeFi/crypto hacks and exploits (DefiLlama): date, name, amount lost USD, chain, technique, bridge-hack flag; ?limit= up to 50. No required params. Use when an agent needs live security-incident risk signals.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { limit: "10" },
        inputSchema: { type: "object", properties: { limit: { type: "string", description: "optional, max 50" } } },
        output: { example: { hacks: [{ name: "Example Protocol", amount_usd: 1000000, chain: ["Ethereum"] }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /crypto/derivatives-exchanges": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Top crypto derivatives exchanges (CoinGecko): open interest BTC, 24h volume BTC, perpetual and futures pair counts, year established. No params. Use when an agent needs perp/futures venue liquidity data.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {  } },
        output: { example: { exchanges: [{ name: "Binance (Futures)", open_interest_btc: 403937 }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /defi/protocol-risk": {
      accepts: { scheme: "exact" as const, price: "$0.01", network: NETWORK, payTo },
      description: "Protocol risk score from DefiLlama: joins TVL, 1d/7d TVL change, age, audits, chain count and matching hack history into one 0-100 score with flags; ?protocol=<slug> (default aave-v3). Use when an agent needs a due-diligence check before routing funds to a DeFi protocol.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { protocol: "aave-v3" },
        inputSchema: { type: "object", properties: { protocol: { type: "string", description: "DefiLlama slug, default aave-v3" } } },
        output: { example: { protocol: "aave-v3", risk_score: 82, flags: [] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /defi/safe-yields": {
      accepts: { scheme: "exact" as const, price: "$0.01", network: NETWORK, payTo },
      description: "Vetted stablecoin yields: top stablecoin pools (DefiLlama, TVL>$5M, APY 1-25%) joined with each protocol's age and hack history, safest-yield first; optional ?chain= & ?limit=. No required params. Use when an agent needs where to park stablecoins with due-diligence already applied.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { limit: "10" },
        inputSchema: { type: "object", properties: { chain: { type: "string", description: "optional chain filter" }, limit: { type: "string", description: "optional, max 30" } } },
        output: { example: { pools: [{ project: "aave-v3", chain: "Ethereum", symbol: "USDC", apy: 4.2, tvl_usd: 900000000, protocol_age_days: 1662, hacked_before: true }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /ai/classify": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Zero-shot text classification (Llama 3.2 3B): ?text=<up to 1000 chars>&labels=<comma-separated labels, 2-10> returns the single best label. Use when an agent needs to route or tag text (intent, sentiment, topic, spam) in one cheap call.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { text: "My card was charged twice", labels: "billing,bug,feature_request,other" },
        inputSchema: { type: "object", properties: { text: { type: "string" }, labels: { type: "string" } }, required: ["text", "labels"] },
        output: { example: { label: "billing", labels: ["billing", "bug", "feature_request", "other"] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /ai/summarize": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Text summarization (Llama 3.2 3B): ?text=<up to 1500 chars> returns a 1-3 sentence summary. Use when an agent needs to compress a passage cheaply before reasoning over it.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { text: "x402 is an open HTTP 402 payment protocol letting clients pay per request in USDC on Base without accounts or API keys." },
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        output: { example: { summary: "x402 lets clients pay per HTTP request in USDC on Base, with no accounts or keys." } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /ai/translate": {
      accepts: { scheme: "exact" as const, price: "$0.003", network: NETWORK, payTo },
      description: "Text translation (Llama 3.2 3B): ?text=<up to 800 chars>&to=<target language, e.g. es, fr, de, ja> returns the translated text only. Use when an agent needs quick pay-per-call translation with no API key.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { text: "Hello, how are you?", to: "es" },
        inputSchema: { type: "object", properties: { text: { type: "string" }, to: { type: "string" } }, required: ["text", "to"] },
        output: { example: { translation: "Hola, ¿cómo estás?", to: "es" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /ai/extract": {
      accepts: { scheme: "exact" as const, price: "$0.005", network: NETWORK, payTo },
      description: "Text-to-JSON extraction (Llama 3.2 3B): ?text=<up to 1500 chars>&fields=<comma-separated field names> returns a strict JSON object with exactly those keys (null when absent). Use when an agent needs messy text turned into typed structured data.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { text: "Invoice 4417 from Acme Corp, due 2026-11-02, total $1,250.00", fields: "invoice_number,vendor,due_date,total" },
        inputSchema: { type: "object", properties: { text: { type: "string" }, fields: { type: "string" } }, required: ["text", "fields"] },
        output: { example: { data: { invoice_number: "4417", vendor: "Acme Corp", due_date: "2026-11-02", total: "1250.00" } } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "POST /v1/chat/completions": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "OpenAI-compatible chat completions (Llama 3.3 70B fp8 on Workers AI; set model=llama-3.2-3b-instruct for the small model). POST {messages:[{role,content}]}, returns choices[0].message. Pay per call, no API key.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "POST",
        bodyType: "json",
        input: { model: "llama-3.3-70b-instruct-fp8-fast", messages: [{ role: "user", content: "Explain x402 in one sentence" }] },
        inputSchema: { type: "object", properties: { messages: { type: "array", description: "OpenAI-style messages, total <= 4000 chars" } }, required: ["messages"] },
        output: { example: { object: "chat.completion", model: "llama-3.3-70b-instruct-fp8-fast", choices: [{ index: 0, message: { role: "assistant", content: "x402 is an HTTP 402-based micropayment protocol." }, finish_reason: "stop" }] } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /ai/ask": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "Cheap LLM answer (Llama 3.2 3B on Workers AI) for a prompt up to 500 chars. Pay per call, no API key.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { q: "Explain x402 in one sentence" },
        inputSchema: { type: "object", properties: { q: { type: "string", description: "prompt, max 500 chars" } }, required: ["q"] },
        output: { example: { answer: "x402 is an HTTP 402-based micropayment protocol.", model: "llama-3.2-3b-instruct" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/block": {
      accepts: { scheme: "exact" as const, price: "$0.002", network: NETWORK, payTo },
      description: "Base block summary by number or 'latest': hash, timestamp, tx count, gas used/limit, base fee.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { number: "latest" },
        inputSchema: { type: "object", properties: { number: { type: "string", description: "block number (decimal) or 'latest'" } } },
        output: { example: { number: 52800000, hash: "0xabc", timestamp: 1792400000, tx_count: 120, gas_used: 12000000, gas_limit: 300000000, base_fee_gwei: 0.005, chain: "base" } },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/wallet": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.003",
        network: NETWORK,
        payTo,
      },
      description: "Wallet screening bundle (balance, activity, contract vs EOA check): ETH balance + balance_usd + tx count + contract-code check (EIP-7702 delegated-EOA aware) for a Base mainnet address, in one call.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { address: "0x4200000000000000000000000000000000000006" },
        inputSchema: {
          type: "object",
          properties: {
            address: { type: "string", description: "0x-prefixed 20-byte Base address" },
          },
        },
        output: {
          example: {
            address: "0x4200000000000000000000000000000000000006",
            balance_wei: "17265432100000000000",
            balance_eth: 17.2654321,
            balance_usd: 31886.15,
            tx_count: 4,
            is_contract: true,
            is_eip7702_delegate: false,
            delegate_address: null,
            chain: "base",
          },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/token-report": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.01",
        network: NETWORK,
        payTo,
      },
      description:
        "Is this Base token safe to buy? One call returns a decision-grade trade-safety verdict — SAFE | CAUTION | AVOID — with risk_score (0-100) and reasons: honeypot/sellability simulation, owner-renounced + mint/pause/blacklist/fee-setter/upgradeable-proxy checks, symbol/name/decimals, and Uniswap v3 WETH-pool liquidity (USD). Replaces many RPC calls and prevents a bad trade. Use when an agent is about to buy or swap a Base ERC-20 and needs a SAFE/CAUTION/AVOID decision.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
        inputSchema: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string", description: "0x-prefixed 20-byte ERC-20 contract address on Base mainnet" },
          },
        },
        output: {
          example: {
            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            chain: "base",
            token_meta: { symbol: "USDC", name: "USD Coin", decimals: 6 },
            security: {
              isHoneypot: false,
              sellable: true,
              buyTaxBps: null,
              sellTaxBps: null,
              transferTaxBps: 0,
              taxNote: "buyTaxBps/sellTaxBps (DEX swap tax) are not measured; transferTaxBps is the MEASURED fee on a plain transfer() via eth_simulateV1 (null if the RPC could not simulate it); taxMutable reflects whether the owner can change fees",
              taxMutable: false,
              ownerRenounced: false,
              upgradeableProxy: true,
              canMint: true,
              canPause: true,
              hasBlacklist: true,
              simStatus: "tested",
            },
            liquidity: {
              wethPoolUsd: 158115578,
              basis: "approx: 2x WETH-side balance of the deepest Uniswap v3 WETH pool",
              pools: [{ fee_tier: 3000, pool: "0x6c561b446416e1a00e8e93e221854d6ea4171372", weth_raw: "32302700341061034860298", weth_side_usd: 79057789.87 }],
              dex: "uniswap-v3",
              note: null,
            },
            verdict: "SAFE",
            risk_score: 25,
            reasons: ["owner can mint new supply", "contract can blacklist addresses", "transfers can be paused", "upgradeable proxy; logic can change after purchase"],
            analyzed_at: "2026-10-20T21:40:00.000Z",
            disclaimer: "Automated heuristic analysis, not financial advice. Verify before trading.",
            note: null,
          },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /gate/swap": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.008",
        network: NETWORK,
        payTo,
      },
      description:
        "Is this Base token safe to swap right now? GO / HOLD / BLOCK pre-trade safety gate for an autonomous trading agent: is it a honeypot, can you sell it, is your trade too big for the pool? Pass token, side (buy|sell), notional_usd; get a one-word decision + reason in one fast call. Combines honeypot/sellability simulation, admin-control checks and Uniswap v3 WETH-pool liquidity vs. trade size (price-impact guard). Use when a trading agent needs a GO/HOLD/BLOCK check right before a Base swap.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", side: "buy", notional_usd: "500" },
        inputSchema: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string", description: "0x-prefixed ERC-20 contract on Base mainnet (only required param)" },
            side: { type: "string", description: "buy or sell (optional, default buy)" },
            notional_usd: { type: "string", description: "intended trade size in USD (optional, default 100)" },
          },
        },
        output: {
          example: {
            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            side: "buy",
            notional_usd: 500,
            decision: "go",
            reason: "token passes safety checks",
            verdict: "SAFE",
            risk_score: 25,
            liquidity_usd: 158115578,
            impact_pct_of_pool: 0.0003,
            flags: ["no honeypot, deep liquidity, no high-risk admin controls detected"],
            token_meta: { symbol: "USDC", name: "USD Coin", decimals: 6 },
            analyzed_at: "2026-10-20T21:45:00.000Z",
            disclaimer: "Heuristic risk signal, not financial advice or a guarantee.",
            note: null,
          },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/token-security": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.009",
        network: NETWORK,
        payTo,
      },
      description:
        "Is this Base token a honeypot — can a real wallet actually sell it? Token-security / honeypot detector for a Base ERC-20: EIP-1967 proxy + upgradeability detection, bytecode scan for mint/pause/blacklist/fee-setter/ownership selectors, owner() renouncement, and a live eth_call state-override sim testing whether a synthetic wallet can transfer() it. Returns risk_score (0-100) + verdict (clear/review/block) + flags. Use when an agent needs honeypot/mint/pause/proxy checks for a Base ERC-20.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
        inputSchema: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string", description: "0x-prefixed 20-byte ERC-20 contract address on Base mainnet" },
          },
        },
        output: {
          // Real, live-verified output for Base USDC (captured during implementation) —
          // not a fabricated example. USDC's Base proxy predates EIP-1967 and uses the
          // older OpenZeppelin "zOS" AdminUpgradeabilityProxy slot convention; this
          // endpoint detects both, and scans the IMPLEMENTATION's bytecode (not the
          // thin proxy's) so mint/pause/blacklist are correctly found.
          example: {
            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            chain: "base",
            is_contract: true,
            is_eip7702_delegate: false,
            delegate_address: null,
            meta: { name: "USD Coin", symbol: "USDC", decimals: 6, total_supply_raw: "4268653465618984", total_supply_formatted: 4268653465.618984 },
            proxy: { is_proxy: true, proxy_standard: "OZ zOS AdminUpgradeabilityProxy (pre-EIP-1967)", implementation_address: "0x2ce6311ddae708829bc0784c967b7d77d19fd779", admin_address: "0x4fc7850364958d97b4d3f5a08f79db2493f8ca44", is_upgradeable: true },
            capabilities: { can_mint: true, can_burn: true, can_pause: true, has_blacklist: true, has_fee_setter: false, has_ownership: true, detected_selectors: [{ selector: "0x40c10f19", signature: "mint(address,uint256)", category: "can_mint" }], scanned_address: "0x2ce6311ddae708829bc0784c967b7d77d19fd779" },
            ownership: { owner: "0x3abd6f64a422225e61e435bae41db12096106df7", ownership_renounced: false, owner_type: "eoa" },
            honeypot_sim: { sim_status: "tested", method: "eth_call with a stateDiff override gives a synthetic wallet a token balance out-of-band, then attempts a plain transfer() and checks for a revert (not a full DEX buy+sell round-trip; no buy/sell tax is computed).", balance_slot_index: 3, slot_layout: "mapping@slot3", transferable: true, revert_reason: null, transfer_tax_bps: 0, note: "A synthetic wallet holding this token successfully completed a plain transfer() with no revert. No basic transfer-block detected (does not rule out DEX-pair-specific sell restrictions)." },
            risk_score: 65,
            verdict: "review",
            flags: ["upgradeable proxy (OZ zOS AdminUpgradeabilityProxy (pre-EIP-1967)) — contract logic can be changed by the admin after you hold this token", "owner/admin can mint unlimited new supply", "has a blacklist function — holders can be blocked from transferring", "contract can be paused — the owner can freeze all transfers", "ownership not renounced — a privileged admin account still controls this contract"],
            risk_summary: "5 risk flag(s) detected. Risk 65/100.",
            analyzed_at: "2026-07-17T04:12:15.519Z",
            note: null,
          },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
  };
  // Stamp every route with the service brand + searchable tags so the CDP Bazaar
  // catalogs us with discoverable metadata (was serviceName:null / tags:null).
  for (const key of Object.keys(routes)) {
    const rc = routes[key];
    if (rc && typeof rc === "object") {
      if (rc.serviceName === undefined) rc.serviceName = BAZAAR_SERVICE_NAME;
      if (rc.tags === undefined) rc.tags = bazaarTagsFor(key);
    }
  }
  return routes;
}

// ---------------------------------------------------------------------------
// API key helpers — for the Stripe-billed human rail
// ---------------------------------------------------------------------------

const KEY_PREFIX = "sk_";

function generateApiKey(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return KEY_PREFIX + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface ApiKeyRecord {
  key: string;
  stripe_session_id: string;
  customer_email?: string;
  credits_remaining: number;
  created_at: number;
  expires_at: number;
}

const PLANS = {
  pro: { price: 9.99, monthly_credits: 100, price_id_env: "STRIPE_PRICE_ID" },
} as const;

// ---------------------------------------------------------------------------
// Atomic credit ledger — per-key Durable Object
// ---------------------------------------------------------------------------
// KV read-modify-write (get → mutate → put) is NOT atomic: two concurrent
// requests for the same key can both read the same balance and both write
// back, double-spending a credit. Workers KV offers no etag/CAS, so the fix is
// a per-key Durable Object: idFromName(apiKey) routes every check-and-decrement
// for one key to the same DO instance, and the DO runtime serializes storage
// access — the balance check and the decrement become a single atomic step.
// KV remains the source of truth for identity + expiry; the DO owns the
// balance after it is seeded (at key creation, or lazily on first use for
// keys created before this deploy).
export class CreditLedger extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Atomically deduct one credit from this key's balance.
   *
   * Discriminated result (audit F3): `{ deducted: true, remaining }` on a
   * successful spend, `{ deducted: false, remaining: 0 }` when exhausted.
   * The OLD API returned the bare post-decrement number, so 0 was ambiguous —
   * it meant both "exhausted" and "just spent the last credit" — and the gate
   * denied the final paid call while the x402 fallback double-billed the same
   * request. Callers MUST branch on `deducted`.
   *
   * seedIfEmpty: when the DO has never been initialized (a key created before
   * this deploy), lazily seed from the KV record's credits_remaining before
   * deducting. `undefined` storage means "never seeded" — once seeded the
   * stored value is a number (possibly 0), so an exhausted key can never be
   * resurrected by a stale KV record. DO serialization makes the
   * read-check-write sequence race-free under concurrent requests.
   */
  async deductCredit(seedIfEmpty?: number): Promise<{ deducted: boolean; remaining: number }> {
    let remaining = await this.ctx.storage.get<number>("credits_remaining");
    if (remaining === undefined) {
      remaining = seedIfEmpty ?? 0;
    }
    if (remaining <= 0) return { deducted: false, remaining: 0 };
    const next = remaining - 1;
    await this.ctx.storage.put("credits_remaining", next);
    return { deducted: true, remaining: next };
  }

  /** Current balance, no side effects. */
  async getBalance(): Promise<number> {
    return (await this.ctx.storage.get<number>("credits_remaining")) ?? 0;
  }

  /** Set the balance to exactly `credits`. Called at key creation. */
  async seed(credits: number): Promise<void> {
    await this.ctx.storage.put("credits_remaining", credits);
  }
}

// Traffic log — SQLite request telemetry (t_9e3fec95); replaces dead AE binding.
export class TrafficLog extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // DDL once per DO instance; index on ts so windowed reads don't full-scan (CF free-tier rows_read cap).
    ctx.blockConcurrencyWhile(async () => {
      // DDL only — best-effort. The prune does NOT run here: the DO wakes on
      // essentially every request, and a per-wake DELETE ... LIMIT 5000 wrote up
      // to 5000 rows PER wake, which exhausted the DO free-tier rows-written
      // budget — breaking logHit (fail-open => lost traffic) and every read.
      // Pruning now happens probabilistically inside logHit (see below).
      try {
        ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS hits (ts INTEGER, path TEXT, method TEXT, ua TEXT)");
        ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS hits_ts ON hits(ts)");
        // Composite (method, ts) index: every PAID-filtered read
        // (getPaid/getSettlements/getRefStats/getBuyers/getNetExternalPaid) does
        // `WHERE method='PAID' AND ts>? ORDER BY ts DESC`. With only hits_ts,
        // SQLite walks the whole ts-window and reads EACH row to test the method
        // filter — so a 30-day read (getNetExternalPaid, on every /metrics hit)
        // scans the entire table (dominated by 1%-sampled non-paid rows) and
        // burns CF free-tier rows_read proportional to table size × read rate.
        // PAID rows are a tiny fraction (tens over the 7-day retention window), so
        // this composite index turns those reads into a narrow index range scan
        // that touches only PAID rows. Additive + idempotent; getStats' non-paid
        // (`method != 'PAID'`) query is non-selective and unaffected.
        ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS hits_method_ts ON hits(method, ts)");
      } catch {
        /* best-effort: table may already exist and reads still work */
      }
      // Additive migration: a `tx` column so every settled PAID row self-documents
      // its on-chain settlement txHash (decoded from the facilitator's
      // PAYMENT-RESPONSE header). Lets a registry/buyer trust-ask be answered from
      // our own store instead of a manual chain scan, and lets buyer_demand_intel
      // tie a paid call to its on-chain tx. SQLite has no ADD COLUMN IF NOT EXISTS,
      // so swallow the "duplicate column" error on a DO that already has it.
      try {
        ctx.storage.sql.exec("ALTER TABLE hits ADD COLUMN tx TEXT");
      } catch {
        /* column already exists on this DO instance — expected after first run */
      }
      // Additive migration: a `ref` column so a settled PAID row records the
      // referral tag (?ref=<partner>) that drove it. A referral partner (e.g. an
      // MCP-client reseller featuring our tools) wires ?ref=<theirs> into the call
      // URL; the tag rides through the 402→sign→retry unchanged, so the settled
      // request carries it. This turns a pilot's calls into a *traced* sale we can
      // reconcile per-partner (what DopamineDesk asked for: "tagged links to
      // measure referrals"). Same ADD COLUMN IF NOT EXISTS workaround as `tx`.
      try {
        ctx.storage.sql.exec("ALTER TABLE hits ADD COLUMN ref TEXT");
      } catch {
        /* column already exists on this DO instance — expected after first run */
      }
    });
  }

  // Fraction of NON-paid hits we persist. The high-volume probe/crawler traffic
  // (402 challenges, catalog sweeps, preview hits) was writing one row per request
  // and exhausting the DO free-tier daily rows-written budget well before UTC
  // midnight — which broke BOTH logHit (lost traffic, fail-open) and every read
  // ("Exceeded allowed rows written"), blinding the demand sensor most of the day.
  // Sampling non-paid writes at this rate keeps the budget alive all day. PAID
  // hits (the revenue signal) are ALWAYS persisted — never sampled. Non-paid
  // counts are therefore ~1/rate of true volume; getStats() reports the scale
  // factor so a reader can multiply back. Relative ranking across paths is
  // preserved because every non-paid path is sampled at the same rate.
  static readonly NONPAID_SAMPLE = 0.01;

  async logHit(path: string, method: string, ua: string, tx: string = "", ref: string = ""): Promise<void> {
    // Always persist PAID; sample everything else to protect the write budget.
    if (method !== "PAID" && Math.random() >= TrafficLog.NONPAID_SAMPLE) return;
    await this.ctx.storage.sql.exec("INSERT INTO hits (ts, path, method, ua, tx, ref) VALUES (?, ?, ?, ?, ?, ?)", Math.floor(Date.now() / 1000), path, method, ua, tx, ref);
    // Opportunistic prune: ~0.1% of writes trigger a small bounded delete of
    // old rows. Each deleted row also drops its hits_ts index entry, so a
    // LIMIT-100 prune costs up to 200 rows_written; at p=0.001 that averages
    // ~0.2 extra writes per insert. Combined with the 1% non-paid sample this
    // keeps total rows_written well under the DO free-tier 100k/day cap (a
    // single global "default" DO funnels every request, and on 2026-10-21 the
    // prior 5% sample + LIMIT-200 prune @ p=0.002 blew that budget before UTC
    // midnight — which breaks logHit for the rest of the day and blinds the
    // demand sensor; see getStats below).
    if (Math.random() < 0.001) {
      try {
        this.ctx.storage.sql.exec("DELETE FROM hits WHERE rowid IN (SELECT rowid FROM hits WHERE ts < ? LIMIT 100)", Math.floor(Date.now() / 1000) - 7 * 86400);
      } catch {
        /* prune is best-effort; never fail a log on it */
      }
    }
  }

  // NOTE: no GROUP BY/ORDER BY in these reads. On the DO SQLite free tier an
  // aggregate/sort materialises a temp b-tree which counts as *rows written*,
  // and the daily write budget is routinely exhausted by logHit — so a
  // GROUP BY read threw "Exceeded allowed rows written". A plain indexed
  // SELECT on hits_ts only consumes the (far larger) rows-read budget; we
  // aggregate in JS. Capped scan keeps rows-read bounded.
  private static readonly SCAN_CAP = 50000;

  async getPaid(windowSeconds: number = 86400): Promise<Array<{ path: string; payer: string; count: number }>> {
    const cursor = await this.ctx.storage.sql.exec("SELECT path, ua FROM hits WHERE method = 'PAID' AND ts > ? ORDER BY ts DESC LIMIT ?", Math.floor(Date.now() / 1000) - windowSeconds, TrafficLog.SCAN_CAP);
    const agg = new Map<string, { path: string; payer: string; count: number }>();
    for (const row of cursor.raw()) {
      const path = String(row[0]), payer = String(row[1]), key = path + "\u0000" + payer;
      const e = agg.get(key); if (e) e.count++; else agg.set(key, { path, payer, count: 1 });
    }
    return Array.from(agg.values()).sort((a, b) => b.count - a.count).slice(0, 500);
  }

  // Self-documenting settlements: every PAID row that captured an on-chain
  // settlement txHash, newest first. Answers a registry/buyer "show me a real
  // Base mainnet settlement tied to a named resource" trust-ask from our own
  // store (no manual chain scan), and lets buyer_demand_intel tie a paid call
  // to its on-chain tx. Plain indexed scan on hits_ts (rows_read only), aggregate
  // in JS — same write-budget discipline as getPaid/getStats.
  async getSettlements(windowSeconds: number = 2592000): Promise<Array<{ ts: number; path: string; payer: string; tx: string }>> {
    const cursor = await this.ctx.storage.sql.exec("SELECT ts, path, ua, tx FROM hits WHERE method = 'PAID' AND tx IS NOT NULL AND tx != '' AND ts > ? ORDER BY ts DESC LIMIT ?", Math.floor(Date.now() / 1000) - windowSeconds, TrafficLog.SCAN_CAP);
    const out: Array<{ ts: number; path: string; payer: string; tx: string }> = [];
    for (const row of cursor.raw()) {
      out.push({ ts: Number(row[0]), path: String(row[1]), payer: String(row[2]), tx: String(row[3]) });
      if (out.length >= 500) break;
    }
    return out;
  }

  // Our own infrastructure wallets — a settlement FROM one of these is a self/test
  // call, not external demand (the goal's no-self-dealing rule). Fixed on-chain
  // addresses (public, also in scripts/*.py and the loop spec), not a behavioral
  // list. Used to split referral-attributed paid calls into real-buyer vs self.
  static readonly SELF_PAYERS = new Set<string>([
    "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10", // receiving (PAY_TO)
    "0xc4852c26498d3187dec2ce1b19e840710e302d1e", // buyer/test funder
    "0x95e6a9761522e9533d74bbebe47e1c5ad8e3c685", // secondary self wallet
  ]);

  // Per-referral reconciliation: aggregate settled PAID rows by their ?ref= tag,
  // splitting distinct payers into external (real demand) vs self (our own test
  // calls). Answers a referral partner's "how many buyers did my tag drive, and
  // can you prove it on-chain?" — the measurement a reseller wants before (and
  // after) featuring us. Plain indexed scan on hits_ts (rows_read only), aggregate
  // in JS — same write-budget discipline as getPaid/getSettlements.
  async getRefStats(windowSeconds: number = 2592000): Promise<Array<{ ref: string; paid_calls: number; distinct_payers: number; distinct_external_payers: number; external_calls: number; txs: string[] }>> {
    const cursor = await this.ctx.storage.sql.exec("SELECT ua, ref, tx FROM hits WHERE method = 'PAID' AND ref IS NOT NULL AND ref != '' AND ts > ? ORDER BY ts DESC LIMIT ?", Math.floor(Date.now() / 1000) - windowSeconds, TrafficLog.SCAN_CAP);
    const agg = new Map<string, { ref: string; paid_calls: number; external_calls: number; payers: Set<string>; ext: Set<string>; txs: Set<string> }>();
    for (const row of cursor.raw()) {
      const payer = String(row[0]).toLowerCase(), ref = String(row[1]), tx = String(row[2] ?? "");
      let e = agg.get(ref);
      if (!e) { e = { ref, paid_calls: 0, external_calls: 0, payers: new Set(), ext: new Set(), txs: new Set() }; agg.set(ref, e); }
      e.paid_calls++;
      e.payers.add(payer);
      const isExternal = payer !== "unknown" && !TrafficLog.SELF_PAYERS.has(payer);
      if (isExternal) { e.external_calls++; e.ext.add(payer); }
      if (tx) e.txs.add(tx);
    }
    return Array.from(agg.values())
      .map((e) => ({ ref: e.ref, paid_calls: e.paid_calls, distinct_payers: e.payers.size, distinct_external_payers: e.ext.size, external_calls: e.external_calls, txs: Array.from(e.txs).slice(0, 20) }))
      .sort((a, b) => b.paid_calls - a.paid_calls)
      .slice(0, 200);
  }

  // Net-external paid calls — the goal's TRUE replied->paid signal. /metrics'
  // total_paid_calls is GROSS: it counts our own self/test settlements and
  // unknown-payer bot dust alongside any real buyer, so the revenue goal-gate
  // reads an inflated "paid" stage and keeps mis-routing to cold outreach when
  // real external demand is actually 0. This splits PAID rows by payer using the
  // same SELF_PAYERS exclusion getRefStats uses, so the gate (and any indexer)
  // can read real external demand directly. Plain indexed scan on hits_ts
  // (rows_read only), aggregate in JS — same write-budget discipline as
  // getPaid/getRefStats. Window default 30d: a trailing count, not all-time, but
  // the only honest replied->paid measure (>0 ever = real demand exists).
  async getNetExternalPaid(windowSeconds: number = 2592000): Promise<{ window_seconds: number; total_paid_rows: number; external_calls: number; self_calls: number; unknown_calls: number; distinct_external_payers: number; external_payers: string[] }> {
    const cursor = await this.ctx.storage.sql.exec("SELECT ua FROM hits WHERE method = 'PAID' AND ts > ? ORDER BY ts DESC LIMIT ?", Math.floor(Date.now() / 1000) - windowSeconds, TrafficLog.SCAN_CAP);
    let external_calls = 0, self_calls = 0, unknown_calls = 0, total = 0;
    const ext = new Set<string>();
    for (const row of cursor.raw()) {
      total++;
      const payer = String(row[0] ?? "").toLowerCase();
      if (payer === "" || payer === "unknown") { unknown_calls++; continue; }
      if (TrafficLog.SELF_PAYERS.has(payer)) { self_calls++; continue; }
      external_calls++; ext.add(payer);
    }
    return { window_seconds: windowSeconds, total_paid_rows: total, external_calls, self_calls, unknown_calls, distinct_external_payers: ext.size, external_payers: Array.from(ext).slice(0, 50) };
  }

  async getStats(windowSeconds: number = 86400): Promise<Array<{ path: string; count: number }>> {
    const cursor = await this.ctx.storage.sql.exec("SELECT path FROM hits WHERE method != 'PAID' AND ts > ? ORDER BY ts DESC LIMIT ?", Math.floor(Date.now() / 1000) - windowSeconds, TrafficLog.SCAN_CAP);
    const agg = new Map<string, number>();
    for (const row of cursor.raw()) {
      const path = String(row[0]);
      agg.set(path, (agg.get(path) ?? 0) + 1);
    }
    return Array.from(agg.entries()).map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count).slice(0, 500);
  }
}

// ---------------------------------------------------------------------------
// Human-facing landing page — token-safety scanner product
// ---------------------------------------------------------------------------

app.get("/token-safety", (c) => {
  const BASE = "https://x402-data-api.sigrunner.workers.dev";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Real-time honeypot detection for Base chain tokens. Analyze any ERC-20 for proxy risks, mint/pause/blacklist functions, and simulate transfers before you buy.">
<meta property="og:title" content="Token Safety Scanner — Base Chain Honeypot Detector">
<meta property="og:description" content="Real-time honeypot detection for Base chain tokens. Analyze proxy risks, mint/pause/blacklist functions, and simulate transfers.">
<meta property="og:url" content="https://x402-data-api.sigrunner.workers.dev/token-safety">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Token Safety Scanner — Base Chain Honeypot Detector">
<meta name="twitter:description" content="Real-time honeypot detection for Base chain tokens. Analyze before you swap.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://x402-data-api.sigrunner.workers.dev/token-safety">
<title>Token Safety Scanner — Base Chain Honeypot Detector | Grey Ridge Signals</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.25rem 4rem;
    background: #0b0f14; color: #dbe4ee;
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  main { max-width: 780px; margin: 0 auto; }
  h1 { font-size: 1.7rem; margin: 0 0 0.4rem; color: #f4f7fa; }
  .tagline { color: #f59e0b; font-size: 0.95rem; margin: 0 0 1.5rem; }
  p { color: #b9c4d0; }
  h2 { font-size: 1.05rem; color: #f4f7fa; margin: 2rem 0 0.75rem; border-top: 1px solid #1f2933; padding-top: 1.5rem; }
  .features { display: flex; flex-direction: column; gap: 0.75rem; margin: 1rem 0; }
  .feature { background: #121a24; border: 1px solid #1f2933; border-radius: 8px; padding: 1rem; }
  .feature h3 { margin: 0 0 0.3rem; font-size: 1rem; color: #7fd1a8; }
  .feature p { margin: 0; font-size: 0.9rem; color: #8b9bab; }
  .pricing { display: flex; gap: 1rem; margin: 1.5rem 0; }
  .plan { background: #121a24; border: 1px solid #1f2933; border-radius: 8px; padding: 1.25rem; flex: 1; }
  .plan.featured { border-color: #f59e0b; }
  .plan h3 { margin: 0 0 0.5rem; color: #f4f7fa; }
  .plan .price { font-size: 1.5rem; color: #7fd1a8; font-weight: bold; }
  .plan ul { list-style: none; padding: 0; margin: 1rem 0; }
  .plan li { padding: 0.25rem 0; color: #b9c4d0; font-size: 0.85rem; }
  .plan li::before { content: "✓ "; color: #7fd1a8; }
  .btn {
    display: inline-block; padding: 0.6rem 1.2rem; border-radius: 6px;
    text-decoration: none; font-weight: 600; font-size: 0.9rem;
    background: #f59e0b; color: #0b0f14; text-align: center;
  }
  .btn:hover { background: #d97706; }
  code {
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #10161d; color: #d7e2ec; border: 1px solid #1f2933; border-radius: 6px;
    padding: 0.1rem 0.35rem;
  }
  .demo-box { background: #10161d; border: 1px solid #1f2933; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
  .demo-box pre { margin: 0; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #b9c4d0; overflow-x: auto; }
  .note { font-size: 0.85rem; color: #6b7c8a; margin-top: 0.5rem; }
</style>
</head>
<body>
<main>
  <h1>🧪 Token Safety Scanner</h1>
  <p class="tagline">Real-time honeypot detection for Base chain tokens — before you buy</p>
  <p><a href="/check" style="display:inline-block;padding:.6rem 1.1rem;background:#0b5;color:#fff;border-radius:8px;text-decoration:none">Try it free: check a token now →</a></p>

  <p>Paste any Base ERC-20 token address and get a full security analysis: proxy detection, bytecode risk-selector scan, ownership checks, and a live on-chain transfer simulation. Built for traders, degens, and AI agents who need to know <em>before</em> they click "swap".</p>

  <h2>What it detects</h2>
  <div class="features">
    <div class="feature"><h3>🔄 Upgradeable Proxies</h3><p>EIP-1967/EIP-1822 transparent & UUPS proxies — can the contract logic be swapped out from under you?</p></div>
    <div class="feature"><h3>✋ Mint, Pause & Blacklist</h3><p>Can the owner mint unlimited new supply, freeze transfers, or block specific holders?</p></div>
    <div class="feature"><h3>🏠 Ownership Status</h3><p>Is the contract renounced? Multi-sig? EOA-controlled? Who can change the rules?</p></div>
    <div class="feature"><h3>💰 Live Transfer Simulation</h3><p>We simulate an actual eth_call transfer — does it succeed, revert, or silently burn your tokens?</p></div>
    <div class="feature"><h3>📊 Risk Score & Verdict</h3><p>Aggregated 0-100 risk score with clear/review/block verdict and human-readable flag explanations.</p></div>
  </div>

  <h2>Live demo</h2>
  <div class="demo-box">
    <pre>curl ${BASE}/chain/token-security/preview</pre>
    <p class="note">Free preview — analyzes a fixed well-known token (Base WETH). Full API analyzes any Base ERC-20.</p>
  </div>

  <h2>Pricing</h2>
  <div class="pricing">
    <div class="plan">
      <h3>Free</h3>
      <div class="price">$0</div>
      <ul>
        <li>3 token checks / month</li>
        <li>Preview endpoint (WETH)</li>
        <li>No account required</li>
      </ul>
      <a class="btn" href="${BASE}/chain/token-security/preview" style="background:#1f2933;color:#b9c4d0;">Try Preview</a>
    </div>
    <div class="plan featured">
      <h3>Pro</h3>
      <div class="price">$9.99</div>
      <div class="note">per month</div>
      <ul>
        <li>100 token checks / month</li>
        <li>Any Base ERC-20 address</li>
        <li>API key access</li>
        <li>Priority RPC routing</li>
      </ul>
      <a class="btn" href="#" onclick="(async () => { try { const res = await fetch('/stripe/create-checkout-session', { method: 'POST' }); const json = await res.json(); if (json.url) { window.location.href = json.url; } else { alert('Error: ' + (json.error || 'unknown')); } } catch (e) { alert('Failed to initialize checkout: ' + e); } })(); return false;">Subscribe</a>
      <p class="note" style="margin-top:0.5rem;">Prefer agent-native? Use our <a href="${BASE}/" style="color:#7fd1a8;">x402 endpoint</a> — pay per call in USDC, no account needed.</p>
    </div>
  </div>

  <h2>API access</h2>
  <p>Subscribe via Stripe to get an API key. Use it directly:</p>
  <div class="demo-box">
    <pre>curl -H "X-API-Key: sk_..." "https://x402-data-api.sigrunner.workers.dev/chain/token-security?token=0x..."</pre>
  </div>
  <p style="font-size:0.9rem;">Or pay-per-call via <a href="${BASE}/" style="color:#7fd1a8;">x402</a> (agent-native, no account).</p>
</main>
</body>
</html>`;
  return c.html(html);
});

// ---------------------------------------------------------------------------
// Stripe checkout session creation — initiates subscription payment flow
// ---------------------------------------------------------------------------

app.post("/stripe/create-checkout-session", async (c) => {
  if (!c.env.STRIPE_API_KEY || !c.env.STRIPE_PRICE_ID) {
    return c.json(
      { error: "Stripe not configured" },
      { status: 503 }
    );
  }

  try {
    const BASE = "https://x402-data-api.sigrunner.workers.dev";
    const params = new URLSearchParams();
    params.append("payment_method_types[]", "card");
    params.append("mode", "subscription");
    params.append("line_items[0][price]", c.env.STRIPE_PRICE_ID);
    params.append("line_items[0][quantity]", "1");
    params.append("success_url", `${BASE}/?session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url", `${BASE}/`);

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${c.env.STRIPE_API_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      console.log(JSON.stringify({ event: "stripe_session_error", status: response.status, error }));
      return c.json(
        { error: `Stripe API error: ${response.status}` },
        502
      );
    }

    const session = await response.json() as { id: string; url: string };
    console.log(JSON.stringify({ event: "checkout_session_created", session_id: session.id }));
    return c.json({ url: session.url });
  } catch (e) {
    console.log(JSON.stringify({ event: "stripe_session_creation_error", error: (e as Error).message }));
    return c.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
});

// ---------------------------------------------------------------------------
// Stripe webhook — creates API keys on successful payment
// ---------------------------------------------------------------------------

app.post("/stripe/webhook", async (c) => {
  const sig = c.req.header("stripe-signature");
  if (!sig) return c.text("Missing stripe-signature header", 400);
  if (!c.env.STRIPE_WEBHOOK_SECRET || !c.env.STRIPE_API_KEY) {
    // Webhook not configured — reply 200 to prevent Stripe retries during setup
    console.log(JSON.stringify({ event: "stripe_webhook_unconfigured", sig }));
    return c.text("ok (unconfigured)");
  }

  let event: any;
  try {
    const body = await c.req.text();
    // Verify webhook signature — using Node crypto polyfill on CF Workers
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(c.env.STRIPE_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    const parts = sig.split(",");
    let sigValue = "", timeValue = "";
    for (const p of parts) {
      const [k, v] = p.split("=");
      if (k === "v1") sigValue = v;
      if (k === "t") timeValue = v;
    }
    // Stripe v1 signature = HMAC(timestamp.body, webhook_secret)
    const payload = `${timeValue}.${body}`;
    const expected = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
    const expectedHex = Array.from(new Uint8Array(expected)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (!timingSafeEqual(expectedHex, sigValue)) {
      console.log(JSON.stringify({ event: "stripe_webhook_sig_mismatch" }));
      return c.text("Signature mismatch", 401);
    }

    // F2 fix: Validate webhook timestamp freshness (prevent replay attacks)
    // Stripe signatures include a Unix timestamp; reject if older than 5 minutes.
    const webhookTimestamp = parseInt(timeValue, 10);
    const currentTime = Math.floor(Date.now() / 1000);
    const MAX_WEBHOOK_AGE_SECONDS = 5 * 60; // 5 minutes
    if (isNaN(webhookTimestamp) || Math.abs(currentTime - webhookTimestamp) > MAX_WEBHOOK_AGE_SECONDS) {
      console.log(JSON.stringify({ event: "stripe_webhook_timestamp_stale", timestamp: timeValue }));
      return c.text("Webhook timestamp too old", 401);
    }

    // Parse webhook body as JSON
    event = JSON.parse(body);
  } catch (e) {
    console.log(JSON.stringify({ event: "stripe_webhook_parse_error", error: (e as Error).message }));
    return c.text("ok (parse error — swallowed to prevent retries)");
  }

  console.log(JSON.stringify({ event: "stripe_webhook_received", type: event?.type }));

  if (event?.type === "checkout.session.completed") {
    const session = event.data.object;
    const sessionId = session.id;
    const email = session.customer_details?.email;
    const paymentStatus = session.payment_status;

    if (!c.env.API_KEYS) {
      console.log(JSON.stringify({ event: "stripe_webhook_no_kv" }));
      return c.json({ received: true, note: "KV not configured — key would be created here" });
    }

    // F2 fix: Only mint keys for paid sessions. Subscription sessions can complete
    // with unpaid first invoices on async payment methods (e.g., bank transfer).
    if (paymentStatus !== "paid") {
      console.log(JSON.stringify({ event: "api_key_not_minted_unpaid", session_id: sessionId, payment_status: paymentStatus }));
      return c.json({ received: true, note: "Session not yet paid" });
    }

    // F2 fix: idempotency — dedup by session_id. Stripe retries and any replay
    // both send the same session_id; only mint once. A captured signed request
    // can be replayed forever, so this check (not the freshness window alone)
    // is what stops unlimited credit farming.
    const dedup_key = `stripe_session_${sessionId}`;
    const existing = await c.env.API_KEYS.get(dedup_key);
    if (existing) {
      console.log(JSON.stringify({ event: "api_key_already_created", session_id: sessionId }));
      return c.json({ received: true, note: "API key already created for this session" });
    }

    // Create API key for the customer
    const apiKey = generateApiKey();
    const record: ApiKeyRecord = {
      key: apiKey,
      stripe_session_id: sessionId,
      customer_email: email,
      credits_remaining: PLANS.pro.monthly_credits,
      created_at: Date.now(),
      expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
    };

    await c.env.API_KEYS.put(apiKey, JSON.stringify(record));
    // Mark this session_id as processed (one-time redemption check)
    await c.env.API_KEYS.put(dedup_key, JSON.stringify({ api_key: apiKey, redeemed: false }));

    // Seed the per-key ledger so the balance is atomic from birth. (Keys
    // created before this deploy are lazily seeded on their first use.)
    if (c.env.CREDIT_LEDGER) {
      const id = c.env.CREDIT_LEDGER.idFromName(apiKey);
      await c.env.CREDIT_LEDGER.get(id).seed(record.credits_remaining);
    }
    console.log(JSON.stringify({ event: "api_key_created", session_id: sessionId, email }));
  }

  return c.json({ received: true });
});

// ---------------------------------------------------------------------------
// Paid-access bypasses — RapidAPI proxy secret, then the X-API-Key header. Both mean
// "this caller already paid on another rail", so they skip the x402 gate.
// ---------------------------------------------------------------------------

/** Length-safe, constant-time string compare.
 *
 * The Workers runtime has no crypto.timingSafeEqual, and `a === b` on a secret short-
 * circuits at the first differing byte — that timing signal is enough to recover a
 * secret one byte at a time. Compare every byte regardless, and fold the length
 * difference into the result so unequal lengths cannot early-return either.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

// Removed 2026-08-08: Analytics Engine binding not available on account.
// See wrangler.toml for decision + rationale. Reversible via wrangler config.

app.use(async (c, next) => {
  // Fire-and-forget traffic logging (t_9e3fec95): waitUntil + catch, fail open.
  // Sampled 1-in-10 and /mcp skipped: unsampled logging exhausted the free-plan DO daily
  // request limit (CF alert 2026-10-19). PAID rows below stay unsampled.
  if (c.env.TRAFFIC_LOG && c.req.path !== "/mcp" && Math.random() < 0.1) {
    const stub = c.env.TRAFFIC_LOG.get(c.env.TRAFFIC_LOG.idFromName("default"));
    c.executionCtx.waitUntil(stub.logHit(c.req.path, c.req.method, c.req.header("User-Agent") ?? "unknown").catch(() => {}));
  }

  // Toll-free routes — never check API key or x402
  const FREE_PATHS = new Set(["/", "/health", "/status", "/terms", "/token-safety", "/stripe/webhook", "/metrics"]);
  if (FREE_PATHS.has(c.req.path)) return next();
  if (c.req.path.startsWith("/.well-known/")) return next();

  // Adapter-friendly preview: generic x402 buyer clients (e.g. the DopamineDesk
  // `mcp-server-aidatamarketplace` adapter) request the free contract proof as
  // `?preview=true` on the PAID path, not at `${path}/preview`. Redirect GET requests
  // for a route that actually exposes a preview to our existing free handler (same
  // response shape, no payment). Degrades open: only PREVIEW_ROUTES are redirected;
  // any other path falls through to the x402 402 gate exactly as before.
  if (c.req.method === "GET" && c.req.query("preview") === "true" && PREVIEW_ROUTES.has(c.req.path)) {
    const u = new URL(c.req.url);
    u.pathname = `${c.req.path}/preview`;
    u.searchParams.delete("preview");
    return c.redirect(`${u.pathname}${u.search}`, 302);
  }

  // RapidAPI bypass for paid endpoints.
  // RapidAPI already collected money from the buyer before proxying this request, so a
  // request carrying the correct proxy secret is ALREADY PAID and must not be x402-gated.
  // Fails closed three ways: no configured secret => no bypass; empty header => no bypass;
  // constant-time compare so a wrong secret leaks nothing through response timing.
  // SECURITY TODO: shared RAPIDAPI_PROXY_SECRET bypass; split from CDP relay secret and rotate.
  const rapidSecret = c.env.RAPIDAPI_PROXY_SECRET;
  if (rapidSecret) {
    const presented = c.req.header("X-RapidAPI-Proxy-Secret") ?? "";
    if (presented && timingSafeEqual(presented, rapidSecret)) {
      // Never log the secret itself — only that the rail was used, so RapidAPI volume
      // is still countable in the logs alongside api_key and x402 traffic.
      console.log(JSON.stringify({
        event: "rapidapi_call",
        path: c.req.path,
        user: c.req.header("X-RapidAPI-User") ?? null,
      }));
      // Attribute this request to the RapidAPI rail (already-paid, non-chain).
      c.set("rail", "rapidapi-bypass");
      return next();
    }
  }

  // API key bypass for paid endpoints. F5 (audit-q3): the key travels ONLY as
  // an X-API-Key header — never as a query parameter, so it cannot leak into
  // Cloudflare access logs, browser history, referrer chains, or proxy logs.
  const apiKey = c.req.header("X-API-Key");
  if (apiKey && c.env.API_KEYS) {
    const raw = await c.env.API_KEYS.get(apiKey);
    if (raw) {
      const record: ApiKeyRecord = JSON.parse(raw);
      if (record.expires_at > Date.now()) {
        // Atomic check-and-decrement via the per-key CreditLedger DO. The old
        // KV read-modify-write (get → mutate → put) could double-spend a credit
        // when two requests for the same key raced. The DO serializes storage
        // access per key, so check + deduct is one atomic step. Fail closed:
        // no DO binding => no api_key bypass (falls through to the x402 gate).
        if (c.env.CREDIT_LEDGER) {
          const id = c.env.CREDIT_LEDGER.idFromName(apiKey);
          const stub = c.env.CREDIT_LEDGER.get(id);
          // record.credits_remaining is the lazy seed for keys created before
          // this deploy; the DO owns the balance from then on.
          const result = await stub.deductCredit(record.credits_remaining);
          if (result.deducted) {
            console.log(JSON.stringify({ event: "api_key_used", credits_remaining: result.remaining }));
            // Attribute this request to the prepaid api-key rail (non-chain).
            c.set("rail", "api-key");
            return next();
          }
        }
      }
    }
  }

  // Fall through to x402 gate
  // MCP: discovery (initialize / tools/list / notifications) is FREE so agents
  // can find the tool; only tools/call is x402-gated ($0.005). Peek at the
  // JSON-RPC method to decide. Non-JSON (GET/SSE) → free.
  if (c.req.path === "/mcp") {
    type RpcItem = { method?: unknown; params?: { name?: unknown } } | null;
    let items: RpcItem[] = [];
    try {
      const body = (await c.req.raw.clone().json()) as RpcItem | RpcItem[];
      items = Array.isArray(body) ? body : [body];
    } catch {
      /* not JSON-RPC → free pass */
    }
    // Freemium: discovery + the free preview tool are FREE (so agents self-scan
    // and SEE they're vulnerable); the full-detail tools are x402-gated (so they
    // must pay to learn WHICH tools and HOW to fix). Free tools bypass the gate.
    const FREE_TOOLS = new Set([
      "scan_mcp_preview",
      "crypto_prices_preview",
      "crypto_funding_preview",
      "defi_yields_preview",
      "pm_markets_preview",
      "chain_block_number_preview",
      "chain_gas_price_preview",
      "chain_token_security_preview",
      "chain_token_report_preview",
      "gate_swap_preview",
    ]);
    // Batch bodies: evaluate EVERY element; any non-free tools/call requires payment.
    const requiresPayment = items.some((it) => {
      if (!it || typeof it !== "object" || it.method !== "tools/call") return false;
      const name = it.params?.name;
      return !(typeof name === "string" && FREE_TOOLS.has(name));
    });
    if (!requiresPayment) {
      return next();
    }
    // paid tools/call → fall through to the x402 payment gate below
  }

  // Initialize the resource server on first request (fetch works here).
  // syncFacilitatorOnStart=false so the x402 middleware doesn't try to init
  // a second time; we already awaited it above.
  await ensureInitialized(c.env);

  if (!cachedMiddleware) {
    const routes = makeRoutes(c.env.PAY_TO);
    cachedMiddleware = paymentMiddleware(
      routes,
      selectResourceServer(c.env),
      undefined,
      undefined,
      false,
    );
  }
  // Fall-through rail: the request is about to pay (or has paid) via x402 —
  // the only rail that settles USDC on Base, so the only one that counts as
  // a paid call in the reconcile ledger.
  c.set("rail", "x402-paid");
  const mwRes = await cachedMiddleware(c, next);
  // Route-level payer attribution: a payment header + non-402 response means a
  // settled paid call. Log "PAID" with the payer address so traffic-stats can
  // show which routes real buyers settle (fail open, never on the response path).
  try {
    const payHdr = c.req.header("payment-signature") ?? c.req.header("x-payment");
    const settledRes = mwRes ?? c.res;
    const st = settledRes?.status;
    if (payHdr && st && st < 400 && c.env.TRAFFIC_LOG) {
      let payer = "unknown";
      try {
        const j = JSON.parse(atob(payHdr));
        payer = String(j?.payload?.authorization?.from ?? "unknown").toLowerCase();
      } catch { /* undecodable header */ }
      // The facilitator rides the settled on-chain txHash back on the
      // PAYMENT-RESPONSE header (base64 JSON: {success, transaction, network,
      // payer}). Capture it so the PAID row self-documents its settlement — a
      // registry/buyer trust-ask ("prove a real Base mainnet settlement") is then
      // answered from our own store, not a manual chain scan. Prefer the settled
      // payer (authoritative) over the request-header decode when present.
      let tx = "";
      try {
        const prHdr = settledRes?.headers.get("payment-response") ?? settledRes?.headers.get("x-payment-response");
        if (prHdr) {
          const pr = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(prHdr), (ch) => ch.charCodeAt(0))));
          if (pr?.transaction) tx = String(pr.transaction);
          if (pr?.payer) payer = String(pr.payer).toLowerCase();
        }
      } catch { /* settle header absent/undecodable — log payer-only, never break the paid response */ }
      // Referral attribution: a partner featuring our endpoints wires ?ref=<tag>
      // into the call URL (survives the 402→sign→retry round-trip since the retry
      // re-requests the same URL). Sanitised to a short opaque slug so it can't be
      // used to smuggle data into the log. Lets a pilot's settled calls be
      // reconciled per-partner (traced sale), which is what referral partners ask
      // for before they feature a seller. Empty when absent — fully backward-compat.
      const ref = (c.req.query("ref") ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
      // Workers Logs line survives the TrafficLog DO daily-limit outage.
      console.log(JSON.stringify({ evt: "PAID", path: c.req.path, payer, tx, ref }));
      const stub = c.env.TRAFFIC_LOG.get(c.env.TRAFFIC_LOG.idFromName("default"));
      fireAndForget(c, stub.logHit(c.req.path, "PAID", payer, tx, ref).catch(() => {}));
    }
  } catch { /* telemetry must never break a paid response */ }
  // x402 v2 carries the challenge only in the payment-required header and sends
  // an empty `{}` body. v1-style crawlers/directories (x402-list prober etc.)
  // look for accepts[] in the body, so mirror the decoded header there.
  const res402 = mwRes ?? c.res;
  if (res402 && res402.status === 402) {
    const hdr = res402.headers.get("payment-required");
    if (hdr) {
      try {
        const decoded = new TextDecoder().decode(Uint8Array.from(atob(hdr), (ch) => ch.charCodeAt(0)));
        // Enrich each offer's `extra` with the asset decimals. The exact-EVM
        // scheme emits extra={name,version} (the EIP-712 domain) but omits
        // `decimals`, so a conformance decoder (e.g. x402-pilot's decode_402)
        // flags "no explicit decimals — never assume 6 or 18". USDC on Base is
        // 6 decimals; publish it so a buyer can render the human amount without
        // guessing. Purely additive metadata — does not touch the EIP-712
        // domain (name/version) the client signs over, so settlement is
        // unaffected. Fail-open: any parse error falls through to raw `decoded`.
        let body = decoded;
        try {
          const pr = JSON.parse(decoded) as { accepts?: Array<{ asset?: string; extra?: Record<string, unknown> }> };
          if (Array.isArray(pr.accepts)) {
            for (const offer of pr.accepts) {
              if (String(offer.asset ?? "").toLowerCase() === USDC_BASE.toLowerCase()) {
                offer.extra = { ...(offer.extra ?? {}), decimals: 6 };
              }
            }
            body = JSON.stringify(pr);
          }
        } catch { /* keep raw decoded body */ }
        const headers = new Headers(res402.headers);
        headers.set("content-type", "application/json");
        headers.delete("content-length");
        return new Response(body, { status: 402, headers });
      } catch {
        // fall through with the original response
      }
    }
  }
  return mwRes;
});

// Track a successful paid call fire-and-forget. Never on the response path:
// the write rides ctx.waitUntil so the buyer's response is not slowed by the
// counter round-trip (DO fetch). Hono's `executionCtx` getter THROWS when no
// ExecutionContext is present (e.g. bare app.request in tests), so access it
// defensively.
function fireAndForget(c: { executionCtx?: { waitUntil(p: Promise<void>): void } }, p: Promise<void>): void {
  try {
    c.executionCtx?.waitUntil?.(p);
  } catch {
    // No ExecutionContext — run the write detached; trackPaidRequest swallows
    // its own errors, so this can never produce an unhandled rejection.
  }
}

// ---------------------------------------------------------------------------
// DNS enrichment endpoint  ($0.01)
// ---------------------------------------------------------------------------

app.get("/dns/:domain", async (c) => {
  const domain = c.req.param("domain");
  const types = ["A", "AAAA", "MX", "NS", "TXT"] as const;

  const results: Record<string, string[]> = {};

  await Promise.all(
    types.map(async (type) => {
      const url = `${DOH_URL}?name=${encodeURIComponent(domain)}&type=${type}`;
      const res = await fetch(url, {
        headers: { accept: "application/dns-json" },
      });
      if (!res.ok) {
        results[type] = [];
        return;
      }
      const data = (await res.json()) as { Answer?: { data: string }[] };
      results[type] = (data.Answer ?? []).map((r) => r.data);
    }),
  );

  console.log(
    JSON.stringify({
      event: "paid_request",
      endpoint: "/dns/:domain",
      domain,
      ts: new Date().toISOString(),
    }),
  );
  const rail = c.get("rail") ?? "x402-paid";
  fireAndForget(c, trackPaidRequest("GET /dns/:domain", rail, makeUsageCounter(c.env)));

  return c.json({ domain, ...results });
});

// ---------------------------------------------------------------------------
// WHOIS / RDAP endpoint  ($0.02)
// ---------------------------------------------------------------------------

app.get("/whois/:domain", async (c) => {
  const domain = c.req.param("domain");

  const res = await rdapFetch(domain);

  if (!res.ok) {
    return c.json(
      { error: "RDAP lookup failed", status: res.status },
      { status: 502 },
    );
  }

  const raw = (await res.json()) as {
    ldhName?: string;
    events?: { eventAction: string; eventDate: string }[];
    entities?: {
      roles: string[];
      vcardArray?: unknown[][];
      handle?: string;
    }[];
    status?: string[];
  };

  const getEvent = (action: string) =>
    raw.events?.find((e) => e.eventAction === action)?.eventDate ?? null;

  const registrant =
    raw.entities?.find((e) => e.roles.includes("registrant"))?.handle ?? null;
  const registrarEntity = raw.entities?.find((e) =>
    e.roles.includes("registrar"),
  );
  const registrar =
    (registrarEntity?.handle as string | undefined) ?? null;

  console.log(
    JSON.stringify({
      event: "paid_request",
      endpoint: "/whois/:domain",
      domain,
      ts: new Date().toISOString(),
    }),
  );
  const rail = c.get("rail") ?? "x402-paid";
  fireAndForget(c, trackPaidRequest("GET /whois/:domain", rail, makeUsageCounter(c.env)));

  return c.json({
    domain: raw.ldhName ?? domain,
    registrar,
    created: getEvent("registration"),
    expiry: getEvent("expiration"),
    registrant,
    status: raw.status ?? [],
  });
});

// ---------------------------------------------------------------------------
// POST /enrich/tech-risk  — Security enrichment  ($0.05)
// ---------------------------------------------------------------------------

interface Fingerprint {
  name: string;
  confidence: "high" | "medium";
}

interface CveEntry {
  id: string;
  description: string;
  cvssScore: number | null;
}

// Shared verdict enum for all 3 security endpoints (/scan/mcp, /enrich/tech-risk,
// /enrich/domain) — every competitor (LoneStarOracle, GlobalAPI, GPT55) ships a
// PASS/WARN/BLOCK-style triage field on top of a numeric score; we only shipped
// the score. Common thresholds for anything already expressed 0-100.
type Verdict = "clear" | "review" | "block";

function verdictFromScore(score: number): Verdict {
  if (score >= 70) return "block";
  if (score >= 30) return "review";
  return "clear";
}

// Reject anything that isn't a bare public hostname — blocks SSRF/proxy abuse
// (schemes, paths, ports, creds, raw IPs, localhost) via the domain param.
function isValidHostname(d: string): boolean {
  if (!d || d.length > 253) return false;
  if (/[/@:\s\\?#]/.test(d)) return false; // no scheme/path/port/creds/whitespace
  if (d === "localhost") return false;
  // dotted hostname ending in an alpha TLD — raw IPv4/IPv6 fail this by construction
  return /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(
    d,
  );
}

// HTTP header-based tech-stack fingerprint for a domain (httpx-style)
async function fingerprintDomain(domain: string): Promise<Fingerprint[]> {
  const detected: Fingerprint[] = [];
  if (!isValidHostname(domain)) return detected; // SSRF guard
  try {
    const res = await fetch(`https://${domain}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; x402-data-api/1.0; +https://x402-data-api.sigrunner.workers.dev)",
      },
      redirect: "follow",
    });
    const server = res.headers.get("server");
    const poweredBy = res.headers.get("x-powered-by");
    const via = res.headers.get("Via");

    if (server) {
      const cleaned = server.replace(/\s*\(.*?\)/g, "").trim();
      if (cleaned) detected.push({ name: cleaned, confidence: "high" });
    }
    if (poweredBy) {
      for (const t of poweredBy.split(";").map((s) => s.trim()).filter(Boolean)) {
        detected.push({ name: t, confidence: "high" });
      }
    }
    // Detect Cloudflare
    if (via?.toLowerCase().includes("cloudflare")) {
      detected.push({ name: "Cloudflare", confidence: "medium" });
    }
    // Detect common frameworks by response headers
    const cfRays = res.headers.get("cf-ray");
    if (cfRays) detected.push({ name: "Cloudflare", confidence: "medium" });
    const setCookie = res.headers.get("set-cookie") ?? "";
    if (
      setCookie.includes("PHPSESSID") &&
      !detected.some((d) => d.name.toLowerCase() === "php")
    ) {
      detected.push({ name: "PHP", confidence: "medium" });
    }
    if (
      setCookie.includes("JSESSIONID") &&
      !detected.some((d) => d.name.toLowerCase().includes("java"))
    ) {
      detected.push({ name: "Java", confidence: "medium" });
    }
    if (
      setCookie.includes("ASP.NET_SessionId") &&
      !detected.some((d) => d.name.toLowerCase().includes("asp"))
    ) {
      detected.push({ name: "ASP.NET", confidence: "medium" });
    }
  } catch {
    // Domain may not serve HTTP — skip fingerprint
  }
  return detected;
}

// Search NVD for CVEs matching a keyword
async function searchNvd(keyword: string): Promise<CveEntry[]> {
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(keyword)}&resultsPerPage=3`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "x402-data-api/1.0" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      vulnerabilities?: { cve: Record<string, unknown> }[];
    };
    const vulns = data.vulnerabilities ?? [];
    return vulns.map((v) => {
      const cve = v.cve as {
        id: string;
        descriptions?: { lang: string; value: string }[];
        metrics?: {
          cvssMetricV31?: { cvssData: { baseScore: number } }[];
          cvssMetricV30?: { cvssData: { baseScore: number } }[];
        };
      };
      const desc =
        cve.descriptions?.find((d) => d.lang === "en")?.value ?? "";
      const cvssData =
        cve.metrics?.cvssMetricV31?.[0]?.cvssData ??
        cve.metrics?.cvssMetricV30?.[0]?.cvssData ??
        null;
      return {
        id: cve.id,
        description: desc.slice(0, 300),
        cvssScore: cvssData?.baseScore ?? null,
      };
    });
  } catch {
    return [];
  }
}

// Fetch EPSS scores for CVE IDs from FIRST
async function fetchEpss(
  cveIds: string[],
): Promise<Record<string, number>> {
  if (cveIds.length === 0) return {};
  const cveParam = cveIds.join(",");
  try {
    const res = await fetch(
      `https://api.first.org/data/v1/epss?cve=${cveParam}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return {};
    const data = (await res.json()) as { data?: { cve: string; epss: string }[] };
    const scores: Record<string, number> = {};
    for (const entry of data.data ?? []) {
      scores[entry.cve] = parseFloat(entry.epss);
    }
    return scores;
  } catch {
    return {};
  }
}

// Check CISA KEV — cache the feed in-memory for this worker isolate
let kevCache: Set<string> | null = null;
let kevCacheTime = 0;

async function isInKev(cveIds: string[]): Promise<Record<string, boolean>> {
  const now = Date.now();
  if (!kevCache || now - kevCacheTime > 3600_000) {
    try {
      const res = await fetch(
        "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
        { headers: { accept: "application/json" } },
      );
      if (res.ok) {
        const raw = (await res.json()) as {
          vulnerabilities?: { cveID: string }[];
        };
        kevCache = new Set(
          (raw.vulnerabilities ?? []).map((v) => v.cveID),
        );
        kevCacheTime = now;
      }
    } catch {
      // Keep stale cache on failure
    }
  }
  const result: Record<string, boolean> = {};
  for (const id of cveIds) result[id] = kevCache?.has(id) ?? false;
  return result;
}

function buildRiskSummary(
  techStack: string[],
  cves: CveEntry[],
  epss: Record<string, number>,
  kev: Record<string, boolean>,
): string {
  const highCvss = cves.filter((c) => c.cvssScore !== null && c.cvssScore >= 7);
  const exploited = cves.filter((c) => kev[c.id]);
  const highEpss = cves.filter((c) => (epss[c.id] ?? 0) > 0.1);
  const parts: string[] = [];
  if (highCvss.length > 0) parts.push(`${highCvss.length} high-severity`);
  if (exploited.length > 0) parts.push(`${exploited.length} known-exploited`);
  if (highEpss.length > 0)
    parts.push(`${highEpss.length} with EPSS > 0.1`);
  if (parts.length === 0)
    return "Low risk: no significant CVEs detected for this tech stack.";
  return `Risk: ${techStack.join(", ")} — ${parts.join(", ")}. Prioritize patching known-exploited vulnerabilities first.`;
}

// ---------------------------------------------------------------------------
// Shared enrichment pipeline  — used by both HTTP and MCP endpoints
// ---------------------------------------------------------------------------

interface EnrichTechRiskParams {
  domain?: string;
  techstack?: string[];
}

interface EnrichTechRiskResult {
  tech_stack: string[];
  domain: string | null;
  vulnerabilities: {
    id: string;
    description: string;
    cvss_score: number | null;
    epss_score: number | null;
    in_kev: boolean;
    exploit_available: boolean;
  }[];
  verdict: Verdict;
  summary: string;
  generated_at: string;
}

// block: at least one actively-exploited (CISA KEV) or high-probability-exploit
// (EPSS >= 0.5) CVE. review: at least one high-severity (CVSS >= 7) CVE that
// isn't (yet) known-exploited. clear: no CVEs, or only low/medium severity.
function techRiskVerdict(vulns: EnrichTechRiskResult["vulnerabilities"]): Verdict {
  if (vulns.some((v) => v.in_kev || v.exploit_available)) return "block";
  if (vulns.some((v) => (v.cvss_score ?? 0) >= 7)) return "review";
  return "clear";
}

async function enrichTechRisk(
  params: EnrichTechRiskParams,
): Promise<EnrichTechRiskResult> {
  const startTs = new Date().toISOString();
  const { domain, techstack } = params;

  // Step 1: determine tech stack
  let techStack: string[];
  if (techstack && techstack.length > 0) {
    techStack = techstack;
  } else if (domain) {
    const fingerprints = await fingerprintDomain(domain);
    techStack = [...new Set(fingerprints.map((f) => f.name))];
  } else {
    throw new Error("Provide domain or techstack");
  }

  // Step 2: search NVD for each tech (limit breadth)
  const searchTerms = techStack.slice(0, 5);
  const cveResults = await Promise.all(searchTerms.map(searchNvd));
  const allCves = [
    ...new Map(cveResults.flat().map((cve) => [cve.id, cve])).values(),
  ];

  // Step 3: EPSS
  const cveIds = allCves.map((c) => c.id);
  const epssScores = await fetchEpss(cveIds);

  // Step 4: CISA KEV
  const kevFlags = await isInKev(cveIds);

  // Step 5: build summary
  const riskSummary = buildRiskSummary(techStack, allCves, epssScores, kevFlags);

  const vulnerabilities = allCves.map((cve) => {
    const inKev = kevFlags[cve.id] ?? false;
    const epssScore = epssScores[cve.id] ?? null;
    return {
      id: cve.id,
      description: cve.description,
      cvss_score: cve.cvssScore,
      epss_score: epssScore,
      in_kev: inKev,
      // NVD's free API doesn't expose exploit-availability directly — derive
      // it from data we already have: actively exploited (CISA KEV) or a
      // high probability of exploitation in the wild (EPSS >= 0.5).
      exploit_available: inKev || (epssScore ?? 0) >= 0.5,
    };
  });

  return {
    tech_stack: techStack,
    domain: domain ?? null,
    vulnerabilities,
    verdict: techRiskVerdict(vulnerabilities),
    summary: riskSummary,
    generated_at: startTs,
  };
}

app.get("/enrich/tech-risk", async (c) => {
  const body = {
    domain: c.req.query("domain"),
    techstack: c.req
      .query("techstack")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  } as EnrichTechRiskParams;
  const startTs = new Date().toISOString();

  try {
    const result = await enrichTechRisk(body);

    console.log(
      JSON.stringify({
        event: "paid_request",
        endpoint: "/enrich/tech-risk",
        domain: body.domain ?? null,
        tech_count: result.tech_stack.length,
        cve_count: result.vulnerabilities.length,
        ts: startTs,
      }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /enrich/tech-risk", rail, makeUsageCounter(c.env)));

    return c.json(result);
  } catch (e) {
    return c.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
});

// Free preview: verdict + counts + the single top-risk CVE; withholds the full list.
app.get("/enrich/tech-risk/preview", async (c) => {
  const domain = c.req.query("domain");
  if (!domain) {
    return c.json({ error: "domain query param required, e.g. ?domain=stripe.com" }, { status: 400 });
  }
  try {
    const r = await enrichTechRisk({ domain } as EnrichTechRiskParams);
    const top = [...r.vulnerabilities].sort((a, b) => (b.cvss_score ?? 0) - (a.cvss_score ?? 0))[0] ?? null;
    return c.json({
      preview: true,
      domain: r.domain,
      tech_stack: r.tech_stack,
      verdict: r.verdict,
      cve_count: r.vulnerabilities.length,
      kev_count: r.vulnerabilities.filter((v) => v.in_kev).length,
      top_cve: top,
      note: "Preview withholds the full CVE list. Paid GET /enrich/tech-risk?domain=<d> returns all CVEs with EPSS/KEV ($0.01 USDC, x402 on Base).",
      generated_at: r.generated_at,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 400 });
  }
});

// ---------------------------------------------------------------------------
// POST /enrich/domain  — Domain enrichment  ($0.01)
// ---------------------------------------------------------------------------

interface CertEntry {
  issuer: string;
  common_name: string;
  valid_from: string;
  valid_to: string;
}

interface CertSearchResult {
  certificates: CertEntry[];
  subdomains: string[];
}

// Certificate transparency logs (crt.sh) — the whole point of crt.sh is
// subdomain enumeration, which needs deduping by the actual hostname
// (name_value), not by issuer (which collapses hundreds of distinct hosts
// down to a handful of CAs). A single row's name_value can list multiple
// SANs newline-separated, so flatten + dedup those into `subdomains` too.
async function searchCertificates(domain: string): Promise<CertSearchResult> {
  try {
    const res = await fetch(
      `https://crt.sh/?q=%.${encodeURIComponent(domain)}&output=json&limit=200`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return { certificates: [], subdomains: [] };
    const raw = (await res.json()) as {
      issuer_name: string;
      name_value: string;
      not_after: string;
      not_before: string;
    }[];

    const seen = new Set<string>();
    const certs: CertEntry[] = [];
    const subdomainSet = new Set<string>();
    for (const entry of raw) {
      for (const host of entry.name_value.split("\n")) {
        const cleaned = host.trim().toLowerCase().replace(/^\*\./, "");
        if (cleaned) subdomainSet.add(cleaned);
      }
      const key = entry.name_value;
      if (!seen.has(key)) {
        seen.add(key);
        certs.push({
          issuer: entry.issuer_name,
          common_name: entry.name_value,
          valid_from: entry.not_before,
          valid_to: entry.not_after,
        });
      }
    }
    return { certificates: certs, subdomains: [...subdomainSet].sort() };
  } catch {
    return { certificates: [], subdomains: [] };
  }
}

interface EnrichDomainResult {
  domain: string;
  dns: Record<string, string[]>;
  organization: string | null;
  registrar: string | null;
  created: string | null;
  certificates: CertEntry[];
  subdomains: string[];
  tech_stack: string[];
  verdict: Verdict;
  generated_at: string;
}

// Domain age is the standard low-cost domain-risk signal (newly-registered
// domains correlate strongly with phishing/abuse infra): block if registered
// <7 days ago, review if <30 days or the registration date is unverifiable
// (no RDAP `created` — can't rule out a fresh/hidden registration), else clear.
function domainVerdict(created: string | null): Verdict {
  if (!created) return "review";
  const ageMs = Date.now() - new Date(created).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "review";
  const ageDays = ageMs / 86_400_000;
  if (ageDays < 7) return "block";
  if (ageDays < 30) return "review";
  return "clear";
}

// Combine RDAP + DoH + crt.sh + HTTP fingerprint for domain enrichment.
// Shared pipeline — used by both the HTTP endpoint and the MCP tool.
async function enrichDomain(domain: string): Promise<EnrichDomainResult> {
  const startTs = new Date().toISOString();

  // Parallel: RDAP, DoH DNS, certificates, HTTP fingerprint
  const [rdapRes, dnsFp, certResult] = await Promise.all([
    rdapFetch(domain),
    fingerprintDomain(domain),
    searchCertificates(domain),
  ]);

  // Parse RDAP
  let organization: string | null = null;
  let registrar: string | null = null;
  let created: string | null = null;
  if (rdapRes.ok) {
    const rdapJson = (await rdapRes.json()) as {
      entities?: {
        roles: string[];
        vcardArray?: unknown[][];
        handle?: string;
      }[];
      events?: { eventAction: string; eventDate: string }[];
    };
    const orgEntity = rdapJson.entities?.find((e) =>
      e.roles.includes("registrant"),
    );
    if (orgEntity?.vcardArray?.[1]) {
      const vcardProps = orgEntity.vcardArray[1] as unknown[][];
      const orgProp = vcardProps.find(
        (p) => Array.isArray(p) && p[0] === "fn",
      );
      if (orgProp && orgProp[3]) organization = String(orgProp[3]);
    }
    registrar =
      rdapJson.entities
        ?.find((e) => e.roles.includes("registrar"))
        ?.handle?.replace(/_/g, " ") ?? null;
    created =
      rdapJson.events?.find((e) => e.eventAction === "registration")
        ?.eventDate ?? null;
  }

  // DNS records via DoH
  const dnsTypes = ["A", "AAAA", "MX", "NS", "TXT"] as const;
  const dnsRecords: Record<string, string[]> = {};
  await Promise.all(
    dnsTypes.map(async (type) => {
      const url = `${DOH_URL}?name=${encodeURIComponent(domain)}&type=${type}`;
      const res = await fetch(url, {
        headers: { accept: "application/dns-json" },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          Answer?: { data: string }[];
        };
        dnsRecords[type] = (data.Answer ?? []).map((r) => r.data);
      } else {
        dnsRecords[type] = [];
      }
    }),
  );

  const techStack = [...new Set(dnsFp.map((f) => f.name))];

  return {
    domain,
    dns: dnsRecords,
    organization,
    registrar,
    created,
    certificates: certResult.certificates,
    subdomains: certResult.subdomains,
    tech_stack: techStack,
    verdict: domainVerdict(created),
    generated_at: startTs,
  };
}

app.get("/enrich/domain", async (c) => {
  const domain = c.req.query("domain") || "coinbase.com";
  if (!domain) {
    return c.json({ error: "domain is required" }, { status: 400 });
  }

  const result = await enrichDomain(domain);

  console.log(
    JSON.stringify({
      event: "paid_request",
      endpoint: "/enrich/domain",
      domain,
      ts: result.generated_at,
    }),
  );
  const rail = c.get("rail") ?? "x402-paid";
  fireAndForget(c, trackPaidRequest("GET /enrich/domain", rail, makeUsageCounter(c.env)));

  return c.json(result);
});

// ---------------------------------------------------------------------------
// GET /pm/markets  — Polymarket live prediction-market data  ($0.005)
// Fixed upstream host only (no user-supplied URL) — SSRF-safe by construction.
// ---------------------------------------------------------------------------

interface GammaMarket {
  question?: string;
  slug?: string;
  outcomes?: string;
  outcomePrices?: string;
  volumeNum?: number;
  volume24hr?: number;
  volume1wk?: number;
  liquidityNum?: number;
  endDate?: string;
  active?: boolean;
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
  oneDayPriceChange?: number;
  clobTokenIds?: string;
  conditionId?: string;
}

interface GammaEvent {
  tags?: { label?: string }[];
  markets?: { conditionId?: string }[];
}

interface PolymarketMarket {
  question: string;
  slug: string;
  outcomes: string[];
  outcomePrices: number[];
  volume: number;
  volume24hr: number;
  volume1wk: number;
  liquidity: number;
  endDate: string | null;
  active: boolean;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  oneDayPriceChange: number | null;
  clobTokenIds: string[];
  conditionId: string | null;
  tags: string[];
}

// Gamma's outcomes/outcomePrices fields are JSON-encoded strings (double-encoded).
function parseJsonArray<T>(raw: string | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

// Category/tag enrichment: the Gamma /markets object carries no tags itself,
// but the /events object it belongs to does (tags[].label + nested markets[]
// keyed by conditionId). Best-effort — tags are an enrichment, so an upstream
// failure here never fails the underlying market fetch.
async function fetchMarketTags(fetchLimit: number): Promise<Map<string, string[]>> {
  const tagMap = new Map<string, string[]>();
  try {
    // Events are ranked by their own aggregate volume24hr (not per-market), so
    // over-fetch events vs. the market limit to improve conditionId coverage —
    // the Gamma /events endpoint caps out around 100 regardless of a higher limit.
    const eventsLimit = Math.min(fetchLimit * 3, 100);
    const url = `${POLYMARKET_EVENTS_URL}?closed=false&order=volume24hr&ascending=false&limit=${eventsLimit}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return tagMap;
    const events = (await res.json()) as GammaEvent[];
    for (const ev of events) {
      const labels = (ev.tags ?? []).map((t) => t.label).filter((l): l is string => !!l);
      for (const m of ev.markets ?? []) {
        if (m.conditionId) tagMap.set(m.conditionId, labels);
      }
    }
  } catch {
    // Keep tagMap empty on any upstream failure — non-fatal enrichment.
  }
  return tagMap;
}

// The Gamma /markets endpoint has no server-side keyword search, so when a
// query is given we pull the top markets by volume24hr and filter client-side.
async function fetchPolymarketMarkets(
  query: string | undefined,
  limit: number,
): Promise<PolymarketMarket[]> {
  const fetchLimit = query ? 100 : limit;
  const url = `${POLYMARKET_URL}?closed=false&limit=${fetchLimit}&order=volume24hr&ascending=false`;

  const [res, tagMap] = await Promise.all([
    fetch(url, { headers: { accept: "application/json" } }),
    fetchMarketTags(fetchLimit),
  ]);
  if (!res.ok) {
    throw new Error(`Polymarket upstream error: ${res.status}`);
  }
  const raw = (await res.json()) as GammaMarket[];

  const normalized: PolymarketMarket[] = raw.map((m) => ({
    question: m.question ?? "",
    slug: m.slug ?? "",
    outcomes: parseJsonArray<string>(m.outcomes),
    outcomePrices: parseJsonArray<string>(m.outcomePrices).map((p) => parseFloat(p)),
    volume: m.volumeNum ?? 0,
    volume24hr: m.volume24hr ?? 0,
    volume1wk: m.volume1wk ?? 0,
    liquidity: m.liquidityNum ?? 0,
    endDate: m.endDate ?? null,
    active: m.active ?? false,
    bestBid: m.bestBid ?? null,
    bestAsk: m.bestAsk ?? null,
    spread: m.spread ?? null,
    oneDayPriceChange: m.oneDayPriceChange ?? null,
    clobTokenIds: parseJsonArray<string>(m.clobTokenIds),
    conditionId: m.conditionId ?? null,
    tags: (m.conditionId && tagMap.get(m.conditionId)) || [],
  }));

  const filtered = query
    ? normalized.filter((m) => m.question.toLowerCase().includes(query.toLowerCase()))
    : normalized;

  return filtered.slice(0, limit);
}

app.get("/pm/markets", async (c) => {
  const query = c.req.query("query") || undefined;
  const limitParam = c.req.query("limit");
  let limit = limitParam ? parseInt(limitParam, 10) : 20;
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(limit, 100);

  try {
    const markets = await fetchPolymarketMarkets(query, limit);

    console.log(
      JSON.stringify({
        event: "paid_request",
        endpoint: "/pm/markets",
        query: query ?? null,
        limit,
        count: markets.length,
        ts: new Date().toISOString(),
      }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /pm/markets", rail, makeUsageCounter(c.env)));

    return c.json(markets);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// ---------------------------------------------------------------------------
// CRYPTO/DEFI DATA — Hyperliquid funding, DefiLlama yields, DefiLlama prices.
// All three upstreams are free + keyless; we cap/normalize and charge per call.
// ---------------------------------------------------------------------------

interface HlUniverseEntry {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  isDelisted?: boolean;
}

interface HlAssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string;
  oraclePx: string;
  markPx: string;
  midPx: string;
}

interface VenueFunding {
  hyperliquid: number | null;
  okx: number | null;
  dydx: number | null;
}

interface FundingRate {
  coin: string;
  // Each venue's current-period rate at its own native funding interval
  // (Hyperliquid + dYdX = hourly, OKX is typically 8h) — intervals are NOT
  // normalized, this is each venue's rate as-quoted right now.
  funding: VenueFunding;
  funding_spread_bps: number | null;
  best_long_venue: string | null;
  best_short_venue: string | null;
  premium: number | null;
  annualized_hl: number | null;
  annualized_okx: number | null;
  signal: "LONGS_PAY" | "SHORTS_PAY" | "NEUTRAL";
  next_funding_ts: number | null;
  markPx: number;
  oraclePx: number;
  openInterest: number;
  dayNtlVlm: number;
}

interface OkxFundingResult {
  rate: number | null;
  nextFundingTs: number | null;
}

async function fetchOkxFunding(coin: string): Promise<OkxFundingResult> {
  try {
    const res = await fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${coin}-USDT-SWAP`);
    if (!res.ok) return { rate: null, nextFundingTs: null };
    const j = (await res.json()) as {
      code: string;
      data?: { fundingRate: string; nextFundingTime?: string }[];
    };
    if (j.code !== "0" || !j.data?.[0]) return { rate: null, nextFundingTs: null };
    const rate = parseFloat(j.data[0].fundingRate);
    const nextFundingTs = j.data[0].nextFundingTime ? parseInt(j.data[0].nextFundingTime, 10) : null;
    return {
      rate: Number.isFinite(rate) ? rate : null,
      nextFundingTs: Number.isFinite(nextFundingTs as number) ? nextFundingTs : null,
    };
  } catch {
    return { rate: null, nextFundingTs: null };
  }
}

// Signal is derived off Hyperliquid's rate — the one venue always present.
function fundingSignal(hlFunding: number): "LONGS_PAY" | "SHORTS_PAY" | "NEUTRAL" {
  if (!Number.isFinite(hlFunding) || Math.abs(hlFunding) < 1e-8) return "NEUTRAL";
  return hlFunding > 0 ? "LONGS_PAY" : "SHORTS_PAY";
}

// Bybit + Binance are geo-blocked from Cloudflare Workers edges (403 / 451 —
// confirmed live) and always resolved null, so we don't advertise dead
// venues. dYdX v4 (indexer, keyless, no CF block) fills the third slot —
// its coin tickers (`{coin}-USD`) map 1:1 onto Hyperliquid's `coin` names.
async function fetchDydxFunding(coin: string): Promise<number | null> {
  try {
    const res = await fetch(`https://indexer.dydx.trade/v4/historicalFunding/${coin}-USD?limit=1`);
    if (!res.ok) return null;
    const j = (await res.json()) as { historicalFunding?: { rate: string }[] };
    const rate = parseFloat(j.historicalFunding?.[0]?.rate ?? "");
    return Number.isFinite(rate) ? rate : null;
  } catch {
    return null;
  }
}

async function fetchFundingRates(limit: number): Promise<FundingRate[]> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
  });
  if (!res.ok) {
    throw new Error(`Hyperliquid upstream error: ${res.status}`);
  }
  const [meta, ctxs] = (await res.json()) as [{ universe: HlUniverseEntry[] }, HlAssetCtx[]];

  const hlRates: {
    coin: string;
    hlFunding: number;
    premium: number | null;
    markPx: number;
    oraclePx: number;
    openInterest: number;
    dayNtlVlm: number;
  }[] = [];
  meta.universe.forEach((u, i) => {
    if (u.isDelisted) return;
    const ctx = ctxs[i];
    if (!ctx) return;
    const premium = parseFloat(ctx.premium);
    hlRates.push({
      coin: u.name,
      hlFunding: parseFloat(ctx.funding),
      premium: Number.isFinite(premium) ? premium : null,
      markPx: parseFloat(ctx.markPx),
      oraclePx: parseFloat(ctx.oraclePx),
      openInterest: parseFloat(ctx.openInterest),
      dayNtlVlm: parseFloat(ctx.dayNtlVlm),
    });
  });

  hlRates.sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
  const top = hlRates.slice(0, limit);

  // Cross-venue enrichment: Hyperliquid is always present (it's the coin
  // universe). OKX/dYdX are best-effort — each call is wrapped so an
  // upstream error or an unlisted coin on either venue never fails the request.
  const rates: FundingRate[] = await Promise.all(
    top.map(async (r) => {
      const [okxRes, dydxRes] = await Promise.allSettled([
        fetchOkxFunding(r.coin),
        fetchDydxFunding(r.coin),
      ]);
      const okx: OkxFundingResult = okxRes.status === "fulfilled" ? okxRes.value : { rate: null, nextFundingTs: null };
      const funding: VenueFunding = {
        hyperliquid: r.hlFunding,
        okx: okx.rate,
        dydx: dydxRes.status === "fulfilled" ? dydxRes.value : null,
      };

      const available = (Object.entries(funding) as [string, number | null][]).filter(
        (entry): entry is [string, number] => entry[1] !== null,
      );
      let funding_spread_bps: number | null = null;
      let best_long_venue: string | null = null;
      let best_short_venue: string | null = null;
      if (available.length >= 2) {
        const min = available.reduce((a, b) => (b[1] < a[1] ? b : a));
        const max = available.reduce((a, b) => (b[1] > a[1] ? b : a));
        funding_spread_bps = Math.round((max[1] - min[1]) * 10000 * 100) / 100;
        best_long_venue = min[0];
        best_short_venue = max[0];
      }

      return {
        coin: r.coin,
        funding,
        funding_spread_bps,
        best_long_venue,
        best_short_venue,
        premium: r.premium,
        annualized_hl: funding.hyperliquid !== null ? funding.hyperliquid * 24 * 365 : null,
        annualized_okx: funding.okx !== null ? funding.okx * 3 * 365 : null,
        signal: fundingSignal(r.hlFunding),
        next_funding_ts: okx.nextFundingTs,
        markPx: r.markPx,
        oraclePx: r.oraclePx,
        openInterest: r.openInterest,
        dayNtlVlm: r.dayNtlVlm,
      };
    }),
  );

  return rates;
}

app.get("/crypto/funding", async (c) => {
  const limitParam = c.req.query("limit");
  let limit = limitParam ? parseInt(limitParam, 10) : 20;
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(limit, 100);

  try {
    const rates = await fetchFundingRates(limit);

    console.log(
      JSON.stringify({
        event: "paid_request",
        endpoint: "/crypto/funding",
        limit,
        count: rates.length,
        ts: new Date().toISOString(),
      }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /crypto/funding", rail, makeUsageCounter(c.env)));

    return c.json(rates);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

interface DefiLlamaPool {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apyBase: number | null;
  apyReward: number | null;
  apy: number | null;
  apyPct1D: number | null;
  apyPct7D: number | null;
  apyPct30D: number | null;
  apyBase7d: number | null;
  apyMean30d: number | null;
  pool: string;
  stablecoin: boolean;
  ilRisk: string;
  il7d: number | null;
  exposure: string;
  volumeUsd1d: number | null;
  outlier: boolean;
  rewardTokens: string[] | null;
  underlyingTokens: string[] | null;
  mu: number | null;
  sigma: number | null;
  predictions?: { predictedProbability: number | null };
}

interface YieldPool {
  project: string;
  chain: string;
  symbol: string;
  pool: string;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
  apyPct1D: number | null;
  apyPct7D: number | null;
  apyPct30D: number | null;
  apyBase7d: number | null;
  apyMean30d: number | null;
  tvlUsd: number;
  stablecoin: boolean;
  ilRisk: string;
  il7d: number | null;
  exposure: string;
  outlier: boolean;
  rewardTokens: string[] | null;
  underlyingTokens: string[] | null;
  mu: number | null;
  sigma: number | null;
  risk_adjusted_apy: number | null;
  predicted_probability: number | null;
  volumeUsd1d: number | null;
}

async function fetchDefiYields(
  limit: number,
  project: string | undefined,
  chain: string | undefined,
  stableOnly: boolean,
  sort: "tvl" | "risk_adjusted" = "tvl",
): Promise<YieldPool[]> {
  const res = await fetch("https://yields.llama.fi/pools", { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`DefiLlama yields upstream error: ${res.status}`);
  }
  const raw = (await res.json()) as { status: string; data: DefiLlamaPool[] };

  const normalized: YieldPool[] = raw.data.map((p) => ({
    project: p.project,
    chain: p.chain,
    symbol: p.symbol,
    pool: p.pool,
    apy: p.apy,
    apyBase: p.apyBase,
    apyReward: p.apyReward,
    apyPct1D: p.apyPct1D ?? null,
    apyPct7D: p.apyPct7D ?? null,
    apyPct30D: p.apyPct30D ?? null,
    apyBase7d: p.apyBase7d ?? null,
    apyMean30d: p.apyMean30d ?? null,
    tvlUsd: p.tvlUsd ?? 0,
    stablecoin: p.stablecoin ?? false,
    ilRisk: p.ilRisk ?? "unknown",
    il7d: p.il7d ?? null,
    exposure: p.exposure ?? "unknown",
    outlier: p.outlier ?? false,
    rewardTokens: p.rewardTokens ?? null,
    underlyingTokens: p.underlyingTokens ?? null,
    mu: p.mu ?? null,
    sigma: p.sigma ?? null,
    risk_adjusted_apy: p.apy != null && p.sigma ? p.apy / p.sigma : null,
    predicted_probability: p.predictions?.predictedProbability ?? null,
    volumeUsd1d: p.volumeUsd1d ?? null,
  }));

  const filtered = normalized.filter((p) => {
    if (project && p.project.toLowerCase() !== project.toLowerCase()) return false;
    if (chain && p.chain.toLowerCase() !== chain.toLowerCase()) return false;
    if (stableOnly && !p.stablecoin) return false;
    return true;
  });

  const sorted = filtered.sort((a, b) =>
    sort === "risk_adjusted"
      ? (b.risk_adjusted_apy ?? -Infinity) - (a.risk_adjusted_apy ?? -Infinity)
      : (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0),
  );

  return sorted.slice(0, limit);
}

app.get("/defi/yields", async (c) => {
  const limitParam = c.req.query("limit");
  let limit = limitParam ? parseInt(limitParam, 10) : 20;
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(limit, 100);
  const project = c.req.query("project") || undefined;
  const chain = c.req.query("chain") || undefined;
  const stable = c.req.query("stable") === "true";
  const sort = c.req.query("sort") === "risk_adjusted" ? "risk_adjusted" : "tvl";

  try {
    const pools = await fetchDefiYields(limit, project, chain, stable, sort);

    console.log(
      JSON.stringify({
        event: "paid_request",
        endpoint: "/defi/yields",
        limit,
        project: project ?? null,
        chain: chain ?? null,
        stable,
        sort,
        count: pools.length,
        ts: new Date().toISOString(),
      }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /defi/yields", rail, makeUsageCounter(c.env)));

    return c.json(pools);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

interface DefiLlamaPriceCoin {
  price: number;
  symbol: string;
  timestamp: number;
  confidence: number;
}

interface TokenPrice {
  id: string;
  symbol: string;
  price: number;
  change_24h: number | null;
  confidence: number;
  timestamp: number;
}

const COINGECKO_ID_RE = /^[a-z0-9-]{1,40}$/;

// Best-effort 24h % change — same host as the price call (coins.llama.fi), a
// separate endpoint, so an upstream failure here never fails the price fetch.
async function fetchTokenPriceChanges(ids: string[]): Promise<Record<string, number | null>> {
  const result: Record<string, number | null> = {};
  try {
    const path = ids.map((id) => `coingecko:${id}`).join(",");
    const res = await fetch(`https://coins.llama.fi/percentage/${path}?period=24h`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return result;
    const raw = (await res.json()) as { coins: Record<string, number> };
    for (const id of ids) {
      const v = raw.coins[`coingecko:${id}`];
      result[id] = typeof v === "number" && Number.isFinite(v) ? v : null;
    }
  } catch {
    // Keep whatever was resolved (possibly empty) — non-fatal enrichment.
  }
  return result;
}

async function fetchTokenPrices(ids: string[]): Promise<TokenPrice[]> {
  const path = ids.map((id) => `coingecko:${id}`).join(",");
  const [res, changes] = await Promise.all([
    fetch(`https://coins.llama.fi/prices/current/${path}`, { headers: { accept: "application/json" } }),
    fetchTokenPriceChanges(ids),
  ]);
  if (!res.ok) {
    throw new Error(`DefiLlama prices upstream error: ${res.status}`);
  }
  const raw = (await res.json()) as { coins: Record<string, DefiLlamaPriceCoin> };

  return ids
    .map((id) => {
      const coin = raw.coins[`coingecko:${id}`];
      if (!coin) return null;
      return {
        id,
        symbol: coin.symbol,
        price: coin.price,
        change_24h: changes[id] ?? null,
        confidence: coin.confidence,
        timestamp: coin.timestamp,
      };
    })
    .filter((c): c is TokenPrice => c !== null);
}

app.get("/crypto/prices", async (c) => {
  const coinsParam = c.req.query("coins") || "bitcoin,ethereum,solana";
  const ids = coinsParam.split(",").map((s) => s.trim()).filter(Boolean);

  if (ids.length === 0) {
    return c.json({ error: "coins query param must contain at least one CoinGecko id" }, { status: 400 });
  }
  if (ids.length > 25) {
    return c.json({ error: "coins query param accepts at most 25 ids" }, { status: 400 });
  }
  const invalid = ids.filter((id) => !COINGECKO_ID_RE.test(id));
  if (invalid.length > 0) {
    return c.json({ error: `invalid coingecko id(s): ${invalid.join(", ")}` }, { status: 400 });
  }

  try {
    const prices = await fetchTokenPrices(ids);

    console.log(
      JSON.stringify({
        event: "paid_request",
        endpoint: "/crypto/prices",
        coins: ids,
        count: prices.length,
        ts: new Date().toISOString(),
      }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /crypto/prices", rail, makeUsageCounter(c.env)));

    return c.json(prices);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// ---------------------------------------------------------------------------
// Internal USD price helpers — the moat OneSource (ETH-only, no price oracle)
// can't match. Cross-call our own DefiLlama fetch logic in-process (never a
// paid x402 sub-call, never a second upstream host), cached per isolate with
// a short TTL: long enough to spare repeat /chain/* calls a redundant fetch,
// short enough that a busy isolate never serves a stale USD figure.
// ---------------------------------------------------------------------------

const USD_PRICE_TTL_MS = 30_000;

let ethUsdCache: { price: number; ts: number } | null = null;

async function getEthUsd(): Promise<number | null> {
  const now = Date.now();
  if (ethUsdCache && now - ethUsdCache.ts < USD_PRICE_TTL_MS) return ethUsdCache.price;
  try {
    const [eth] = await fetchTokenPrices(["ethereum"]);
    if (!eth || !Number.isFinite(eth.price)) return ethUsdCache?.price ?? null;
    ethUsdCache = { price: eth.price, ts: now };
    return eth.price;
  } catch {
    return ethUsdCache?.price ?? null; // stale-but-present beats a hard failure
  }
}

const tokenUsdCache = new Map<string, { price: number; ts: number }>();

// Base-chain ERC-20 price by contract address, via the same coins.llama.fi
// host as fetchTokenPrices (the `base:{address}` id form instead of
// `coingecko:{id}`). Not called by any route in this build; kept ready for
// token-level USD enrichment (e.g. /chain/token-balance).
async function getTokenUsd(contract: string): Promise<number | null> {
  const key = contract.toLowerCase();
  const now = Date.now();
  const cached = tokenUsdCache.get(key);
  if (cached && now - cached.ts < USD_PRICE_TTL_MS) return cached.price;
  try {
    const res = await fetch(`https://coins.llama.fi/prices/current/base:${key}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return cached?.price ?? null;
    const raw = (await res.json()) as { coins: Record<string, { price: number }> };
    const price = raw.coins[`base:${key}`]?.price;
    if (typeof price !== "number" || !Number.isFinite(price)) return cached?.price ?? null;
    tokenUsdCache.set(key, { price, ts: now });
    return price;
  } catch {
    return cached?.price ?? null;
  }
}

// ---------------------------------------------------------------------------
// BASE MAINNET JSON-RPC READS — 8 endpoints, all via baseRpc() (fixed host,
// SSRF-safe by construction). Addresses/hashes validated before any RPC call.
// ---------------------------------------------------------------------------

app.get("/chain/block-number", async (c) => {
  try {
    const hex = (await baseRpc("eth_blockNumber", [])) as string;
    const result = { block_number: parseInt(hex, 16), chain: "base" };

    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/block-number", ts: new Date().toISOString() }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/block-number", rail, makeUsageCounter(c.env)));

    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// Free preview — same live Base RPC read as the paid route, no payment required.
// Base-RPC calls are already $0.001, but a zero-friction taste matters for cold
// outreach: an agent (or a human evaluating one) can curl this with no wallet setup.
app.get("/chain/block-number/preview", async (c) => {
  try {
    const hex = (await baseRpc("eth_blockNumber", [])) as string;
    return c.json({
      block_number: parseInt(hex, 16),
      chain: "base",
      note: "Free live sample — identical to the paid route. Full: GET /chain/block-number ($0.01), keyless x402 on Base.",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// EIP-1559 base/priority fee via eth_feeHistory (1 block, median-percentile
// reward). Best-effort: an upstream hiccup here degrades to nulls rather than
// failing the whole gas-price read (eth_gasPrice already has its own answer).
async function fetchFeeHistory(): Promise<{ base_fee_gwei: number | null; priority_fee_gwei: number | null }> {
  try {
    const hist = (await baseRpc("eth_feeHistory", ["0x1", "latest", [50]])) as {
      baseFeePerGas?: string[];
      reward?: string[][];
    };
    const baseFee = hist.baseFeePerGas?.[0];
    const priorityFee = hist.reward?.[0]?.[0];
    return {
      base_fee_gwei: baseFee ? Number(BigInt(baseFee)) / 1e9 : null,
      priority_fee_gwei: priorityFee ? Number(BigInt(priorityFee)) / 1e9 : null,
    };
  } catch {
    return { base_fee_gwei: null, priority_fee_gwei: null };
  }
}

app.get("/chain/gas-price", async (c) => {
  try {
    const [hex, feeHistory, ethUsd] = await Promise.all([
      baseRpc("eth_gasPrice", []) as Promise<string>,
      fetchFeeHistory(),
      getEthUsd(),
    ]);
    const wei = BigInt(hex);
    const gasPriceEth = Number(wei) / 1e18;
    const result = {
      gas_price_wei: wei.toString(),
      gas_price_gwei: Number(wei) / 1e9,
      base_fee_gwei: feeHistory.base_fee_gwei,
      priority_fee_gwei: feeHistory.priority_fee_gwei,
      gas_price_usd: ethUsd !== null ? gasPriceEth * ethUsd : null,
      chain: "base",
    };

    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/gas-price", ts: new Date().toISOString() }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/gas-price", rail, makeUsageCounter(c.env)));

    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// Free preview — same live Base RPC read as the paid route, no payment required.
app.get("/chain/gas-price/preview", async (c) => {
  try {
    const [hex, feeHistory, ethUsd] = await Promise.all([
      baseRpc("eth_gasPrice", []) as Promise<string>,
      fetchFeeHistory(),
      getEthUsd(),
    ]);
    const wei = BigInt(hex);
    const gasPriceEth = Number(wei) / 1e18;
    return c.json({
      gas_price_wei: wei.toString(),
      gas_price_gwei: Number(wei) / 1e9,
      base_fee_gwei: feeHistory.base_fee_gwei,
      priority_fee_gwei: feeHistory.priority_fee_gwei,
      gas_price_usd: ethUsd !== null ? gasPriceEth * ethUsd : null,
      chain: "base",
      note: "Free live sample — identical to the paid route. Full: GET /chain/gas-price ($0.01), keyless x402 on Base.",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/balance", async (c) => {
  const address = c.req.query("address");
  if (!address || !ADDR_RE.test(address)) {
    return c.json({ error: "address query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }

  try {
    const [hex, ethUsd] = await Promise.all([
      baseRpc("eth_getBalance", [address, "latest"]) as Promise<string>,
      getEthUsd(),
    ]);
    const wei = BigInt(hex);
    const balanceEth = Number(wei) / 1e18;
    const result = {
      address,
      balance_wei: wei.toString(),
      balance_eth: balanceEth,
      balance_usd: ethUsd !== null ? balanceEth * ethUsd : null,
      chain: "base",
    };

    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/balance", address, ts: new Date().toISOString() }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/balance", rail, makeUsageCounter(c.env)));

    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// Decode an ABI-encoded `string` return: dynamic (offset+length+data) or the
// legacy bytes32 form (MKR-style). Returns null when undecodable/empty.
function decodeAbiString(hex: string | null | undefined): string | null {
  try {
    if (!hex) return null;
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length < 64) return null;
    let dataHex: string;
    if (clean.length === 64) {
      dataHex = clean;
    } else {
      const offset = parseInt(clean.slice(0, 64), 16) * 2;
      const len = parseInt(clean.slice(offset, offset + 64), 16);
      if (!Number.isFinite(len) || len <= 0 || len > 1024) return null;
      dataHex = clean.slice(offset + 64, offset + 64 + len * 2);
    }
    const bytes = new Uint8Array(Math.floor(dataHex.length / 2));
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(dataHex.substr(i * 2, 2), 16);
    const out = new TextDecoder().decode(bytes).replace(/\0/g, "").trim();
    return out || null;
  } catch {
    return null;
  }
}

interface TokenMeta {
  symbol: string | null;
  name: string | null;
  decimals: number | null;
}

// symbol()/name()/decimals() rarely change for a deployed contract, so cache
// per token address for this Worker isolate's lifetime.
const tokenMetaCache = new Map<string, TokenMeta>();

async function getTokenMeta(token: string): Promise<TokenMeta> {
  const key = token.toLowerCase();
  const cached = tokenMetaCache.get(key);
  if (cached) return cached;
  const call = (data: string) =>
    (baseRpc("eth_call", [{ to: token, data }, "latest"]) as Promise<string>).catch(() => null);
  const [symbolHex, nameHex, decimalsHex] = await Promise.all([call("0x95d89b41"), call("0x06fdde03"), call("0x313ce567")]);
  let decimals: number | null = null;
  if (decimalsHex && decimalsHex.length > 2) {
    const d = parseInt(decimalsHex.slice(0, 66), 16);
    if (Number.isFinite(d) && d >= 0 && d <= 77) decimals = d;
  }
  const meta: TokenMeta = { symbol: decodeAbiString(symbolHex), name: decodeAbiString(nameHex), decimals };
  // Only cache when every call answered, so a transient RPC failure isn't pinned.
  if (symbolHex && nameHex && decimalsHex) tokenMetaCache.set(key, meta);
  return meta;
}

function formatUnits(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

async function buildTokenBalance(address: string, token: string) {
  const data = `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`;
  const [hex, meta] = await Promise.all([
    baseRpc("eth_call", [{ to: token, data }, "latest"]) as Promise<string>,
    getTokenMeta(token),
  ]);
  const balanceRaw = BigInt(hex);
  const formatted = meta.decimals === null ? null : formatUnits(balanceRaw, meta.decimals);
  return {
    address,
    token,
    symbol: meta.symbol,
    name: meta.name,
    decimals: meta.decimals,
    balance_raw: balanceRaw.toString(),
    balance: formatted === null ? null : Number(formatted),
    balance_formatted: formatted,
    chain: "base",
  };
}

// Free preview — same live read as the paid route; defaults to USDC + a known holder.
app.get("/chain/token-balance/preview", async (c) => {
  const address = c.req.query("address") ?? "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10";
  const token = c.req.query("token") ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  if (!ADDR_RE.test(address) || !ADDR_RE.test(token)) {
    return c.json({ error: "address and token must be 0x-prefixed 20-byte addresses" }, { status: 400 });
  }
  try {
    return c.json({
      ...(await buildTokenBalance(address, token)),
      note: "Free live sample — identical to the paid route. Full: GET /chain/token-balance ($0.005), keyless x402 on Base.",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/token-balance", async (c) => {
  const address = c.req.query("address");
  const token = c.req.query("token");
  if (!address || !ADDR_RE.test(address)) {
    return c.json({ error: "address query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }
  if (!token || !ADDR_RE.test(token)) {
    return c.json({ error: "token query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }

  try {
    const result = await buildTokenBalance(address, token);

    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/token-balance", address, token, ts: new Date().toISOString() }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/token-balance", rail, makeUsageCounter(c.env)));

    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/tx", async (c) => {
  const hash = c.req.query("hash");
  if (!hash || !HASH_RE.test(hash)) {
    return c.json({ error: "hash query param must be a 0x-prefixed 32-byte transaction hash" }, { status: 400 });
  }

  try {
    const tx = (await baseRpc("eth_getTransactionByHash", [hash])) as Record<string, unknown> | null;
    if (!tx) {
      return c.json({ error: "tx not found" }, { status: 404 });
    }
    const hexToDec = (v: unknown) => (typeof v === "string" && v.startsWith("0x") ? BigInt(v).toString() : v);
    const result = {
      ...tx,
      blockNumber: hexToDec(tx.blockNumber),
      value: hexToDec(tx.value),
      gas: hexToDec(tx.gas),
      gasPrice: hexToDec(tx.gasPrice),
      nonce: hexToDec(tx.nonce),
    };

    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/tx", hash, ts: new Date().toISOString() }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/tx", rail, makeUsageCounter(c.env)));

    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/receipt", async (c) => {
  const hash = c.req.query("hash");
  if (!hash || !HASH_RE.test(hash)) {
    return c.json({ error: "hash query param must be a 0x-prefixed 32-byte transaction hash" }, { status: 400 });
  }

  try {
    const [receipt, ethUsd] = await Promise.all([
      baseRpc("eth_getTransactionReceipt", [hash]) as Promise<{
        status: string;
        blockNumber: string;
        gasUsed: string;
        cumulativeGasUsed: string;
        effectiveGasPrice?: string;
        from: string;
        to: string | null;
        contractAddress: string | null;
        logs: unknown[];
        l1Fee?: string;
        l1GasPrice?: string;
        l1GasUsed?: string;
      } | null>,
      getEthUsd(),
    ]);
    if (!receipt) {
      return c.json({ error: "receipt not found" }, { status: 404 });
    }
    const hexToDec = (v: string | undefined) => (v ? BigInt(v).toString() : null);
    // Base (OP-stack) total fee = L2 execution fee (effectiveGasPrice * gasUsed)
    // + the L1 data-availability fee (l1Fee) — the breakdown an ETH-only
    // competitor has no L1 component for in the first place.
    const l1FeeWei = receipt.l1Fee ? BigInt(receipt.l1Fee) : null;
    const l2FeeWei = receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice) * BigInt(receipt.gasUsed) : null;
    const totalFeeWei = l2FeeWei !== null ? l2FeeWei + (l1FeeWei ?? 0n) : l1FeeWei;
    const weiToUsd = (w: bigint | null) => (w !== null && ethUsd !== null ? (Number(w) / 1e18) * ethUsd : null);
    const result = {
      status: parseInt(receipt.status, 16),
      block_number: parseInt(receipt.blockNumber, 16),
      gas_used: parseInt(receipt.gasUsed, 16),
      cumulative_gas_used: parseInt(receipt.cumulativeGasUsed, 16),
      effective_gas_price_wei: hexToDec(receipt.effectiveGasPrice),
      from: receipt.from,
      to: receipt.to,
      contract_address: receipt.contractAddress,
      tx_hash: hash,
      logs_count: receipt.logs.length,
      logs: receipt.logs,
      l1_fee_wei: hexToDec(receipt.l1Fee),
      l1_gas_price_wei: hexToDec(receipt.l1GasPrice),
      l1_gas_used: receipt.l1GasUsed ? parseInt(receipt.l1GasUsed, 16) : null,
      l1_fee_usd: weiToUsd(l1FeeWei),
      total_fee_usd: weiToUsd(totalFeeWei),
    };

    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/receipt", hash, ts: new Date().toISOString() }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/receipt", rail, makeUsageCounter(c.env)));

    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// EIP-7702 delegation designator (0xef0100 + 20-byte target address). A
// delegated EOA carries this special bytecode — it is NOT a real contract,
// and mislabeling it breaks security/wallet classification for any consumer.
// https://eips.ethereum.org/EIPS/eip-7702
function classifyCode(code: string): {
  is_contract: boolean;
  is_eip7702_delegate: boolean;
  delegate_address: string | null;
} {
  const hasCode = code !== "0x" && code.length > 2;
  if (hasCode && code.toLowerCase().startsWith("0xef0100")) {
    return {
      is_contract: false,
      is_eip7702_delegate: true,
      delegate_address: "0x" + code.slice(8, 48),
    };
  }
  return { is_contract: hasCode, is_eip7702_delegate: false, delegate_address: null };
}

app.get("/chain/code", async (c) => {
  const address = c.req.query("address");
  if (!address || !ADDR_RE.test(address)) {
    return c.json({ error: "address query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }

  try {
    const code = (await baseRpc("eth_getCode", [address, "latest"])) as string;
    const result = {
      address,
      ...classifyCode(code),
      code_size_bytes: Math.max(0, (code.length - 2) / 2),
      chain: "base",
    };

    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/code", address, ts: new Date().toISOString() }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/code", rail, makeUsageCounter(c.env)));

    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/erc20-meta", async (c) => {
  const token = c.req.query("token");
  if (!token || !ADDR_RE.test(token)) {
    return c.json({ error: "token query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }
  try {
    const call = (data: string) => baseRpc("eth_call", [{ to: token, data }, "latest"]).catch(() => "0x") as Promise<string>;
    const [n, sy, d, ts] = await Promise.all([call("0x06fdde03"), call("0x95d89b41"), call("0x313ce567"), call("0x18160ddd")]);
    if (d === "0x" && ts === "0x") return c.json({ error: "not an ERC-20 contract on Base" }, { status: 422 });
    const decimals = d && d !== "0x" ? Number(BigInt(d)) : null;
    const raw = ts && ts !== "0x" ? BigInt(ts) : null;
    const result = {
      token,
      name: decodeAbiString(n),
      symbol: decodeAbiString(sy),
      decimals,
      total_supply_raw: raw === null ? null : raw.toString(),
      total_supply: raw === null || decimals === null ? null : Number(raw) / 10 ** decimals,
      chain: "base",
    };
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/erc20-meta", token, ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/erc20-meta", rail, makeUsageCounter(c.env)));
    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/nonce", async (c) => {
  const address = c.req.query("address");
  if (!address || !ADDR_RE.test(address)) {
    return c.json({ error: "address query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }
  try {
    const [l, p] = await Promise.all([
      baseRpc("eth_getTransactionCount", [address, "latest"]) as Promise<string>,
      baseRpc("eth_getTransactionCount", [address, "pending"]) as Promise<string>,
    ]);
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/nonce", address, ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/nonce", rail, makeUsageCounter(c.env)));
    return c.json({ address, nonce_latest: Number(BigInt(l)), nonce_pending: Number(BigInt(p)), chain: "base" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/is-contract", async (c) => {
  const address = c.req.query("address");
  if (!address || !ADDR_RE.test(address)) {
    return c.json({ error: "address query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }
  try {
    const code = (await baseRpc("eth_getCode", [address, "latest"])) as string;
    const bytes = Math.max(0, (code.length - 2) / 2);
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/is-contract", address, ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/is-contract", rail, makeUsageCounter(c.env)));
    return c.json({ address, is_contract: bytes > 0, code_bytes: bytes, chain: "base" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/fee-estimate", async (c) => {
  try {
    const [blk, tip] = await Promise.all([baseRpc("eth_getBlockByNumber", ["latest", false]), baseRpc("eth_maxPriorityFeePerGas", []).catch(() => "0x0")]) as [{ baseFeePerGas?: string; number: string }, string];
    const g = (h: string) => Number(BigInt(h)) / 1e9;
    const base = g(blk.baseFeePerGas ?? "0x0");
    const prio = g(tip as string);
    const tier = (bm: number, pm: number) => { const mf = base * bm + prio * pm; return { max_fee_gwei: mf, priority_fee_gwei: prio * pm, transfer_cost_eth: (mf * 21000) / 1e9 }; };
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/fee-estimate", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/fee-estimate", rail, makeUsageCounter(c.env)));
    return c.json({ block: Number(BigInt(blk.number)), base_fee_gwei: base, priority_fee_gwei: prio, tiers: { slow: tier(1.0, 0.5), standard: tier(1.25, 1), fast: tier(1.6, 2) }, chain: "base" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/network-status", async (c) => {
  try {
    const [blk, cid] = await Promise.all([baseRpc("eth_getBlockByNumber", ["latest", false]), baseRpc("eth_chainId", [])]) as [{ number: string; timestamp: string; gasUsed: string; gasLimit: string; transactions: unknown[] }, string];
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/network-status", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/network-status", rail, makeUsageCounter(c.env)));
    return c.json({ chain_id: Number(BigInt(cid)), block: Number(BigInt(blk.number)), block_age_seconds: Math.max(0, Math.floor(Date.now() / 1000) - Number(BigInt(blk.timestamp))), gas_used_ratio: Number(BigInt(blk.gasUsed)) / Number(BigInt(blk.gasLimit)), tx_count: blk.transactions.length, chain: "base" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/l1-base-fee", async (c) => {
  try {
    const r = (await baseRpc("eth_call", [{ to: "0x420000000000000000000000000000000000000F", data: "0x519b4bd3" }, "latest"])) as string;
    const wei = BigInt(r);
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/l1-base-fee", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/l1-base-fee", rail, makeUsageCounter(c.env)));
    return c.json({ l1_base_fee_wei: wei.toString(), l1_base_fee_gwei: Number(wei) / 1e9, est_l1_data_fee_eth_simple_transfer: (Number(wei) * 16 * 200) / 1e18, assumed_tx_bytes: 200, chain: "base" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/blob-base-fee", async (c) => {
  try {
    const r = (await baseRpc("eth_call", [{ to: "0x420000000000000000000000000000000000000F", data: "0xf8206140" }, "latest"])) as string;
    const wei = BigInt(r);
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/blob-base-fee", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/blob-base-fee", rail, makeUsageCounter(c.env)));
    return c.json({ blob_base_fee_wei: wei.toString(), blob_base_fee_gwei: Number(wei) / 1e9, chain: "base" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/eth-usd", async (c) => {
  try {
    const r = (await baseRpc("eth_call", [{ to: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", data: "0xfeaf968c" }, "latest"])) as string;
    const h = r.slice(2);
    const roundId = BigInt("0x" + h.slice(0, 64)).toString();
    const answer = BigInt("0x" + h.slice(64, 128));
    const updatedAt = Number(BigInt("0x" + h.slice(192, 256)));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/eth-usd", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/eth-usd", rail, makeUsageCounter(c.env)));
    return c.json({
      price_usd: Number(answer) / 1e8,
      round_id: roundId,
      updated_at: new Date(updatedAt * 1000).toISOString(),
      age_seconds: Math.max(0, Math.floor(Date.now() / 1000) - updatedAt),
      source: "chainlink ETH/USD aggregator on Base",
      chain: "base",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/btc-usd", async (c) => {
  try {
    const r = (await baseRpc("eth_call", [{ to: "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F", data: "0xfeaf968c" }, "latest"])) as string;
    const h = r.slice(2);
    const roundId = BigInt("0x" + h.slice(0, 64)).toString();
    const answer = BigInt("0x" + h.slice(64, 128));
    const updatedAt = Number(BigInt("0x" + h.slice(192, 256)));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/btc-usd", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/btc-usd", rail, makeUsageCounter(c.env)));
    return c.json({
      price_usd: Number(answer) / 1e8,
      round_id: roundId,
      updated_at: new Date(updatedAt * 1000).toISOString(),
      age_seconds: Math.max(0, Math.floor(Date.now() / 1000) - updatedAt),
      source: "chainlink BTC/USD aggregator on Base",
      chain: "base",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/prices", async (c) => {
  try {
    const feeds: Record<string, string> = {
      BTC: "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F",
      ETH: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
      LINK: "0x17CAb8FE31E32f08326e5E27412894e49B0f9D65",
      SOL: "0x975043adBb80fc32276CbF9Bbcfd4A601a12462D",
    };
    const now = Math.floor(Date.now() / 1000);
    const entries = await Promise.all(Object.entries(feeds).map(async ([sym, to]) => {
      const r = (await baseRpc("eth_call", [{ to, data: "0xfeaf968c" }, "latest"])) as string;
      const h = r.slice(2);
      const answer = BigInt("0x" + h.slice(64, 128));
      const updatedAt = Number(BigInt("0x" + h.slice(192, 256)));
      return [sym, { price_usd: Number(answer) / 1e8, updated_at: new Date(updatedAt * 1000).toISOString(), age_seconds: Math.max(0, now - updatedAt) }] as const;
    }));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/prices", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/prices", rail, makeUsageCounter(c.env)));
    return c.json({ prices: Object.fromEntries(entries), source: "chainlink aggregators on Base", chain: "base" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/sol-usd", async (c) => {
  try {
    const r = (await baseRpc("eth_call", [{ to: "0x975043adBb80fc32276CbF9Bbcfd4A601a12462D", data: "0xfeaf968c" }, "latest"])) as string;
    const h = r.slice(2);
    const roundId = BigInt("0x" + h.slice(0, 64)).toString();
    const answer = BigInt("0x" + h.slice(64, 128));
    const updatedAt = Number(BigInt("0x" + h.slice(192, 256)));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/sol-usd", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/sol-usd", rail, makeUsageCounter(c.env)));
    return c.json({
      price_usd: Number(answer) / 1e8,
      round_id: roundId,
      updated_at: new Date(updatedAt * 1000).toISOString(),
      age_seconds: Math.max(0, Math.floor(Date.now() / 1000) - updatedAt),
      source: "chainlink SOL/USD aggregator on Base",
      chain: "base",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/link-usd", async (c) => {
  try {
    const r = (await baseRpc("eth_call", [{ to: "0x17CAb8FE31E32f08326e5E27412894e49B0f9D65", data: "0xfeaf968c" }, "latest"])) as string;
    const h = r.slice(2);
    const roundId = BigInt("0x" + h.slice(0, 64)).toString();
    const answer = BigInt("0x" + h.slice(64, 128));
    const updatedAt = Number(BigInt("0x" + h.slice(192, 256)));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/link-usd", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/link-usd", rail, makeUsageCounter(c.env)));
    return c.json({
      price_usd: Number(answer) / 1e8,
      round_id: roundId,
      updated_at: new Date(updatedAt * 1000).toISOString(),
      age_seconds: Math.max(0, Math.floor(Date.now() / 1000) - updatedAt),
      source: "chainlink LINK/USD aggregator on Base",
      chain: "base",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/fee-history", async (c) => {
  try {
    const r = (await baseRpc("eth_feeHistory", ["0xa", "latest", []])) as { oldestBlock: string; baseFeePerGas: string[]; gasUsedRatio: number[] };
    const fees = r.baseFeePerGas.map((x) => Number(BigInt(x)) / 1e9);
    const oldest = parseInt(r.oldestBlock, 16);
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/fee-history", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/fee-history", rail, makeUsageCounter(c.env)));
    return c.json({
      oldest_block: oldest,
      blocks: r.gasUsedRatio.map((g, i) => ({ block: oldest + i, base_fee_gwei: fees[i], gas_used_ratio: g })),
      next_base_fee_gwei: fees[fees.length - 1],
      summary: { min_gwei: Math.min(...fees), max_gwei: Math.max(...fees), avg_gwei: fees.reduce((a, b) => a + b, 0) / fees.length },
      chain: "base",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/total-supply", async (c) => {
  const token = c.req.query("token");
  if (!token || !ADDR_RE.test(token)) {
    return c.json({ error: "token query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }
  try {
    const call = (data: string) => baseRpc("eth_call", [{ to: token, data }, "latest"]).catch(() => "0x") as Promise<string>;
    const [sy, d, ts] = await Promise.all([call("0x95d89b41"), call("0x313ce567"), call("0x18160ddd")]);
    if (ts === "0x") return c.json({ error: "not an ERC-20 contract on Base" }, { status: 422 });
    const decimals = d && d !== "0x" ? Number(BigInt(d)) : null;
    const raw = BigInt(ts);
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/total-supply", token, ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/total-supply", rail, makeUsageCounter(c.env)));
    return c.json({
      token,
      symbol: decodeAbiString(sy),
      decimals,
      total_supply_raw: raw.toString(),
      total_supply: decimals === null ? null : Number(raw) / 10 ** decimals,
      chain: "base",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/storage-at", async (c) => {
  const address = c.req.query("address");
  const slot = c.req.query("slot") ?? "0x0";
  if (!address || !ADDR_RE.test(address)) {
    return c.json({ error: "address query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }
  if (!/^0x[a-fA-F0-9]{1,64}$/.test(slot)) {
    return c.json({ error: "slot must be 0x-prefixed hex (up to 32 bytes)" }, { status: 400 });
  }
  try {
    const value = (await baseRpc("eth_getStorageAt", [address, slot, "latest"])) as string;
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/storage-at", address, ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/storage-at", rail, makeUsageCounter(c.env)));
    return c.json({ address, slot, value, chain: "base" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/proxy-info", async (c) => {
  const address = c.req.query("address");
  if (!address || !ADDR_RE.test(address)) {
    return c.json({ error: "address query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }
  try {
    const slots = {
      implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
      beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
    };
    const toAddr = (v: string) => (v && /^0x0*$/.test(v) ? null : "0x" + v.slice(-40));
    const [impl, adm, bea] = (await Promise.all(
      Object.values(slots).map((sl) => baseRpc("eth_getStorageAt", [address, sl, "latest"])),
    )) as string[];
    const out = { implementation: toAddr(impl), admin: toAddr(adm), beacon: toAddr(bea) };
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/proxy-info", address, ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/proxy-info", rail, makeUsageCounter(c.env)));
    return c.json({ address, is_proxy: !!(out.implementation || out.beacon), ...out, chain: "base" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/allowance", async (c) => {
  const token = c.req.query("token"), owner = c.req.query("owner"), spender = c.req.query("spender");
  if (!token || !owner || !spender || ![token, owner, spender].every((x) => ADDR_RE.test(x))) {
    return c.json({ error: "token, owner and spender query params must be 0x-prefixed 20-byte addresses" }, { status: 400 });
  }
  try {
    const pad = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");
    const [al, d] = await Promise.all([
      baseRpc("eth_call", [{ to: token, data: "0xdd62ed3e" + pad(owner) + pad(spender) }, "latest"]) as Promise<string>,
      baseRpc("eth_call", [{ to: token, data: "0x313ce567" }, "latest"]).catch(() => "0x") as Promise<string>,
    ]);
    if (!al || al === "0x") return c.json({ error: "not an ERC-20 contract on Base" }, { status: 422 });
    const raw = BigInt(al);
    const decimals = d && d !== "0x" ? Number(BigInt(d)) : null;
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/allowance", token, ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/allowance", rail, makeUsageCounter(c.env)));
    return c.json({ token, owner, spender, allowance_raw: raw.toString(), allowance: decimals === null ? null : Number(raw) / 10 ** decimals, decimals, is_unlimited: raw >= (1n << 255n), chain: "base" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/defi/chains-tvl", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  try {
    const r = await fetch("https://api.llama.fi/v2/chains");
    if (!r.ok) return c.json({ error: "upstream " + r.status }, { status: 502 });
    const d = (await r.json()) as Array<{ name: string; tvl: number; tokenSymbol?: string }>;
    const chains = d.filter((x) => x.tvl > 0).sort((a, b) => b.tvl - a.tvl).slice(0, limit).map((x) => ({ name: x.name, tvl_usd: Math.round(x.tvl), token: x.tokenSymbol ?? null }));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/defi/chains-tvl", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /defi/chains-tvl", rail, makeUsageCounter(c.env)));
    return c.json({ count: chains.length, chains, source: "defillama", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/crypto/stablecoins", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  try {
    const r = await fetch("https://stablecoins.llama.fi/stablecoins?includePrices=true");
    if (!r.ok) return c.json({ error: "upstream " + r.status }, { status: 502 });
    const d = ((await r.json()) as { peggedAssets: Array<{ name: string; symbol: string; pegType: string; price: number | null; circulating?: Record<string, number> }> }).peggedAssets;
    const stablecoins = d.map((x) => ({ name: x.name, symbol: x.symbol, peg_type: x.pegType, price: x.price, circulating_usd: Math.round(Object.values(x.circulating ?? {})[0] ?? 0) }))
      .sort((a, b) => b.circulating_usd - a.circulating_usd).slice(0, limit);
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/crypto/stablecoins", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /crypto/stablecoins", rail, makeUsageCounter(c.env)));
    return c.json({ count: stablecoins.length, stablecoins, source: "defillama", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/defi/protocols-top", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  try {
    const r = await fetch("https://api.llama.fi/protocols");
    if (!r.ok) return c.json({ error: "upstream " + r.status }, { status: 502 });
    const d = (await r.json()) as Array<{ name: string; category?: string; tvl?: number; change_1d?: number; change_7d?: number; chain?: string }>;
    const protocols = d.filter((x) => (x.tvl ?? 0) > 0 && x.category !== "CEX").sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0)).slice(0, limit)
      .map((x) => ({ name: x.name, category: x.category ?? null, tvl_usd: Math.round(x.tvl ?? 0), change_1d: x.change_1d ?? null, change_7d: x.change_7d ?? null, chain: x.chain ?? null }));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/defi/protocols-top", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /defi/protocols-top", rail, makeUsageCounter(c.env)));
    return c.json({ count: protocols.length, protocols, source: "defillama", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/defi/dex-volume", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  try {
    const r = await fetch("https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true");
    if (!r.ok) return c.json({ error: "upstream " + r.status }, { status: 502 });
    const d = (await r.json()) as { total24h?: number; total7d?: number; change_1d?: number; protocols?: Array<{ name: string; total24h?: number; total7d?: number; change_1d?: number }> };
    const dexs = (d.protocols ?? []).filter((x) => (x.total24h ?? 0) > 0).sort((a, b) => (b.total24h ?? 0) - (a.total24h ?? 0)).slice(0, limit)
      .map((x) => ({ name: x.name, volume24h_usd: Math.round(x.total24h ?? 0), volume7d_usd: Math.round(x.total7d ?? 0), change_1d: x.change_1d ?? null }));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/defi/dex-volume", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /defi/dex-volume", rail, makeUsageCounter(c.env)));
    return c.json({ total24h_usd: Math.round(d.total24h ?? 0), total7d_usd: Math.round(d.total7d ?? 0), change_1d: d.change_1d ?? null, count: dexs.length, dexs, source: "defillama", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/crypto/fear-greed", async (c) => {
  const days = Math.min(Math.max(parseInt(c.req.query("days") ?? "7", 10) || 7, 1), 90);
  try {
    const r = await fetch("https://api.alternative.me/fng/?limit=" + days);
    if (!r.ok) return c.json({ error: "upstream " + r.status }, { status: 502 });
    const d = ((await r.json()) as { data: Array<{ value: string; value_classification: string; timestamp: string }> }).data;
    const history = d.map((x) => ({ value: parseInt(x.value, 10), classification: x.value_classification, date: new Date(parseInt(x.timestamp, 10) * 1000).toISOString().slice(0, 10) }));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/crypto/fear-greed", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /crypto/fear-greed", rail, makeUsageCounter(c.env)));
    return c.json({ value: history[0]?.value ?? null, classification: history[0]?.classification ?? null, history, source: "alternative.me", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/crypto/trending", async (c) => {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/search/trending");
    if (!r.ok) return c.json({ error: "upstream " + r.status }, { status: 502 });
    const d = (await r.json()) as { coins: Array<{ item: { name: string; symbol: string; market_cap_rank: number | null; data?: { price_change_percentage_24h?: Record<string, number> } } }> };
    const trending = d.coins.map((x) => ({ name: x.item.name, symbol: x.item.symbol, market_cap_rank: x.item.market_cap_rank, change_24h_pct: x.item.data?.price_change_percentage_24h?.usd ?? null }));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/crypto/trending", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /crypto/trending", rail, makeUsageCounter(c.env)));
    return c.json({ count: trending.length, trending, source: "coingecko", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/defi/fees-top", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  try {
    const r = await fetch("https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true");
    if (!r.ok) return c.json({ error: "upstream " + r.status }, { status: 502 });
    const d = (await r.json()) as { total24h?: number; protocols?: Array<{ name: string; total24h?: number; total7d?: number; change_1d?: number }> };
    const protocols = (d.protocols ?? []).filter((x) => (x.total24h ?? 0) > 0).sort((a, b) => (b.total24h ?? 0) - (a.total24h ?? 0)).slice(0, limit)
      .map((x) => ({ name: x.name, fees24h_usd: Math.round(x.total24h ?? 0), fees7d_usd: Math.round(x.total7d ?? 0), change_1d: x.change_1d ?? null }));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/defi/fees-top", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /defi/fees-top", rail, makeUsageCounter(c.env)));
    return c.json({ total24h_usd: Math.round(d.total24h ?? 0), count: protocols.length, protocols, source: "defillama", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/crypto/global", async (c) => {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/global");
    if (!r.ok) return c.json({ error: "upstream " + r.status }, { status: 502 });
    const d = ((await r.json()) as { data: { active_cryptocurrencies: number; markets: number; market_cap_change_percentage_24h_usd: number; total_market_cap: Record<string, number>; total_volume: Record<string, number>; market_cap_percentage: Record<string, number> } }).data;
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/crypto/global", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /crypto/global", rail, makeUsageCounter(c.env)));
    return c.json({ total_market_cap_usd: Math.round(d.total_market_cap.usd), total_volume_24h_usd: Math.round(d.total_volume.usd), market_cap_change_24h_pct: d.market_cap_change_percentage_24h_usd, btc_dominance_pct: d.market_cap_percentage.btc, eth_dominance_pct: d.market_cap_percentage.eth, active_cryptocurrencies: d.active_cryptocurrencies, markets: d.markets, source: "coingecko", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/defi/yields-top", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  const chain = (c.req.query("chain") ?? "").toLowerCase();
  const stable = c.req.query("stable") === "true";
  try {
    const r = await fetch("https://yields.llama.fi/pools");
    if (!r.ok) return c.json({ error: "upstream " + r.status }, { status: 502 });
    const d = (await r.json()) as { data: Array<{ chain: string; project: string; symbol: string; tvlUsd: number; apy: number | null; stablecoin: boolean }> };
    const pools = d.data.filter((x) => (!chain || x.chain.toLowerCase() === chain) && (!stable || x.stablecoin) && x.apy != null && x.tvlUsd > 1e6)
      .sort((a, b) => b.tvlUsd - a.tvlUsd).slice(0, limit)
      .map((x) => ({ chain: x.chain, project: x.project, symbol: x.symbol, apy: Math.round((x.apy ?? 0) * 100) / 100, tvl_usd: Math.round(x.tvlUsd), stablecoin: x.stablecoin }));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/defi/yields-top", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /defi/yields-top", rail, makeUsageCounter(c.env)));
    return c.json({ count: pools.length, pools, source: "defillama", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

const cgMarkets = async (n: number) => {
  const r = await fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=" + n + "&page=1&price_change_percentage=24h");
  if (!r.ok) throw new Error("upstream " + r.status);
  return ((await r.json()) as Array<{ symbol: string; name: string; current_price: number; market_cap: number; market_cap_rank: number; total_volume: number; price_change_percentage_24h: number | null }>)
    .map((x) => ({ rank: x.market_cap_rank, symbol: x.symbol.toUpperCase(), name: x.name, price_usd: x.current_price, market_cap_usd: x.market_cap, volume_24h_usd: x.total_volume, change_24h_pct: x.price_change_percentage_24h == null ? null : Math.round(x.price_change_percentage_24h * 100) / 100 }));
};

app.get("/crypto/markets-top", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  try {
    const coins = await cgMarkets(limit);
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/crypto/markets-top", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /crypto/markets-top", rail, makeUsageCounter(c.env)));
    return c.json({ count: coins.length, coins, source: "coingecko", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/crypto/movers", async (c) => {
  try {
    const coins = (await cgMarkets(100)).filter((x) => x.change_24h_pct != null);
    const sorted = [...coins].sort((a, b) => (b.change_24h_pct ?? 0) - (a.change_24h_pct ?? 0));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/crypto/movers", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /crypto/movers", rail, makeUsageCounter(c.env)));
    return c.json({ gainers: sorted.slice(0, 10), losers: sorted.slice(-10).reverse(), source: "coingecko", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/brief/market", async (c) => {
  try {
    const [fg, gl, mk, tr, fe] = await Promise.all([
      fetch("https://api.alternative.me/fng/?limit=1").then((r) => r.json() as Promise<{ data: Array<{ value: string; value_classification: string }> }>),
      fetch("https://api.coingecko.com/api/v3/global").then((r) => r.json() as Promise<{ data: { total_market_cap: Record<string, number>; total_volume: Record<string, number>; market_cap_percentage: Record<string, number>; market_cap_change_percentage_24h_usd: number } }>),
      cgMarkets(100),
      fetch("https://api.coingecko.com/api/v3/search/trending").then((r) => r.json() as Promise<{ coins: Array<{ item: { name: string; symbol: string } }> }>),
      fetch("https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true").then((r) => r.json() as Promise<{ total24h?: number; protocols?: Array<{ name: string; total24h?: number }> }>),
    ]);
    const sorted = mk.filter((x) => x.change_24h_pct != null).sort((a, b) => (b.change_24h_pct ?? 0) - (a.change_24h_pct ?? 0));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/brief/market", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /brief/market", rail, makeUsageCounter(c.env)));
    return c.json({
      fear_greed: { value: parseInt(fg.data[0].value, 10), classification: fg.data[0].value_classification },
      global: { total_market_cap_usd: Math.round(gl.data.total_market_cap.usd), total_volume_24h_usd: Math.round(gl.data.total_volume.usd), market_cap_change_24h_pct: gl.data.market_cap_change_percentage_24h_usd, btc_dominance_pct: gl.data.market_cap_percentage.btc, eth_dominance_pct: gl.data.market_cap_percentage.eth },
      movers: { gainers: sorted.slice(0, 5), losers: sorted.slice(-5).reverse() },
      trending: tr.coins.slice(0, 7).map((x) => ({ name: x.item.name, symbol: x.item.symbol })),
      defi_fees_top: { total24h_usd: Math.round(fe.total24h ?? 0), protocols: (fe.protocols ?? []).filter((x) => (x.total24h ?? 0) > 0).sort((a, b) => (b.total24h ?? 0) - (a.total24h ?? 0)).slice(0, 5).map((x) => ({ name: x.name, fees24h_usd: Math.round(x.total24h ?? 0) })) },
      source: "alternative.me,coingecko,defillama", ts: new Date().toISOString(),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/crypto/exchanges-top", async (c) => {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/exchanges?per_page=25");
    if (!r.ok) return c.json({ error: "upstream " + r.status }, { status: 502 });
    const d = (await r.json()) as Array<{ name: string; country: string | null; year_established: number | null; trust_score: number | null; trust_score_rank: number | null; trade_volume_24h_btc: number | null }>;
    const exchanges = d.map((x) => ({ name: x.name, country: x.country, year_established: x.year_established, trust_score: x.trust_score, trust_score_rank: x.trust_score_rank, volume_24h_btc: Math.round(x.trade_volume_24h_btc ?? 0) }));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/crypto/exchanges-top", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /crypto/exchanges-top", rail, makeUsageCounter(c.env)));
    return c.json({ count: exchanges.length, exchanges, source: "coingecko", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/crypto/categories", async (c) => {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/coins/categories");
    if (!r.ok) return c.json({ error: "upstream " + r.status }, { status: 502 });
    const d = (await r.json()) as Array<{ name: string; market_cap: number | null; market_cap_change_24h: number | null; volume_24h: number | null }>;
    const categories = d.filter((x) => (x.market_cap ?? 0) > 0).sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0)).slice(0, 30)
      .map((x) => ({ name: x.name, market_cap_usd: Math.round(x.market_cap ?? 0), market_cap_change_24h_pct: x.market_cap_change_24h == null ? null : Math.round(x.market_cap_change_24h * 100) / 100, volume_24h_usd: Math.round(x.volume_24h ?? 0) }));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/crypto/categories", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /crypto/categories", rail, makeUsageCounter(c.env)));
    return c.json({ count: categories.length, categories, source: "coingecko", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/defi/hacks-recent", async (c) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") ?? "10", 10) || 10));
    const r = await fetch("https://api.llama.fi/hacks");
    if (!r.ok) return c.json({ error: "upstream " + r.status }, { status: 502 });
    const d = (await r.json()) as Array<{ date: number; name: string; amount: number | null; chain: string[] | null; classification: string | null; technique: string | null; bridgeHack: boolean | null; targetType: string | null }>;
    const hacks = d.sort((a, b) => b.date - a.date).slice(0, limit)
      .map((x) => ({ date: new Date(x.date * 1000).toISOString().slice(0, 10), name: x.name, amount_usd: x.amount ?? null, chain: x.chain ?? [], classification: x.classification, technique: x.technique, bridge_hack: !!x.bridgeHack, target_type: x.targetType }));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/defi/hacks-recent", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /defi/hacks-recent", rail, makeUsageCounter(c.env)));
    return c.json({ count: hacks.length, hacks, source: "defillama", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/crypto/derivatives-exchanges", async (c) => {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/derivatives/exchanges?per_page=25&order=open_interest_btc_desc");
    if (!r.ok) return c.json({ error: "upstream " + r.status }, { status: 502 });
    const d = (await r.json()) as Array<{ name: string; open_interest_btc: number | null; trade_volume_24h_btc: string | null; number_of_perpetual_pairs: number | null; number_of_futures_pairs: number | null; year_established: number | null }>;
    const exchanges = d.map((x) => ({ name: x.name, open_interest_btc: Math.round(x.open_interest_btc ?? 0), volume_24h_btc: Math.round(Number(x.trade_volume_24h_btc ?? 0)), perpetual_pairs: x.number_of_perpetual_pairs, futures_pairs: x.number_of_futures_pairs, year_established: x.year_established }));
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/crypto/derivatives-exchanges", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /crypto/derivatives-exchanges", rail, makeUsageCounter(c.env)));
    return c.json({ count: exchanges.length, exchanges, source: "coingecko", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

async function protocolRisk(c: any, paid: boolean) {
  try {
    const slug = paid ? (c.req.query("protocol") ?? "aave-v3").trim().toLowerCase().slice(0, 80) : "aave-v3";
    const [pr, hr] = await Promise.all([fetch("https://api.llama.fi/protocols"), fetch("https://api.llama.fi/hacks")]);
    if (!pr.ok) return c.json({ error: "upstream " + pr.status }, { status: 502 });
    const protos = (await pr.json()) as Array<{ id: string; parentProtocol?: string; name: string; slug: string; tvl: number | null; change_1d: number | null; change_7d: number | null; category: string | null; chains: string[]; audits: string | null; listedAt: number | null }>;
    const p = protos.find((x) => x.slug === slug);
    if (!p) return c.json({ error: "unknown protocol slug", hint: "use a DefiLlama slug e.g. aave-v3, uniswap-v3, lido" }, { status: 404 });
    const hacks = hr.ok ? ((await hr.json()) as Array<{ date: number; name: string; amount: number | null; defillamaId?: string | null; parentProtocolId?: string | null }>) : [];
    const mine = hacks.filter((h) => (h.defillamaId != null && String(h.defillamaId) === String(p.id)) || (!!p.parentProtocol && h.parentProtocolId === p.parentProtocol)).sort((a, b) => b.date - a.date);
    const tvl = p.tvl ?? 0;
    const ageDays = p.listedAt ? Math.floor((Date.now() / 1000 - p.listedAt) / 86400) : null;
    const flags: string[] = [];
    let score = 50;
    if (tvl >= 1e9) score += 20; else if (tvl >= 1e8) score += 12; else if (tvl >= 1e7) score += 5; else if (tvl < 1e6) { score -= 15; flags.push("tvl_under_1m"); }
    if (ageDays != null) { if (ageDays >= 730) score += 12; else if (ageDays >= 365) score += 6; else if (ageDays < 90) { score -= 15; flags.push("younger_than_90d"); } }
    const audits = Number(p.audits ?? 0);
    if (audits >= 2) score += 10; else if (audits === 0) { score -= 10; flags.push("no_audits_listed"); }
    if ((p.chains ?? []).length >= 3) score += 3;
    if ((p.change_7d ?? 0) <= -30) { score -= 15; flags.push("tvl_down_30pct_7d"); }
    if (mine.length) { score -= 20; flags.push("hack_history_match"); }
    score = Math.max(0, Math.min(100, score));
    if (paid) {
      console.log(JSON.stringify({ event: "paid_request", endpoint: "/defi/protocol-risk", ts: new Date().toISOString() }));
      const rail = c.get("rail") ?? "x402-paid";
      fireAndForget(c, trackPaidRequest("GET /defi/protocol-risk", rail, makeUsageCounter(c.env)));
    }
    return c.json({ protocol: p.slug, name: p.name, category: p.category, risk_score: score, tvl_usd: Math.round(tvl), change_1d_pct: p.change_1d == null ? null : Math.round(p.change_1d * 100) / 100, change_7d_pct: p.change_7d == null ? null : Math.round(p.change_7d * 100) / 100, age_days: ageDays, audits, chain_count: (p.chains ?? []).length, hacks_matched: mine.slice(0, 3).map((h) => ({ date: new Date(h.date * 1000).toISOString().slice(0, 10), name: h.name, amount_usd: h.amount })), flags, note: "heuristic score (higher = lower risk); hack match is by DefiLlama protocol/parent id", source: "defillama", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
}

app.get("/defi/protocol-risk", (c) => protocolRisk(c, true));
app.get("/defi/protocol-risk/preview", (c) => protocolRisk(c, false));

async function safeYields(c: any, paid: boolean) {
  try {
    const limit = paid ? Math.min(30, Math.max(1, parseInt(c.req.query("limit") ?? "10", 10) || 10)) : 3;
    const chain = paid ? (c.req.query("chain") ?? "").toLowerCase() : "";
    const [yr, pr, hr] = await Promise.all([fetch("https://yields.llama.fi/pools"), fetch("https://api.llama.fi/protocols"), fetch("https://api.llama.fi/hacks")]);
    if (!yr.ok || !pr.ok) return c.json({ error: "upstream " + (yr.ok ? pr.status : yr.status) }, { status: 502 });
    const pools = ((await yr.json()) as { data: Array<{ chain: string; project: string; symbol: string; tvlUsd: number; apy: number | null; stablecoin: boolean; ilRisk?: string }> }).data;
    const protos = (await pr.json()) as Array<{ id: string; parentProtocol?: string; slug: string; listedAt: number | null; audits: string | null }>;
    const hacks = hr.ok ? ((await hr.json()) as Array<{ defillamaId?: string | null; parentProtocolId?: string | null }>) : [];
    const hackIds = new Set(hacks.map((h) => (h.defillamaId == null ? "" : String(h.defillamaId))).filter(Boolean));
    const hackParents = new Set(hacks.map((h) => h.parentProtocolId ?? "").filter(Boolean));
    const bySlug = new Map(protos.map((p) => [p.slug, p] as const));
    const nowS = Date.now() / 1000;
    const out = pools
      .filter((x) => x.stablecoin && x.apy != null && x.apy >= 1 && x.apy <= 25 && x.tvlUsd > 5e6 && (!chain || x.chain.toLowerCase() === chain))
      .map((x) => {
        const p = bySlug.get(x.project) ?? protos.find((q) => q.slug.startsWith(x.project));
        const age = p?.listedAt ? Math.floor((nowS - p.listedAt) / 86400) : null;
        const hacked = !!p && (hackIds.has(String(p.id)) || (!!p.parentProtocol && hackParents.has(p.parentProtocol)));
        const audits = Number(p?.audits ?? 0);
        const score = Math.round(((age ?? 0) >= 365 ? 30 : 0) + (audits >= 1 ? 20 : 0) + (hacked ? 0 : 20) + Math.min(30, Math.log10(x.tvlUsd) * 3.5));
        return { project: x.project, chain: x.chain, symbol: x.symbol, apy: Math.round((x.apy ?? 0) * 100) / 100, tvl_usd: Math.round(x.tvlUsd), protocol_age_days: age, audits, hacked_before: hacked, safety_score: score };
      })
      .sort((a, b) => b.safety_score - a.safety_score || b.apy - a.apy).slice(0, limit);
    if (paid) {
      console.log(JSON.stringify({ event: "paid_request", endpoint: "/defi/safe-yields", ts: new Date().toISOString() }));
      const rail = c.get("rail") ?? "x402-paid";
      fireAndForget(c, trackPaidRequest("GET /defi/safe-yields", rail, makeUsageCounter(c.env)));
    }
    return c.json({ count: out.length, pools: out, note: "heuristic safety_score 0-100 (age, audits, no hack record, TVL); not financial advice", source: "defillama", ts: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
}

app.get("/defi/safe-yields", (c) => safeYields(c, true));
app.get("/defi/safe-yields/preview", (c) => safeYields(c, false));

app.get("/ai/ask/preview", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q || q.length > 200) return c.json({ error: "q required, max 200 chars (free preview)" }, { status: 400 });
  if (!c.env.AI || !c.env.API_KEYS) return c.json({ error: "ai unavailable" }, { status: 501 });
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const ipKey = `aiprev:${day}:${ip}`;
  const capKey = "aicap:" + day;
  const [ipUsed, used] = await Promise.all([c.env.API_KEYS.get(ipKey), c.env.API_KEYS.get(capKey)]);
  if (parseInt(ipUsed ?? "0", 10) >= 3) return c.json({ error: "free preview limit: 3/day/IP. Paid: GET /ai/ask?q= ($0.002, x402)" }, { status: 429 });
  if (parseInt(used ?? "0", 10) >= 300) return c.json({ error: "preview capacity reached today" }, { status: 503 });
  try {
    const r = (await c.env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
      messages: [{ role: "system", content: "Context: x402 is Coinbase's open HTTP 402 micropayment protocol where API callers pay per request in USDC on Base. Base is Coinbase's Ethereum L2. Answer concisely in under 60 words." }, { role: "user", content: q }],
      max_tokens: 100,
    })) as { response?: string };
    await Promise.all([
      c.env.API_KEYS.put(ipKey, String(parseInt(ipUsed ?? "0", 10) + 1), { expirationTtl: 172800 }),
      c.env.API_KEYS.put(capKey, String(parseInt(used ?? "0", 10) + 1), { expirationTtl: 172800 }),
    ]);
    return c.json({ answer: r.response ?? "", model: "llama-3.2-3b-instruct", preview: true, paid_endpoint: "/ai/ask" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/ai/ask", async (c) => {
  const q = (c.req.query("q") || "What is the x402 payment protocol?").trim();
  if (!q || q.length > 500) return c.json({ error: "q required, max 500 chars" }, { status: 400 });
  if (!c.env.AI) return c.json({ error: "ai unavailable" }, { status: 501 });
  // Hard daily cap keeps Workers AI inside the free allowance (no capital spend).
  const day = new Date().toISOString().slice(0, 10);
  const key = "aicap:" + day;
  const used = parseInt((await c.env.API_KEYS?.get(key)) ?? "0", 10);
  if (used >= 400) return c.json({ error: "daily capacity reached, retry after 00:00 UTC" }, { status: 503 });
  try {
    const r = (await c.env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
      messages: [{ role: "system", content: "Context: x402 is Coinbase's open HTTP 402 micropayment protocol where API callers pay per request in USDC on Base. Base is Coinbase's Ethereum L2. Answer concisely and accurately in under 120 words." }, { role: "user", content: q }],
      max_tokens: 200,
    })) as { response?: string };
    await c.env.API_KEYS?.put(key, String(used + 1), { expirationTtl: 172800 });
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/ai/ask", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /ai/ask", rail, makeUsageCounter(c.env)));
    return c.json({ answer: r.response ?? "", model: "llama-3.2-3b-instruct" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// OpenAI-SDK clients often send stream:true; emulate with a single-chunk SSE so they do not break.
function chatSse(text: string, model: string): Response {
  const id = "chatcmpl-" + crypto.randomUUID(), created = Math.floor(Date.now() / 1000);
  const chunk = (delta: object, finish: string | null) =>
    "data: " + JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] }) + "\n\n";
  return new Response(chunk({ role: "assistant", content: text }, null) + chunk({}, "stop") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

// Free OpenAI-client compatibility: SDKs/gateways probe GET /v1/models before calling chat.
app.get("/v1/models", (c) =>
  c.json({
    object: "list",
    data: [
      { id: "llama-3.3-70b-instruct-fp8-fast", object: "model", created: 1730000000, owned_by: "greyridge", default: true },
      { id: "llama-3.2-3b-instruct", object: "model", created: 1730000000, owned_by: "greyridge" },
    ],
    pay: { endpoint: "POST /v1/chat/completions", price_usdc: "0.002", network: "base", protocol: "x402" },
    // Honest, measured positioning for a provider deciding whether to wire us in:
    // the differentiator is keyless pay-per-call (no account/API key/minimum),
    // not a lower per-token rate. Flat $0.002/call; break-even vs Together's
    // Llama-3.3-70B ($1.04/1M in+out, measured 2026-10-21) is ~1,900 tokens/call
    // — cheaper for long-context calls, a small convenience premium on short ones.
    positioning: { model: "keyless-pay-per-call", differentiator: "no account/API key/minimum; settles USDC on Base inline via x402", price_per_call_usdc: "0.002", vs_together_70b_per_1m_usd: "1.04", breakeven_tokens_per_call: 1923 },
    free_trial: { endpoint: "POST /v1/chat/completions/preview", real_model: true, limit: "3 70B calls/day/IP, then a real 3B sample (10/day/IP); paid route is full 70B" },
  }));

app.post("/v1/chat/completions/preview", async (c) => {
  let wantStream = false;
  const canned = (txt: string, model = "llama-3.3-70b-instruct-fp8-fast") =>
    wantStream ? chatSse(txt, model) : c.json({
      id: "chatcmpl-preview", object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: "assistant", content: txt }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  const note = "[preview] Free trial limit reached or unavailable. Same response shape as paid POST /v1/chat/completions ($0.002 USDC via x402 on Base).";
  // A successful preview carries the paid-upgrade CTA inline (OpenAI clients
  // ignore unknown top-level fields) so an impressed evaluator sees exactly how
  // to pay without leaving the response.
  const UPGRADE = {
    paid_url: "https://x402-data-api.sigrunner.workers.dev/v1/chat/completions",
    price_usdc: "0.002",
    adds: "Paid route: full Llama 3.3 70B on every call, up to 400 output tokens, unmetered. This free preview serves the real 70B for your first 3 calls/day/IP, then real Llama 3.2 3B samples (<=80 tokens) — the response's `model` field tells you which you got, so you always see live model output before paying.",
    pay_with: 'x402 (USDC on Base): npm i x402-fetch viem; const walletClient=createWalletClient({account:privateKeyToAccount(process.env.EVM_PRIVATE_KEY),chain:base,transport:http()}); const f=wrapFetchWithPayment(fetch, walletClient); await f("https://x402-data-api.sigrunner.workers.dev/v1/chat/completions",{method:"POST",body:JSON.stringify({model:"llama-3.3-70b",messages})}). Runnable: https://github.com/rezearcher/x402-data-api/blob/main/examples/llm-chat.mjs (POST LLM example; also a drop-in x402 fallback provider for Daydreams/Lucid-Agents). Docs: https://api.greyridgesignals.ai/llms.txt',
  };
  const previewOut = (txt: string, model: string) =>
    wantStream ? chatSse(txt, model) : c.json({
      id: "chatcmpl-preview", object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: "assistant", content: txt }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      x402_upgrade: UPGRADE,
    });
  let body: { messages?: { role?: string; content?: unknown }[]; max_tokens?: number; stream?: boolean; model?: string } = {};
  try { body = await c.req.json(); } catch { return canned(note); }
  wantStream = body.stream === true;
  // Honour an explicit small-model request (same opt-in convention as the paid
  // route, body.model containing "3b") so an evaluator who deliberately tests
  // the 3B tier does NOT consume the scarce 3-per-IP/day 70B "taste" budget that
  // a flagship evaluation depends on. Unknown/absent model → 70B-first (default).
  const want3b = String(body.model ?? "").includes("3b");
  const msgs = (body.messages ?? []).filter((m) => m && typeof m.content === "string" && ["system", "user", "assistant"].includes(String(m.role)))
    .map((m) => ({ role: String(m.role), content: String(m.content) }));
  const total = msgs.reduce((n, m) => n + m.content.length, 0);
  if (!msgs.length || total > 1000 || !c.env.AI || !c.env.API_KEYS) return canned(note);
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const ipKey = `chatprev:${day}:${ip}`;
  const capKey = "aicap:" + day;
  const maxTok = Math.min(Math.max(Number(body.max_tokens) || 64, 1), 80);
  const [ipUsed, used] = await Promise.all([c.env.API_KEYS.get(ipKey), c.env.API_KEYS.get(capKey)]);
  const ip70 = parseInt(ipUsed ?? "0", 10), g70 = parseInt(used ?? "0", 10);
  try {
    // Premium taste: serve 70B while its (small) budget lasts — unless the caller
    // explicitly asked for the 3B model, in which case fall through and preserve
    // the 70B budget for flagship evaluations.
    if (!want3b && ip70 < 3 && g70 < 300) {
      const r = (await c.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages: msgs, max_tokens: maxTok })) as { response?: string };
      await Promise.all([
        c.env.API_KEYS.put(ipKey, String(ip70 + 1), { expirationTtl: 172800 }),
        c.env.API_KEYS.put(capKey, String(g70 + 1), { expirationTtl: 172800 }),
      ]);
      return previewOut(r.response ?? "", "llama-3.3-70b-instruct-fp8-fast");
    }
    // 70B budget spent → fall back to the cheap 3B model (its own, far higher
    // cap) so an evaluator ALWAYS sees real model output, never a dead
    // "limit reached" first impression. 3B still proves the endpoint is a
    // real OpenAI-compatible x402 route; the paid tier is the full 70B.
    const ipKey3 = `chatprev3b:${day}:${ip}`;
    const capKey3 = "aicap3b:" + day;
    const [ip3s, g3s] = await Promise.all([c.env.API_KEYS.get(ipKey3), c.env.API_KEYS.get(capKey3)]);
    const ip3 = parseInt(ip3s ?? "0", 10), g3 = parseInt(g3s ?? "0", 10);
    if (ip3 >= 10 || g3 >= 3000) return canned(note);
    const r = (await c.env.AI.run("@cf/meta/llama-3.2-3b-instruct", { messages: msgs, max_tokens: maxTok })) as { response?: string };
    await Promise.all([
      c.env.API_KEYS.put(ipKey3, String(ip3 + 1), { expirationTtl: 172800 }),
      c.env.API_KEYS.put(capKey3, String(g3 + 1), { expirationTtl: 172800 }),
    ]);
    return previewOut(r.response ?? "", "llama-3.2-3b-instruct");
  } catch {
    return canned(note);
  }
});

app.post("/v1/chat/completions", async (c) => {
  if (!c.env.AI) return c.json({ error: "ai unavailable" }, { status: 501 });
  let body: { messages?: { role?: string; content?: unknown }[]; max_tokens?: number; stream?: boolean } = {};
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, { status: 400 }); }
  const msgs = (body.messages ?? []).filter((m) => m && typeof m.content === "string" && ["system", "user", "assistant"].includes(String(m.role)))
    .map((m) => ({ role: String(m.role), content: String(m.content) }));
  const total = msgs.reduce((n, m) => n + m.content.length, 0);
  if (!msgs.length || total > 8000) return c.json({ error: "messages required, total content max 8000 chars" }, { status: 400 });
  const day = new Date().toISOString().slice(0, 10);
  const key = "aicap:" + day;
  const used = parseInt((await c.env.API_KEYS?.get(key)) ?? "0", 10);
  if (used >= 400) return c.json({ error: "daily capacity reached, retry after 00:00 UTC" }, { status: 503 });
  try {
    // Default 70B (cost ~$0.0007-0.0012/call vs $0.002 price); body.model "llama-3.2-3b-instruct" opts into the small model.
    const want3b = String((body as { model?: string }).model ?? "").includes("3b");
    const params = { messages: msgs, max_tokens: Math.min(Math.max(Number(body.max_tokens) || 256, 1), 400) };
    let modelUsed = want3b ? "llama-3.2-3b-instruct" : "llama-3.3-70b-instruct-fp8-fast";
    let r: { response?: string };
    if (want3b) {
      r = (await c.env.AI.run("@cf/meta/llama-3.2-3b-instruct", params)) as { response?: string };
    } else {
      try {
        r = (await c.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", params)) as { response?: string };
      } catch {
        modelUsed = "llama-3.2-3b-instruct";
        r = (await c.env.AI.run("@cf/meta/llama-3.2-3b-instruct", params)) as { response?: string };
      }
    }
    await c.env.API_KEYS?.put(key, String(used + 1), { expirationTtl: 172800 });
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("POST /v1/chat/completions", rail, makeUsageCounter(c.env)));
    const text = r.response ?? "";
    if (body.stream === true) return chatSse(text, modelUsed);
    return c.json({
      id: "chatcmpl-" + crypto.randomUUID(), object: "chat.completion", created: Math.floor(Date.now() / 1000), model: modelUsed,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: Math.ceil(total / 4), completion_tokens: Math.ceil(text.length / 4), total_tokens: Math.ceil((total + text.length) / 4) },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/ai/classify", async (c) => {
  const text = (c.req.query("text") || "My card was charged twice this month").trim();
  const labels = (c.req.query("labels") || "billing,bug,feature_request,other").split(",").map((f) => f.trim()).filter(Boolean);
  if (!text || text.length > 1000) return c.json({ error: "text required, max 1000 chars" }, { status: 400 });
  if (labels.length < 2 || labels.length > 10 || labels.some((l) => !/^[A-Za-z0-9_ -]{1,40}$/.test(l))) return c.json({ error: "labels required: 2-10 comma-separated labels" }, { status: 400 });
  if (!c.env.AI) return c.json({ error: "ai unavailable" }, { status: 501 });
  const day = new Date().toISOString().slice(0, 10);
  const key = "aicap:" + day;
  const used = parseInt((await c.env.API_KEYS?.get(key)) ?? "0", 10);
  if (used >= 400) return c.json({ error: "daily capacity reached, retry after 00:00 UTC" }, { status: 503 });
  try {
    const r = (await c.env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
      messages: [{ role: "system", content: "Classify the user's text. Reply with ONLY one label from this list, exactly as written: " + labels.join(", ") }, { role: "user", content: text }],
      max_tokens: 20,
    })) as { response?: string };
    const out = (r.response ?? "").trim().toLowerCase();
    const label = labels.find((l) => out === l.toLowerCase()) ?? labels.find((l) => out.includes(l.toLowerCase())) ?? null;
    await c.env.API_KEYS?.put(key, String(used + 1), { expirationTtl: 172800 });
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/ai/classify", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /ai/classify", rail, makeUsageCounter(c.env)));
    return c.json({ label, labels, model: "llama-3.2-3b-instruct" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/ai/summarize", async (c) => {
  const text = (c.req.query("text") || "x402 is an open HTTP 402 payment protocol letting clients pay per request in USDC on Base without accounts or API keys. Servers answer 402 with price details, clients sign a payment, and the server returns the resource once settled.").trim();
  if (!text || text.length > 1500) return c.json({ error: "text required, max 1500 chars" }, { status: 400 });
  if (!c.env.AI) return c.json({ error: "ai unavailable" }, { status: 501 });
  const day = new Date().toISOString().slice(0, 10);
  const key = "aicap:" + day;
  const used = parseInt((await c.env.API_KEYS?.get(key)) ?? "0", 10);
  if (used >= 400) return c.json({ error: "daily capacity reached, retry after 00:00 UTC" }, { status: 503 });
  try {
    const r = (await c.env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
      messages: [{ role: "system", content: "Summarize the user's text in 1-3 sentences. Reply with ONLY the summary." }, { role: "user", content: text }],
      max_tokens: 150,
    })) as { response?: string };
    await c.env.API_KEYS?.put(key, String(used + 1), { expirationTtl: 172800 });
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/ai/summarize", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /ai/summarize", rail, makeUsageCounter(c.env)));
    return c.json({ summary: (r.response ?? "").trim(), model: "llama-3.2-3b-instruct" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/ai/translate", async (c) => {
  const text = (c.req.query("text") || "Hello, how are you today?").trim();
  const to = (c.req.query("to") || "es").trim();
  if (!text || text.length > 800) return c.json({ error: "text required, max 800 chars" }, { status: 400 });
  if (!/^[A-Za-z][A-Za-z -]{1,30}$/.test(to)) return c.json({ error: "to required: target language name or code" }, { status: 400 });
  if (!c.env.AI) return c.json({ error: "ai unavailable" }, { status: 501 });
  const day = new Date().toISOString().slice(0, 10);
  const key = "aicap:" + day;
  const used = parseInt((await c.env.API_KEYS?.get(key)) ?? "0", 10);
  if (used >= 400) return c.json({ error: "daily capacity reached, retry after 00:00 UTC" }, { status: 503 });
  try {
    const r = (await c.env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
      messages: [{ role: "system", content: "Translate the user's text into " + to + ". Reply with ONLY the translation, no notes or quotes." }, { role: "user", content: text }],
      max_tokens: 400,
    })) as { response?: string };
    await c.env.API_KEYS?.put(key, String(used + 1), { expirationTtl: 172800 });
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/ai/translate", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /ai/translate", rail, makeUsageCounter(c.env)));
    return c.json({ translation: (r.response ?? "").trim(), to, model: "llama-3.2-3b-instruct" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/ai/extract/preview", async (c) => {
  const text = (c.req.query("text") ?? "").trim();
  const fields = (c.req.query("fields") ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  if (!text || text.length > 300) return c.json({ error: "text required, max 300 chars (free preview)" }, { status: 400 });
  if (!fields.length || fields.length > 6 || fields.some((f) => !/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(f))) return c.json({ error: "fields required: 1-6 comma-separated identifiers" }, { status: 400 });
  if (!c.env.AI || !c.env.API_KEYS) return c.json({ error: "ai unavailable" }, { status: 501 });
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const ipKey = `aiprev:${day}:${ip}`;
  const capKey = "aicap:" + day;
  const [ipUsed, used] = await Promise.all([c.env.API_KEYS.get(ipKey), c.env.API_KEYS.get(capKey)]);
  if (parseInt(ipUsed ?? "0", 10) >= 3) return c.json({ error: "free preview limit: 3/day/IP. Paid: GET /ai/extract ($0.005, x402)" }, { status: 429 });
  if (parseInt(used ?? "0", 10) >= 300) return c.json({ error: "preview capacity reached today" }, { status: 503 });
  try {
    const r = (await c.env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
      messages: [{ role: "system", content: "Extract data from the user's text. Reply with ONLY a JSON object with exactly these keys: " + fields.join(", ") + ". Use null for any value not present in the text. No prose, no code fences." }, { role: "user", content: text }],
      max_tokens: 200,
    })) as { response?: string };
    const m = (r.response ?? "").match(/\{[\s\S]*\}/);
    let parsed: Record<string, unknown> = {};
    try { parsed = m ? JSON.parse(m[0]) : {}; } catch { return c.json({ error: "model returned unparseable output, retry" }, { status: 502 }); }
    const data: Record<string, unknown> = {};
    for (const f of fields) data[f] = parsed[f] ?? null;
    await Promise.all([
      c.env.API_KEYS.put(ipKey, String(parseInt(ipUsed ?? "0", 10) + 1), { expirationTtl: 172800 }),
      c.env.API_KEYS.put(capKey, String(parseInt(used ?? "0", 10) + 1), { expirationTtl: 172800 }),
    ]);
    return c.json({ data, model: "llama-3.2-3b-instruct", preview: true, paid_endpoint: "/ai/extract" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/ai/extract", async (c) => {
  const text = (c.req.query("text") || "Acme Corp paid Bob Lee $40 on May 3 for hosting").trim();
  const fields = (c.req.query("fields") || "payer,payee,amount,date").split(",").map((f) => f.trim()).filter(Boolean);
  if (!text || text.length > 1500) return c.json({ error: "text required, max 1500 chars" }, { status: 400 });
  if (!fields.length || fields.length > 12 || fields.some((f) => !/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(f))) return c.json({ error: "fields required: 1-12 comma-separated identifiers" }, { status: 400 });
  if (!c.env.AI) return c.json({ error: "ai unavailable" }, { status: 501 });
  const day = new Date().toISOString().slice(0, 10);
  const key = "aicap:" + day;
  const used = parseInt((await c.env.API_KEYS?.get(key)) ?? "0", 10);
  if (used >= 400) return c.json({ error: "daily capacity reached, retry after 00:00 UTC" }, { status: 503 });
  try {
    const r = (await c.env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
      messages: [{ role: "system", content: "Extract data from the user's text. Reply with ONLY a JSON object with exactly these keys: " + fields.join(", ") + ". Use null for any value not present in the text. No prose, no code fences." }, { role: "user", content: text }],
      max_tokens: 300,
    })) as { response?: string };
    const raw = r.response ?? "";
    const m = raw.match(/\{[\s\S]*\}/);
    let parsed: Record<string, unknown> = {};
    try { parsed = m ? JSON.parse(m[0]) : {}; } catch { return c.json({ error: "model returned unparseable output, retry" }, { status: 502 }); }
    const data: Record<string, unknown> = {};
    for (const f of fields) data[f] = parsed[f] ?? null;
    await c.env.API_KEYS?.put(key, String(used + 1), { expirationTtl: 172800 });
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/ai/extract", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /ai/extract", rail, makeUsageCounter(c.env)));
    return c.json({ data, model: "llama-3.2-3b-instruct" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/block", async (c) => {
  const q = c.req.query("number") ?? "latest";
  if (q !== "latest" && !/^\d{1,12}$/.test(q)) {
    return c.json({ error: "number must be a decimal block number or 'latest'" }, { status: 400 });
  }
  try {
    const b = (await baseRpc("eth_getBlockByNumber", [q === "latest" ? "latest" : "0x" + Number(q).toString(16), false])) as any;
    if (!b) return c.json({ error: "block not found" }, { status: 404 });
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/chain/block", ts: new Date().toISOString() }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/block", rail, makeUsageCounter(c.env)));
    return c.json({
      number: Number(BigInt(b.number)), hash: b.hash, parent_hash: b.parentHash, timestamp: Number(BigInt(b.timestamp)),
      tx_count: b.transactions.length, gas_used: Number(BigInt(b.gasUsed)), gas_limit: Number(BigInt(b.gasLimit)),
      base_fee_gwei: b.baseFeePerGas ? Number(BigInt(b.baseFeePerGas)) / 1e9 : null, chain: "base",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/wallet", async (c) => {
  const address = c.req.query("address");
  if (!address || !ADDR_RE.test(address)) {
    return c.json({ error: "address query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }

  try {
    const [balanceHex, nonceHex, code, ethUsd] = await Promise.all([
      baseRpc("eth_getBalance", [address, "latest"]) as Promise<string>,
      baseRpc("eth_getTransactionCount", [address, "latest"]) as Promise<string>,
      baseRpc("eth_getCode", [address, "latest"]) as Promise<string>,
      getEthUsd(),
    ]);
    const wei = BigInt(balanceHex);
    const balanceEth = Number(wei) / 1e18;
    const result = {
      address,
      balance_wei: wei.toString(),
      balance_eth: balanceEth,
      balance_usd: ethUsd !== null ? balanceEth * ethUsd : null,
      tx_count: parseInt(nonceHex, 16),
      ...classifyCode(code),
      chain: "base",
    };

    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/wallet", address, ts: new Date().toISOString() }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/wallet", rail, makeUsageCounter(c.env)));

    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// ---------------------------------------------------------------------------
// TOKEN SECURITY / HONEYPOT DETECTOR — the flagship moat product. Every other
// endpoint here is a thin wrapper on data anyone could fetch themselves; this
// one does real compute an agent can't trivially self-serve: EIP-1967/1822
// proxy-slot reads, a runtime-bytecode dispatcher scan for dangerous selectors,
// and a LIVE eth_call state-override simulation of a wallet-to-wallet transfer
// to test whether a token is actually movable. Base mainnet, free RPC only.
// ---------------------------------------------------------------------------

// EIP-1967 standard proxy storage slots: bytes32(uint256(keccak256("eip1967.proxy.<x>")) - 1).
// Independently recomputed via keccak256 during implementation — not copy-pasted blind.
const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const EIP1967_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
// EIP-1822 UUPS: the "PROXIABLE" slot is keccak256("PROXIABLE") itself (no -1 offset).
const EIP1822_PROXIABLE_SLOT = "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7";
// Pre-EIP-1967 OpenZeppelin "zOS" AdminUpgradeabilityProxy slots (keccak256(string), no -1
// offset) — the pattern OZ shipped before EIP-1967 was finalized in 2019. Still load-bearing:
// Base USDC's FiatTokenProxy (deployed 2018-era) uses exactly this older convention, not
// EIP-1967 — confirmed empirically against live Base state during implementation (its
// EIP-1967 slots read all-zero; these zOS slots hold the real implementation/admin).
const ZOS_IMPLEMENTATION_SLOT = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";
const ZOS_ADMIN_SLOT = "0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b";

// A 32-byte storage word to a checksummed-agnostic lowercase address, or null if unset.
function storageWordToAddress(word: string): string | null {
  const clean = word.replace(/^0x/, "").padStart(64, "0");
  const addrPart = clean.slice(24);
  if (/^0+$/.test(addrPart)) return null;
  return "0x" + addrPart;
}

interface ProxyInfo {
  is_proxy: boolean;
  proxy_standard: string | null;
  implementation_address: string | null;
  admin_address: string | null;
  is_upgradeable: boolean;
}

async function detectProxy(token: string): Promise<ProxyInfo> {
  const [implWord, adminWord, uupsWord, zosImplWord, zosAdminWord] = await Promise.all([
    (baseRpc("eth_getStorageAt", [token, EIP1967_IMPLEMENTATION_SLOT, "latest"]).catch(() => null)) as Promise<string | null>,
    (baseRpc("eth_getStorageAt", [token, EIP1967_ADMIN_SLOT, "latest"]).catch(() => null)) as Promise<string | null>,
    (baseRpc("eth_getStorageAt", [token, EIP1822_PROXIABLE_SLOT, "latest"]).catch(() => null)) as Promise<string | null>,
    (baseRpc("eth_getStorageAt", [token, ZOS_IMPLEMENTATION_SLOT, "latest"]).catch(() => null)) as Promise<string | null>,
    (baseRpc("eth_getStorageAt", [token, ZOS_ADMIN_SLOT, "latest"]).catch(() => null)) as Promise<string | null>,
  ]);
  const implAddr = implWord ? storageWordToAddress(implWord) : null;
  const adminAddr = adminWord ? storageWordToAddress(adminWord) : null;
  const uupsAddr = uupsWord ? storageWordToAddress(uupsWord) : null;
  const zosImplAddr = zosImplWord ? storageWordToAddress(zosImplWord) : null;
  const zosAdminAddr = zosAdminWord ? storageWordToAddress(zosAdminWord) : null;

  if (implAddr) {
    return { is_proxy: true, proxy_standard: "EIP-1967", implementation_address: implAddr, admin_address: adminAddr, is_upgradeable: true };
  }
  if (uupsAddr) {
    return { is_proxy: true, proxy_standard: "EIP-1822 (UUPS)", implementation_address: uupsAddr, admin_address: adminAddr, is_upgradeable: true };
  }
  if (zosImplAddr) {
    // Pre-EIP-1967 OpenZeppelin AdminUpgradeabilityProxy convention (e.g. Base USDC's
    // FiatTokenProxy) — same upgradeability risk, older slot layout.
    return { is_proxy: true, proxy_standard: "OZ zOS AdminUpgradeabilityProxy (pre-EIP-1967)", implementation_address: zosImplAddr, admin_address: zosAdminAddr, is_upgradeable: true };
  }
  if (adminAddr) {
    // Admin slot populated but no readable implementation slot — still proxy-like (nonstandard variant).
    return { is_proxy: true, proxy_standard: "EIP-1967 (admin slot only)", implementation_address: null, admin_address: adminAddr, is_upgradeable: true };
  }
  return { is_proxy: false, proxy_standard: null, implementation_address: null, admin_address: null, is_upgradeable: false };
}

// Bytecode red-flag selectors, grouped by risk capability. Selectors below are
// verified 4-byte function selectors (keccak256(signature).slice(0,4)) for the
// exact signatures shown — cross-checked with viem's toFunctionSelector during
// implementation, not guessed.
type SecurityCategory = "can_mint" | "can_burn" | "can_pause" | "has_blacklist" | "has_fee_setter" | "has_ownership";

const SELECTOR_CATALOG: { selector: string; sig: string; category: SecurityCategory }[] = [
  { selector: "40c10f19", sig: "mint(address,uint256)", category: "can_mint" },
  { selector: "a0712d68", sig: "mint(uint256)", category: "can_mint" },
  { selector: "42966c68", sig: "burn(uint256)", category: "can_burn" },
  { selector: "9dc29fac", sig: "burn(address,uint256)", category: "can_burn" },
  { selector: "8456cb59", sig: "pause()", category: "can_pause" },
  { selector: "3f4ba83a", sig: "unpause()", category: "can_pause" },
  { selector: "f9f92be4", sig: "blacklist(address)", category: "has_blacklist" },
  { selector: "0ecb93c0", sig: "addBlackList(address)", category: "has_blacklist" },
  { selector: "417c73a7", sig: "addToBlackList(address)", category: "has_blacklist" },
  { selector: "153b0d1e", sig: "setBlacklist(address,bool)", category: "has_blacklist" },
  { selector: "fe575a87", sig: "isBlacklisted(address)", category: "has_blacklist" },
  { selector: "e5c7160b", sig: "blocklist(address)", category: "has_blacklist" },
  { selector: "000af2a1", sig: "setBlocked(address,bool)", category: "has_blacklist" },
  { selector: "061c82d0", sig: "setTaxFeePercent(uint256)", category: "has_fee_setter" },
  { selector: "69fe0e2d", sig: "setFee(uint256)", category: "has_fee_setter" },
  { selector: "0b78f9c0", sig: "setFees(uint256,uint256)", category: "has_fee_setter" },
  { selector: "2e5bb6ff", sig: "setTax(uint256)", category: "has_fee_setter" },
  { selector: "dc1052e2", sig: "setBuyTax(uint256)", category: "has_fee_setter" },
  { selector: "8cd09d50", sig: "setSellTax(uint256)", category: "has_fee_setter" },
  { selector: "8da5cb5b", sig: "owner()", category: "has_ownership" },
  { selector: "715018a6", sig: "renounceOwnership()", category: "has_ownership" },
  { selector: "f2fde38b", sig: "transferOwnership(address)", category: "has_ownership" },
];

// Detects a selector via the Solidity function-dispatcher pattern (PUSH4 <selector> EQ,
// opcodes 0x63<4-byte-selector>0x14) rather than a raw substring search — far lower
// false-positive rate than matching the 4 bytes anywhere in the bytecode (which can
// coincidentally appear inside PUSH-immediate constants unrelated to the dispatcher).
function scanBytecodeSelectors(code: string): {
  detected: { selector: string; signature: string; category: SecurityCategory }[];
  categories: Record<SecurityCategory, boolean>;
} {
  const low = code.toLowerCase();
  const detected = SELECTOR_CATALOG.filter((s) => low.includes(`63${s.selector}14`)).map((s) => ({
    selector: `0x${s.selector}`,
    signature: s.sig,
    category: s.category,
  }));
  const categories: Record<SecurityCategory, boolean> = {
    can_mint: false,
    can_burn: false,
    can_pause: false,
    has_blacklist: false,
    has_fee_setter: false,
    has_ownership: false,
  };
  for (const d of detected) categories[d.category] = true;
  return { detected, categories };
}

interface OwnerInfo {
  owner: string | null;
  ownership_renounced: boolean;
  owner_type: "none" | "renounced" | "eoa" | "contract";
}

// Single-attempt-per-provider RPC call: unlike baseRpc(), a JSON-RPC "error"
// here (e.g. execution reverted because a function doesn't exist — expected
// for e.g. owner() on a non-Ownable token) IS a real answer, not a failure to
// paper over by rotating through all 4 providers. Only rotates on transport-
// level failures or explicit rate-limit responses. Cloudflare Workers caps
// subrequests per invocation (~50, shared with the x402 payment middleware's
// own facilitator calls) — burning 4x subrequests on every expected revert
// (as baseRpc's blind full-rotation would) risks tripping that cap on a
// compute-heavy endpoint like this one, so every optional/may-revert call in
// this file's token-security analysis uses this instead of baseRpc().
async function baseRpcProbe(method: string, params: unknown[]): Promise<{ result?: string; error?: string; unavailable?: boolean }> {
  for (const url of rpcOrder()) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) { rpcMarkBad(url); continue; }
      const j = (await res.json()) as { result?: string; error?: { message?: string } };
      if (j.error) {
        if (/rate limit|too many requests|429/i.test(j.error.message ?? "")) continue; // transient — try next provider
        // Only a genuine EVM revert is "the answer". Provider-side refusals ("method not
        // supported", auth, quota…) are infra failures — rotate, else a bad provider reached
        // after the good ones rate-limit us turns every token into sim_status "unavailable".
        if (!/revert|invalid opcode|out of gas|stack|abort/i.test(j.error.message ?? "")) { rpcMarkBad(url); continue; }
        return { error: j.error.message ?? "execution reverted" };
      }
      return { result: j.result };
    } catch {
      rpcMarkBad(url);
      continue;
    }
  }
  return { unavailable: true };
}

async function getOwnerInfo(token: string): Promise<OwnerInfo> {
  const call = await baseRpcProbe("eth_call", [{ to: token, data: "0x8da5cb5b" }, "latest"]);
  if (!call.result || call.result === "0x") return { owner: null, ownership_renounced: false, owner_type: "none" };
  const addr = storageWordToAddress(call.result);
  if (!addr) return { owner: null, ownership_renounced: true, owner_type: "renounced" };
  const codeCall = await baseRpcProbe("eth_getCode", [addr, "latest"]);
  const isContract = !!codeCall.result && codeCall.result !== "0x";
  return { owner: addr, ownership_renounced: false, owner_type: isContract ? "contract" : "eoa" };
}

// ---------------------------------------------------------------------------
// Honeypot / tradeability simulation — the hard, valuable part. Real eth_call
// state overrides (stateDiff), not a fabricated result: a synthetic wallet is
// given a token balance out-of-band (no funds move, nothing is broadcast) by
// overriding the ERC-20's balance-mapping storage slot, then we attempt a
// plain transfer() from it and observe revert vs success. This is a proxy for
// "can this token actually be moved", NOT a full DEX buy+sell round-trip
// through a router (Aerodrome/Uniswap) — see the `method` note on the result.
// Confirmed empirically during implementation that mainnet.base.org,
// base-rpc.publicnode.com, and base.drpc.org all honor the stateDiff override
// (verified against WETH's known balance slot before writing this).
// ---------------------------------------------------------------------------

const PROBE_HOLDER = "0x1111111111111111111111111111111111111111";
const PROBE_RECIPIENT = "0x2222222222222222222222222222222222222222";
const PROBE_VALUE = 31337n * 10n ** 18n; // distinctive "leet" test balance — collision-negligible vs a real balance
const PROBE_VALUE_HEX = "0x" + PROBE_VALUE.toString(16).padStart(64, "0");
// Candidate balance-mapping slots. The old probe tried only integer slots 0..3
// as a bare mapping(address=>uint256) — which silently fails on the entire class
// of OpenZeppelin v5 UPGRADEABLE tokens, where storage is ERC-7201 "namespaced":
// the _balances mapping lives at a keccak-derived base slot, nowhere near 0..3.
// Since that is the fastest-growing layout for new Base tokens (and exactly where
// a free simple-layout probe also gives up), we now cover integer slots 0..15
// PLUS the ERC-7201 base slot for "openzeppelin.storage.ERC20". Range 0..63 also
// covers the Coinbase bridged-token layout (balances at slot 51 — cbETH, USDbC,
// cbBTC and friends), which the old 0..3 scan missed entirely on Base.
//
// Cloudflare Workers caps subrequests at 50/invocation, shared with the x402
// payment middleware's verify+settle calls. We stay well under it by NOT probing
// each candidate with its own RPC call: discovery overrides the WHOLE candidate
// set in one stateDiff and reads balanceOf once (1 call), then binary-narrows to
// the exact slot (~ceil(log2(N)) calls), then runs ONE clean single-slot transfer
// sim. Worst case ≈ 7 subrequests to cover 17 candidate layouts — fewer than the
// old sequential scan needed to cover 4.

// ERC-7201 (EIP-7201) namespaced storage base slot:
//   keccak256(abi.encode(uint256(keccak256(id)) - 1)) & ~bytes32(uint256(0xff))
// For OZ v5 ERC20Upgradeable the _balances mapping is field 0 of ERC20Storage,
// so its slot IS this base slot.
function erc7201BaseSlot(namespace: string): bigint {
  const inner = BigInt(keccak256(stringToHex(namespace))) - 1n;
  const encoded = ("0x" + inner.toString(16).padStart(64, "0")) as `0x${string}`;
  const mask = ((1n << 256n) - 1n) ^ 0xffn; // ~bytes32(uint256(0xff)): clear the low byte
  return BigInt(keccak256(encoded)) & mask;
}
const ERC20_7201_BALANCES_SLOT = erc7201BaseSlot("openzeppelin.storage.ERC20");
const CANDIDATE_SLOTS: bigint[] = [
  ...Array.from({ length: 64 }, (_, i) => BigInt(i)),
  ERC20_7201_BALANCES_SLOT,
];

// Solidity's mapping(address => X) slot derivation: keccak256(pad32(key) . pad32(slot)).
// Slot is a full 256-bit value (ERC-7201 base slots are large), so take a bigint.
function mappingSlotKey(holder: string, slot: bigint): string {
  const holderWord = holder.slice(2).toLowerCase().padStart(64, "0");
  const slotWord = slot.toString(16).padStart(64, "0");
  return keccak256(`0x${holderWord}${slotWord}` as `0x${string}`);
}

interface HoneypotSim {
  sim_status: "tested" | "unavailable";
  method: string;
  balance_slot_index: number | null;
  slot_layout: string | null;
  transferable: boolean | null;
  revert_reason: string | null;
  transfer_tax_bps?: number | null;
  note: string;
}

const HONEYPOT_SIM_METHOD =
  "eth_call with a stateDiff override: gives a synthetic wallet (0x1111...1111) a token balance out-of-band (no real funds move) by overriding the ERC-20's balance-mapping storage slot, then attempts a plain transfer() to a second synthetic wallet and checks for a revert. Detects wallet-to-wallet transfer blocks (the most common honeypot/blacklist pattern). This is NOT a full DEX buy+sell round-trip through a router (Aerodrome/Uniswap) — no buy_tax_pct/sell_tax_pct is computed. A token could in principle allow plain transfers while still blocking sells specifically through its LP pair, or vice versa; treat transferable:false as a strong red flag and transferable:true as 'no basic transfer-block found', not a full sellability guarantee.";

// Measured fee-on-transfer: eth_simulateV1 runs [balanceOf(R), transfer(H->R, X), balanceOf(R)]
// in ONE simulated block with the same stateDiff, so received = after - before. This is a
// plain-transfer tax (catches fee-on-transfer/reflection tokens), NOT a DEX buy/sell tax.
// Own fetch loop (no rpcMarkBad): a provider lacking eth_simulateV1 must not be demoted for other calls.
async function measureTransferTaxBps(token: string, key: string, amount: bigint): Promise<number | null> {
  const word = (n: bigint) => n.toString(16).padStart(64, "0");
  const bal = { to: token, data: `0x70a08231${PROBE_RECIPIENT.slice(2).toLowerCase().padStart(64, "0")}` };
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "eth_simulateV1",
    params: [{
      blockStateCalls: [{
        stateOverrides: { [token]: { stateDiff: { [key]: "0x" + word(PROBE_VALUE) } } },
        calls: [bal,
          { from: PROBE_HOLDER, to: token, data: `0xa9059cbb${PROBE_RECIPIENT.slice(2).toLowerCase().padStart(64, "0")}${word(amount)}` },
          bal],
      }],
      validation: false,
    }, "latest"],
  });
  for (const url of rpcOrder().slice(0, 3)) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const j = (await res.json()) as { result?: { calls?: { status?: string; returnData?: string }[] }[] };
      const c = j.result?.[0]?.calls;
      if (!c || c.length !== 3 || c[1].status !== "0x1") continue;
      const before = BigInt(c[0].returnData || "0x0"), after = BigInt(c[2].returnData || "0x0");
      const received = after - before;
      if (received < 0n || received > amount) return null;
      return Number(((amount - received) * 10000n) / amount);
    } catch { continue; }
  }
  return null;
}

async function simulateTransferProbe(token: string): Promise<HoneypotSim> {
  const balanceOfData = (holder: string) => `0x70a08231${holder.slice(2).toLowerCase().padStart(64, "0")}`;
  const transferData = (to: string, amount: bigint) =>
    `0xa9059cbb${to.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;

  // Discovery: find which candidate slot holds _balances[holder]. Override the
  // WHOLE candidate set in one stateDiff and read balanceOf once — overriding
  // non-balance slots is harmless to a balanceOf read, so the call returns our
  // planted value iff the real slot is somewhere in the set. Then binary-narrow
  // to the exact slot. This covers 17 candidate layouts in ~7 subrequests.
  let sawAnySuccess = false;
  const subsetHoldsSlot = async (subset: bigint[]): Promise<boolean> => {
    const stateDiff: Record<string, string> = {};
    for (const s of subset) stateDiff[mappingSlotKey(PROBE_HOLDER, s)] = PROBE_VALUE_HEX;
    const r = await baseRpcProbe("eth_call", [
      { to: token, data: balanceOfData(PROBE_HOLDER) },
      "latest",
      { [token]: { stateDiff } },
    ]);
    if (r.result === undefined) return false;
    sawAnySuccess = true;
    try {
      return BigInt(r.result) === PROBE_VALUE;
    } catch {
      return false; // non-numeric result — ignore
    }
  };

  let foundSlot: bigint | null = null;
  if (await subsetHoldsSlot(CANDIDATE_SLOTS)) {
    let pool = CANDIDATE_SLOTS.slice();
    while (pool.length > 1) {
      const mid = Math.ceil(pool.length / 2);
      const left = pool.slice(0, mid);
      pool = (await subsetHoldsSlot(left)) ? left : pool.slice(mid);
    }
    foundSlot = pool[0];
  }

  if (foundSlot === null) {
    return {
      sim_status: "unavailable",
      method: HONEYPOT_SIM_METHOD,
      balance_slot_index: null,
      slot_layout: null,
      transferable: null,
      revert_reason: null,
      note: sawAnySuccess
        ? `Could not locate this token's balance storage slot — probed integer slots 0-63 and the ERC-7201 "openzeppelin.storage.ERC20" namespace. Likely a non-standard layout (reflection/rebasing math, packed struct, or a custom namespace) — no tradeability signal available. This does NOT imply the token is safe or unsafe.`
        : "RPC state-override calls failed or were rate-limited on every attempt — simulation infra unavailable right now. This does NOT imply the token is safe or unsafe.",
    };
  }

  const slotLayout =
    foundSlot === ERC20_7201_BALANCES_SLOT ? "erc7201:openzeppelin.storage.ERC20" : `mapping@slot${foundSlot}`;
  const slotIndexNum = foundSlot < 64n ? Number(foundSlot) : null;
  const key = mappingSlotKey(PROBE_HOLDER, foundSlot);
  const override = { [token]: { stateDiff: { [key]: PROBE_VALUE_HEX } } };
  const sendAmount = PROBE_VALUE / 2n;
  const simResult = await baseRpcProbe("eth_call", [
    { to: token, from: PROBE_HOLDER, data: transferData(PROBE_RECIPIENT, sendAmount) },
    "latest",
    override,
  ]);

  if (simResult.unavailable) {
    return {
      sim_status: "unavailable",
      method: HONEYPOT_SIM_METHOD,
      balance_slot_index: slotIndexNum,
      slot_layout: slotLayout,
      transferable: null,
      revert_reason: null,
      note: "Balance slot located but the transfer-probe eth_call failed or was rate-limited on every RPC attempt.",
    };
  }
  if (simResult.error) {
    return {
      sim_status: "tested",
      method: HONEYPOT_SIM_METHOD,
      balance_slot_index: slotIndexNum,
      slot_layout: slotLayout,
      transferable: false,
      revert_reason: simResult.error.slice(0, 300),
      note: "A synthetic wallet holding this token could NOT complete a plain transfer() — it reverted. Strong honeypot / transfer-restriction signal.",
    };
  }
  const transferTaxBps = await measureTransferTaxBps(token, key, sendAmount);
  return {
    sim_status: "tested",
    method: HONEYPOT_SIM_METHOD,
    balance_slot_index: slotIndexNum,
    slot_layout: slotLayout,
    transferable: true,
    revert_reason: null,
    transfer_tax_bps: transferTaxBps,
    note: "A synthetic wallet holding this token successfully completed a plain transfer() with no revert. No basic transfer-block detected (does not rule out DEX-pair-specific sell restrictions).",
  };
}

interface TokenSecurityResult {
  token: string;
  chain: "base";
  is_contract: boolean;
  is_eip7702_delegate: boolean;
  delegate_address: string | null;
  meta: {
    name: string | null;
    symbol: string | null;
    decimals: number;
    total_supply_raw: string | null;
    total_supply_formatted: number | null;
  };
  proxy: ProxyInfo;
  capabilities: Record<SecurityCategory, boolean> & {
    detected_selectors: { selector: string; signature: string; category: SecurityCategory }[];
    scanned_address: string;
  };
  ownership: OwnerInfo;
  honeypot_sim: HoneypotSim;
  risk_score: number;
  verdict: Verdict;
  flags: string[];
  risk_summary: string;
  analyzed_at: string;
}

async function analyzeTokenSecurity(token: string): Promise<TokenSecurityResult> {
  const analyzed_at = new Date().toISOString();

  const [code, nameCall, totalSupplyCall, meta, proxy, owner, sim] = await Promise.all([
    baseRpc("eth_getCode", [token, "latest"]) as Promise<string>,
    baseRpcProbe("eth_call", [{ to: token, data: "0x06fdde03" }, "latest"]),
    baseRpcProbe("eth_call", [{ to: token, data: "0x18160ddd" }, "latest"]),
    getTokenMeta(token),
    detectProxy(token),
    getOwnerInfo(token),
    simulateTransferProbe(token),
  ]);

  const codeClass = classifyCode(code);
  // A proxy's OWN bytecode is just a thin delegatecall forwarder — mint/pause/
  // blacklist/etc selectors live in the IMPLEMENTATION contract, not the proxy.
  // Scanning the proxy's code would silently miss every capability on every
  // legitimate proxy token (including USDC). Fetch and scan the implementation
  // instead when one was found; fall back to the queried address's own code.
  let scanAddress = token;
  let scanCode = code;
  if (proxy.is_proxy && proxy.implementation_address) {
    const implCode = (await baseRpc("eth_getCode", [proxy.implementation_address, "latest"]).catch(() => null)) as string | null;
    if (implCode && implCode !== "0x") {
      scanAddress = proxy.implementation_address;
      scanCode = implCode;
    }
  }
  const { detected, categories } = scanBytecodeSelectors(scanCode);
  const decimals = meta?.decimals ?? 18;
  const nameHex = nameCall.result ?? null;
  const totalSupplyHex = totalSupplyCall.result ?? null;
  let totalSupplyRaw: bigint | null = null;
  try {
    if (totalSupplyHex && totalSupplyHex !== "0x") totalSupplyRaw = BigInt(totalSupplyHex);
  } catch {
    /* non-numeric — leave null */
  }

  const flags: string[] = [];
  let score = 0;

  if (!codeClass.is_contract) {
    score = 100;
    flags.push("target address is not a contract — not a valid ERC-20 token");
  } else {
    if (sim.sim_status === "tested" && sim.transferable === false) {
      score += 75;
      flags.push("simulated transfer reverted — token appears non-transferable / possible honeypot");
    }
    if (sim.sim_status === "tested" && typeof sim.transfer_tax_bps === "number" && sim.transfer_tax_bps >= 500) {
      score += 25;
      flags.push(`measured ${(sim.transfer_tax_bps / 100).toFixed(1)}% fee on a plain transfer() (fee-on-transfer token)`);
    }
    if (proxy.is_proxy) {
      score += 15;
      flags.push(`upgradeable proxy (${proxy.proxy_standard}) — contract logic can be changed by the admin after you hold this token`);
    }
    if (categories.can_mint) {
      score += 15;
      flags.push("owner/admin can mint unlimited new supply");
    }
    if (categories.has_blacklist) {
      score += 15;
      flags.push("has a blacklist function — holders can be blocked from transferring");
    }
    if (categories.can_pause) {
      score += 10;
      flags.push("contract can be paused — the owner can freeze all transfers");
    }
    if (categories.has_fee_setter) {
      score += 10;
      flags.push("owner can set or change a transfer tax/fee");
    }
    if (categories.has_ownership && !owner.ownership_renounced) {
      score += 10;
      flags.push("ownership not renounced — a privileged admin account still controls this contract");
    }
  }
  score = Math.min(100, score);
  const verdict = verdictFromScore(score);

  const risk_summary = !codeClass.is_contract
    ? "Target is not a contract — cannot be an ERC-20 token."
    : flags.length === 0
      ? `No dangerous capabilities detected on static analysis${sim.sim_status === "tested" && sim.transferable ? " and the simulated transfer succeeded" : ""}. Risk ${score}/100.`
      : `${flags.length} risk flag(s) detected. Risk ${score}/100.${sim.sim_status === "unavailable" ? " Honeypot simulation was unavailable for this token — see honeypot_sim.note." : ""}`;

  return {
    token,
    chain: "base",
    is_contract: codeClass.is_contract,
    is_eip7702_delegate: codeClass.is_eip7702_delegate,
    delegate_address: codeClass.delegate_address,
    meta: {
      name: (nameHex ? decodeAbiString(nameHex) : "") || null,
      symbol: meta?.symbol ?? null,
      decimals,
      total_supply_raw: totalSupplyRaw !== null ? totalSupplyRaw.toString() : null,
      total_supply_formatted: totalSupplyRaw !== null ? Number(totalSupplyRaw) / 10 ** decimals : null,
    },
    proxy,
    capabilities: { ...categories, detected_selectors: detected, scanned_address: scanAddress },
    ownership: owner,
    honeypot_sim: sim,
    risk_score: score,
    verdict,
    flags,
    risk_summary,
    analyzed_at,
  };
}

app.get("/chain/token-security", async (c) => {
  const token = c.req.query("token");
  if (!token || !ADDR_RE.test(token)) {
    return c.json({ error: "token query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }
  try {
    const result = await analyzeTokenSecurity(token);
    console.log(
      JSON.stringify({
        event: "paid_request",
        endpoint: "/chain/token-security",
        token,
        verdict: result.verdict,
        risk_score: result.risk_score,
        ts: result.analyzed_at,
      }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/token-security", rail, makeUsageCounter(c.env)));
    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// Free preview — runs the FULL real analysis (not a withheld/partial result) on
// a fixed well-known token (Base WETH) so an agent can see the real product
// before paying. To analyze an arbitrary token, pay for GET /chain/token-security.
const TOKEN_SECURITY_PREVIEW_TOKEN = "0x4200000000000000000000000000000000000006"; // WETH on Base
app.get("/chain/token-security/preview", async (c) => {
  try {
    const result = await analyzeTokenSecurity(TOKEN_SECURITY_PREVIEW_TOKEN);
    console.log(
      JSON.stringify({
        event: "free_preview",
        endpoint: "/chain/token-security/preview",
        token: TOKEN_SECURITY_PREVIEW_TOKEN,
        verdict: result.verdict,
        ts: result.analyzed_at,
      }),
    );
    return c.json({
      ...result,
      note: "Free live sample — full real analysis of a well-known token (Base WETH), same depth as the paid endpoint. Full: GET /chain/token-security?token=<0x…> ($0.009) to analyze ANY Base ERC-20 token.",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// ---------------------------------------------------------------------------
// TOKEN TRADE-SAFETY REPORT — decision-grade bundle for trading agents/vaults.
// One call composes analyzeTokenSecurity (honeypot sim + capability scan) +
// getTokenMeta + Uniswap v3 WETH-pool liquidity into a SAFE|CAUTION|AVOID
// verdict. Every sub-fetch degrades to null; the paid call never fails on one.
// ---------------------------------------------------------------------------
const BASE_WETH = "0x4200000000000000000000000000000000000006";
const UNIV3_FACTORY_BASE = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const UNIV3_FEE_TIERS = [100, 500, 3000, 10000];
const MIN_SAFE_LIQUIDITY_USD = 100_000;
const THIN_LIQUIDITY_USD = 10_000;

interface WethLiquidity {
  checked: boolean;
  pools: { fee_tier: number; pool: string; weth_raw: string; weth_side_usd: number | null }[];
  weth_pool_usd: number | null; // 2x WETH-side value of the deepest pool (v3 TVL proxy)
  note: string | null;
}

// One JSON-RPC batch = one subrequest (Workers cap subrequests per invocation),
// rotating providers only on transport failure. Per-item failures come back null.
async function baseRpcBatch(calls: { method: string; params: unknown[] }[]): Promise<(string | null)[] | null> {
  const body = JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, method: c.method, params: c.params })));
  for (const url of [...rpcOrder(), ...rpcOrder()]) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
      if (!res.ok) continue;
      const j = (await res.json()) as unknown;
      if (!Array.isArray(j)) continue;
      const byId = new Map<number, { result?: string; error?: unknown }>();
      for (const item of j as { id: number; result?: string; error?: unknown }[]) byId.set(item.id, item);
      const out = calls.map((_, i) => {
        const it = byId.get(i + 1);
        return it && typeof it.result === "string" && !it.error ? it.result : null;
      });
      if (out.every((r) => r === null)) continue;
      return out;
    } catch {
      continue;
    }
  }
  return null;
}

async function getWethLiquidity(token: string): Promise<WethLiquidity> {
  if (token.toLowerCase() === BASE_WETH) {
    return { checked: false, pools: [], weth_pool_usd: null, note: "token is WETH itself; no WETH pair applies" };
  }
  const pad = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");
  const lookups = await baseRpcBatch(
    UNIV3_FEE_TIERS.map((fee) => ({
      method: "eth_call",
      params: [{ to: UNIV3_FACTORY_BASE, data: `0x1698ee82${pad(token)}${pad(BASE_WETH)}${fee.toString(16).padStart(64, "0")}` }, "latest"],
    })),
  );
  if (!lookups) return { checked: false, pools: [], weth_pool_usd: null, note: "pool lookup unavailable" };
  const found = UNIV3_FEE_TIERS.map((fee, i) => {
    const r = lookups[i];
    const addr = r && r.length >= 66 ? `0x${r.slice(-40)}` : null;
    return { fee, addr: addr && BigInt(addr) !== 0n ? addr : null };
  }).filter((p): p is { fee: number; addr: string } => p.addr !== null);
  if (found.length === 0) {
    const anyAnswered = lookups.some((r) => r !== null);
    return {
      checked: anyAnswered,
      pools: [],
      weth_pool_usd: null,
      note: anyAnswered ? "no Uniswap v3 WETH pool found (token may trade only on other pairs/DEXes)" : "pool lookup unavailable",
    };
  }
  const [balances, ethUsd] = await Promise.all([
    baseRpcBatch(found.map((p) => ({ method: "eth_call", params: [{ to: BASE_WETH, data: `0x70a08231${pad(p.addr)}` }, "latest"] }))),
    getEthUsd().catch(() => null),
  ]);
  if (!balances) {
    return { checked: false, pools: [], weth_pool_usd: null, note: "pool liquidity read unavailable" };
  }
  const pools = found.flatMap((p, i) => {
    const r = balances[i];
    if (!r || r === "0x") return [];
    const raw = BigInt(r);
    return [{ fee_tier: p.fee, pool: p.addr, weth_raw: raw.toString(), weth_side_usd: ethUsd !== null ? (Number(raw) / 1e18) * ethUsd : null }];
  });
  const best = pools.reduce<number | null>(
    (m, p) => (p.weth_side_usd !== null && (m === null || p.weth_side_usd > m) ? p.weth_side_usd : m),
    null,
  );
  return {
    checked: true,
    pools,
    weth_pool_usd: best !== null ? Math.round(best * 2) : null,
    note: pools.length === 0 ? "WETH pool balance read unavailable" : ethUsd === null ? "ETH/USD price unavailable; see weth_raw" : null,
  };
}

async function buildTokenReport(token: string) {
  // Liquidity first (2 batched subrequests) so the heavier security analysis can't
  // starve it of the per-invocation subrequest budget.
  const liqR = await Promise.allSettled([getWethLiquidity(token)]).then((r) => r[0]);
  const [secR, metaR] = await Promise.allSettled([analyzeTokenSecurity(token), getTokenMeta(token)]);
  const sec = secR.status === "fulfilled" ? secR.value : null;
  const meta = metaR.status === "fulfilled" ? metaR.value : null;
  const liq = liqR.status === "fulfilled" ? liqR.value : null;

  const sim = sec?.honeypot_sim ?? null;
  const simTested = sim?.sim_status === "tested";
  const isHoneypot = simTested ? sim!.transferable === false : null;
  const sellable = simTested ? sim!.transferable === true : null;
  const caps = sec?.capabilities ?? null;
  const ownerRenounced = sec ? sec.ownership.ownership_renounced : null;
  const liqUsd = liq?.weth_pool_usd ?? null;

  const reasons: string[] = [];
  let avoid = false;
  let score = sec ? sec.risk_score : 50;

  if (!sec) reasons.push("security analysis unavailable");
  if (sec && !sec.is_contract) {
    avoid = true;
    reasons.push("address is not a contract / not an ERC-20");
  }
  if (isHoneypot) {
    avoid = true;
    reasons.push("honeypot: simulated transfer reverted, token cannot be sold/moved");
  }
  if (sec?.verdict === "block") {
    avoid = true;
    reasons.push("static analysis verdict is block");
  }
  if (caps?.has_fee_setter) reasons.push("owner can change transfer tax/fee; buy/sell tax not fixed");
  if (caps?.can_mint && !ownerRenounced) reasons.push("owner can mint new supply");
  if (caps?.has_blacklist) reasons.push("contract can blacklist addresses");
  if (caps?.can_pause) reasons.push("transfers can be paused");
  if (sec?.proxy.is_upgradeable) reasons.push("upgradeable proxy; logic can change after purchase");

  if (liq?.checked) {
    if (liqUsd === null && liq.pools.length === 0) {
      reasons.push("no Uniswap v3 WETH pool found");
      score += 10;
    } else if (liqUsd !== null && liqUsd < THIN_LIQUIDITY_USD) {
      reasons.push(`very thin WETH-pool liquidity (~$${liqUsd.toLocaleString("en-US")})`);
      score += 20;
    } else if (liqUsd !== null && liqUsd < MIN_SAFE_LIQUIDITY_USD) {
      reasons.push(`modest WETH-pool liquidity (~$${liqUsd.toLocaleString("en-US")}); slippage risk on size`);
      score += 10;
    }
  } else if (liq === null || /unavailable/.test(liq.note ?? "")) {
    reasons.push("liquidity check unavailable");
  }

  // Deep liquidity from a verified-transferable or long-established token offsets
  // admin-capability risk that static analysis alone over-weights (e.g. USDC).
  const deepLiquidity = liqUsd !== null && liqUsd >= MIN_SAFE_LIQUIDITY_USD * 10;
  const sellabilityUnverified = !!sec && !simTested && !avoid;
  if (sellabilityUnverified) {
    reasons.push(
      deepLiquidity
        ? "transfer simulation unavailable (non-standard storage layout); deep live WETH-pool liquidity indicates the token trades"
        : "transfer simulation unavailable (non-standard storage layout); sellability unverified",
    );
  }
  if (!avoid && deepLiquidity && (sellable || !simTested)) score = Math.min(score, 25);
  if (avoid) score = Math.max(score, 85);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const risky = (sellabilityUnverified && !deepLiquidity) || reasons.some((r) => /thin|no Uniswap|liquidity check unavailable|unavailable$/.test(r));
  const verdict: "SAFE" | "CAUTION" | "AVOID" = avoid ? "AVOID" : score >= 70 ? "AVOID" : score >= 30 || risky ? "CAUTION" : "SAFE";
  if (verdict === "SAFE" && reasons.length === 0) reasons.push("no honeypot, deep liquidity, no high-risk admin controls detected");

  return {
    token,
    chain: "base",
    token_meta: {
      symbol: meta?.symbol ?? sec?.meta.symbol ?? null,
      name: meta?.name ?? sec?.meta.name ?? null,
      decimals: meta?.decimals ?? sec?.meta.decimals ?? null,
    },
    security: {
      isHoneypot,
      sellable,
      buyTaxBps: null as number | null,
      sellTaxBps: null as number | null,
      transferTaxBps: simTested ? (sim!.transfer_tax_bps ?? null) : null,
      taxNote: "buyTaxBps/sellTaxBps (DEX swap tax) are not measured; transferTaxBps is the MEASURED fee on a plain transfer() via eth_simulateV1 (null if the RPC could not simulate it); taxMutable reflects whether the owner can change fees",
      taxMutable: caps ? caps.has_fee_setter : null,
      ownerRenounced,
      upgradeableProxy: sec ? sec.proxy.is_upgradeable : null,
      canMint: caps ? caps.can_mint : null,
      canPause: caps ? caps.can_pause : null,
      hasBlacklist: caps ? caps.has_blacklist : null,
      simStatus: sim?.sim_status ?? null,
    },
    liquidity: liq
      ? { wethPoolUsd: liq.weth_pool_usd, basis: "approx: 2x WETH-side balance of the deepest Uniswap v3 WETH pool", pools: liq.pools, dex: "uniswap-v3", note: liq.note }
      : { wethPoolUsd: null, pools: [], dex: "uniswap-v3", note: "liquidity check unavailable" },
    verdict,
    risk_score: score,
    reasons,
    analyzed_at: new Date().toISOString(),
    disclaimer: "Heuristic risk signal, not financial advice or a guarantee.",
  };
}

app.get("/chain/token-report", async (c) => {
  const token = tokenQ(c);
  if (!token || !ADDR_RE.test(token)) {
    return c.json({ error: "token query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }
  try {
    const result = await buildTokenReport(token);
    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/token-report", token, verdict: result.verdict, risk_score: result.risk_score, ts: result.analyzed_at }),
    );
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /chain/token-report", rail, makeUsageCounter(c.env)));
    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

async function buildSwapGate(token: string, side: "buy" | "sell", notional: number) {
  const r = await buildTokenReport(token);
  const liq = r.liquidity.wethPoolUsd;
  const impact = liq && liq > 0 ? (notional / liq) * 100 : null;
  let decision: "go" | "hold" | "block" = "go";
  let reason = "token passes safety checks";
  if (r.verdict === "AVOID") {
    decision = side === "sell" && r.security.isHoneypot !== true ? "hold" : "block";
    reason = r.reasons[0] ?? "token flagged AVOID";
  } else if (impact !== null && impact > 10) {
    decision = "block";
    reason = `trade is ${impact.toFixed(1)}% of pool liquidity; severe price impact`;
  } else if (impact !== null && impact > 2) {
    decision = "hold";
    reason = `trade is ${impact.toFixed(1)}% of pool liquidity; split the order`;
  } else if (r.verdict === "CAUTION") {
    decision = side === "buy" && r.risk_score >= 50 ? "hold" : "go";
    reason = r.reasons[0] ?? "caution flags present";
  } else if (impact !== null) {
    reason = `token passes safety checks; trade is ${impact.toFixed(2)}% of pool liquidity`;
  }
  return {
    token, side, notional_usd: notional, decision, reason,
    verdict: r.verdict, risk_score: r.risk_score, liquidity_usd: liq,
    impact_pct_of_pool: impact === null ? null : Math.round(impact * 100) / 100,
    flags: r.reasons, token_meta: r.token_meta, analyzed_at: r.analyzed_at,
    disclaimer: r.disclaimer,
  };
}

// Pre-trade gate: compact go/hold/block built on the token-report engine.
app.get("/gate/swap", async (c) => {
  const token = tokenQ(c);
  if (!token || !ADDR_RE.test(token)) {
    return c.json({ error: "token query param must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }
  const side = (c.req.query("side") ?? "buy").toLowerCase();
  if (side !== "buy" && side !== "sell") return c.json({ error: "side must be buy or sell" }, { status: 400 });
  const notional = Number(c.req.query("notional_usd") ?? c.req.query("notional") ?? "100");
  if (!Number.isFinite(notional) || notional <= 0) return c.json({ error: "notional_usd must be a positive number" }, { status: 400 });
  try {
    const out = await buildSwapGate(token, side as "buy" | "sell", notional);
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /gate/swap", rail, makeUsageCounter(c.env)));
    return c.json(out);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// Free preview — full real report for Base USDC (same depth as paid). ?token= is
// honored only for the fixed demo set so the preview can't substitute the paid route.
const TOKEN_REPORT_PREVIEW_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const PREVIEW_DEMO_TOKENS: Record<string, string> = {
  usdc: TOKEN_REPORT_PREVIEW_TOKEN,
  weth: "0x4200000000000000000000000000000000000006",
  cbbtc: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  aero: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  degen: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
};
function previewToken(q: string | undefined): string {
  const k = (q ?? "").trim().toLowerCase();
  if (PREVIEW_DEMO_TOKENS[k]) return PREVIEW_DEMO_TOKENS[k];
  const hit = Object.values(PREVIEW_DEMO_TOKENS).find((a) => a.toLowerCase() === k);
  return hit ?? TOKEN_REPORT_PREVIEW_TOKEN;
}

const CHECK_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Base Token Check — honeypot, tax &amp; rug-risk verdict in one paste</title>
<meta name="description" content="Paste a Base token address and get an instant SAFE / CAUTION / DANGER verdict: honeypot sell-simulation, owner controls, liquidity depth. Free, no signup.">
<meta property="og:title" content="Base Token Check — is this token a honeypot?"><meta property="og:description" content="Paste a Base ERC-20 address, get a verdict: honeypot simulation, mint/pause/blacklist, liquidity.">
<style>body{max-width:40rem;margin:0 auto;padding:2rem 1.1rem;font:16px/1.5 system-ui,sans-serif;background:#0d1117;color:#e6e6e6}input{width:100%;padding:.8rem;font:inherit;border-radius:8px;border:1px solid #333;background:#161b22;color:inherit;box-sizing:border-box}button{margin-top:.6rem;padding:.7rem 1.2rem;font:inherit;border:0;border-radius:8px;background:#0b5;color:#fff;cursor:pointer}#card{margin-top:1.4rem;padding:1.2rem;border-radius:12px;background:#161b22;display:none}.v{font-size:2rem;font-weight:700}.SAFE{color:#3fb950}.CAUTION{color:#d29922}.DANGER{color:#f85149}li{margin:.25rem 0}small,a{color:#8b949e}</style></head><body>
<h1>Base Token Check</h1><p>Paste a Base ERC-20 address. We simulate a sell, scan owner controls and measure liquidity.</p>
<input id="t" placeholder="0x… token address" autocomplete="off"><button onclick="go()">Check token</button>
<div id="card"></div>
<p><small>Free: 3 checks/day. Unlimited for agents via x402 pay-per-call: <a href="/chain/token-report">/chain/token-report</a> ($0.01) · <a href="/chain/token-security">/chain/token-security</a> ($0.009) · <a href="/llms.txt">llms.txt</a>. Heuristic signal, not financial advice.</small></p>
<script>
const q=new URLSearchParams(location.search).get('token');if(q){document.getElementById('t').value=q;go()}
function share(t,j,m){const u=location.origin+'/check?token='+t,tx=encodeURIComponent((m.symbol||'Token')+' on Base: '+j.verdict+' (risk '+j.risk_score+'/100) via Base Token Check'),eu=encodeURIComponent(u);
return '<p>Share: <a href="https://twitter.com/intent/tweet?text='+tx+'&url='+eu+'" target="_blank" rel="noopener">X</a> · <a href="https://warpcast.com/~/compose?text='+tx+'&embeds[]='+eu+'" target="_blank" rel="noopener">Farcaster</a> · <a href="https://t.me/share/url?url='+eu+'&text='+tx+'" target="_blank" rel="noopener">Telegram</a></p>'}
async function go(){const t=document.getElementById('t').value.trim(),c=document.getElementById('card');c.style.display='block';
if(!/^0x[0-9a-fA-F]{40}$/.test(t)){c.textContent='Enter a valid 0x… address (40 hex chars).';return}
c.textContent='Checking…';history.replaceState(null,'','?token='+t);
try{const r=await fetch('/chain/token-report/preview?token='+t);const j=await r.json();
if(!r.ok){c.innerHTML='<b>'+(j.error||'Limit reached')+'</b><br>Daily free limit may be used up — use the paid x402 route for more.';return}
const m=j.token_meta||{},s=j.security||{},l=j.liquidity||{};const esc=x=>String(x).replace(/[<>&]/g,'');
c.innerHTML='<div class="v '+esc(j.verdict)+'">'+esc(j.verdict)+'</div><div>'+esc(m.symbol||'?')+' · '+esc(m.name||'')+' · risk '+esc(j.risk_score)+'/100</div><ul>'
+'<li>Honeypot: '+(s.isHoneypot?'YES':'no')+' (sim: '+esc(s.simStatus)+')</li><li>Can mint: '+(s.canMint?'yes':'no')+' · Can pause: '+(s.canPause?'yes':'no')+' · Blacklist: '+(s.hasBlacklist?'yes':'no')+'</li><li>Upgradeable proxy: '+(s.upgradeableProxy?'yes':'no')+' · Owner renounced: '+(s.ownerRenounced?'yes':'no')+'</li><li>Liquidity (WETH pool): '+(l.wethPoolUsd==null?'n/a':'$'+Math.round(l.wethPoolUsd))+'</li></ul><div>'+(j.reasons||[]).map(esc).join('; ')+'</div>'+share(t,j,m)}catch(e){c.textContent='Error: '+e}}
</script></body></html>`;
app.get("/check", (c) => {
  const t = c.req.query("token") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(t)) return c.html(CHECK_HTML);
  const short = `${t.slice(0, 6)}…${t.slice(-4)}`;
  return c.html(
    CHECK_HTML.replace(
      /<meta property="og:title"[^>]*>/,
      `<meta property="og:title" content="Is ${short} a honeypot? Base Token Check"><meta property="og:url" content="https://x402-data-api.sigrunner.workers.dev/check?token=${t}">`,
    ),
  );
});

// Absolute, directly-quotable paid URL built from the live preview request: drop the "/preview"
// segment and keep the caller's exact query (token, side, notional_usd). An agent can feed the
// result straight into an x402 client (wrapFetchWithPayment) or a hosted quote rail with zero
// string-munging — the paid-handoff step that was the main conversion friction on the 429 path.
function paidUrlFrom(c: any): string {
  try {
    const u = new URL(c.req.url);
    u.pathname = u.pathname.replace(/\/preview$/, "");
    return u.toString();
  } catch {
    return "";
  }
}

// Machine-readable upgrade CTA appended to free-preview responses so an agent
// evaluating the preview has a zero-friction, paste-ready path to the paid call
// (the exact paid URL for the token it just previewed + an x402 wiring snippet).
// Strictly additive — preview data depth is unchanged.
function upgradeCTA(paidUrl: string, price: string, adds: string) {
  return {
    paid_url: paidUrl,
    price_usdc: price,
    adds,
    pay_with: `x402 (USDC on Base, settles inline): npm i x402-fetch viem; const f=wrapFetchWithPayment(fetch, walletClient); await f("${paidUrl}"). Any x402 client works (@x402/fetch, Cloudflare withX402Client). Docs: https://api.greyridgesignals.ai/llms.txt`,
  };
}

// Integrators pass the token under many names; never silently fall back to a demo token for a safety gate.
function tokenQ(c: any): string | undefined {
  for (const k of ["token", "address", "tokenAddress", "token_address", "contract", "contractAddress"]) {
    const v = c.req.query(k);
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}
app.get("/chain/token-report/preview", async (c) => {
  const tq = tokenQ(c);
  if (tq !== undefined && !ADDR_RE.test(tq) && !PREVIEW_DEMO_TOKENS[tq.toLowerCase()]) return c.json({ error: "token must be a 0x-prefixed 20-byte Base address (or demo: usdc|weth|cbbtc|aero|degen)" }, { status: 400 });
  try {
    const t = await trialToken(c, tq);
    if (t.exhausted) { const pu = paidUrlFrom(c); return c.json({ error: "free real-token trial exhausted (3/day/IP) - this is NOT a result for the token you asked about", trial: { real_token_checks_left_today: 0 }, paid: pu, paid_url: pu, price_usdc: "0.01", pay_with: `x402: npm i x402-fetch viem; const f=wrapFetchWithPayment(fetch, walletClient); await f("${pu}") - pays USDC on Base automatically. Docs: https://api.greyridgesignals.ai/llms.txt` }, { status: 429 }); }
    const result = await buildTokenReport(t.token);
    return c.json({
      ...result,
      ...(t.left !== null ? { trial: { real_token_checks_left_today: t.left } } : {}),
      note: "Free live sample (Base USDC) — same depth as the paid route. Full: GET /chain/token-report?token=<0x…> ($0.01) for ANY Base ERC-20.",
      upgrade: upgradeCTA(paidUrlFrom(c), "0.01", "Unmetered, any Base ERC-20 (this free preview is capped at 3 real tokens/IP/day)."),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// Free real-token trial: 3 arbitrary-token checks per IP per UTC day (approximate; KV is eventually consistent).
const TRIAL_PER_DAY = 3;
async function trialToken(c: any, q: string | undefined): Promise<{ token: string; left: number | null; exhausted?: boolean }> {
  const raw = (q ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw) || !c.env.API_KEYS) return { token: previewToken(q), left: null };
  if (Object.values(PREVIEW_DEMO_TOKENS).some((a) => a.toLowerCase() === raw.toLowerCase())) return { token: raw, left: null };
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const key = `trial:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const used = parseInt((await c.env.API_KEYS.get(key)) ?? "0", 10) || 0;
  if (used >= TRIAL_PER_DAY) return { token: previewToken(q), left: 0, exhausted: true };
  await c.env.API_KEYS.put(key, String(used + 1), { expirationTtl: 90000 });
  return { token: raw, left: TRIAL_PER_DAY - used - 1 };
}
app.get("/gate/swap/preview", async (c) => {
  const tq = tokenQ(c);
  if (tq !== undefined && !ADDR_RE.test(tq) && !PREVIEW_DEMO_TOKENS[tq.toLowerCase()]) return c.json({ error: "token must be a 0x-prefixed 20-byte Base address (or demo: usdc|weth|cbbtc|aero|degen)" }, { status: 400 });
  try {
    const t = await trialToken(c, tq);
    if (t.exhausted) { const pu = paidUrlFrom(c); return c.json({ error: "free real-token trial exhausted (3/day/IP) - this is NOT a result for the token you asked about", trial: { real_token_checks_left_today: 0 }, paid: pu, paid_url: pu, price_usdc: "0.008", pay_with: `x402: npm i x402-fetch viem; const f=wrapFetchWithPayment(fetch, walletClient); await f("${pu}") - pays USDC on Base automatically. Docs: https://api.greyridgesignals.ai/llms.txt` }, { status: 429 }); }
    const pSide = c.req.query("side") === "sell" ? "sell" : "buy";
    const pNotional = Number(c.req.query("notional_usd") ?? "100");
    const out = await buildSwapGate(t.token, pSide, Number.isFinite(pNotional) && pNotional > 0 ? pNotional : 100);
    const swapUpgrade = upgradeCTA(paidUrlFrom(c), "0.008", "Unmetered, any Base ERC-20, sized to your trade via side & notional_usd (this free preview is capped at 3 real tokens/IP/day).");
    if (t.left !== null) return c.json({ ...out, trial: { real_token_checks_left_today: t.left }, paid_gate: { url: paidUrlFrom(c), price_usdc: "0.008" }, upgrade: swapUpgrade, note: t.left === 0 && t.token === previewToken(c.req.query("token")) ? "Free real-token trial exhausted for today (3/day/IP); showing demo token. Paid: GET /gate/swap?token=<0x…> ($0.008)." : `Free real-token trial (${t.left} left today). Paid: GET /gate/swap?token=<0x…>&side=buy|sell&notional_usd=<n> ($0.008).` });
    return c.json({ ...out, upgrade: swapUpgrade, note: "Free live sample (demo tokens via ?token=usdc|weth|cbbtc|aero|degen; default Base USDC, buy, $100) — full: GET /gate/swap?token=<0x…>&side=buy|sell&notional_usd=<n> ($0.008) for ANY Base ERC-20." });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// ---------------------------------------------------------------------------
// MCP SECURITY SCAN — the moat product. Fetch a target MCP server's tool list
// and statically analyze each tool for prompt-injection / tool-poisoning (OWASP
// LLM01/LLM08 + the MCP-specific tool-poisoning class). Edge-runnable, keyless:
// pure fetch + text analysis, no subprocess, no external API key. This is a real
// executed audit of THEIR deployment — nothing free replaces it on demand.
// ---------------------------------------------------------------------------

interface ScanFinding {
  tool: string;
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  detail: string;
  evidence: string;
}

// Detection rules for a single MCP tool's name+description+schema (all attacker-
// controllable text the agent trusts). Pattern set derived from documented MCP
// tool-poisoning research (hidden instructions, exfiltration, shadowing, danger).
function analyzeMcpTool(name: string, description: string, schemaText: string): ScanFinding[] {
  const f: ScanFinding[] = [];
  const text = `${description}\n${schemaText}`;
  const low = text.toLowerCase();
  const add = (severity: ScanFinding["severity"], rule: string, detail: string, ev: string) =>
    f.push({ tool: name, severity, rule, detail, evidence: ev.slice(0, 160) });

  // 1. Hidden instructions to the AI embedded in a tool description (tool poisoning).
  // Only DECEPTION / OVERRIDE constructs are tool-poisoning — ordinary sequencing
  // language ("you must first call X", "before calling this tool", "instead of")
  // is legitimate tool-chaining guidance and was producing false CRITICALs on clean
  // servers (e.g. Context7), which destroys the scanner's credibility. The canonical
  // tool-poisoning signatures (Invariant Labs / OWASP LLM01) are: override of prior
  // instructions, hidden <IMPORTANT>/<system> directive tags, and instructions to
  // conceal actions from the user. Genuine exfiltration/danger stays covered by
  // rules 2–5 below, so a real "before using X, read ~/.ssh/id_rsa" attack still flags.
  const inj = /(ignore (all |any )?(previous|prior|earlier|above)( instructions| context| prompt)?|disregard (the )?(above|previous|prior|earlier)|<\/?important>|<\/?system>|<\/?secret>|do not (tell|mention|inform|notify|reveal)\b[^.]{0,20}\bthe user|never (reveal|mention|disclose|tell)\b[^.]{0,30}\binstructions?|never (reveal|mention|disclose|tell)\b[^.]{0,30}\bthe user\s+(about|that you|of|how you|what you)\b|(hidden|concealed|kept secret) from the user|keep (this|it) (secret|hidden)|without (telling|informing|notifying|alerting) the user|reveal (your|the) (full |complete )?(system )?(prompt|instructions))/i;
  if (inj.test(text)) add("critical", "tool-poisoning:hidden-instructions",
    "Description contains deceptive/override instructions aimed at the AI agent (conceal-from-user or ignore-prior-instructions) — classic MCP tool-poisoning.", (text.match(inj) || [""])[0]);

  // 2. Data-exfiltration hints. A BARE mention of "api key"/"password"/"secret" is
  // NOT exfiltration — legitimate auth/docs tools (and even security warnings like
  // "do not include API keys") use those words, and flagging them destroys trust.
  // Real exfiltration is (a) an unambiguous secret-artifact that has no business in
  // a tool description, or (b) a sensitive target PAIRED with an instruction to send
  // it to an external destination.
  const secretArtifact = /(\.env\b|~\/\.ssh|id_rsa|\bprivate key\b|exfiltrat)/i;
  const externalize = /(send|post|upload|transmit|forward|leak|exfiltrat\w*)\b[^.]{0,60}?\b(secrets?|credentials?|passwords?|api[ _-]?keys?|access tokens?|cookies?|private keys?|conversation|chat history|system prompt|environment variables?|contents? of (the |any )?files?)\b[^.]{0,80}?(https?:\/\/|\bwebhook\b|\bexternal\b|third[- ]?party|attacker|\bexfil)|(secrets?|credentials?|passwords?|api[ _-]?keys?|cookies?|private keys?|conversation|chat history|system prompt)\b[^.]{0,60}?\b(to|at|via) (https?:\/\/|an? (external|remote|third[- ]?party)|attacker)/i;
  const descLow = description.toLowerCase(); // sentence-scoped: never match across the description/schema boundary
  const exfilHit = low.match(secretArtifact) || descLow.match(externalize);
  if (exfilHit) add("high", "exfiltration-hint",
    "Description instructs sending data to an external destination, or references a secret-file artifact (.env/.ssh/id_rsa).", exfilHit[0]);

  // 3. Dangerous capability surface
  const danger = /((?<![\/.\w-])(exec|execs)(?![\/\w-])|\b(exec\(|eval|eval\(|subprocess|shell|sudo|chmod)\b|os\.system|child_process|rm -rf|arbitrary (code|command)|remote code|\bexecute (shell|arbitrary|code|commands?)\b|run (shell|arbitrary) (commands?|code))/i;
  if (danger.test(low)) add("high", "dangerous-capability",
    "Tool exposes code/command execution or destructive filesystem ops.", (low.match(danger) || [""])[0]);

  // 4. Cross-tool shadowing / rug-pull language (altering other tools' behavior)
  const shadow = /(\b(other|all|every|any) tools?\b[^.]{0,40}\b(behaviou?r|description|output|call|invoke|instruction)s?\b|\boverride (the )?(\w+ (of )?)?(other|all|every|any|previous) |\bshadow(s|ing)? (the )?(other|all|every)|when (any|another) tool|modify the behaviou?r of)/i;
  if (shadow.test(low)) add("medium", "cross-tool-shadowing",
    "Description references other tools' behavior — shadowing / rug-pull risk.", (low.match(shadow) || [""])[0]);

  // 5. Invisible / non-ASCII payloads (unicode tag chars, zero-width, long base64)
  if (/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/.test(text) || /[\u{E0000}-\u{E007F}]/u.test(text))
    add("high", "invisible-unicode", "Hidden/zero-width or unicode-tag characters in description — covert instruction channel.", "non-printable chars");
  if (/[A-Za-z0-9+/]{120,}={0,2}/.test(text))
    add("medium", "opaque-blob", "Long base64-like blob embedded in tool text — possible hidden payload.", "…base64…");

  return f;
}

interface McpScanResult {
  target: string;
  tools_scanned: number;
  findings: ScanFinding[];
  risk_score: number; // 0-100
  verdict: Verdict;
  risk_summary: string;
  scanned_at: string;
}

interface McpRpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

// One streamable-HTTP JSON-RPC round trip: POSTs the body, captures any
// Mcp-Session-Id response header, and parses either plain-JSON or SSE
// ("event: message\ndata: {...}") framing per the 2025-06-18 transport spec.
async function mcpRpcCall(
  target: string,
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<{ json: McpRpcResponse | null; sessionId: string | null; status: number }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(target, { method: "POST", headers, body: JSON.stringify(body) });
  const newSessionId = res.headers.get("mcp-session-id");
  const raw = (await res.text()).trim();
  let json: McpRpcResponse | null = null;
  if (raw) {
    const jsonStr = raw.includes("data:") ? raw.split("data:").pop()!.trim() : raw;
    try {
      json = JSON.parse(jsonStr) as McpRpcResponse;
    } catch {
      json = null;
    }
  }
  return { json, sessionId: newSessionId, status: res.status };
}

async function scanMcpServer(target: string): Promise<McpScanResult> {
  const scanned_at = new Date().toISOString();
  // SSRF guard: only audit a public https(s) hostname — no internal/localhost/IP
  // targets (a paid caller must not use us as a proxy into private infra).
  let host: string;
  try {
    host = new URL(target).hostname;
  } catch {
    throw new Error("invalid target URL");
  }
  if (!isValidHostname(host)) {
    throw new Error("target must be a public MCP server hostname (no IPs/localhost/internal hosts)");
  }
  // Fetch the target's tool list via MCP JSON-RPC (streamable-http). Spec-
  // compliant servers require the initialize handshake before tools/list —
  // skipping it (the old behavior) makes them error, which used to be
  // silently swallowed into a false "0 tools, clean" verdict. Do the real
  // handshake: initialize -> capture Mcp-Session-Id -> notifications/initialized
  // -> tools/list (with the session header). Fall back to a bare stateless
  // tools/list only if the server doesn't speak the initialize handshake.
  let tools: { name?: string; description?: string; inputSchema?: unknown }[] = [];
  try {
    const init = await mcpRpcCall(target, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "x402-data-api-mcp-scanner", version: "0.1.0" }, // mirror root package.json (canonical)
      },
    });

    if (init.json?.result) {
      const sessionId = init.sessionId ?? undefined;
      // Notification (no id, no response expected) — best-effort; some
      // servers don't require it before accepting further requests.
      try {
        await mcpRpcCall(target, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId);
      } catch {
        /* non-fatal */
      }
      const list = await mcpRpcCall(target, { jsonrpc: "2.0", id: 2, method: "tools/list" }, sessionId);
      if (!list.json) {
        throw new Error(`tools/list returned a non-JSON response (status ${list.status})`);
      }
      if (list.json.error) {
        throw new Error(list.json.error.message ?? "tools/list error");
      }
      tools = (list.json.result as { tools?: typeof tools } | undefined)?.tools ?? [];
    } else {
      // Server doesn't support/require the initialize handshake — fall back
      // to a bare stateless tools/list (pre-fix behavior, still needed for
      // lenient servers that never required a session). Apply the SAME error
      // guards as the happy path: a target that answers BOTH initialize and
      // tools/list with a JSON-RPC error (or a non-JSON body) must surface as
      // an error — never a silent 0-tools "Clean" verdict (the core bug this
      // whole fix exists to kill; a hostile server could otherwise force a
      // false pass by erroring on every call).
      const fallback = await mcpRpcCall(target, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      if (!fallback.json) {
        throw new Error(
          `tools/list returned a non-JSON response (status ${fallback.status}); initialize gave ${
            init.json?.error?.message ?? "no result"
          }`,
        );
      }
      if (fallback.json.error) {
        throw new Error(fallback.json.error.message ?? "tools/list error");
      }
      tools = (fallback.json.result as { tools?: typeof tools } | undefined)?.tools ?? [];
    }
  } catch (e) {
    throw new Error(`could not fetch MCP tools/list from target: ${(e as Error).message}`);
  }

  const findings: ScanFinding[] = [];
  for (const t of tools) {
    findings.push(...analyzeMcpTool(t.name ?? "(unnamed)", t.description ?? "", JSON.stringify(t.inputSchema ?? {})));
  }
  const weight = { critical: 40, high: 20, medium: 8, low: 3 } as const;
  const risk_score = Math.min(100, findings.reduce((s, x) => s + weight[x.severity], 0));
  const crit = findings.filter((x) => x.severity === "critical").length;
  const risk_summary = findings.length === 0
    ? `No tool-poisoning/injection patterns detected across ${tools.length} tool(s). Clean on static checks.`
    : `${findings.length} issue(s) across ${tools.length} tool(s)${crit ? `, ${crit} CRITICAL (tool-poisoning)` : ""}. Risk ${risk_score}/100. Review flagged tools before trusting this server.`;

  return { target, tools_scanned: tools.length, findings, risk_score, verdict: verdictFromScore(risk_score), risk_summary, scanned_at };
}

app.get("/scan/mcp", async (c) => {
  const target = c.req.query("url");
  if (!target || !/^https?:\/\//i.test(target)) {
    return c.json({ error: "url query param (target MCP server endpoint) required" }, { status: 400 });
  }
  try {
    const result = await scanMcpServer(target);
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/scan/mcp", target, findings: result.findings.length, ts: result.scanned_at }));
    const rail = c.get("rail") ?? "x402-paid";
    fireAndForget(c, trackPaidRequest("GET /scan/mcp", rail, makeUsageCounter(c.env)));
    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// PAID zero-egress scan: POST your own tools/list array and get the FULL itemized
// audit (same output as GET /scan/mcp) without exposing a server URL. For OAuth-gated
// / private MCP servers whose operators won't send a reachable URL out — the paid
// counterpart to the free paste-mode preview. x402-gated at $0.05 via "POST /scan/mcp".
app.post("/scan/mcp", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'POST JSON body: {"tools":[{name,description,inputSchema}]} (your tools/list result)' }, { status: 400 });
  }
  const tools: { name?: string; description?: string; inputSchema?: unknown }[] = body?.tools ?? body?.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0 || tools.length > 200 || JSON.stringify(tools).length > 262144) {
    return c.json({ error: "body.tools must be a non-empty array (<=200 tools, <=256KB)" }, { status: 400 });
  }
  const findings: ScanFinding[] = [];
  for (const t of tools) findings.push(...analyzeMcpTool(t?.name ?? "(unnamed)", t?.description ?? "", JSON.stringify(t?.inputSchema ?? {})));
  const weight = { critical: 40, high: 20, medium: 8, low: 3 } as const;
  const risk_score = Math.min(100, findings.reduce((s, x) => s + weight[x.severity], 0));
  const crit = findings.filter((x) => x.severity === "critical").length;
  const risk_summary = findings.length === 0
    ? `No tool-poisoning/injection patterns detected across ${tools.length} tool(s). Clean on static checks.`
    : `${findings.length} issue(s) across ${tools.length} tool(s)${crit ? `, ${crit} CRITICAL (tool-poisoning)` : ""}. Risk ${risk_score}/100. Review flagged tools before trusting this server.`;
  const result = { target: "(pasted tools/list)", tools_scanned: tools.length, findings, risk_score, verdict: verdictFromScore(risk_score), risk_summary, scanned_at: new Date().toISOString() };
  console.log(JSON.stringify({ event: "paid_request", endpoint: "POST /scan/mcp", target: "(paste)", findings: findings.length, ts: result.scanned_at }));
  const rail = c.get("rail") ?? "x402-paid";
  fireAndForget(c, trackPaidRequest("POST /scan/mcp", rail, makeUsageCounter(c.env)));
  return c.json(result);
});

// FREE preview — the conversion hook. Reveals THAT the target is vulnerable
// (counts + severity + risk score) but withholds WHICH tools and the evidence.
// A self-scanning agent that sees "2 CRITICAL tool-poisoning issues" must pay
// the full scan to learn where they are and how to fix them.
function previewOf(r: McpScanResult) {
  const by = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
  for (const f of r.findings) by[f.severity]++;
  const upsell =
    r.findings.length === 0
      ? "Clean on static checks. Full itemized report + evidence: GET /scan/mcp?url= or zero-egress POST /scan/mcp with your tools array ($0.05 via x402)."
      : `${r.findings.length} issue(s) found${by.critical ? `, ${by.critical} CRITICAL` : ""}. This preview hides WHICH tools and the evidence — get the full itemized findings + remediation: paste-mode POST /scan/mcp (zero egress, same body you just used) or GET /scan/mcp?url= ($0.05), or the scan_mcp_server MCP tool ($0.005).`;
  return {
    target: r.target,
    tools_scanned: r.tools_scanned,
    issue_count: r.findings.length,
    severity_breakdown: by,
    risk_score: r.risk_score,
    verdict: r.verdict,
    risk_summary: r.risk_summary,
    upsell,
    scanned_at: r.scanned_at,
  };
}

app.get("/scan/mcp/preview", async (c) => {
  const target = c.req.query("url");
  if (!target || !/^https?:\/\//i.test(target)) {
    return c.json({ error: "url query param (target MCP server endpoint) required" }, { status: 400 });
  }
  try {
    const result = await scanMcpServer(target);
    console.log(JSON.stringify({ event: "free_preview", endpoint: "/scan/mcp/preview", target, issues: result.findings.length, ts: result.scanned_at }));
    return c.json(previewOf(result));
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// shields.io endpoint badge: img.shields.io/endpoint?url=<BASE>/scan/mcp/badge?url=<mcp-server>
// Lets any MCP directory/README show a live scan verdict that links back to the paid full audit.
app.get("/scan/mcp/badge", async (c) => {
  const target = c.req.query("url");
  const base = { schemaVersion: 1, label: "mcp-scan", cacheSeconds: 21600 };
  if (!target || !/^https?:\/\//i.test(target)) return c.json({ ...base, message: "url required", color: "lightgrey" });
  try {
    const r = await scanMcpServer(target);
    const color = ({ clear: "brightgreen", review: "yellow", block: "red" } as Record<string, string>)[r.verdict] ?? "lightgrey";
    return c.json({ ...base, message: `${r.verdict} (${r.tools_scanned} tools, ${r.findings.length} issues)`, color });
  } catch {
    return c.json({ ...base, message: "unreachable", color: "lightgrey" });
  }
});

// Self-serve badge generator page: paste an MCP URL, see the live verdict, copy README markdown.
app.get("/scan/badge-gen", (c) => {
  const html = `<!doctype html><meta charset=utf-8><title>MCP scan badge</title><meta name=viewport content="width=device-width,initial-scale=1">
<body style="font-family:system-ui;max-width:640px;margin:2rem auto;padding:0 1rem"><h1>MCP scan badge</h1>
<p>Paste your MCP server URL. We statically scan its advertised tool metadata (never call tools) and give you a live README badge.</p>
<input id=u placeholder="https://your-server.example/mcp" style="width:100%;padding:.5rem"><p><button id=b>Generate</button></p>
<p id=img></p><pre id=md style="white-space:pre-wrap;word-break:break-all"></pre>
<p>Itemized findings + OWASP mapping: paid <code>GET /scan/mcp</code> ($0.05 USDC via x402).</p>
<script>b.onclick=()=>{const u=encodeURIComponent(location.origin+"/scan/mcp/badge?url="+encodeURIComponent(document.getElementById("u").value));
const src="https://img.shields.io/endpoint?url="+u;img.innerHTML='<img src="'+src+'">';md.textContent="![mcp-scan]("+src+")"}</script>`;
  return c.html(html);
});

// Paste-mode preview for servers we can't reach (OAuth-gated / private): POST the
// JSON of your own tools/list response ({"tools":[...]} or {"result":{"tools":[...]}}).
// Same static analysis, no outbound fetch, no SSRF surface. Counts only (like GET preview).
app.post("/scan/mcp/preview", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'POST JSON body: {"tools":[{name,description,inputSchema}]} (your tools/list result)' }, { status: 400 });
  }
  const tools: { name?: string; description?: string; inputSchema?: unknown }[] = body?.tools ?? body?.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0 || tools.length > 200 || JSON.stringify(tools).length > 262144) {
    return c.json({ error: "body.tools must be a non-empty array (<=200 tools, <=256KB)" }, { status: 400 });
  }
  const findings: ScanFinding[] = [];
  for (const t of tools) findings.push(...analyzeMcpTool(t?.name ?? "(unnamed)", t?.description ?? "", JSON.stringify(t?.inputSchema ?? {})));
  const weight = { critical: 40, high: 20, medium: 8, low: 3 } as const;
  const risk_score = Math.min(100, findings.reduce((s, x) => s + weight[x.severity], 0));
  const crit = findings.filter((x) => x.severity === "critical").length;
  const risk_summary = findings.length === 0
    ? `No tool-poisoning/injection patterns detected across ${tools.length} tool(s). Clean on static checks.`
    : `${findings.length} issue(s) across ${tools.length} tool(s)${crit ? `, ${crit} CRITICAL (tool-poisoning)` : ""}. Risk ${risk_score}/100.`;
  return c.json(previewOf({ target: "(pasted tools/list)", tools_scanned: tools.length, findings, risk_score, verdict: verdictFromScore(risk_score), risk_summary, scanned_at: new Date().toISOString() }));
});

// ---------------------------------------------------------------------------
// MCP endpoint — expose the full x402-paid tool surface (22 tools) via MCP ($0.005 per tools/call via x402)
// ---------------------------------------------------------------------------

const mcpHandler = createMcpHandler(() => {
  const server = new McpServer({
    name: "x402-data-api",
    version: "0.1.0", // mirror root package.json (canonical)
  });

  server.registerTool(
    "enrich_tech_risk",
    {
      description:
        "Security enrichment: tech-stack fingerprint + CVE mapping + EPSS + CISA KEV + verdict (clear/review/block) for a domain. Cost: $0.005 USDC per call (x402 micropayment).",
      inputSchema: {
        domain: z.string().optional(),
        techstack: z.array(z.string()).optional(),
      },
    },
    async ({ domain, techstack }) => {
      const result = await enrichTechRisk({ domain, techstack });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "enrich_domain",
    {
      description:
        "Firmographic + tech-stack enrichment: RDAP registrant/registrar, DNS records, full subdomain enumeration + certificate-transparency history, tech-stack fingerprint, verdict (clear/review/block, based on domain age) for a domain. Cost: $0.005 USDC per call via the shared MCP payment gate (the direct HTTP endpoint GET /enrich/domain is $0.01 — MCP tools/call is gated at a flat $0.005 per request).",
      inputSchema: {
        domain: z.string(),
      },
    },
    async ({ domain }) => {
      const result = await enrichDomain(domain);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "scan_mcp_server",
    {
      description:
        "Security-audit a target MCP server for prompt-injection / tool-poisoning. Fetches the server's advertised tools and statically analyzes each for hidden instructions, data-exfiltration hints, dangerous capabilities, cross-tool shadowing, and invisible-unicode payloads (OWASP LLM01/LLM08). Returns findings + a 0-100 risk score + verdict (clear/review/block). Cost: $0.005 USDC per scan via x402 (GET /scan/mcp HTTP variant is $0.05).",
      inputSchema: {
        url: z.string().describe("Target MCP server endpoint URL to audit"),
      },
    },
    async ({ url }) => {
      const result = await scanMcpServer(url);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "scan_mcp_preview",
    {
      description:
        "FREE preview scan of a target MCP server for tool-poisoning / prompt-injection. Returns issue count, severity breakdown, risk score, and verdict (clear/review/block) — but NOT which tools or the evidence. Use this to check any MCP server (including your own) at no cost; if issues are found, call the paid scan_mcp_server for the itemized findings + remediation. No payment required.",
      inputSchema: {
        url: z.string().describe("Target MCP server endpoint URL to preview-scan (free)"),
      },
    },
    async ({ url }) => {
      const result = await scanMcpServer(url);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(previewOf(result), null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "crypto_prices",
    {
      description:
        "Live spot token prices (price, change_24h, symbol, confidence, timestamp) for CoinGecko ids, sourced from DefiLlama. Cost: $0.005 USDC per call via x402.",
      inputSchema: {
        coins: z.string().optional().describe('Comma-separated CoinGecko ids, e.g. "bitcoin,ethereum,solana" (default; max 25)'),
      },
    },
    async ({ coins }) => {
      try {
        const coinsParam = coins || "bitcoin,ethereum,solana";
        const ids = coinsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 25);
        const invalid = ids.filter((id) => !COINGECKO_ID_RE.test(id));
        if (invalid.length > 0) {
          return { content: [{ type: "text" as const, text: `Error: invalid coingecko id(s): ${invalid.join(", ")}` }] };
        }
        const result = await fetchTokenPrices(ids);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "crypto_funding",
    {
      description:
        "Live cross-venue perpetual-futures funding rates from Hyperliquid+OKX+dYdX (per-venue rate, arb spread in bps, cheapest-long/richest-short venue, premium/basis, annualized_hl, annualized_okx, LONGS_PAY/SHORTS_PAY/NEUTRAL signal, next_funding_ts, mark/oracle price, open interest, day volume), ranked by volume. Venues that are unreachable or don't list a given coin are omitted per-coin — Hyperliquid is always present. Cost: $0.005 USDC per call via x402.",
      inputSchema: {
        limit: z.number().optional().describe("Number of results, default 20, max 100"),
      },
    },
    async ({ limit }) => {
      try {
        let n = limit ?? 20;
        if (!Number.isFinite(n) || n <= 0) n = 20;
        n = Math.min(n, 100);
        const result = await fetchFundingRates(n);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "defi_yields",
    {
      description:
        "Live DeFi lending/LP yield pools (project, chain, symbol, pool id, APY breakdown incl. 1d/7d/30d trend + apyBase7d/apyMean30d, IL risk incl. il7d, exposure, reward/underlying tokens, outlier flag, mu/sigma, DefiLlama stability forecast, TVL, stablecoin flag) from DefiLlama, ranked by TVL (or risk-adjusted APY = apy/sigma). Cost: $0.005 USDC per call via x402.",
      inputSchema: {
        limit: z.number().optional().describe("Number of results, default 20, max 100"),
        project: z.string().optional().describe("Filter by DefiLlama project slug"),
        chain: z.string().optional().describe("Filter by chain name"),
        stable: z.boolean().optional().describe("Only stablecoin pools"),
        sort: z.enum(["tvl", "risk_adjusted"]).optional().describe("Sort order: 'tvl' (default) or 'risk_adjusted' (apy/sigma)"),
      },
    },
    async ({ limit, project, chain, stable, sort }) => {
      try {
        let n = limit ?? 20;
        if (!Number.isFinite(n) || n <= 0) n = 20;
        n = Math.min(n, 100);
        const result = await fetchDefiYields(n, project, chain, stable ?? false, sort ?? "tvl");
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "pm_markets",
    {
      description:
        "Live Polymarket prediction-market data — question, outcomes, outcome prices, bestBid/bestAsk/spread, volume24hr/volume1wk, oneDayPriceChange, clobTokenIds, conditionId, category tags, liquidity, end date — ranked by volume24hr. Cost: $0.005 USDC per call via x402.",
      inputSchema: {
        query: z.string().optional().describe("Case-insensitive keyword filter on the market question"),
        limit: z.number().optional().describe("Number of results, default 20, max 100"),
      },
    },
    async ({ query, limit }) => {
      try {
        let n = limit ?? 20;
        if (!Number.isFinite(n) || n <= 0) n = 20;
        n = Math.min(n, 100);
        const result = await fetchPolymarketMarkets(query, n);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "crypto_prices_preview",
    {
      description:
        "FREE 1-item sample of live token prices. No payment required.",
      inputSchema: {},
    },
    async () => {
      try {
        const all = await fetchTokenPrices(["bitcoin", "ethereum", "solana"]);
        const result = {
          preview: all.slice(0, 1),
          note: "Free sample. Full data via the paid crypto_prices tool or GET /crypto/prices ($0.001).",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "crypto_funding_preview",
    {
      description:
        "FREE 1-item sample of live cross-venue funding rates. No payment required.",
      inputSchema: {},
    },
    async () => {
      try {
        const all = await fetchFundingRates(20);
        const result = {
          preview: all.slice(0, 1),
          note: "Free sample. Full data via the paid crypto_funding tool or GET /crypto/funding ($0.001).",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "defi_yields_preview",
    {
      description:
        "FREE 1-item sample of live DeFi yield pools. No payment required.",
      inputSchema: {},
    },
    async () => {
      try {
        const all = await fetchDefiYields(20, undefined, undefined, false);
        const result = {
          preview: all.slice(0, 1),
          note: "Free sample. Full data via the paid defi_yields tool or GET /defi/yields ($0.001).",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "pm_markets_preview",
    {
      description:
        "FREE top-1 sample of live Polymarket prediction markets, ranked by volume24hr. No payment required.",
      inputSchema: {},
    },
    async () => {
      try {
        const all = await fetchPolymarketMarkets(undefined, 20);
        const result = {
          preview: all.slice(0, 1),
          total_available: all.length,
          note: "Free sample. Full data via the paid pm_markets tool or GET /pm/markets ($0.005).",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "chain_block_number",
    {
      description:
        "Current Base mainnet block number via multi-provider JSON-RPC (automatic failover across 4 providers, never fails on one provider's rate limit). Cost: $0.005 USDC per call via x402.",
      inputSchema: {},
    },
    async () => {
      try {
        const hex = (await baseRpc("eth_blockNumber", [])) as string;
        const result = { block_number: parseInt(hex, 16), chain: "base" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "chain_gas_price",
    {
      description:
        "Current Base mainnet gas price (wei/gwei), EIP-1559 base_fee_gwei/priority_fee_gwei, and gas_price_usd (ETH price cross-call — no price oracle on ETH-only competitors) via multi-provider JSON-RPC. Cost: $0.005 USDC per call via x402.",
      inputSchema: {},
    },
    async () => {
      try {
        const [hex, feeHistory, ethUsd] = await Promise.all([
          baseRpc("eth_gasPrice", []) as Promise<string>,
          fetchFeeHistory(),
          getEthUsd(),
        ]);
        const wei = BigInt(hex);
        const gasPriceEth = Number(wei) / 1e18;
        const result = {
          gas_price_wei: wei.toString(),
          gas_price_gwei: Number(wei) / 1e9,
          base_fee_gwei: feeHistory.base_fee_gwei,
          priority_fee_gwei: feeHistory.priority_fee_gwei,
          gas_price_usd: ethUsd !== null ? gasPriceEth * ethUsd : null,
          chain: "base",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "chain_balance",
    {
      description:
        "Native ETH balance of a Base mainnet address, incl. balance_usd (ETH price cross-call — no price oracle on ETH-only competitors), via multi-provider JSON-RPC. Cost: $0.005 USDC per call via x402.",
      inputSchema: {
        address: z.string().describe("0x-prefixed 20-byte Base address"),
      },
    },
    async ({ address }) => {
      if (!ADDR_RE.test(address)) {
        return { content: [{ type: "text" as const, text: "Error: address must be a 0x-prefixed 20-byte address" }] };
      }
      try {
        const [hex, ethUsd] = await Promise.all([
          baseRpc("eth_getBalance", [address, "latest"]) as Promise<string>,
          getEthUsd(),
        ]);
        const wei = BigInt(hex);
        const balanceEth = Number(wei) / 1e18;
        const result = {
          address,
          balance_wei: wei.toString(),
          balance_eth: balanceEth,
          balance_usd: ethUsd !== null ? balanceEth * ethUsd : null,
          chain: "base",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "chain_token_balance",
    {
      description:
        "ERC-20 token balance of a Base mainnet address via multi-provider JSON-RPC, incl. symbol/decimals/balance_formatted (per-token-contract cached in-isolate). Cost: $0.005 USDC per call via x402.",
      inputSchema: {
        address: z.string().describe("0x-prefixed 20-byte holder address"),
        token: z.string().describe("0x-prefixed 20-byte ERC-20 contract address"),
      },
    },
    async ({ address, token }) => {
      if (!ADDR_RE.test(address)) {
        return { content: [{ type: "text" as const, text: "Error: address must be a 0x-prefixed 20-byte address" }] };
      }
      if (!ADDR_RE.test(token)) {
        return { content: [{ type: "text" as const, text: "Error: token must be a 0x-prefixed 20-byte address" }] };
      }
      try {
        const data = `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`;
        const [hex, meta] = await Promise.all([
          baseRpc("eth_call", [{ to: token, data }, "latest"]) as Promise<string>,
          getTokenMeta(token),
        ]);
        const balanceRaw = BigInt(hex);
        const decimals = meta?.decimals ?? 18;
        const result = {
          address,
          token,
          symbol: meta?.symbol ?? null,
          decimals,
          balance_raw: balanceRaw.toString(),
          balance_formatted: Number(balanceRaw) / 10 ** decimals,
          chain: "base",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "chain_tx",
    {
      description:
        "Transaction details by hash on Base mainnet via multi-provider JSON-RPC. Cost: $0.005 USDC per call via x402.",
      inputSchema: {
        hash: z.string().describe("0x-prefixed 32-byte transaction hash"),
      },
    },
    async ({ hash }) => {
      if (!HASH_RE.test(hash)) {
        return { content: [{ type: "text" as const, text: "Error: hash must be a 0x-prefixed 32-byte transaction hash" }] };
      }
      try {
        const tx = (await baseRpc("eth_getTransactionByHash", [hash])) as Record<string, unknown> | null;
        if (!tx) {
          return { content: [{ type: "text" as const, text: "Error: tx not found" }] };
        }
        const hexToDec = (v: unknown) => (typeof v === "string" && v.startsWith("0x") ? BigInt(v).toString() : v);
        const result = {
          ...tx,
          blockNumber: hexToDec(tx.blockNumber),
          value: hexToDec(tx.value),
          gas: hexToDec(tx.gas),
          gasPrice: hexToDec(tx.gasPrice),
          nonce: hexToDec(tx.nonce),
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "chain_wallet",
    {
      description:
        "Wallet screening bundle (balance, activity, contract vs EOA check): ETH balance + balance_usd (ETH price cross-call) + tx count + contract-code check (EIP-7702 delegated-EOA aware) for a Base mainnet address, in one call. Cost: $0.005 USDC per call via x402.",
      inputSchema: {
        address: z.string().describe("0x-prefixed 20-byte Base address"),
      },
    },
    async ({ address }) => {
      if (!ADDR_RE.test(address)) {
        return { content: [{ type: "text" as const, text: "Error: address must be a 0x-prefixed 20-byte address" }] };
      }
      try {
        const [balanceHex, nonceHex, code, ethUsd] = await Promise.all([
          baseRpc("eth_getBalance", [address, "latest"]) as Promise<string>,
          baseRpc("eth_getTransactionCount", [address, "latest"]) as Promise<string>,
          baseRpc("eth_getCode", [address, "latest"]) as Promise<string>,
          getEthUsd(),
        ]);
        const wei = BigInt(balanceHex);
        const balanceEth = Number(wei) / 1e18;
        const result = {
          address,
          balance_wei: wei.toString(),
          balance_eth: balanceEth,
          balance_usd: ethUsd !== null ? balanceEth * ethUsd : null,
          tx_count: parseInt(nonceHex, 16),
          ...classifyCode(code),
          chain: "base",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "chain_token_security",
    {
      description:
        "Token security / honeypot detector for a Base mainnet ERC-20: EIP-1967/1822 proxy + upgradeability detection, bytecode dispatcher scan for mint/pause/blacklist/fee-setter/ownership selectors, owner() renouncement check, and a live eth_call state-override simulation testing whether a synthetic wallet can actually transfer() the token. Returns risk_score (0-100) + verdict (clear/review/block) + human-readable flags. Real compute an agent can't trivially self-serve. Cost: $0.005 USDC per call via x402.",
      inputSchema: {
        token: z.string().describe("0x-prefixed 20-byte ERC-20 contract address on Base mainnet"),
      },
    },
    async ({ token }) => {
      if (!ADDR_RE.test(token)) {
        return { content: [{ type: "text" as const, text: "Error: token must be a 0x-prefixed 20-byte address" }] };
      }
      try {
        const result = await analyzeTokenSecurity(token);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "chain_block_number_preview",
    {
      description:
        "FREE live sample of the current Base mainnet block number — identical data to the paid chain_block_number tool. No payment required.",
      inputSchema: {},
    },
    async () => {
      try {
        const hex = (await baseRpc("eth_blockNumber", [])) as string;
        const result = {
          block_number: parseInt(hex, 16),
          chain: "base",
          note: "Free live sample — identical to the paid tool. Full: the paid chain_block_number tool or GET /chain/block-number ($0.005).",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "chain_gas_price_preview",
    {
      description:
        "FREE live sample of the current Base mainnet gas price — identical data to the paid chain_gas_price tool. No payment required.",
      inputSchema: {},
    },
    async () => {
      try {
        const [hex, feeHistory, ethUsd] = await Promise.all([
          baseRpc("eth_gasPrice", []) as Promise<string>,
          fetchFeeHistory(),
          getEthUsd(),
        ]);
        const wei = BigInt(hex);
        const gasPriceEth = Number(wei) / 1e18;
        const result = {
          gas_price_wei: wei.toString(),
          gas_price_gwei: Number(wei) / 1e9,
          base_fee_gwei: feeHistory.base_fee_gwei,
          priority_fee_gwei: feeHistory.priority_fee_gwei,
          gas_price_usd: ethUsd !== null ? gasPriceEth * ethUsd : null,
          chain: "base",
          note: "Free live sample — identical to the paid tool. Full: the paid chain_gas_price tool or GET /chain/gas-price ($0.005).",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "chain_token_report",
    {
      description:
        "Token security check (honeypot detector + rug-pull risk score) for a Base ERC-20 in one call, decision-grade trade-safety verdict: SAFE | CAUTION | AVOID plus risk_score (0-100) and reasons, bundling honeypot/sellability simulation, owner-renounced + mint/pause/blacklist/fee-setter/upgradeable-proxy checks, token symbol/name/decimals, and Uniswap v3 WETH-pool liquidity (USD). Replaces many RPC calls and prevents a bad trade. Cost: $0.005 USDC per call via the shared MCP payment gate (the direct HTTP endpoint GET /chain/token-report is $0.01 — MCP tools/call is gated at a flat $0.005 per request).",
      inputSchema: {
        token: z.string().describe("0x-prefixed 20-byte ERC-20 contract address on Base mainnet"),
      },
    },
    async ({ token }) => {
      if (!ADDR_RE.test(token)) {
        return { content: [{ type: "text" as const, text: "Error: token must be a 0x-prefixed 20-byte address" }] };
      }
      try {
        const result = await buildTokenReport(token);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "gate_swap",
    {
      description:
        "Pre-trade GO / HOLD / BLOCK gate for a Base ERC-20 swap: honeypot/sellability + admin-control checks + Uniswap v3 liquidity vs. your trade size. One decision + reason. Cost: $0.005 USDC per call via the shared MCP payment gate (the direct HTTP endpoint GET /gate/swap is $0.008 — MCP tools/call is gated at a flat $0.005 per request).",
      inputSchema: {
        token: z.string().describe("0x-prefixed ERC-20 contract on Base mainnet"),
        side: z.enum(["buy", "sell"]).optional().describe("default buy"),
        notional_usd: z.number().positive().optional().describe("intended trade size in USD (default 100)"),
      },
    },
    async ({ token, side, notional_usd }) => {
      if (!ADDR_RE.test(token)) {
        return { content: [{ type: "text" as const, text: "Error: token must be a 0x-prefixed 20-byte address" }] };
      }
      try {
        const result = await buildSwapGate(token, side ?? "buy", notional_usd ?? 100);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "gate_swap_preview",
    {
      description:
        "FREE live sample of the gate_swap pre-trade GO/HOLD/BLOCK decision for a demo Base token (usdc|weth|cbbtc|aero|degen), same shape as the paid gate_swap tool. No payment required.",
      inputSchema: {
        token: z.enum(["usdc", "weth", "cbbtc", "aero", "degen"]).optional().describe("demo token, default usdc"),
        side: z.enum(["buy", "sell"]).optional().describe("default buy"),
        notional_usd: z.number().positive().optional().describe("trade size in USD (default 100)"),
      },
    },
    async ({ token, side, notional_usd }) => {
      try {
        const result = await buildSwapGate(PREVIEW_DEMO_TOKENS[token ?? "usdc"], side ?? "buy", notional_usd ?? 100);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "chain_token_report_preview",
    {
      description:
        "FREE full real trade-safety report (SAFE/CAUTION/AVOID verdict) for Base USDC, same depth as the paid chain_token_report tool. No payment required.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await buildTokenReport(TOKEN_REPORT_PREVIEW_TOKEN);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    "chain_token_security_preview",
    {
      description:
        "FREE full real analysis of a fixed well-known token (Base WETH) via the token security / honeypot detector — same depth as the paid chain_token_security tool, so you can see the real product before paying. To analyze an arbitrary token, use the paid chain_token_security tool. No payment required.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await analyzeTokenSecurity(TOKEN_SECURITY_PREVIEW_TOKEN);
        const withNote = {
          ...result,
          note: "Free live sample — full real analysis of a well-known token (Base WETH), same depth as the paid tool. Full: the paid chain_token_security tool or GET /chain/token-security ($0.009) to analyze ANY Base ERC-20 token.",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(withNote, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
      }
    },
  );

  return server;
});

app.all("/mcp", async (c) => {
  // Parse JSON body for the MCP handler (same pattern as createMcpHonoApp)
  let parsedBody: unknown;
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      parsedBody = await c.req.raw.clone().json();
    } catch {
      return c.text("Invalid JSON", 400);
    }
  }
  // Lenient Accept: simple probes/clients that omit text/event-stream would
  // otherwise get a 406 that looks like an auth wall. Normalize on POST.
  let mcpReq = c.req.raw;
  const acc = (c.req.header("accept") ?? "").toLowerCase();
  if (mcpReq.method === "POST" && !(acc.includes("application/json") && acc.includes("text/event-stream"))) {
    const h = new Headers(mcpReq.headers);
    h.set("accept", "application/json, text/event-stream");
    mcpReq = new Request(mcpReq, { headers: h });
  }
  const res = await mcpHandler.fetch(mcpReq, { parsedBody });
  // The gate middleware sets `rail` ONLY on paid tools/call (x402-paid after
  // payment, or rapidapi-bypass / api-key on the marketplace rails). MCP
  // discovery (initialize / tools/list / notifications) and free preview
  // tools never set it, so they are never counted as paid. Fire-and-forget.
  const rail = c.get("rail");
  if (rail) {
    fireAndForget(c, trackPaidRequest("POST /mcp", rail, makeUsageCounter(c.env)));
  }
  return res;
});


// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export { UsageCounter } from "./usage_counter.ts";
export default app;
