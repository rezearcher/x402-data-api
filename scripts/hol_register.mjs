#!/usr/bin/env node
/**
 * Register Grey Ridge Signals with the HOL Universal Agent Registry.
 *
 *   HEDERA_ACCOUNT_ID=0.0.xxxx HEDERA_PRIVATE_KEY=302e... node scripts/hol_register.mjs
 *
 * HOL's Registry Broker lists an agent on the "Best x402 Payable" discovery
 * surface (104,503+ agents / 15 registries). Registration is an SDK call that
 * authenticates with Hedera ledger credentials (NOT a REST API key) and creates
 * an HCS-11 profile linked to our A2A agent-card + ERC-8004 identity.
 *
 * The deployable core is already live and keyless:
 *   - A2A card:            {BASE}/.well-known/agent-card.json
 *   - ERC-8004 reg file:   {BASE}/.well-known/erc-8004.json
 * so HOL's protocol-detection can already ingest us by URL. This script performs
 * the explicit broker registration (the one step gated on a Hedera account) and
 * pulls the profile fields straight from the LIVE card so nothing drifts.
 *
 * Contract (from hol.org/blog/launch-erc-8004-agent-hol-registry +
 * jentic.com/apis/hol.org/hol-org-registry-broker):
 *   - client.authenticateWithLedgerCredentials({accountId, network, hederaPrivateKey, ...})
 *   - client.registerAgent({profile, communicationProtocol:'a2a', registry, endpoint, metadata})
 *   - client.updateAgent(uaid, { additionalRegistries: ['erc-8004:base'] })  // links on-chain identity
 *   - GET /api/v1/search?q=  // keyless verify
 *
 * Env:
 *   HEDERA_ACCOUNT_ID   (required)  e.g. 0.0.12345
 *   HEDERA_PRIVATE_KEY  (required)  the account's private key
 *   HEDERA_NETWORK      (optional)  mainnet|testnet, default mainnet
 *   AGENT_ENDPOINT      (optional)  A2A URL, default our live card URL
 *   HOL_BASE_URL        (optional)  default https://hol.org/registry/api/v1
 */

const BASE = process.env.PUBLIC_BASE || "https://x402-data-api.sigrunner.workers.dev";
const HOL_BASE_URL = process.env.HOL_BASE_URL || "https://hol.org/registry/api/v1";
const CARD_URL = `${BASE}/.well-known/agent-card.json`;
const ERC8004_URL = `${BASE}/.well-known/erc-8004.json`;

const die = (msg, code = 1) => { console.error("✗ " + msg); process.exit(code); };
const need = (k) => process.env[k] || die(
  `${k} is not set. HOL registration is gated on a free Hedera account (account id + private key), ` +
  `not a REST API key. Create one at https://hol.org/registry/billing (first 5 base registrations free), ` +
  `then: HEDERA_ACCOUNT_ID=0.0.xxxx HEDERA_PRIVATE_KEY=302e... node scripts/hol_register.mjs`);

const accountId = need("HEDERA_ACCOUNT_ID");
const hederaPrivateKey = need("HEDERA_PRIVATE_KEY");
const networkName = process.env.HEDERA_NETWORK || "mainnet";
const endpoint = process.env.AGENT_ENDPOINT || CARD_URL;

// ---- load the SDK lazily so the repo needs no dependency until you register ----
let sdk;
try {
  sdk = await import("@hashgraphonline/standards-sdk");
} catch {
  die("The HOL SDK is not installed. Run:  npm i @hashgraphonline/standards-sdk  (then re-run this script).");
}
const { RegistryBrokerClient, ProfileType, AIAgentType, AIAgentCapability } = sdk;

// ---- pull the profile from the LIVE agent-card so it never drifts from the API ----
const card = await fetch(CARD_URL).then((r) => r.json()).catch(() => die(`could not fetch ${CARD_URL}`));
const tags = Array.from(new Set((card.skills || []).flatMap((s) => s.tags || []))).slice(0, 20);

const profile = {
  version: "1.0",
  type: ProfileType?.AI_AGENT ?? "ai_agent",
  display_name: card.name || "Grey Ridge Signals — x402 Data & Security API",
  alias: "grey-ridge-signals",
  bio: card.description || "Agent-native pay-per-call data & pre-trade token safety on Base (USDC via x402).",
  properties: { tags, url: BASE, erc8004: ERC8004_URL },
  aiAgent: {
    type: AIAgentType?.AUTONOMOUS ?? "autonomous",
    model: "n/a",
    // Our headline capabilities: on-chain data + pre-trade security analysis.
    capabilities: [
      AIAgentCapability?.DATA_INTEGRATION ?? "data_integration",
      AIAgentCapability?.SECURITY ?? "security",
    ],
    creator: card.provider?.name || "Grey Ridge Signals Group LLC",
  },
};

console.log(`→ registering with HOL Registry Broker (${HOL_BASE_URL})`);
console.log(`  account=${accountId} network=hedera:${networkName}`);
console.log(`  a2a endpoint=${endpoint}`);
console.log(`  erc-8004 identity=${ERC8004_URL}`);

const client = new RegistryBrokerClient({ baseUrl: HOL_BASE_URL });
await client.authenticateWithLedgerCredentials({
  accountId,
  network: `hedera:${networkName}`,
  hederaPrivateKey,
  expiresInMinutes: 30,
  label: "grey-ridge-x402",
});

const registration = await client.registerAgent({
  profile,
  communicationProtocol: "a2a",
  registry: "hashgraph-online",
  endpoint,
  metadata: { provider: profile.aiAgent.creator, version: card.version || "0.1.0" },
});

// registerAgent is async on the broker side — poll if an attemptId came back.
if (registration?.attemptId && typeof client.waitForRegistrationCompletion === "function") {
  console.log(`  attemptId=${registration.attemptId} — waiting for completion…`);
  try { await client.waitForRegistrationCompletion(registration.attemptId); } catch (e) { console.warn("  (poll warning) " + (e?.message || e)); }
}

const uaid = registration?.uaid || registration?.agentId;
if (!uaid) die("registration returned no uaid — response: " + JSON.stringify(registration).slice(0, 400));
console.log(`✓ registered — UAID=${uaid}`);

// ---- link the ERC-8004 on-chain identity (base-sepolia today; base mainnet when HOL enables it) ----
const erc8004Registry = process.env.ERC8004_REGISTRY_ID || "erc-8004:base";
try {
  await client.updateAgent(uaid, { additionalRegistries: [erc8004Registry] });
  console.log(`✓ linked ERC-8004 registry: ${erc8004Registry}`);
} catch (e) {
  console.warn(`  (ERC-8004 link skipped — ${erc8004Registry} may not be enabled yet: ${e?.message || e})`);
  console.warn("  Available today: erc-8004:base-sepolia, erc-8004:ethereum-sepolia. Set ERC8004_REGISTRY_ID to override.");
}

// ---- keyless verify ----
try {
  const found = await fetch(`${HOL_BASE_URL}/search?q=grey+ridge`).then((r) => r.json());
  const hit = JSON.stringify(found).toLowerCase().includes("grey");
  console.log(hit ? "✓ verify: our agent is searchable on HOL" : "… verify: not indexed yet (search may lag registration)");
} catch (e) {
  console.warn("  (verify skipped) " + (e?.message || e));
}

console.log("\nDone. Listed on the HOL Universal Agent Registry — the 'Best x402 Payable' discovery surface.");
