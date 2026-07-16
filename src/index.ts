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

// ---------------------------------------------------------------------------
// App factory — called fresh per Worker request (Hono is stateless)
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Free health endpoint
// ---------------------------------------------------------------------------

app.get("/health", (c) => c.json({ ok: true }));

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
      categories: ["prediction-markets", "crypto", "data", "security", "mcp", "funding", "yield", "token-price"],
    },
    name: "Grey Ridge Signals",
    provider: "Grey Ridge Signals Group LLC",
    x402Version: 2,
    network: NETWORK,
    networks: [NETWORK],
    mcp_endpoint: `${BASE}/mcp`,
    resources: [
      mk("/pm/markets", "GET", "0.005", "5000", "Live Polymarket prediction markets — question, outcomes, live prices, volume, liquidity, end date. Filter by keyword.", ["prediction-markets", "polymarket", "markets", "crypto", "data"]),
      mk("/crypto/funding", "GET", "0.001", "1000", "Cross-venue perp funding rates from Hyperliquid — top coins by 24h notional volume, hourly + annualized funding, mark/oracle prices, open interest.", ["crypto", "funding", "perps", "hyperliquid", "defi", "data"]),
      mk("/defi/yields", "GET", "0.001", "1000", "Top DeFi lending/LP yields — project, chain, symbol, APY breakdown, TVL. Filter by project, chain, or stablecoin-only.", ["defi", "yield", "lending", "apy", "tvl", "data"]),
      mk("/crypto/prices", "GET", "0.001", "1000", "Spot token prices from DefiLlama — pass comma-separated CoinGecko ids, get price/symbol/confidence/timestamp.", ["crypto", "prices", "token-price", "defi", "data"]),
      mk("/scan/mcp", "GET", "0.10", "100000", "Security scan of a target MCP server: audits every advertised tool for prompt-injection / tool-poisoning / exfiltration / dangerous-capability / hidden-unicode (OWASP LLM01/LLM08). Returns findings + risk score.", ["security", "mcp", "audit", "prompt-injection"]),
      mk("/enrich/tech-risk", "GET", "0.05", "50000", "Tech-stack fingerprint -> CVE (NVD) + EPSS + CISA-KEV attack-surface risk for a domain.", ["security", "cve", "risk"]),
      mk("/enrich/domain", "GET", "0.01", "10000", "Firmographic + tech-stack enrichment for a domain (crt.sh, RDAP, DoH, HTTP fingerprint).", ["data", "domain", "enrichment"]),
    ],
  });
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
        price: "$0.05",
        network: NETWORK,
        payTo,
      },
      description:
        "MCP tools/call: enrich_tech_risk (security: tech-stack + CVE/EPSS/CISA-KEV), enrich_domain (firmographic), or scan_mcp_server (tool-poisoning/prompt-injection audit of a target MCP server)",
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
        "Domain enrichment: firmographic data + SSL certs + tech-stack fingerprint",
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
        "Query live Polymarket prediction markets — question, outcomes, live prices, volume, liquidity, end date. Filter by keyword.",
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
          example: { question: "Will X happen by 2026?", slug: "will-x-happen-by-2026", outcomes: ["Yes", "No"], outcomePrices: [0.65, 0.35], volume: 1234567.89, liquidity: 45678.12, endDate: "2026-12-31T12:00:00Z", active: true },
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
        "Cross-venue perp funding rates from Hyperliquid — top coins by 24h notional volume, hourly + annualized funding, mark/oracle prices, open interest.",
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
          example: { coin: "BTC", funding: 0.0000125, fundingAnnualizedPct: 10.95, markPx: 63730, oraclePx: 63750, openInterest: 37519.8698399999, dayNtlVlm: 1670654479.0625291 },
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
        "Top DeFi lending/LP yields — project, chain, symbol, APY breakdown, TVL. Filter by project, chain, or stablecoin-only.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        method: "GET",
        input: { limit: "20", project: "aave-v3", chain: "Ethereum", stable: "true" },
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "string", description: "Max pools to return (default 20, max 100)" },
            project: { type: "string", description: "Optional: filter to an exact project name (case-insensitive)" },
            chain: { type: "string", description: "Optional: filter to an exact chain name (case-insensitive)" },
            stable: { type: "string", description: "Optional: \"true\" to return only stablecoin pools" },
          },
        },
        output: {
          example: { project: "aave-v3", chain: "Ethereum", symbol: "USDC", apy: 4.21, apyBase: 3.1, apyReward: 1.11, tvlUsd: 512345678, stablecoin: true },
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
        "Spot token prices from DefiLlama — pass comma-separated CoinGecko ids, get price/symbol/confidence/timestamp.",
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
          example: { id: "bitcoin", symbol: "BTC", price: 63731.496785708485, confidence: 0.99, timestamp: 1784244902 },
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
    const FREE_TOOLS = new Set(["scan_mcp_preview"]);
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
  exploitAvailable: boolean;
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
        exploitAvailable: false, // NVD free API doesn't directly expose this
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
    vulnerabilities: allCves.map((cve) => ({
      id: cve.id,
      description: cve.description,
      cvss_score: cve.cvssScore,
      epss_score: epssScores[cve.id] ?? null,
      in_kev: kevFlags[cve.id] ?? false,
      exploit_available: cve.exploitAvailable,
    })),
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

// Certificate transparency logs (crt.sh)
async function searchCertificates(domain: string): Promise<CertEntry[]> {
  try {
    const res = await fetch(
      `https://crt.sh/?q=%.${encodeURIComponent(domain)}&output=json&limit=20`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return [];
    const raw = (await res.json()) as {
      issuer_name: string;
      name_value: string;
      not_after: string;
      not_before: string;
    }[];

    const seen = new Set<string>();
    const certs: CertEntry[] = [];
    for (const entry of raw.slice(0, 10)) {
      const key = entry.issuer_name;
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
    return certs;
  } catch {
    return [];
  }
}

interface EnrichDomainResult {
  domain: string;
  dns: Record<string, string[]>;
  organization: string | null;
  registrar: string | null;
  created: string | null;
  certificates: CertEntry[];
  tech_stack: string[];
  generated_at: string;
}

// Combine RDAP + DoH + crt.sh + HTTP fingerprint for domain enrichment.
// Shared pipeline — used by both the HTTP endpoint and the MCP tool.
async function enrichDomain(domain: string): Promise<EnrichDomainResult> {
  const startTs = new Date().toISOString();

  // Parallel: RDAP, DoH DNS, certificates, HTTP fingerprint
  const [rdapRes, dnsFp, certs] = await Promise.all([
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
    certificates: certs,
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
  liquidityNum?: number;
  endDate?: string;
  active?: boolean;
}

interface PolymarketMarket {
  question: string;
  slug: string;
  outcomes: string[];
  outcomePrices: number[];
  volume: number;
  liquidity: number;
  endDate: string | null;
  active: boolean;
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

// The Gamma /markets endpoint has no server-side keyword search, so when a
// query is given we pull the top markets by volume and filter client-side.
async function fetchPolymarketMarkets(
  query: string | undefined,
  limit: number,
): Promise<PolymarketMarket[]> {
  const fetchLimit = query ? 100 : limit;
  const url = `${POLYMARKET_URL}?closed=false&limit=${fetchLimit}&order=volume&ascending=false`;

  const res = await fetch(url, { headers: { accept: "application/json" } });
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
    liquidity: m.liquidityNum ?? 0,
    endDate: m.endDate ?? null,
    active: m.active ?? false,
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

interface FundingRate {
  coin: string;
  funding: number;
  fundingAnnualizedPct: number;
  markPx: number;
  oraclePx: number;
  openInterest: number;
  dayNtlVlm: number;
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

  const rates: FundingRate[] = [];
  meta.universe.forEach((u, i) => {
    if (u.isDelisted) return;
    const ctx = ctxs[i];
    if (!ctx) return;
    const funding = parseFloat(ctx.funding);
    rates.push({
      coin: u.name,
      funding,
      fundingAnnualizedPct: Math.round(funding * 24 * 365 * 100 * 10000) / 10000,
      markPx: parseFloat(ctx.markPx),
      oraclePx: parseFloat(ctx.oraclePx),
      openInterest: parseFloat(ctx.openInterest),
      dayNtlVlm: parseFloat(ctx.dayNtlVlm),
    });
  });

  rates.sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
  return rates.slice(0, limit);
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
  pool: string;
  stablecoin: boolean;
}

interface YieldPool {
  project: string;
  chain: string;
  symbol: string;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
  tvlUsd: number;
  stablecoin: boolean;
}

async function fetchDefiYields(
  limit: number,
  project: string | undefined,
  chain: string | undefined,
  stableOnly: boolean,
): Promise<YieldPool[]> {
  const res = await fetch("https://yields.llama.fi/pools", { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`DefiLlama yields upstream error: ${res.status}`);
  }
  const raw = (await res.json()) as { status: string; data: DefiLlamaPool[] };

  const normalized: YieldPool[] = raw.data
    .slice()
    .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
    .map((p) => ({
      project: p.project,
      chain: p.chain,
      symbol: p.symbol,
      apy: p.apy,
      apyBase: p.apyBase,
      apyReward: p.apyReward,
      tvlUsd: p.tvlUsd ?? 0,
      stablecoin: p.stablecoin ?? false,
    }));

  const filtered = normalized.filter((p) => {
    if (project && p.project.toLowerCase() !== project.toLowerCase()) return false;
    if (chain && p.chain.toLowerCase() !== chain.toLowerCase()) return false;
    if (stableOnly && !p.stablecoin) return false;
    return true;
  });

  return filtered.slice(0, limit);
}

app.get("/defi/yields", async (c) => {
  const limitParam = c.req.query("limit");
  let limit = limitParam ? parseInt(limitParam, 10) : 20;
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(limit, 100);
  const project = c.req.query("project") || undefined;
  const chain = c.req.query("chain") || undefined;
  const stable = c.req.query("stable") === "true";

  try {
    const pools = await fetchDefiYields(limit, project, chain, stable);

    console.log(
      JSON.stringify({
        event: "paid_request",
        endpoint: "/defi/yields",
        limit,
        project: project ?? null,
        chain: chain ?? null,
        stable,
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
  confidence: number;
  timestamp: number;
}

const COINGECKO_ID_RE = /^[a-z0-9-]{1,40}$/;

async function fetchTokenPrices(ids: string[]): Promise<TokenPrice[]> {
  const path = ids.map((id) => `coingecko:${id}`).join(",");
  const res = await fetch(`https://coins.llama.fi/prices/current/${path}`, {
    headers: { accept: "application/json" },
  });
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
  // Fetch the target's tool list via MCP JSON-RPC (streamable-http)
  let tools: { name?: string; description?: string; inputSchema?: unknown }[] = [];
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const raw = await res.text();
    // handle both plain JSON and SSE ("data: {...}") framing
    const jsonStr = raw.includes("data:") ? raw.split("data:").pop()!.trim() : raw;
    const parsed = JSON.parse(jsonStr) as { result?: { tools?: typeof tools } };
    tools = parsed.result?.tools ?? [];
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
        "Firmographic + tech-stack enrichment: RDAP registrant/registrar, DNS records, certificate-transparency history, tech-stack fingerprint for a domain. Cost: $0.05 USDC per call via the shared MCP payment gate (the direct HTTP endpoint GET /enrich/domain is $0.01 — MCP tools/call is gated at a flat $0.05 per request today).",
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
