// x402-wrapped fetch: pays the per-call USDC price (e.g. $0.001 /crypto/prices,
// /defi/yields) on Base. The private key is the agent's own wallet; it signs
// the x402 payment. No API key, no account, no subscription.
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

export type PayFetch = (url: string) => Promise<Response>;

let cached: PayFetch | null = null;

/**
 * Build (once) an x402-paying fetch from a hex private key.
 * Returns a plain `fetch` fallback if no key is configured — callers should
 * then only hit the free `/preview` paths (the tools degrade open automatically).
 */
export function makePayFetch(privateKey?: string): PayFetch {
  if (!privateKey) return fetch as unknown as PayFetch;
  if (cached) return cached;
  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer: privateKeyToAccount(privateKey as `0x${string}`),
  });
  cached = wrapFetchWithPayment(fetch, client) as unknown as PayFetch;
  return cached;
}
