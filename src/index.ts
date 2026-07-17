import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Environment bindings
// ---------------------------------------------------------------------------

type Env = {
  PAY_TO: string;
  // CDP facilitator credentials (Worker secrets) — enable Bazaar discovery/settlement.
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  FACILITATOR_MODE?: string; // "cdp" routes settlement through CDP; anything else = xpay (default)
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NETWORK = "eip155:8453" as const; // Base mainnet
// Non-custodial facilitator — no Coinbase/CDP API key needed.
const FACILITATOR_URL = "https://facilitator.xpay.sh";
// CDP hosted facilitator — settlements through this get catalogued in the x402 Bazaar.
const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const CDP_HOST = "api.cdp.coinbase.com";
const DOH_URL = "https://cloudflare-dns.com/dns-query";
const RDAP_URL = "https://rdap.org/domain";
const POLYMARKET_URL = "https://gamma-api.polymarket.com/markets";
const POLYMARKET_EVENTS_URL = "https://gamma-api.polymarket.com/events";
// Multiple keyless Base RPCs — rotate on 429/5xx so a single provider's rate
// limit never fails a paid call (reliability = repeat callers).
const BASE_RPCS = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
];

// ---------------------------------------------------------------------------
// Base mainnet JSON-RPC helper — fixed host only (no user-supplied URL),
// SSRF-safe by construction. Shared by all /chain/* endpoints.
// ---------------------------------------------------------------------------

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const HASH_RE = /^0x[a-fA-F0-9]{64}$/;

async function baseRpc(method: string, params: unknown[]): Promise<any> {
  let lastErr = "no rpc tried";
  for (const url of BASE_RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) {
        lastErr = `${url} -> HTTP ${res.status}`;
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

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Free health endpoint
// ---------------------------------------------------------------------------

app.get("/health", (c) => c.json({ ok: true }));

// ---------------------------------------------------------------------------
// Landing page — every external listing (Bazaar, MCP registry, awesome-x402,
// llms.txt crawlers) links back here, so a 404 undercuts credibility. Plain
// self-contained HTML: inline CSS only, no external resources, readable by
// both humans and agents. Hono auto-serves HEAD from this GET handler.
// ---------------------------------------------------------------------------

app.get("/", (c) => {
  const BASE = "https://x402-data-api.sigrunner.workers.dev";
  const mcpConfig = JSON.stringify(
    { mcpServers: { "grey-ridge-x402": { type: "streamable-http", url: `${BASE}/mcp` } } },
    null,
    2,
  );
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Grey Ridge Signals — Base-native x402 Data API</title>
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
  <h1>Grey Ridge Signals — Base-native x402 Data API</h1>
  <p class="tagline">Agent-native, pay-per-call data on Base — no account, no API key.</p>
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
      <tr><td>Base on-chain reads</td><td class="price">$0.001&ndash;$0.003</td><td><code>/chain/block-number</code>, <code>/chain/gas-price</code>, <code>/chain/balance</code>, <code>/chain/token-balance</code>, <code>/chain/tx</code>, <code>/chain/receipt</code>, <code>/chain/code</code>, <code>/chain/wallet</code></td></tr>
      <tr><td>Crypto / DeFi / prediction markets</td><td class="price">$0.001&ndash;$0.005</td><td><code>/crypto/prices</code>, <code>/crypto/funding</code>, <code>/defi/yields</code>, <code>/pm/markets</code></td></tr>
      <tr><td>Security</td><td class="price">$0.01&ndash;$0.10</td><td><code>/enrich/domain</code>, <code>/enrich/tech-risk</code>, <code>/scan/mcp</code></td></tr>
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
    <li><a href="/mcp">/mcp</a></li>
  </ul>

  <footer>Grey Ridge Signals Group LLC &middot; Base mainnet (eip155:8453), USDC via x402</footer>
</main>
</body>
</html>
`;
  return c.html(html);
});

// Staged CDP-auth probe (temporary): confirms we can mint a CDP JWT from Worker
// secrets and that the CDP facilitator accepts it, before swapping the live gate.
app.get("/internal/cdp-probe", async (c) => {
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
    tags,
    accepts: [{
      scheme: "exact", network: NETWORK, amount: units, maxAmountRequired: units,
      asset: USDC, payTo, maxTimeoutSeconds: 300, resource: `${BASE}${p}`,
      description: desc, mimeType: "application/json", extra: { name: "USD Coin", version: "2" },
    }],
  });
  return c.json({
    service_overview: {
      name: "Grey Ridge Signals — x402 Data & Security",
      tagline: "Agent-native prediction-market & crypto data, plus MCP security audits, pay-per-call over x402.",
      description:
        "Pay-per-call x402 services on Base: live Polymarket prediction-market data, and MCP security scans (tool-poisoning / prompt-injection / exfiltration, OWASP LLM01/LLM08). No account, no key — agents pay inline in USDC.",
      website: BASE,
      categories: ["prediction-markets", "crypto", "data", "security", "mcp", "funding", "yield", "token-price", "rpc", "base", "onchain", "blockchain"],
    },
    name: "Grey Ridge Signals",
    provider: "Grey Ridge Signals Group LLC",
    x402Version: 2,
    network: NETWORK,
    networks: [NETWORK],
    mcp_endpoint: `${BASE}/mcp`,
    resources: [
      mk("/pm/markets", "GET", "0.005", "5000", "Live Polymarket prediction markets — question, outcomes, bestBid/bestAsk/spread, volume24hr/volume1wk, oneDayPriceChange, clobTokenIds, conditionId, category tags, liquidity, end date. Ranked by volume24hr; filter by keyword.", ["prediction-markets", "polymarket", "markets", "crypto", "data"]),
      mk("/crypto/funding", "GET", "0.001", "1000", "Cross-venue Hyperliquid+OKX+dYdX perp funding rates — top coins by 24h notional volume, per-venue funding + arb spread (bps) + cheapest-long/richest-short venue, premium/basis, annualized_hl/annualized_okx, LONGS_PAY/SHORTS_PAY/NEUTRAL signal, next_funding_ts, mark/oracle prices, open interest.", ["crypto", "funding", "perps", "hyperliquid", "okx", "dydx", "arbitrage", "defi", "data"]),
      mk("/defi/yields", "GET", "0.001", "1000", "Top DeFi lending/LP yields — project, chain, symbol, pool id, APY breakdown + 1d/7d/30d APY trend, IL risk (incl. il7d), exposure, reward/underlying tokens, outlier flag, mu/sigma, DefiLlama stability forecast, TVL. Filter by project, chain, or stablecoin-only; sort by TVL or risk-adjusted APY.", ["defi", "yield", "lending", "apy", "tvl", "data"]),
      mk("/crypto/prices", "GET", "0.001", "1000", "Spot token prices from DefiLlama — pass comma-separated CoinGecko ids, get price/change_24h/symbol/confidence/timestamp.", ["crypto", "prices", "token-price", "defi", "data"]),
      mk("/scan/mcp", "GET", "0.10", "100000", "Security scan of a target MCP server: audits every advertised tool for prompt-injection / tool-poisoning / exfiltration / dangerous-capability / hidden-unicode (OWASP LLM01/LLM08). Returns findings + risk score.", ["security", "mcp", "audit", "prompt-injection"]),
      mk("/enrich/tech-risk", "GET", "0.05", "50000", "Tech-stack fingerprint -> CVE (NVD) + EPSS + CISA-KEV attack-surface risk for a domain.", ["security", "cve", "risk"]),
      mk("/enrich/domain", "GET", "0.01", "10000", "Firmographic + tech-stack enrichment for a domain, incl. full subdomain enumeration via certificate-transparency logs (crt.sh, RDAP, DoH, HTTP fingerprint).", ["data", "domain", "enrichment"]),
      mk("/chain/block-number", "GET", "0.001", "1000", "Current Base mainnet block number.", ["rpc", "base", "onchain", "blockchain", "data"]),
      mk("/chain/gas-price", "GET", "0.001", "1000", "Current Base mainnet gas price (wei + gwei).", ["rpc", "base", "onchain", "blockchain", "data"]),
      mk("/chain/balance", "GET", "0.001", "1000", "ETH balance of a Base mainnet address.", ["rpc", "base", "onchain", "blockchain", "data"]),
      mk("/chain/token-balance", "GET", "0.001", "1000", "ERC-20 token balance of a Base mainnet address, incl. symbol, decimals, balance_formatted.", ["rpc", "base", "onchain", "blockchain", "data"]),
      mk("/chain/tx", "GET", "0.001", "1000", "Transaction details by hash on Base mainnet.", ["rpc", "base", "onchain", "blockchain", "data"]),
      mk("/chain/receipt", "GET", "0.001", "1000", "Transaction receipt (status, gas used, logs count) by hash on Base mainnet.", ["rpc", "base", "onchain", "blockchain", "data"]),
      mk("/chain/code", "GET", "0.001", "1000", "Contract-code check for a Base mainnet address (is_contract + code size + EIP-7702 delegated-EOA detection).", ["rpc", "base", "onchain", "blockchain", "data"]),
      mk("/chain/wallet", "GET", "0.003", "3000", "Wallet bundle: ETH balance + tx count + contract-code check (EIP-7702 delegated-EOA aware) for a Base mainnet address, in one call.", ["rpc", "base", "onchain", "blockchain", "wallet", "data"]),
    ],
  });
});

// llms.txt — the plain-text catalog AI-agent crawlers read to discover paid
// services (an emerging convention many x402 sellers expose). Free, ungated.
app.get("/llms.txt", (c) => {
  const BASE = "https://x402-data-api.sigrunner.workers.dev";
  return c.text(`# Grey Ridge Signals — x402 Data & Security APIs

> Agent-native, pay-per-call data on Base (USDC via x402). No account, no API key — agents pay inline.
> Landing page: ${BASE}/  |  Discovery: ${BASE}/.well-known/x402  |  OpenAPI: ${BASE}/openapi.json  |  Listed on the Coinbase CDP x402 Bazaar.

## How to pay
Each paid GET returns HTTP 402 with an x402 v2 payment-required challenge (network eip155:8453 / Base, asset USDC).
Sign and retry per the x402 spec (https://x402.org). Settlement ~1s. No signup.

## Endpoints
- GET ${BASE}/crypto/prices?coins=bitcoin,ethereum,solana — $0.001 — spot token prices + change_24h (DefiLlama), keyless.
- GET ${BASE}/crypto/funding?limit=20 — $0.001 — cross-venue Hyperliquid+OKX+dYdX funding rates + arb spread (bps) + best long/short venue + premium/annualized/signal/next_funding_ts.
- GET ${BASE}/defi/yields?limit=20&project=&chain=&stable=&sort=tvl|risk_adjusted — $0.001 — top DeFi lending/LP yields, APY trend + IL risk + reward/underlying tokens + mu/sigma + stability forecast + TVL (DefiLlama).
- GET ${BASE}/pm/markets?query=&limit=20 — $0.005 — live Polymarket prediction markets, ranked by volume24hr (bestBid/bestAsk/spread, clobTokenIds, category tags, liquidity).
- GET ${BASE}/scan/mcp?url=<mcp-server> — $0.10 — security audit of an MCP server (tool-poisoning / prompt-injection, OWASP LLM01/LLM08).
- GET ${BASE}/enrich/tech-risk?domain=<domain> — $0.05 — tech-stack -> CVE (NVD) + EPSS + CISA-KEV risk.
- GET ${BASE}/enrich/domain?domain=<domain> — $0.01 — firmographic + tech-stack enrichment, incl. subdomain enumeration (crt.sh).
- GET ${BASE}/chain/block-number — $0.001 — current Base mainnet block number.
- GET ${BASE}/chain/gas-price — $0.001 — current Base mainnet gas price (wei + gwei).
- GET ${BASE}/chain/balance?address=<0x…> — $0.001 — ETH balance of a Base address.
- GET ${BASE}/chain/token-balance?address=<0x…>&token=<0x…> — $0.001 — ERC-20 token balance of a Base address, incl. symbol/decimals/balance_formatted.
- GET ${BASE}/chain/tx?hash=<0x…> — $0.001 — transaction details by hash on Base.
- GET ${BASE}/chain/receipt?hash=<0x…> — $0.001 — transaction receipt (status, gas used, logs) by hash on Base.
- GET ${BASE}/chain/code?address=<0x…> — $0.001 — contract-code check for a Base address (EIP-7702 delegated-EOA aware).
- GET ${BASE}/chain/wallet?address=<0x…> — $0.003 — wallet bundle: balance + tx count + contract check (EIP-7702 delegated-EOA aware), one call.

## Free (previews — taste the data before you pay)
- GET ${BASE}/crypto/prices/preview — free 1-token sample of /crypto/prices.
- GET ${BASE}/crypto/funding/preview — free top-1 sample of /crypto/funding.
- GET ${BASE}/defi/yields/preview — free top-1 sample of /defi/yields.
- GET ${BASE}/pm/markets/preview — free top-1 sample of /pm/markets.
- GET ${BASE}/chain/block-number/preview — free, full live data (identical to the paid route).
- GET ${BASE}/chain/gas-price/preview — free, full live data (identical to the paid route).
- GET ${BASE}/scan/mcp/preview?url=<mcp-server> — free preview (counts + risk score; withholds detail).
- GET ${BASE}/.well-known/x402 — machine-readable discovery manifest.
`);
});

// openapi.json — OpenAPI 3.1 spec so agents can auto-integrate every paid route.
app.get("/openapi.json", (c) => {
  const BASE = "https://x402-data-api.sigrunner.workers.dev";
  const paid = (
    summary: string,
    price: string,
    params: { name: string; desc: string; required?: boolean }[],
  ) => ({
    get: {
      summary,
      description: `${summary} Paid via x402 (USDC on Base, eip155:8453). Returns HTTP 402 with a payment-required challenge until paid. Price: $${price}.`,
      parameters: params.map((p) => ({
        name: p.name, in: "query", required: !!p.required,
        schema: { type: "string" }, description: p.desc,
      })),
      responses: {
        "200": { description: "Success — JSON data" },
        "402": { description: `Payment required ($${price} USDC via x402)` },
      },
    },
  });
  return c.json({
    openapi: "3.1.0",
    info: {
      title: "Grey Ridge Signals — x402 Data & Security APIs",
      version: "1.0.0",
      description: "Agent-native pay-per-call data on Base (USDC via x402). No API keys, no signup. Discovery: /.well-known/x402",
    },
    servers: [{ url: BASE }],
    paths: {
      "/": {
        get: {
          summary: "Landing page (HTML, free).",
          description: "Self-contained HTML landing page — pitch, endpoint-group pricing table, free curl sample, MCP install snippet, discovery links. No payment required.",
          responses: { "200": { description: "HTML landing page" } },
        },
      },
      "/crypto/prices": paid("Spot token prices + change_24h (DefiLlama).", "0.001", [{ name: "coins", desc: "comma-separated coingecko ids (max 25)" }]),
      "/crypto/funding": paid("Cross-venue Hyperliquid+OKX+dYdX funding rates + arb spread + premium/annualized/signal/next_funding_ts.", "0.001", [{ name: "limit", desc: "max coins (default 20, max 100)" }]),
      "/defi/yields": paid("Top DeFi lending/LP yields — APY trend + IL risk + reward/underlying tokens + mu/sigma + stability forecast (DefiLlama).", "0.001", [{ name: "limit", desc: "max pools" }, { name: "project", desc: "protocol filter" }, { name: "chain", desc: "chain filter" }, { name: "stable", desc: "'true' = stablecoin only" }, { name: "sort", desc: "'tvl' (default) or 'risk_adjusted' (apy/sigma)" }]),
      "/pm/markets": paid("Live Polymarket prediction markets, ranked by volume24hr, with bestBid/bestAsk/spread and category tags.", "0.005", [{ name: "query", desc: "keyword filter" }, { name: "limit", desc: "max markets" }]),
      "/scan/mcp": paid("Security audit of an MCP server (tool-poisoning / prompt-injection).", "0.10", [{ name: "url", desc: "target MCP server URL", required: true }]),
      "/enrich/tech-risk": paid("Tech-stack -> CVE + EPSS + CISA-KEV risk.", "0.05", [{ name: "domain", desc: "target domain", required: true }]),
      "/enrich/domain": paid("Firmographic + tech-stack enrichment, incl. subdomain enumeration.", "0.01", [{ name: "domain", desc: "target domain", required: true }]),
      "/chain/block-number": paid("Current Base mainnet block number.", "0.001", []),
      "/chain/gas-price": paid("Current Base mainnet gas price (wei + gwei).", "0.001", []),
      "/chain/balance": paid("ETH balance of a Base mainnet address.", "0.001", [{ name: "address", desc: "0x-prefixed Base address", required: true }]),
      "/chain/token-balance": paid("ERC-20 token balance of a Base mainnet address, incl. symbol/decimals/balance_formatted.", "0.001", [{ name: "address", desc: "0x-prefixed holder address", required: true }, { name: "token", desc: "0x-prefixed ERC-20 contract address", required: true }]),
      "/chain/tx": paid("Transaction details by hash on Base mainnet.", "0.001", [{ name: "hash", desc: "0x-prefixed 32-byte transaction hash", required: true }]),
      "/chain/receipt": paid("Transaction receipt (status, gas used, logs count) by hash on Base mainnet.", "0.001", [{ name: "hash", desc: "0x-prefixed 32-byte transaction hash", required: true }]),
      "/chain/code": paid("Contract-code check for a Base mainnet address (EIP-7702 delegated-EOA aware).", "0.001", [{ name: "address", desc: "0x-prefixed Base address", required: true }]),
      "/chain/wallet": paid("Wallet bundle: ETH balance + tx count + contract-code check (EIP-7702 delegated-EOA aware), in one call.", "0.003", [{ name: "address", desc: "0x-prefixed Base address", required: true }]),
    },
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

function makeCdpAuthHeaders(apiKeyId: string, apiKeySecret: string) {
  const mk = async (path: string, method: "GET" | "POST") => {
    const jwt = await generateJwt({
      apiKeyId,
      apiKeySecret,
      requestMethod: method,
      requestHost: CDP_HOST,
      requestPath: path,
    });
    return { Authorization: `Bearer ${jwt}` };
  };
  return async () => ({
    verify: await mk("/platform/v2/x402/verify", "POST"),
    settle: await mk("/platform/v2/x402/settle", "POST"),
    supported: await mk("/platform/v2/x402/supported", "GET"),
  });
}

let activeResourceServer: x402ResourceServer | null = null;

function selectResourceServer(env: Env): x402ResourceServer {
  if (activeResourceServer) return activeResourceServer;
  if (env.FACILITATOR_MODE === "cdp" && env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) {
    const cdpFacilitator = new HTTPFacilitatorClient({
      url: CDP_FACILITATOR_URL,
      createAuthHeaders: makeCdpAuthHeaders(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET),
    });
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

function makeRoutes(payTo: string) {
  return {
    "POST /mcp": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.005",
        network: NETWORK,
        payTo,
      },
      description:
        "MCP tools/call: crypto_prices, crypto_funding, defi_yields, pm_markets (Base/crypto/prediction-market data), chain_block_number, chain_gas_price, chain_balance, chain_token_balance, chain_tx, chain_wallet (Base mainnet on-chain reads, EIP-7702 delegated-EOA aware), enrich_tech_risk (security: tech-stack + CVE/EPSS/CISA-KEV), enrich_domain (firmographic), or scan_mcp_server (tool-poisoning/prompt-injection audit of a target MCP server)",
      mimeType: "application/json",
    },
    "GET /scan/mcp": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.10",
        network: NETWORK,
        payTo,
      },
      description:
        "Security scan of a target MCP server: audits every advertised tool for prompt-injection / tool-poisoning / exfiltration / dangerous-capability / hidden-unicode (OWASP LLM01/LLM08). Returns findings + risk score.",
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
        price: "$0.02",
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
        price: "$0.05",
        network: NETWORK,
        payTo,
      },
      description:
        "Security enrichment: tech-stack fingerprint + CVE mapping + EPSS + CISA KEV for a domain",
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
        "Domain enrichment: firmographic data + SSL certs + subdomain enumeration + tech-stack fingerprint",
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
        price: "$0.001",
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
        price: "$0.001",
        network: NETWORK,
        payTo,
      },
      description: "Current Base mainnet block number.",
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
        price: "$0.001",
        network: NETWORK,
        payTo,
      },
      description: "Current Base mainnet gas price (wei + gwei).",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: {},
        inputSchema: { type: "object", properties: {} },
        output: {
          example: { gas_price_wei: "21284349", gas_price_gwei: 0.021284349, chain: "base" },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/balance": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.001",
        network: NETWORK,
        payTo,
      },
      description: "ETH balance of a Base mainnet address.",
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
          example: { address: "0x4200000000000000000000000000000000000006", balance_wei: "17265432100000000000", balance_eth: 17.2654321, chain: "base" },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/token-balance": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.001",
        network: NETWORK,
        payTo,
      },
      description: "ERC-20 token balance of a Base mainnet address, incl. symbol, decimals, balance_formatted.",
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
        price: "$0.001",
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
        price: "$0.001",
        network: NETWORK,
        payTo,
      },
      description: "Transaction receipt (status, gas used, logs count) by hash on Base mainnet.",
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
          example: { status: 1, block_number: 48747709, gas_used: 70216, from: "0xd80217bd14c4d4a4fe37bb1354be1830ed815a60", to: "0x6211a3742cf9d3b6677ecc7fd9dd102ab101d8e2", tx_hash: "0x571284385ad512a3ffc984a6c2f335113ada217215b6296847944f9d0bc613ef", logs_count: 0 },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
    "GET /chain/code": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.001",
        network: NETWORK,
        payTo,
      },
      description: "Contract-code check for a Base mainnet address (is_contract + code size + EIP-7702 delegated-EOA detection).",
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
    "GET /chain/wallet": {
      accepts: {
        scheme: "exact" as const,
        price: "$0.003",
        network: NETWORK,
        payTo,
      },
      description: "Wallet bundle: ETH balance + tx count + contract-code check (EIP-7702 delegated-EOA aware) for a Base mainnet address, in one call.",
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
          example: { address: "0x4200000000000000000000000000000000000006", balance_wei: "17265432100000000000", balance_eth: 17.2654321, tx_count: 4, is_contract: true, is_eip7702_delegate: false, delegate_address: null, chain: "base" },
        },
      } as Parameters<typeof declareDiscoveryExtension>[0]),
    },
  };
}

app.use(async (c, next) => {
  // MCP: discovery (initialize / tools/list / notifications) is FREE so agents
  // can find the tool; only tools/call is x402-gated ($0.05). Peek at the
  // JSON-RPC method to decide. Non-JSON (GET/SSE) → free.
  if (c.req.path === "/mcp") {
    let rpcMethod: string | undefined;
    let toolName: string | undefined;
    try {
      const body = (await c.req.raw.clone().json()) as {
        method?: string;
        params?: { name?: string };
      };
      rpcMethod = body.method;
      toolName = body.params?.name;
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
    ]);
    if (rpcMethod !== "tools/call" || (toolName && FREE_TOOLS.has(toolName))) {
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
  return cachedMiddleware(c, next);
});

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

  return c.json({ domain, ...results });
});

// ---------------------------------------------------------------------------
// WHOIS / RDAP endpoint  ($0.02)
// ---------------------------------------------------------------------------

app.get("/whois/:domain", async (c) => {
  const domain = c.req.param("domain");

  const res = await fetch(`${RDAP_URL}/${encodeURIComponent(domain)}`, {
    headers: { accept: "application/rdap+json" },
  });

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
  summary: string;
  generated_at: string;
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

  return {
    tech_stack: techStack,
    domain: domain ?? null,
    vulnerabilities: allCves.map((cve) => {
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
    }),
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

    return c.json(result);
  } catch (e) {
    return c.json(
      { error: (e as Error).message },
      { status: 400 },
    );
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
  generated_at: string;
}

// Combine RDAP + DoH + crt.sh + HTTP fingerprint for domain enrichment.
// Shared pipeline — used by both the HTTP endpoint and the MCP tool.
async function enrichDomain(domain: string): Promise<EnrichDomainResult> {
  const startTs = new Date().toISOString();

  // Parallel: RDAP, DoH DNS, certificates, HTTP fingerprint
  const [rdapRes, dnsFp, certResult] = await Promise.all([
    fetch(`${RDAP_URL}/${encodeURIComponent(domain)}`, {
      headers: { accept: "application/rdap+json" },
    }),
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
    generated_at: startTs,
  };
}

app.get("/enrich/domain", async (c) => {
  const domain = c.req.query("domain");
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

    return c.json(prices);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

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
      note: "Free live sample — identical to the paid route. Full: GET /chain/block-number ($0.001), keyless x402 on Base.",
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

app.get("/chain/gas-price", async (c) => {
  try {
    const hex = (await baseRpc("eth_gasPrice", [])) as string;
    const wei = BigInt(hex);
    const result = { gas_price_wei: wei.toString(), gas_price_gwei: Number(wei) / 1e9, chain: "base" };

    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/gas-price", ts: new Date().toISOString() }),
    );

    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// Free preview — same live Base RPC read as the paid route, no payment required.
app.get("/chain/gas-price/preview", async (c) => {
  try {
    const hex = (await baseRpc("eth_gasPrice", [])) as string;
    const wei = BigInt(hex);
    return c.json({
      gas_price_wei: wei.toString(),
      gas_price_gwei: Number(wei) / 1e9,
      chain: "base",
      note: "Free live sample — identical to the paid route. Full: GET /chain/gas-price ($0.001), keyless x402 on Base.",
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
    const hex = (await baseRpc("eth_getBalance", [address, "latest"])) as string;
    const wei = BigInt(hex);
    const result = { address, balance_wei: wei.toString(), balance_eth: Number(wei) / 1e18, chain: "base" };

    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/balance", address, ts: new Date().toISOString() }),
    );

    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
});

// Decode an ABI-encoded dynamic `string` return value (offset + length + data).
function decodeAbiString(hex: string): string {
  try {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length < 128) return "";
    const len = parseInt(clean.slice(64, 128), 16);
    const dataHex = clean.slice(128, 128 + len * 2);
    const bytes = new Uint8Array(dataHex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(dataHex.substr(i * 2, 2), 16);
    return new TextDecoder().decode(bytes).replace(/\0/g, "").trim();
  } catch {
    return "";
  }
}

interface TokenMeta {
  symbol: string;
  decimals: number;
}

// symbol()/decimals() rarely change for a deployed contract, so cache per
// token address for this Worker isolate's lifetime — most-called RPC
// primitive, this avoids 2 extra eth_calls on every repeat lookup.
const tokenMetaCache = new Map<string, TokenMeta>();

async function getTokenMeta(token: string): Promise<TokenMeta | null> {
  const key = token.toLowerCase();
  const cached = tokenMetaCache.get(key);
  if (cached) return cached;
  try {
    const [symbolHex, decimalsHex] = await Promise.all([
      baseRpc("eth_call", [{ to: token, data: "0x95d89b41" }, "latest"]) as Promise<string>,
      baseRpc("eth_call", [{ to: token, data: "0x313ce567" }, "latest"]) as Promise<string>,
    ]);
    const symbol = decodeAbiString(symbolHex) || "UNKNOWN";
    const decimals = decimalsHex && decimalsHex !== "0x" ? parseInt(decimalsHex, 16) : 18;
    const meta: TokenMeta = { symbol, decimals: Number.isFinite(decimals) ? decimals : 18 };
    tokenMetaCache.set(key, meta);
    return meta;
  } catch {
    return null;
  }
}

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

    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/token-balance", address, token, ts: new Date().toISOString() }),
    );

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
    const receipt = (await baseRpc("eth_getTransactionReceipt", [hash])) as {
      status: string;
      blockNumber: string;
      gasUsed: string;
      from: string;
      to: string | null;
      logs: unknown[];
    } | null;
    if (!receipt) {
      return c.json({ error: "receipt not found" }, { status: 404 });
    }
    const result = {
      status: parseInt(receipt.status, 16),
      block_number: parseInt(receipt.blockNumber, 16),
      gas_used: parseInt(receipt.gasUsed, 16),
      from: receipt.from,
      to: receipt.to,
      tx_hash: hash,
      logs_count: receipt.logs.length,
    };

    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/receipt", hash, ts: new Date().toISOString() }),
    );

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

    return c.json(result);
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
    const [balanceHex, nonceHex, code] = await Promise.all([
      baseRpc("eth_getBalance", [address, "latest"]) as Promise<string>,
      baseRpc("eth_getTransactionCount", [address, "latest"]) as Promise<string>,
      baseRpc("eth_getCode", [address, "latest"]) as Promise<string>,
    ]);
    const wei = BigInt(balanceHex);
    const result = {
      address,
      balance_wei: wei.toString(),
      balance_eth: Number(wei) / 1e18,
      tx_count: parseInt(nonceHex, 16),
      ...classifyCode(code),
      chain: "base",
    };

    console.log(
      JSON.stringify({ event: "paid_request", endpoint: "/chain/wallet", address, ts: new Date().toISOString() }),
    );

    return c.json(result);
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

  // 1. Hidden instructions to the AI embedded in a tool description (tool poisoning)
  const inj = /(ignore (all )?previous|disregard (the )?above|you must (always|first)|<important>|<system>|do not (tell|mention|inform) the user|before (using|calling) (any|this|other)|instead of)/i;
  if (inj.test(text)) add("critical", "tool-poisoning:hidden-instructions",
    "Description contains instructions aimed at the AI agent, not the human — classic MCP tool-poisoning.", (text.match(inj) || [""])[0]);

  // 2. Data-exfiltration hints (read secrets/env/files, send elsewhere)
  const exfil = /(\.env|env(ironment)? variable|secret|api[_ -]?key|private key|~\/\.ssh|id_rsa|password|credential|read (the )?file|exfiltrat|send (it|them|the|this) to|POST (it|to)|upload to)/i;
  if (exfil.test(low)) add("high", "exfiltration-hint",
    "Description references reading secrets/files or sending data externally.", (low.match(exfil) || [""])[0]);

  // 3. Dangerous capability surface
  const danger = /(exec|eval|subprocess|shell|os\.system|child_process|rm -rf|sudo|chmod|arbitrary (code|command)|remote code)/i;
  if (danger.test(low)) add("high", "dangerous-capability",
    "Tool exposes code/command execution or destructive filesystem ops.", (low.match(danger) || [""])[0]);

  // 4. Cross-tool shadowing / rug-pull language (altering other tools' behavior)
  const shadow = /(other tools?|all tools?|every tool|override|shadow|when (any|another) tool|modify the behavior)/i;
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
        clientInfo: { name: "x402-data-api-mcp-scanner", version: "1.0.0" },
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

  return { target, tools_scanned: tools.length, findings, risk_score, risk_summary, scanned_at };
}

app.get("/scan/mcp", async (c) => {
  const target = c.req.query("url");
  if (!target || !/^https?:\/\//i.test(target)) {
    return c.json({ error: "url query param (target MCP server endpoint) required" }, { status: 400 });
  }
  try {
    const result = await scanMcpServer(target);
    console.log(JSON.stringify({ event: "paid_request", endpoint: "/scan/mcp", target, findings: result.findings.length, ts: result.scanned_at }));
    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, { status: 502 });
  }
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
      ? "Clean on static checks. Run the full scan_mcp_server ($0.05) for the itemized report + evidence."
      : `${r.findings.length} issue(s) found${by.critical ? `, ${by.critical} CRITICAL` : ""}. This preview hides WHICH tools and the evidence — get the full itemized findings + remediation via the paid scan_mcp_server tool ($0.05 USDC) or GET /scan/mcp ($0.10).`;
  return {
    target: r.target,
    tools_scanned: r.tools_scanned,
    issue_count: r.findings.length,
    severity_breakdown: by,
    risk_score: r.risk_score,
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

// ---------------------------------------------------------------------------
// MCP endpoint — expose enrich_tech_risk as an MCP tool  ($0.05 paid via x402)
// ---------------------------------------------------------------------------

const mcpHandler = createMcpHandler(() => {
  const server = new McpServer({
    name: "x402-data-api",
    version: "0.1.0",
  });

  server.registerTool(
    "enrich_tech_risk",
    {
      description:
        "Security enrichment: tech-stack fingerprint + CVE mapping + EPSS + CISA KEV for a domain. Cost: $0.05 USDC per call (x402 micropayment).",
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
        "Firmographic + tech-stack enrichment: RDAP registrant/registrar, DNS records, full subdomain enumeration + certificate-transparency history, tech-stack fingerprint for a domain. Cost: $0.05 USDC per call via the shared MCP payment gate (the direct HTTP endpoint GET /enrich/domain is $0.01 — MCP tools/call is gated at a flat $0.05 per request today).",
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
        "Security-audit a target MCP server for prompt-injection / tool-poisoning. Fetches the server's advertised tools and statically analyzes each for hidden instructions, data-exfiltration hints, dangerous capabilities, cross-tool shadowing, and invisible-unicode payloads (OWASP LLM01/LLM08). Returns findings + a 0-100 risk score. Cost: $0.05 USDC per scan via x402.",
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
        "FREE preview scan of a target MCP server for tool-poisoning / prompt-injection. Returns issue count, severity breakdown, and risk score — but NOT which tools or the evidence. Use this to check any MCP server (including your own) at no cost; if issues are found, call the paid scan_mcp_server for the itemized findings + remediation. No payment required.",
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
        "Current Base mainnet gas price (wei + gwei) via multi-provider JSON-RPC. Cost: $0.005 USDC per call via x402.",
      inputSchema: {},
    },
    async () => {
      try {
        const hex = (await baseRpc("eth_gasPrice", [])) as string;
        const wei = BigInt(hex);
        const result = { gas_price_wei: wei.toString(), gas_price_gwei: Number(wei) / 1e9, chain: "base" };
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
        "Native ETH balance of a Base mainnet address via multi-provider JSON-RPC. Cost: $0.005 USDC per call via x402.",
      inputSchema: {
        address: z.string().describe("0x-prefixed 20-byte Base address"),
      },
    },
    async ({ address }) => {
      if (!ADDR_RE.test(address)) {
        return { content: [{ type: "text" as const, text: "Error: address must be a 0x-prefixed 20-byte address" }] };
      }
      try {
        const hex = (await baseRpc("eth_getBalance", [address, "latest"])) as string;
        const wei = BigInt(hex);
        const result = { address, balance_wei: wei.toString(), balance_eth: Number(wei) / 1e18, chain: "base" };
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
        "Wallet bundle: ETH balance + tx count + contract-code check (EIP-7702 delegated-EOA aware) for a Base mainnet address, in one call. Cost: $0.005 USDC per call via x402.",
      inputSchema: {
        address: z.string().describe("0x-prefixed 20-byte Base address"),
      },
    },
    async ({ address }) => {
      if (!ADDR_RE.test(address)) {
        return { content: [{ type: "text" as const, text: "Error: address must be a 0x-prefixed 20-byte address" }] };
      }
      try {
        const [balanceHex, nonceHex, code] = await Promise.all([
          baseRpc("eth_getBalance", [address, "latest"]) as Promise<string>,
          baseRpc("eth_getTransactionCount", [address, "latest"]) as Promise<string>,
          baseRpc("eth_getCode", [address, "latest"]) as Promise<string>,
        ]);
        const wei = BigInt(balanceHex);
        const result = {
          address,
          balance_wei: wei.toString(),
          balance_eth: Number(wei) / 1e18,
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
          note: "Free live sample — identical to the paid tool. Full: the paid chain_block_number tool or GET /chain/block-number ($0.001).",
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
        const hex = (await baseRpc("eth_gasPrice", [])) as string;
        const wei = BigInt(hex);
        const result = {
          gas_price_wei: wei.toString(),
          gas_price_gwei: Number(wei) / 1e9,
          chain: "base",
          note: "Free live sample — identical to the paid tool. Full: the paid chain_gas_price tool or GET /chain/gas-price ($0.001).",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
  return mcpHandler.fetch(c.req.raw, { parsedBody });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export default app;
