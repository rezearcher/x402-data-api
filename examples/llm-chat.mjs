// Grey Ridge x402 — minimal runnable LLM buyer (POST /v1/chat/completions).
//
// Every other example here is a GET data route. This is the one the *compute*
// buyers need: an OpenAI-compatible chat completion that signs + settles USDC on
// Base inline via x402. No API key, no account, no gas ETH (EIP-3009 gasless).
// Llama 3.3 70B fp8 on Workers AI at $0.002/call; pass model=llama-3.2-3b-instruct
// for the cheap small model.
//
//   npm i x402-fetch viem
//   EVM_PRIVATE_KEY=0xYOURKEY node examples/llm-chat.mjs "What is the Base chain id?"
//
// Preview first — no wallet needed, real model, 3 free 70B calls/day/IP:
//   curl -s -X POST "https://x402-data-api.sigrunner.workers.dev/v1/chat/completions/preview" \
//     -H 'content-type: application/json' \
//     -d '{"messages":[{"role":"user","content":"hi"}]}'
//
// ── Using Grey Ridge as a drop-in x402 LLM fallback in a Daydreams / Lucid-Agents agent ──
// Agents in that ecosystem wrap an x402 LLM provider around a router base URL (e.g.
// taggaverse/ai-trading-agent's X402LLMProvider reads DREAMS_ROUTER_URL). Because this
// endpoint speaks the standard x402 402-challenge flow (accepts[] with scheme=exact,
// network=eip155:8453, USDC asset) and the OpenAI /v1/chat/completions shape, you can
// point that provider straight at us for a cheap Base-USDC fallback:
//
//   DREAMS_ROUTER_URL=https://x402-data-api.sigrunner.workers.dev   # base; it POSTs to /v1/chat/completions
//   model=llama-3.3-70b                                             # our model id (not provider/model)
//
// Any standard x402 client works: x402-fetch, @x402/fetch, Cloudflare withX402Client,
// or Daydreams' own generateX402Payment X-PAYMENT header.

import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { wrapFetchWithPayment } from "x402-fetch";

const BASE = process.env.X402_BASE_URL || "https://x402-data-api.sigrunner.workers.dev";
const MODEL = process.env.X402_MODEL || "llama-3.3-70b"; // or llama-3.2-3b-instruct
const PROMPT = process.argv.slice(2).join(" ") || "In one sentence, what is EIP-3009?";

const body = JSON.stringify({ model: MODEL, messages: [{ role: "user", content: PROMPT }] });

const key = process.env.EVM_PRIVATE_KEY;
if (!key) {
  console.error("Set EVM_PRIVATE_KEY (a 0x Base EOA holding USDC). Or preview first, no wallet needed:");
  console.error(`  curl -s -X POST "${BASE}/v1/chat/completions/preview" -H 'content-type: application/json' -d '${body}'`);
  process.exit(1);
}

const account = privateKeyToAccount(key);
const walletClient = createWalletClient({ account, chain: base, transport: http() });

// wrapFetchWithPayment(fetch, walletClient) — 2nd arg is a viem WalletClient, NOT a bare account.
const f = wrapFetchWithPayment(fetch, walletClient);

const url = `${BASE}/v1/chat/completions`;
console.error(`→ paying + calling ${url}  model=${MODEL}  (payer ${account.address})`);
const r = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body });
console.error(`← HTTP ${r.status}`);
const j = await r.json();
console.log(j?.choices?.[0]?.message?.content ?? JSON.stringify(j, null, 2));
