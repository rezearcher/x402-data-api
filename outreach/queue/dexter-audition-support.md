To: branch@dexter.cash
Subject: x402gle audition: "could not settle a test payment" for x402-data-api.sigrunner.workers.dev

Hi Branch,

We ran `opendexter audition` on https://x402-data-api.sigrunner.workers.dev: 20 paid routes registered and show on x402gle (skills.json live). Endpoint-level paid tests (/gate/swap, /chain/token-report, /chain/token-security) all return auditOutcome=incomplete: "OpenDexter could not settle a test payment on a chain this route accepts." Our routes accept USDC on Base (eip155:8453, exact scheme, CDP facilitator). Two questions: is the verifier funded on Base mainnet, and can you recover/retry the saved attempts? Also https://api.greyridgesignals.ai (same Worker, custom domain) returns discovery_failed "No OpenAPI or well-known/x402 document found" though /openapi.json and /.well-known/x402 are 200; any idea why?

Thanks — Grey Ridge Signals, contact@greyridgesignals.ai
