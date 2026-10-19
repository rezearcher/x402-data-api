# B3 OS x402 endpoint catalog (api.b3os.org)
B3 OS runs a public x402 endpoint catalog (GET https://api.b3os.org/v1/x402-endpoints, 100+ items) used by its workflow/agent builder. POST /v1/x402-endpoints/import probes, PAYS from the org's Turnkey wallet (external money), and lists the endpoint. Probe/import need an Authorization header, so it needs a b3os.org account.
Steps for Rez: sign up at b3os.org, create an API key, put it in ~/.hermes/.env as B3OS_API_KEY. Then POST /v1/x402-endpoints/import for /chain/token-report, /gate/swap, /crypto/prices, /defi/yields (url + method GET).
Check afterwards: GET /v1/x402-endpoints/by-url?url=<route> should return exists:true.
Why: their test/import calls are paid by B3's wallet, not ours, and listed endpoints get used by B3 workflow builders.
