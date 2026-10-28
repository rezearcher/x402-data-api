# The pre-trade safety check, as a shell command your CI can fail on

Most token-safety tools on Base are an HTTP API or a library you import and write code around. That is fine inside a running agent. It is awkward everywhere else a trade gets decided: a CI job that lints a new strategy, a pre-commit hook, a deploy gate, a quick check from your terminal before you wire a token into a bot.

So the gate now installs as a command.

```
pip install "git+https://github.com/rezearcher/greyridge-x402-tools@main"

greyridge-gate aero
greyridge-report aero
```

That is the whole setup. One pip install, no API key for the free preview, two commands on your PATH.

## What it actually prints

These are live runs from the installed v0.3.0, not mockups:

```
$ greyridge-gate aero
GO    SAFE  risk=15  token passes safety checks; trade is 0.01% of pool liquidity
  - owner can mint new supply
$ echo $?
0

$ greyridge-gate weth
GO    SAFE  risk=0  token passes safety checks; trade is 0.00% of pool liquidity
  - no honeypot, deep liquidity, no high-risk admin controls detected
$ echo $?
0

$ greyridge-report degen
SAFE     risk=20
  - transfers can be paused
$ echo $?
0
```

`greyridge-gate` gives you the pre-trade decision: GO, HOLD, or BLOCK. `greyridge-report` gives you the standing safety verdict: SAFE, CAUTION, or AVOID. Both take a Base symbol like `aero` or a raw `0x` address, and both accept `--json` for the full structured response (decision, verdict, risk_score, liquidity_usd, impact_pct_of_pool, flags).

## The part that matters for CI: the exit code

The commands are not just pretty-printers. GO exits 0. HOLD exits 1. BLOCK exits 2. SAFE, CAUTION and AVOID map the same way for the report command. That means a shell gate works with no glue code:

```
greyridge-gate "$TOKEN" || { echo "pre-trade gate did not return GO"; exit 1; }
```

Drop that in a GitHub Actions step, a Makefile target, or a deploy script, and anything that is not a clean GO stops the job. You get the same honeypot, admin-control and pool-sizing checks the HTTP route runs, except the output is an exit status your pipeline already understands.

## How this compares to the SDKs

GoPlus ships a real and widely used Python SDK: `pip install goplus`, then you import its `Token` class and call it with a chain ID and a list of token addresses. It returns token properties. It is a library, so you write the Python that calls it, interprets the fields, and decides what to do. There is no command you can run and no exit code to branch on.

Two honest differences, not a knock on a good tool:

- Ours is a runnable command with a CI-meaningful exit status, so it works in places where importing an SDK and writing a script does not fit.
- The reputation APIs answer "is this token a scam?" from token properties. They do not take your trade size. Our gate also measures your order against live Uniswap v3 WETH-pool liquidity, so a safe token in a thin pool still returns HOLD when the fill would move the price against you. In the run above, the aero trade is 0.01% of pool liquidity, which is why it cleared.

We are not the cheapest safety route on Base and we do not claim to be. The free preview shown here is rate limited per IP; paid calls settle over x402 with the `--paid` flag when you install the `[pay]` extra.

## What this is and is not

This is a static and heuristic safety signal, not a pentest, not financial advice, and not a guarantee. A GO or a SAFE means no known honeypot pattern matched, admin controls look ordinary, and the pool is deep enough for the order as sized. It does not mean the trade will be profitable and it does not mean the token is risk free. The pool-impact figure is measured at scan time and markets move. Wire it as one gate in your pre-trade path, set to actually block, alongside your own slippage and position limits. Never treat a GO as "safe" in the absolute.

One note on install: the `git+` URL above is the live channel today. The plain `pip install greyridge-x402-tools` name on PyPI is being set up and is not live yet, so use the git URL for now.

## Try it

- Install and run the two commands above on any Base token in your terminal right now (free preview).
- See the free-preview output shape and per-call pricing: [api.greyridgesignals.ai/pricing](https://api.greyridgesignals.ai/pricing)
- Prefer the HTTP route for an always-on agent: [gate/swap preview](https://api.greyridgesignals.ai/gate/swap/preview?token=aero&side=buy&notionalUsd=100)
