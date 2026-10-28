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

// --- Base-RPC read routes: gas-price, block-number, token-balance ---

export declare const BASE_USDC: string;

export interface ReadArgs {
  base?: string;
}
export interface TokenBalanceArgs {
  address: string;
  token?: string;
  base?: string;
}

export interface GasPriceResponse {
  gas_price_wei?: string;
  gas_price_gwei?: number;
  base_fee_gwei?: number | null;
  priority_fee_gwei?: number | null;
  gas_price_usd?: number | null;
  chain?: string;
  note?: string;
  [k: string]: unknown;
}
export interface BlockNumberResponse {
  block_number?: number;
  chain?: string;
  note?: string;
  [k: string]: unknown;
}
export interface TokenBalanceResponse {
  address?: string;
  token?: string;
  symbol?: string;
  name?: string;
  decimals?: number | null;
  balance_raw?: string;
  balance?: number | null;
  balance_formatted?: string | null;
  chain?: string;
  note?: string;
  [k: string]: unknown;
}

export interface GasPriceResult extends GasPriceResponse {
  summary: string;
  paid: boolean;
  activation?: Activation;
  error?: string;
}
export interface BlockNumberResult extends BlockNumberResponse {
  summary: string;
  paid: boolean;
  activation?: Activation;
  error?: string;
}
export interface TokenBalanceResult extends TokenBalanceResponse {
  summary: string;
  paid: boolean;
  activation?: Activation;
  error?: string;
}

export declare function buildGasPriceUrl(args?: ReadArgs): string;
export declare function buildGasPricePreviewUrl(args?: ReadArgs): string;
export declare function buildBlockNumberUrl(args?: ReadArgs): string;
export declare function buildBlockNumberPreviewUrl(args?: ReadArgs): string;
export declare function buildTokenBalanceUrl(args?: TokenBalanceArgs): string;
export declare function buildTokenBalancePreviewUrl(args?: TokenBalanceArgs): string;

export declare function summarizeGasPrice(out: GasPriceResponse): string;
export declare function summarizeBlockNumber(out: BlockNumberResponse): string;
export declare function summarizeTokenBalance(out: TokenBalanceResponse): string;

export declare function runGasPrice(payFetch: PayFetch, args?: ReadArgs, opts?: RunOpts): Promise<GasPriceResult>;
export declare function runBlockNumber(payFetch: PayFetch, args?: ReadArgs, opts?: RunOpts): Promise<BlockNumberResult>;
export declare function runTokenBalance(payFetch: PayFetch, args?: TokenBalanceArgs, opts?: RunOpts): Promise<TokenBalanceResult>;

// --- Market-intelligence routes: perp funding, market brief ---

export interface FundingArgs {
  limit?: number;
  base?: string;
}
export interface BriefArgs {
  base?: string;
}

export interface FundingRow {
  coin?: string;
  funding?: Record<string, number>;
  funding_spread_bps?: number;
  best_long_venue?: string;
  best_short_venue?: string;
  premium?: number;
  annualized_hl?: number;
  annualized_okx?: number;
  signal?: "LONGS_PAY" | "SHORTS_PAY" | "NEUTRAL" | string;
  next_funding_ts?: number;
  markPx?: number;
  oraclePx?: number;
  openInterest?: number;
  dayNtlVlm?: number;
  [k: string]: unknown;
}

export interface MarketBriefResponse {
  fear_greed?: { value: number; classification: string };
  global?: {
    total_market_cap_usd?: number;
    total_volume_24h_usd?: number;
    market_cap_change_24h_pct?: number;
    btc_dominance_pct?: number;
    eth_dominance_pct?: number;
  };
  movers?: { gainers: unknown[]; losers: unknown[] };
  trending?: Array<{ name?: string; symbol?: string }>;
  defi_fees_top?: { total24h_usd?: number; protocols?: Array<{ name: string; fees24h_usd: number }> };
  source?: string;
  ts?: string;
  [k: string]: unknown;
}

export interface FundingResult {
  funding: FundingRow[];
  count: number;
  summary: string;
  paid: boolean;
  total_available?: number;
  activation?: Activation;
  guard_reasons?: string[];
  error?: string;
}
export interface MarketBriefResult extends MarketBriefResponse {
  summary: string;
  paid: boolean;
  activation?: Activation;
  guard_reasons?: string[];
  error?: string;
}

export declare function buildFundingUrl(args?: FundingArgs): string;
export declare function buildFundingPreviewUrl(args?: { base?: string }): string;
export declare function buildMarketBriefUrl(args?: BriefArgs): string;

export declare function summarizeFunding(rows: FundingRow[]): string;
export declare function summarizeMarketBrief(out: MarketBriefResponse): string;

export declare function fetchFundingOrPreview(
  payFetch: PayFetch,
  args?: FundingArgs,
  opts?: RunOpts
): Promise<{ funding: FundingRow[]; paid: boolean; total_available?: number; activation?: Activation }>;

export declare function runFunding(payFetch: PayFetch, args?: FundingArgs, opts?: RunOpts): Promise<FundingResult>;
export declare function runMarketBrief(
  payFetch: PayFetch,
  args?: BriefArgs,
  opts?: { hasKey?: boolean }
): Promise<MarketBriefResult>;

// --- Token-safety route: pre-trade rug/honeypot verdict ---

export declare const DEMO_TOKEN: string;

export interface TokenReportArgs {
  token?: string;
  base?: string;
}

export interface TokenReportResult {
  token?: string;
  verdict: "SAFE" | "CAUTION" | "AVOID" | null | string;
  risk_score: number | null;
  symbol?: string;
  reasons: string[];
  security?: Record<string, unknown>;
  liquidity?: Record<string, unknown>;
  paid: boolean;
  summary: string;
  trial_exhausted?: boolean;
  note?: string;
  paid_url?: string;
  activation?: Activation;
  guard_reasons?: string[];
  error?: string;
}

export declare function buildTokenReportUrl(args?: TokenReportArgs): string;
export declare function buildTokenReportPreviewUrl(args?: TokenReportArgs): string;
export declare function summarizeTokenReport(out: Record<string, unknown>): string;
export declare function runTokenReport(payFetch: PayFetch, args?: TokenReportArgs, opts?: RunOpts): Promise<TokenReportResult>;
