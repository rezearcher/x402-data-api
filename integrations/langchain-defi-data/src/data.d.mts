// Types for the dependency-free core (data.mjs).

export declare const DATA_BASE: string;

export interface YieldArgs {
  limit?: number;
  project?: string;
  chain?: string;
  stable?: boolean | "true";
  sort?: "tvl" | "risk_adjusted" | string;
  base?: string;
}

export interface PricesArgs {
  coins: string | string[];
  base?: string;
}

export interface BalanceArgs {
  address: string;
  base?: string;
}

export interface Activation {
  needed: boolean;
  mode: "free_preview";
  reason: string;
  hint: string;
  paid_url?: string;
  price_usdc: string;
}

export interface YieldPool {
  project?: string;
  chain?: string;
  symbol?: string;
  pool?: string;
  apy?: number;
  apyBase?: number | null;
  apyReward?: number | null;
  tvlUsd?: number;
  stablecoin?: boolean;
  ilRisk?: string;
  exposure?: string;
  risk_adjusted_apy?: number;
  predicted_probability?: number;
  [k: string]: unknown;
}

export interface TokenPrice {
  id: string;
  symbol: string;
  price: number;
  change_24h: number | null;
  confidence: number;
  timestamp: number;
}

export interface BalanceResponse {
  address?: string;
  balance_wei?: string;
  balance_eth?: number;
  balance_usd?: number | null;
  chain?: string;
  [k: string]: unknown;
}

export interface YieldsResult {
  yields: YieldPool[];
  count: number;
  summary: string;
  paid: boolean;
  total_available?: number;
  activation?: Activation;
  guard_reasons?: string[];
  error?: string;
}

export interface PricesResult {
  prices: TokenPrice[];
  summary: string;
  paid: boolean;
  activation?: Activation;
  guard_reasons?: string[];
  error?: string;
}

export interface BalanceResult extends BalanceResponse {
  summary: string;
  paid: boolean;
  activation?: Activation;
  guard_reasons?: string[];
  error?: string;
}

export type PayFetch = (url: string) => Promise<Response>;
export interface RunOpts {
  hasKey?: boolean;
  previewFetch?: typeof fetch;
}

export declare function normalizeCoins(coins: string | string[]): string[];
export declare function buildYieldsUrl(args?: YieldArgs): string;
export declare function buildYieldsPreviewUrl(args?: { base?: string }): string;
export declare function buildPricesUrl(args?: PricesArgs): string;
export declare function buildPricesPreviewUrl(args?: PricesArgs): string;
export declare function buildBalanceUrl(args?: BalanceArgs): string;

export declare function summarizeYields(rows: YieldPool[]): string;
export declare function summarizePrices(rows: TokenPrice[]): string;
export declare function summarizeBalance(out: BalanceResponse): string;
export declare function fundOnrampHint(): string;

export declare function fetchYieldsOrPreview(
  payFetch: PayFetch,
  args?: YieldArgs,
  opts?: RunOpts
): Promise<{ yields: YieldPool[]; paid: boolean; total_available?: number; activation?: Activation }>;
export declare function fetchPricesOrPreview(
  payFetch: PayFetch,
  args?: PricesArgs,
  opts?: RunOpts
): Promise<{ prices: TokenPrice[]; paid: boolean; activation?: Activation }>;

export declare function runYields(payFetch: PayFetch, args?: YieldArgs, opts?: RunOpts): Promise<YieldsResult>;
export declare function runPrices(payFetch: PayFetch, args?: PricesArgs, opts?: RunOpts): Promise<PricesResult>;
export declare function runBalance(
  payFetch: PayFetch,
  args?: BalanceArgs,
  opts?: { hasKey?: boolean }
): Promise<BalanceResult>;
