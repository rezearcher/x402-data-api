Run five of the most-traded tokens on Base through a dumb rug checklist and USD Coin comes back as one of the most dangerous things you can hold. Owner can mint new supply. Contract can freeze your wallet. Transfers can be paused. The logic sitting behind the address can be swapped out after you buy. Four red boxes ticked. If a checklist is all you have, you just flagged the most-used stablecoin on the chain as a probable rug.

That is not a hypothetical. I pulled it live this morning.

## What the engine actually returns

We run a free, keyless token check at `/check?token=`. It reads the contract on-chain, simulates a transfer, measures the WETH-pool liquidity, and hands back a verdict plus a risk score from 0 to 100. Here is what five Base blue-chips scored on 23 October 2026:

| Token | Verdict | Risk | What fired |
|-------|---------|------|-----------|
| WETH  | SAFE | 0  | nothing |
| AERO  | SAFE | 15 | owner can mint |
| DEGEN | SAFE | 20 | transfers can be paused |
| USDC  | SAFE | 25 | mint + blacklist + pause + upgradeable proxy |
| cbBTC | SAFE | 25 | mint + blacklist + pause + upgradeable proxy |

Look at USDC and cbBTC. Both carry the exact four admin powers a naive scanner treats as a death sentence. Both come back SAFE anyway. The score ticks up to acknowledge the controls exist, and the verdict still says these are fine to hold, because a 25 stays under the line where the engine switches to a caution.

So the engine sees the same four flags the dumb checklist sees. It just refuses to confuse a disclosure with a verdict.

## Admin controls are a disclosure, not a crime

Here is the thing nobody selling a green-checkmark badge wants to say out loud: mint, pause, blacklist, and upgradeability are features of almost every serious regulated asset on-chain. Circle can freeze USDC because a court can order Circle to freeze USDC. Coinbase can pause cbBTC because cbBTC is a custodied wrapper and the custodian needs a kill switch. These are not bugs that slipped past an audit. They are the reason a regulated institution was willing to issue the token at all.

A memecoin with a renounced owner and no pause function is, by the dumb checklist, "safer" than USD Coin. On the checklist. In reality the memecoin can have zero liquidity, a hidden sell tax, or a pair that lets you buy and never sell. The checklist cannot see any of that, so it rewards the thing that will actually drain you and punishes the thing that will not.

That is the trap. A rug check that only counts admin flags is measuring the wrong surface.

## What actually separates a rug from a stablecoin

Two things do the real work, and neither of them is on the admin-flag checklist.

First, a sell simulation. The engine gives a throwaway wallet a synthetic balance of the token out-of-band, then tries a plain `transfer()` and watches for a revert. If the token blocks the move, that is the single most common honeypot pattern and it fails loud. All five tokens above transferred cleanly. A honeypot would not.

Second, liquidity depth. USDC sits on roughly 213 million dollars of WETH-pool liquidity. cbBTC, about 24 million. AERO, about 1.9 million. When liquidity is that deep and the token demonstrably transfers, the scoring deliberately caps the risk at 25 no matter how many admin flags are set, because deep liquidity plus a clean sell is hard, measurable evidence the token trades. The code that does this literally has USD Coin named in the comment as the case it exists to handle. Over-weighting admin flags on a token like that is a known failure mode, and it is engineered out on purpose.

Flip it around. A token that reverts on a sell, or sits on four thousand dollars of liquidity, gets pushed toward CAUTION or AVOID even if its owner renounced everything and the checklist would wave it through. Honeypot and thin liquidity are the signals that cost people money. Mint and pause are the signals that make people feel clever on Twitter.

## Why this matters if you are shipping an agent

If you are wiring a trading agent, a wallet, or a Telegram bot that quotes token safety, the temptation is to grep the contract for `mint` and `pause` and call it a rug detector. It will ship fast and it will be confidently wrong. It will block your users from the safest asset on the chain and nod through the honeypot that drains them, because the honeypot renounced its owner to look clean.

The check we run is free and keyless for the preview, returns the verdict, the score, the reasons, and the liquidity in one JSON blob, and you can point it at any Base ERC-20. Paste an address, read what fired, and decide with the measurement in front of you instead of a checklist that mistakes a stablecoin for a scam.

Try it on a token you already hold: https://api.greyridgesignals.ai/check

Every number in this post came off the live engine on 23 October 2026. Run it yourself and the scores should match, or close to it as liquidity moves.
