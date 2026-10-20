---
title: Honeypot check API for Base tokens
---
# Honeypot check API for Base tokens

/chain/token-report simulates a sell on-chain (eth_simulateV1) and reports isHoneypot, sellable, measured transferTaxBps, owner-renounced, upgradeable-proxy, mint/pause/blacklist capability and Uniswap v3 WETH-pool liquidity, then folds them into a verdict and risk_score.

Real response for WETH (captured 2026-10-20):

    {"token_meta":{"symbol":"WETH"},"security":{"isHoneypot":false,"sellable":true,"transferTaxBps":0,"canMint":false,"canPause":false,"hasBlacklist":false,"simStatus":"tested"},"verdict":"SAFE","risk_score":0}

Try any Base token for free:

    curl "https://x402-data-api.sigrunner.workers.dev/chain/token-report/preview?token=0xYourBaseToken"

Limits, stated plainly: DEX buy/sell tax (buyTaxBps/sellTaxBps) is not measured, only the transfer fee. Base only. Heuristic signal, not financial advice.

[Back](index.html)
