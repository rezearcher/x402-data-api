Most "pay to unlock" buttons on the web run on the honor system. The front-end flips a flag, the flag says paid, and the content appears. Anyone with devtools, or a compromised CDN serving your JavaScript, can set that flag without spending a cent. For a free newsletter that is fine. For something that gates a paid result, it is a hole you can drive a truck through.

We just shipped a one-tap payment button on our token-safety checker, and the interesting part is not the button. It is what the server refuses to believe.

## What the button does

Open a token result at `/check?token=0x...` and there is a single button that opens Base Pay. One tap sends 0.01 USDC on Base to our receiving wallet. The client code is about as small as it gets:

    var m = await import('https://esm.sh/@base-org/account@2.5.13');
    var res = await m.pay({ amount: '0.01', to: PAY_TO, testnet: false });
    var id = res.id || res.transactionHash;

No account, no email, no chain-switch dance for the user. If Base Pay is not available, the same button falls back to a plain `window.ethereum` transfer so nobody gets locked out. Either path ends the same way: the browser now holds a transaction hash.

Here is the thing. That hash, and the word "paid," are coming from code running on the user's machine. We do not trust either one.

## Why the hash is not proof

A transaction hash is a claim, not a receipt. The user could hand us a hash from some unrelated transfer, a hash for 0.0001 USDC instead of 0.01, a hash to the wrong address, or a hash for a transaction that reverted. A tampered copy of our own script could fabricate one. If the server unlocked on the hash alone, every one of those would walk right through.

So before the client even gets to send the hash, we gate it on shape: it has to match `^0x[0-9a-fA-F]{64}$`. That throws out garbage early. It proves nothing about payment.

The real check happens server-side, and it reads the chain itself.

## What the server actually verifies

When the unlock endpoint gets a hash, it pulls the transaction receipt straight from a Base RPC node with `eth_getTransactionReceipt`. Then it walks the logs looking for one specific event, and it will not unlock until it finds it:

1. The transaction mined and succeeded. `receipt.status` has to be `0x1`. A reverted transaction fails here, even if it exists.
2. The log came from the real USDC contract on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`). A transfer of some lookalike token does not count.
3. The event is an ERC-20 `Transfer`, matched by its topic hash `0xddf252ad...`.
4. The recipient is our wallet, compared against the padded `to` address in the log topic. A payment to anyone else is invisible to us.
5. The amount is at least 0.01 USDC, decoded from the log data.

Only when a single log clears all five does the server read the payer address out of the `from` topic and unlock the result. If the hash is not mined yet, the endpoint returns a 202 and the page quietly polls for a few seconds until Base catches up. If no qualifying transfer is ever found, it returns a 402 with the exact instructions to pay, pulled from ground truth rather than hardcoded in the page.

None of this trusts the front-end. You could rewrite our entire client script to scream "PAID" in red letters and the server would still go read the chain and find nothing.

## Pay once, unlock once

There is one more thing a naive version gets wrong: replay. If a single real payment unlocked results forever, one person pays 0.01 USDC once and then checks ten thousand tokens free. So each verified hash gets written to a key, `unlock:<tx>`, the moment it is redeemed, with a 30-day lifetime. A second attempt to cash the same transaction comes back 409, already redeemed. One payment, one result.

If that store is unavailable for some reason, the gate degrades open rather than locking everyone out. That is a deliberate trade. We would rather occasionally allow a replay than wrongly reject a paying customer, because the downside of the first is a few cents and the downside of the second is a user who thinks we stole their money.

## Why bother, for a penny

0.01 USDC is nothing. Why build a five-point on-chain verification for a penny?

Because the point was never the penny. It is the pattern. This is how an x402-style pay-per-call gate should work when the payer is a human in a browser instead of an agent with an API key: the client makes paying easy, and the server makes faking it impossible. The free preview still shows you the verdict and the pool liquidity with no payment at all, three checks a day. The paid unlock adds the sizing math on top: how big you can trade before you move the price, and how much you would actually recover if you sold into the pool today. That is the part worth gating, so that is the part the chain has to confirm you paid for.

Build the convenient path for honest users. Build the verification for everyone else. The button can lie all it wants. The ledger cannot.

You can try it on any Base token at api.greyridgesignals.ai/check, or read how the underlying safety check decides go, caution, or danger in our other writeups.
