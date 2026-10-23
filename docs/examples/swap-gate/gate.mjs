// Check a Base token before your agent buys it. Pays $0.008 USDC via x402.
// Free, no-wallet sample first: curl https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=degen
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(process.env.PRIVATE_KEY) });
const payFetch = wrapFetchWithPayment(fetch, client);

const [token, side = "buy", usd = "100"] = process.argv.slice(2);
const res = await payFetch(`https://x402-data-api.sigrunner.workers.dev/gate/swap?token=${token}&side=${side}&notional_usd=${usd}`);
const out = await res.json();
// { decision: "go"|"hold"|"block", reason, verdict, risk_score, liquidity_usd, flags,
//   sizing: {                                  // the paid add — absent from the free preview
//     max_safe_notional_usd,                   // largest order under 2% price impact; split above this
//     this_trade: { price_impact_pct },
//     exit_sim: {                              // bounds your worst-case loss BEFORE you buy
//       this_trade: { net_recovered_usd, lost_to_slippage_usd, slippage_pct },
//       tiers: [ { notional_usd, net_recovered_usd, lost_to_slippage_usd, slippage_pct } ]  // $100/$1k/$10k/$50k
//     } } }
console.log(JSON.stringify(out, null, 2));
if (out.decision !== "go") process.exit(1); // guard: skip the trade

// Size the position off the exit simulation: don't enter a trade you can't exit cheaply.
const ex = out.sizing?.exit_sim?.this_trade;
if (ex && ex.slippage_pct > 10) {
  console.error(`exit slippage ${ex.slippage_pct}% on $${usd} — recover only $${ex.net_recovered_usd}; skipping`);
  process.exit(1);
}
