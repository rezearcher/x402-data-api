import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Environment bindings
// ---------------------------------------------------------------------------

type Env = {
  PAY_TO: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NETWORK = "eip155:8453" as const; // Base mainnet
// Non-custodial facilitator — no Coinbase/CDP API key needed.
const FACILITATOR_URL = "https://facilitator.xpay.sh";
const DOH_URL = "https://cloudflare-dns.com/dns-query";
const RDAP_URL = "https://rdap.org/domain";

// ---------------------------------------------------------------------------
// App factory — called fresh per Worker request (Hono is stateless)
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Free health endpoint
// ---------------------------------------------------------------------------

app.get("/health", (c) => c.json({ ok: true }));

// ---------------------------------------------------------------------------
// 402index.io domain-ownership verification (static hash file)
// ---------------------------------------------------------------------------

app.get("/.well-known/402index-verify.txt", (c) =>
  c.text("619f23496d826b50e86afc72eaae3aa523868d4dba61161bfdb8640e88d4f4a5"),
);

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
// Lazy init: resourceServer.initialize() fetches supported-kinds from the
// facilitator. In CF Workers, outbound fetch is only available during request
// handling, so we cache a single init promise and await it on first request.
// ---------------------------------------------------------------------------

let initPromise: Promise<void> | null = null;

function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = resourceServer.initialize();
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
  await ensureInitialized();

  if (!cachedMiddleware) {
    const routes = makeRoutes(c.env.PAY_TO);
    cachedMiddleware = paymentMiddleware(
      routes,
      resourceServer,
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
