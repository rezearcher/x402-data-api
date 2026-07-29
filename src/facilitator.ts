import { HTTPFacilitatorClient } from "@x402/core/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";

/**
 * CDP-authenticated facilitator client factory.
 * Creates an HTTPFacilitatorClient wired to the CDP x402 facilitator endpoint
 * with JWT authentication headers minted from CDP API credentials.
 *
 * @param apiKeyId - CDP API Key ID (env: CDP_API_KEY_ID)
 * @param apiKeySecret - CDP API Key Secret (env: CDP_API_KEY_SECRET)
 * @returns A function that returns auth headers for verify/settle/supported paths
 */
function makeCdpAuthHeaders(
  apiKeyId: string,
  apiKeySecret: string,
): () => Promise<{ verify: Record<string, string>; settle: Record<string, string>; supported: Record<string, string> }> {
  const mk = async (path: string, method: "GET" | "POST") => {
    const jwt = await generateJwt({
      apiKeyId,
      apiKeySecret,
      requestMethod: method,
      requestHost: "api.cdp.coinbase.com",
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

/**
 * Creates an HTTPFacilitatorClient for CDP Bazaar settlement with JWT auth.
 *
 * @param apiKeyId - CDP API Key ID
 * @param apiKeySecret - CDP API Key Secret
 * @returns HTTPFacilitatorClient pointing to CDP x402 facilitator endpoint
 */
export function createCdpFacilitator(
  apiKeyId: string,
  apiKeySecret: string,
): HTTPFacilitatorClient {
  const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
  return new HTTPFacilitatorClient({
    url: CDP_FACILITATOR_URL,
    createAuthHeaders: makeCdpAuthHeaders(apiKeyId, apiKeySecret),
  });
}
