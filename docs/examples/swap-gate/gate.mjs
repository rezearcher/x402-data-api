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
const out = await res.json(); // { decision: "go"|"hold"|"block", reason, verdict, risk_score, flags, ... }
console.log(out);
if (out.decision !== "go") process.exit(1); // guard: skip the trade
