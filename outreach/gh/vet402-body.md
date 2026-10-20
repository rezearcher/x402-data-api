Hi — vet402 looks like exactly the right independent check for sellers. We run a Base x402 seller (`api.greyridgesignals.ai`, 24 routes, $0.002–$0.05, payTo `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10`) and a search of `rank.json` (10,059 attempts) finds no record for our host.

Two asks:
1. How does vet402 pick sellers to buy from (Bazaar discovery? a submit list?). If there's a way to be queued, please add us — we'd rather have an outside delivery record than self-reported uptime.
2. Cheapest routes to include, all JSON, no setup: `GET /chain/block-number`, `GET /chain/gas-price`, `POST /v1/chat/completions` ($0.002), `GET /gate/swap?token=<0x>` ($0.008). Full manifest: https://api.greyridgesignals.ai/.well-known/x402 (free previews: `/gate/swap/preview?token=degen`).

If any call settles without a usable body, we want to know — please open an issue with the receipt. Thanks.
