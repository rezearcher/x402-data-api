/** Handler-owned success contracts for the gas and wallet routes only.
 * JSON Schema is used by Bazaar; OpenAPI 3.0 uses nullable instead of type unions.
 * Additional response fields (including the free preview's note) remain allowed.
 */
const decimalQuantity = { type: "string", pattern: "^[0-9]+$" } as const;
const nonnegativeAmount = { type: "number", minimum: 0 } as const;
const nullableNumber = { type: ["number", "null"] } as const;
const baseChain = { type: "string", enum: ["base"] } as const;

function successSchema(properties: Record<string, unknown>) {
  return { type: "object", required: Object.keys(properties), additionalProperties: true, properties };
}

export const GAS_SUCCESS_SCHEMA = successSchema({
  gas_price_wei: decimalQuantity,
  gas_price_gwei: nonnegativeAmount,
  base_fee_gwei: nullableNumber,
  priority_fee_gwei: nullableNumber,
  gas_price_usd: nullableNumber,
  chain: baseChain,
});

export const WALLET_SUCCESS_SCHEMA = successSchema({
  address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
  balance_wei: decimalQuantity,
  balance_eth: nonnegativeAmount,
  balance_usd: nullableNumber,
  // Nonces must remain safe integers for JSON consumers.
  tx_count: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  is_contract: { type: "boolean" },
  is_eip7702_delegate: { type: "boolean" },
  delegate_address: { type: ["string", "null"] },
  chain: baseChain,
});

export function toOpenApiSuccess(schema: ReturnType<typeof successSchema>) {
  return {
    ...schema,
    properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => {
      const property = value as { type: string | readonly string[] };
      return [key, Array.isArray(property.type)
        ? { ...property, type: property.type.find((t) => t !== "null"), nullable: true }
        : { ...property }];
    })),
  };
}

/** Validate the complete RPC quantity before BigInt/Number can coerce it. */
export function parsePrimaryQuantity(value: unknown, method: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`Invalid ${method} result`);
  }
  return BigInt(value);
}

export function primaryAmount(wei: bigint, scale: number, method: string): number {
  const amount = Number(wei) / scale;
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid ${method} result`);
  return amount;
}

export function parseWalletNonce(value: unknown): number {
  const count = Number(parsePrimaryQuantity(value, "eth_getTransactionCount"));
  if (!Number.isSafeInteger(count)) throw new Error("Invalid eth_getTransactionCount result");
  return count;
}

/** Do not change classifyCode's other consumers. A delegation is exactly 23 bytes. */
export function parseWalletCode(value: unknown): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(value)
      || (value.toLowerCase().startsWith("0xef0100") && value.length !== 48)) {
    throw new Error("Invalid eth_getCode result");
  }
  return value;
}

export function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

export function optionalFeeGwei(value: unknown): number | null {
  try {
    return primaryAmount(parsePrimaryQuantity(value, "eth_feeHistory"), 1e9, "eth_feeHistory");
  } catch {
    return null;
  }
}

/** Paid and preview gas responses must share both construction and validation. */
export function gasSuccess(value: unknown, fees: { base_fee_gwei: number | null; priority_fee_gwei: number | null }, ethUsd: number | null) {
  const wei = parsePrimaryQuantity(value, "eth_gasPrice");
  const gwei = primaryAmount(wei, 1e9, "eth_gasPrice");
  return {
    gas_price_wei: wei.toString(),
    gas_price_gwei: gwei,
    base_fee_gwei: fees.base_fee_gwei,
    priority_fee_gwei: fees.priority_fee_gwei,
    gas_price_usd: finiteOrNull(ethUsd !== null ? Number(wei) / 1e18 * ethUsd : null),
    chain: "base" as const,
  };
}
