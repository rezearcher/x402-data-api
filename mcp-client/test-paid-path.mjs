// test-paid-path.mjs
// Proves wrapFetchWithPayment (paid path) against a local mock that speaks
// the real x402 V2 protocol:
//   1. first request  -> 402 + PAYMENT-REQUIRED header (base64 JSON manifest)
//   2. retry with PAYMENT-SIGNATURE header -> mock decodes/validates payload -> 200
// Also covers: non-402 passthrough, and a permanently-402 endpoint (payment rejected).
import http from "node:http";
import assert from "node:assert/strict";
import { wrapFetchWithPayment } from "@x402/fetch";

const PAY_TO = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"; // well-known XRPL testnet key

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (code, obj, extra = {}) => {
    res.writeHead(code, { "content-type": "application/json", ...extra });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === "/free") {
    return json(200, { ok: true, free: true });
  }

  if (url.pathname === "/test-bad") {
    // Always demands payment, even with a valid signature -> payment rejected.
    return json(402, { error: "payment required" }, {
      "payment-required": Buffer.from(JSON.stringify(PAYMENT_REQUIRED)).toString("base64"),
    });
  }

  if (url.pathname === "/test") {
    const sig = req.headers["payment-signature"];
    if (!sig) {
      // First request: demand payment.
      return json(402, { error: "payment required" }, {
        "payment-required": Buffer.from(JSON.stringify(PAYMENT_REQUIRED)).toString("base64"),
      });
    }
    // Retry: decode and validate the payment payload for real.
    let payload;
    try {
      payload = JSON.parse(Buffer.from(sig, "base64").toString("utf8"));
    } catch {
      return json(402, { error: "malformed payment signature" });
    }
    const accepted = payload?.accepted ?? {};
    const valid =
      payload?.x402Version === 2 &&
      accepted.scheme === "https" &&
      accepted.network === "xrpl" &&
      accepted.amount === "1" &&
      accepted.asset === "XRP" &&
      accepted.payTo === PAY_TO;
    if (!valid) {
      return json(402, { error: "invalid payment payload" });
    }
    return json(200, { ok: true, paid: true, accepted });
  }

  return json(404, { error: "not found" });
});

let port;
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
port = server.address().port;

const PAYMENT_REQUIRED = {
  x402Version: 2,
  resource: { url: `http://127.0.0.1:${port}/test` },
  accepts: [{
    scheme: "https",
    network: "xrpl",
    amount: "1",
    asset: "XRP",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
  }],
};

// Stub wallet client: simulates a registered x402 scheme without real keys.
let payloadsCreated = 0;
const stubClient = {
  async createPaymentPayload(paymentRequired) {
    payloadsCreated += 1;
    return {
      x402Version: 2,
      accepted: paymentRequired.accepts[0],
      payload: { nonce: `test-${payloadsCreated}`, ts: Date.now() },
    };
  },
  async handlePaymentResponse(_ctx) {
    return { recovered: false }; // no settle/recovery flow in this stub
  },
};

const wrappedFetch = wrapFetchWithPayment(fetch, stubClient);

// 1. Paid path: 402 -> PAYMENT-SIGNATURE retry -> 200
{
  const res = await wrappedFetch(`http://127.0.0.1:${port}/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hello: "world" }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, "paid request should return 200");
  assert.equal(body.ok, true, "mock should have accepted the payment payload");
  assert.equal(body.accepted.payTo, PAY_TO, "mock echoed the accepted payTo");
  assert.equal(payloadsCreated, 1, "createPaymentPayload called exactly once on happy path");
}

// 2. Passthrough: non-402 responses are returned untouched (no payment attempted)
{
  const res = await wrappedFetch(`http://127.0.0.1:${port}/free`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.free, true);
  assert.equal(payloadsCreated, 1, "no payment payload created for passthrough");
}

// 3. Rejected: server keeps returning 402 -> wrapped fetch surfaces the 402
{
  const res = await wrappedFetch(`http://127.0.0.1:${port}/test-bad`);
  assert.equal(res.status, 402, "unresolved 402 must surface to the caller");
  assert.equal(payloadsCreated, 2, "one payload created for the rejected attempt");
}

// 4. Error path: createPaymentPayload failure propagates with context
{
  const failing = wrapFetchWithPayment(fetch, {
    ...stubClient,
    async createPaymentPayload() {
      throw new Error("no wallet registered for scheme https/xrpl");
    },
  });
  await assert.rejects(
    () => failing(`http://127.0.0.1:${port}/test`),
    /Failed to create payment payload: no wallet registered/,
    "payload creation errors should wrap with context"
  );
}

server.close();
console.log("PASS: paid path (402 -> PAYMENT-SIGNATURE -> 200), passthrough, rejection, and error path all verified");
