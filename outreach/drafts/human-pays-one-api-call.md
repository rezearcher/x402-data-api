x402 solved payments for agents. An agent hits a paid endpoint, gets back an HTTP 402 with a challenge, signs an EIP-3009 gasless USDC authorization on Base, retries, and the call goes through. The `x402-fetch` client does all of it automatically. No account, no key, no invoice. For software, it is clean.

For a human, it is a wall. A person who just wants one answer out of the API has no `x402-fetch` client in their hands and no reason to install one. The 402 challenge is machine-readable, not human-clickable. So we had an API that software could pay for and a person could not, which is a strange place to be when the thing you sell is a single decision someone wants before they click "swap."

I wanted to close that gap without building the thing everyone defaults to: accounts, a billing portal, a card form, a password to reset later. That is a lot of surface to maintain so a stranger can buy one 0.01 USDC answer. So the version we shipped has none of it.

## What a human actually does now

On the token-safety page, there is a button: "Unlock sized trade check — pay 0.01 USDC." You click it. Your own Base wallet opens (Coinbase Wallet, Rabby, MetaMask on Base, or the in-feed wallet if you are in a Farcaster frame). It asks you to confirm a single USDC transfer. You confirm. A few seconds later the full result is on the page.

That is the whole flow. No email, no signup, no key to store, no subscription. The money moves straight from the visitor's wallet to ours, and the result comes back.

Under the button, the payment is an ordinary ERC-20 transfer. The call data is the `transfer(address,uint256)` selector `0xa9059cbb`, our receiving address, and an amount of `10000` — which at USDC's six decimals is exactly 0.01 USDC. The wallet is asked to switch to chain `0x2105` (Base mainnet, 8453) first. There is no custom contract in the middle and nothing to approve ahead of time. It is the same transfer your wallet already knows how to do.

## How the server trusts a payment it did not broker

The interesting part is the back half. When you pay through a facilitator, the facilitator vouches for the payment. Here there is no facilitator in the human path — the browser just sent a plain transfer — so the server has to verify the money itself, from the chain, before it hands over anything.

The page calls back to `/gate/swap/unlock` with the transaction hash. The server pulls the receipt with `eth_getTransactionReceipt` and refuses to serve until all of this holds:

- the transaction is actually mined (not pending), and its status is success, not reverted;
- one of its logs is a USDC `Transfer` event, emitted by the real USDC contract on Base;
- the recipient in that event is our receiving wallet;
- the amount is at least 0.01 USDC.

Only a transfer that clears every one of those checks unlocks the result. A made-up hash, a reverted transaction, a transfer to the wrong address, or a transfer that is a hair too small all come back as a 402 or a plain error. Nothing is served on the strength of the caller's word.

If the transaction is on-chain but not yet confirmed, the endpoint answers 202 and the page quietly polls for about forty seconds until Base catches up. And because the hash gets written into the URL as you pay, you can close the tab mid-confirmation, reopen the link later, and the unlock finishes from where it left off.

## Paid once, not paid forever

A naive version of this leaks. If one settled payment unlocked the endpoint for good, a single transaction hash would be a password anyone could replay for unlimited free results. So an unlock is single-use: the server records the transaction hash the first time it is redeemed and rejects it on every later attempt, with a 30-day memory. One payment, one result.

There is a deliberate exception. If the key-value store that tracks redeemed hashes is unavailable, the check degrades open rather than locking every paying customer out. The failure mode we chose is "a determined person might replay a hash they already paid for," not "a paying customer gets nothing." For a 0.01 USDC product, that is the right side to fail on.

## What the 0.01 actually buys

The free version of the token check already shows the honeypot verdict and the pool liquidity. Charging for that again would be insulting. The paid unlock adds the thing the free teaser does not: sizing. It takes the measured Uniswap v3 WETH-pool liquidity and tells you the largest order you can place while staying under roughly 2% price impact, plus the impact at $100, $1k, $10k, and $50k against that specific pool. It is the difference between "this token is sellable" and "here is how much of it you can move before the pool eats your trade."

No extra RPC calls go into that — it is arithmetic over liquidity the server already measured — so the paid answer is not slower than the free one. It is just the part you would otherwise have to work out yourself.

## Two doors, same room

The agent door never changed. Automated traders still hit `/gate/swap` over x402 at 0.008 USDC a call and get the same gate, signed and retried by their client. The browser unlock is the second door into the same room, for the person who has a wallet and a question but no agent and no patience for a signup.

If you want to see the human side, there is a manual fallback that gives the whole trick away: send 0.01 USDC on Base to our receiving wallet yourself, then load the unlock URL with your transaction hash on the end. The server verifies it exactly the same way the button does, because the button is only sugar over that URL. Pay-per-call, no account, settled on-chain and checked on-chain.
