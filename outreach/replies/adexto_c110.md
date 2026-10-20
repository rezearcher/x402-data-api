Thanks — noted. To make the evaluation zero-effort, here is the fallback lane as a drop-in (OpenAI-compatible, $0.002/call USDC on Base, Llama 3.3 70B with a 3B fallback):

```ts
// try your primary provider; on error/timeout, fall back to the x402 lane
const BASE = "https://x402-data-api.sigrunner.workers.dev";
const res = await fetchWithPayment(`${BASE}/v1/chat/completions`, {   // x402-fetch wrapFetchWithPayment
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "llama-3.3-70b", messages }),
});
```

- Free shape check (no payment, no model run): `POST ${BASE}/v1/chat/completions/preview`
- Model list: `GET ${BASE}/v1/models`
- Unpaid call returns a standard 402 with payTo/amount, so any x402 client works unchanged.

If you tell me the model/latency you need for the fallback lane I'll check it against that before you spend anything.
